import { can, type UserCtx } from '../auth/permissions';
import { isApprovalKind, resolvePolicy, type ResolvedPolicy } from '../approvals/policy';
import { loadApprovalPolicies } from '../approvals/policy-store';
import { readOptional } from '../db/optional';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { zeroMetrics } from '../reports/metrics';
import { expensesReport } from '../reports/expenses';
import { salesReport } from '../reports/sales';
import { stockReport } from '../reports/stock';
import type { EntityFilter, ReportMetrics, ReportScope } from '../reports/types';
import { businessDate } from '../time';

const ITEM_CAP = 8;

const APPROVAL_TITLES: Record<string, string> = {
  invoice_batch_issue: 'Emisión de facturas en lote',
  intercompany_invoice_issue: 'Factura intercompañía',
  regulatory_submission: 'Envío regulatorio',
  emcs_submission: 'Envío e-DA',
  edi_submission: 'Mensaje EDI',
  organic_report: 'Informe ecológico',
  cellar_loss: 'Mermas y destrucciones',
  inventory_adjustment: 'Regularización de aforo',
  billing_rules_activation: 'Activación de reglas de facturación',
  tariff_activation: 'Activación de tarifas',
  module_toggle: 'Módulos',
  third_party_message: 'Mensaje a terceros',
};

export interface AttentionItem {
  id: string;
  title: string;
  detail: string | null;
  href: string | null;
  days_left: number | null;
  can_act?: boolean;
  own?: boolean;
}

export interface AttentionBlock {
  count: number;
  items: AttentionItem[];
}

export interface MoneyBucket {
  key: string;
  label: string;
  amount: string;
  count: number;
}

export interface ReceivablesBlock {
  count: number;
  amount: string;
  buckets: MoneyBucket[];
}

export interface YearBlock {
  from: string;
  to: string;
  sales: ReportMetrics;
  expenses: ReportMetrics;
  stock: ReportMetrics;
}

export interface DashboardBody {
  entity: EntityFilter;
  approvals_pending: AttentionBlock;
  deadlines_next_30d: AttentionBlock | null;
  receivables_overdue: ReceivablesBlock | null;
  alerts: AttentionBlock;
  year: YearBlock | null;
  verifactu_pending: { count: number; since: string | null } | null;
  submissions_failed: AttentionBlock | null;
  cellar_alerts: AttentionBlock | null;
  stock_alerts: AttentionBlock | null;
}

interface Scope {
  entity: EntityFilter;
  po: boolean;
  cvpo: boolean;
}

export async function loadDashboard(writer: Writer, user: UserCtx, url: URL, now: Date): Promise<DashboardBody> {
  const requested = parseEntity(url.searchParams.get('entity'));
  const scope = scopeFor(user, requested);
  const today = businessDate(now);
  const [approvals, deadlines, receivables, alerts, year, verifactu, submissions, stock, cellar] = await Promise.all([
    pendingApprovals(writer, user, scope, now),
    can(user, 'reports.read') || can(user, 'billing.read') ? deadlinesWithin(writer, scope, today) : Promise.resolve(null),
    can(user, 'billing.read') ? overdueReceivables(writer, scope, today) : Promise.resolve(null),
    openAlerts(writer, user.id),
    can(user, 'reports.read') ? yearHeadlines(writer, scope, today) : Promise.resolve(null),
    can(user, 'billing.read') ? verifactuPending(writer, scope) : Promise.resolve(null),
    can(user, 'billing.read') ? failedSubmissions(writer, scope, today) : Promise.resolve(null),
    can(user, 'inventory.read') ? stockGaps(writer, scope) : Promise.resolve(null),
    can(user, 'cellar.read') ? cellarAlerts(writer, scope, today) : Promise.resolve(null),
  ]);
  return {
    entity: scope.entity,
    approvals_pending: approvals,
    deadlines_next_30d: deadlines,
    receivables_overdue: receivables,
    alerts,
    year,
    verifactu_pending: verifactu,
    submissions_failed: submissions,
    cellar_alerts: cellar,
    stock_alerts: stock,
  };
}

function parseEntity(raw: string | null): EntityFilter {
  if (raw == null || raw.trim() === '') return 'both';
  const normalized = raw.trim().toLowerCase().replace(/\./g, '');
  if (normalized === 'po') return 'PO';
  if (normalized === 'cvpo') return 'CVPO';
  if (normalized === 'both' || normalized === 'ambas' || normalized === 'all' || normalized === 'todas') return 'both';
  throw domainError('WC_VALIDATION', { entity: 'La entidad debe ser P.O, CVPO o ambas' });
}

function scopeFor(user: UserCtx, requested: EntityFilter): Scope {
  const allowed = allowedCodes(user);
  if (requested === 'PO' && !allowed.has('PO')) throw domainError('WC_FORBIDDEN');
  if (requested === 'CVPO' && !allowed.has('CVPO')) throw domainError('WC_FORBIDDEN');
  const po = requested !== 'CVPO' && allowed.has('PO');
  const cvpo = requested !== 'PO' && allowed.has('CVPO');
  const entity: EntityFilter = po && cvpo ? 'both' : po ? 'PO' : 'CVPO';
  return { entity: po || cvpo ? entity : requested, po, cvpo };
}

function allowedCodes(user: UserCtx): Set<string> {
  const codes = new Set<string>();
  let unrestricted = false;
  for (const role of user.roles) {
    if (role.legalEntityId == null) unrestricted = true;
    else if (role.legalEntityCode === 'PO' || role.legalEntityCode === 'CVPO') codes.add(role.legalEntityCode);
  }
  if (unrestricted) {
    codes.add('PO');
    codes.add('CVPO');
  }
  return codes;
}

function entityPredicate(scope: Scope, column = 'e.code'): string {
  if (!scope.po && !scope.cvpo) return 'FALSE';
  const parts: string[] = [];
  if (scope.po) parts.push(`${column} = 'PO'`);
  if (scope.cvpo) parts.push(`${column} = 'CVPO'`);
  return `(${parts.join(' OR ')})`;
}

const CELLAR_RULES: Record<string, string> = {
  stuck: 'Fermentación parada',
  temperature: 'Temperatura fuera de rango',
  density_stall: 'Densidad estancada',
  winter_racking: 'Trasiego de invierno',
  post_spring_bottling: 'Embotellado tras la primavera',
};

async function cellarAlerts(writer: Writer, scope: Scope, today: string): Promise<AttentionBlock> {
  const year = today.slice(0, 4);
  const [ferment, reminders] = await Promise.all([
    readOptional<Record<string, unknown>>(writer, `
      SELECT a.id, a.rule, l.code AS lot_code
      FROM cellar.fermentation_alert a
      JOIN inventory.lot l ON l.id = a.lot_id
      JOIN core.legal_entity e ON e.id = l.producer_entity_id
      WHERE a.status = 'open' AND ${entityPredicate(scope)}
      ORDER BY a.opened_at DESC, a.id DESC
      LIMIT 50
    `),
    readOptional<Record<string, unknown>>(writer, `
      SELECT d.id, d.rule_code AS rule, l.code AS lot_code, d.season_key
      FROM enology.reminder_dispatch d
      JOIN inventory.lot l ON l.id = d.lot_id
      JOIN core.legal_entity e ON e.id = d.legal_entity_id
      WHERE d.season_key = ${sqlQuote(year)} AND ${entityPredicate(scope)}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 50
    `),
  ]);
  const items: AttentionItem[] = [];
  for (const row of [...(ferment ?? []), ...(reminders ?? [])]) {
    const id = idOf(row.id);
    if (!id) continue;
    const rule = text(row.rule) ?? 'alerta';
    const code = text(row.lot_code);
    const season = text(row.season_key);
    items.push({
      id,
      title: CELLAR_RULES[rule] ?? rule,
      detail: season && code ? `${code} · ${season}` : code ?? season,
      href: code ? `/bodega/lotes/${encodeURIComponent(code)}` : '/bodega/lotes',
      days_left: null,
    });
  }
  return block(items);
}

function emptyBlock(): AttentionBlock {
  return { count: 0, items: [] };
}

function block(items: AttentionItem[]): AttentionBlock {
  return { count: items.length, items: items.slice(0, ITEM_CAP) };
}

async function pendingApprovals(writer: Writer, user: UserCtx, scope: Scope, now: Date): Promise<AttentionBlock> {
  const rows = await readOptional<Record<string, unknown>>(writer, sql`
    SELECT r.id, r.kind, r.legal_entity_id, e.code AS legal_entity_code, r.summary,
           r.requested_by, r.expires_at
    FROM ops.approval_request r
    LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE r.status = 'pending' AND r.expires_at >= ${now}
    ORDER BY r.requested_at, r.id
    LIMIT 200
  `);
  if (!rows) return emptyBlock();
  const [policies, decided] = await Promise.all([
    loadApprovalPolicies(writer).catch((error: unknown) => {
      if (missing(error)) return [];
      throw error;
    }),
    decidedIds(writer, user.id),
  ]);
  const items: AttentionItem[] = [];
  for (const row of rows) {
    const kind = text(row.kind);
    const id = idOf(row.id);
    if (!kind || !id || !isApprovalKind(kind)) continue;
    const entityCode = text(row.legal_entity_code);
    const entityId = idOf(row.legal_entity_id);
    if (!approvalInScope(entityCode, scope)) continue;
    const requestedBy = (text(row.requested_by) ?? '').toLowerCase();
    const own = requestedBy !== '' && requestedBy === user.id.toLowerCase();
    const policy = resolvePolicy(policies, { kind, legalEntityId: entityId });
    const canAct = !decided.has(id)
      && mayDecide(policy, entityId, user)
      && (policy.allowSelfApproval || !own);
    if (!own && !canAct) continue;
    const summary = text(row.summary);
    items.push({
      id,
      title: APPROVAL_TITLES[kind] ?? summary ?? kind,
      detail: summary,
      href: `/aprobaciones/${id}`,
      days_left: null,
      can_act: canAct,
      own,
    });
  }
  return block(items);
}

function approvalInScope(code: string | null, scope: Scope): boolean {
  if (code == null) return true;
  if (code === 'PO') return scope.po;
  if (code === 'CVPO') return scope.cvpo;
  return false;
}

function mayDecide(policy: ResolvedPolicy, entityId: string | null, user: UserCtx): boolean {
  if (policy.allowedUserIds.length > 0 && !policy.allowedUserIds.includes(user.id.toLowerCase())) return false;
  return user.roles.some((assignment) => {
    if (!policy.allowedRoles.includes(assignment.role)) return false;
    if (assignment.legalEntityId == null) return true;
    if (entityId == null) return false;
    return assignment.legalEntityId.toLowerCase() === entityId;
  });
}

async function decidedIds(writer: Writer, userId: string): Promise<Set<string>> {
  const rows = await readOptional<{ request_id: unknown }>(writer, sql`
    SELECT request_id FROM ops.approval_decision WHERE decided_by = CAST(${userId} AS UUID)
  `);
  return new Set((rows ?? []).map((row) => idOf(row.request_id)).filter((id): id is string => id != null));
}

async function deadlinesWithin(writer: Writer, scope: Scope, today: string): Promise<AttentionBlock> {
  const until = addDays(today, 30);
  const rows = await readOptional<Record<string, unknown>>(writer, `
    SELECT o.id, o.title, o.flow, CAST(o.due_date AS VARCHAR) AS due_date
    FROM regulatory.obligation o
    JOIN core.legal_entity e ON e.id = o.legal_entity_id
    WHERE o.status IN ('open', 'in_progress')
      AND o.due_date >= CAST(${sqlQuote(today)} AS DATE)
      AND o.due_date <= CAST(${sqlQuote(until)} AS DATE)
      AND ${entityPredicate(scope)}
    ORDER BY o.due_date, o.id
  `);
  if (!rows) return emptyBlock();
  return block(rows.flatMap((row) => {
    const id = idOf(row.id);
    const due = dateOf(row.due_date);
    if (!id || !due) return [];
    const flow = text(row.flow);
    const title = text(row.title) ?? flow ?? 'Plazo';
    return [{
      id,
      title,
      detail: flow,
      href: '/regulatorio',
      days_left: daysBetween(today, due),
    }];
  }));
}

async function overdueReceivables(writer: Writer, scope: Scope, today: string): Promise<ReceivablesBlock> {
  const predicate = entityPredicate(scope);
  const [invoices, legacy] = await Promise.all([
    readOptional<Record<string, unknown>>(writer, `
      SELECT CAST(i.total - i.amount_paid AS VARCHAR) AS outstanding,
             CAST(min(d.due_date) AS VARCHAR) AS due_date
      FROM billing.invoice i
      JOIN billing.invoice_due d ON d.invoice_id = i.id
      JOIN core.legal_entity e ON e.id = i.legal_entity_id
      WHERE i.status = 'issued'
        AND i.payment_status IN ('unpaid', 'partially_paid')
        AND i.total > i.amount_paid
        AND COALESCE(i.origin, 'native') <> 'holded_import'
        AND ${predicate}
      GROUP BY i.id, i.total, i.amount_paid
    `),
    readOptional<Record<string, unknown>>(writer, `
      SELECT CAST(o.amount - o.amount_paid AS VARCHAR) AS outstanding,
             CAST(o.due_date AS VARCHAR) AS due_date
      FROM legacy.open_item o
      JOIN core.legal_entity e ON e.id = o.entity_id
      WHERE o.direction = 'receivable'
        AND o.status IN ('open', 'partially_paid')
        AND o.due_date IS NOT NULL
        AND o.amount > o.amount_paid
        AND ${predicate}
    `),
  ]);
  const buckets = new Map<string, { label: string; amount: ReturnType<typeof money.fromString>; count: number }>([
    ['0-30', { label: '0–30 días', amount: money.fromString('0'), count: 0 }],
    ['31-60', { label: '31–60 días', amount: money.fromString('0'), count: 0 }],
    ['60+', { label: 'Más de 60', amount: money.fromString('0'), count: 0 }],
  ]);
  let total = money.fromString('0');
  let count = 0;
  for (const row of [...(invoices ?? []), ...(legacy ?? [])]) {
    const due = dateOf(row.due_date);
    if (!due || due >= today) continue;
    const outstanding = money.fromString(decimalText(row.outstanding));
    if (outstanding.lte(0)) continue;
    const age = daysBetween(due, today);
    const key = age <= 30 ? '0-30' : age <= 60 ? '31-60' : '60+';
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.amount = money.add(bucket.amount, outstanding);
    bucket.count += 1;
    total = money.add(total, outstanding);
    count += 1;
  }
  return {
    count,
    amount: money.toString(total),
    buckets: [...buckets].map(([key, bucket]) => ({
      key,
      label: bucket.label,
      amount: money.toString(bucket.amount),
      count: bucket.count,
    })),
  };
}

async function openAlerts(writer: Writer, userId: string): Promise<AttentionBlock> {
  const rows = await readOptional<Record<string, unknown>>(writer, sql`
    SELECT id, title, body, link
    FROM core.notification
    WHERE user_id = CAST(${userId} AS UUID) AND read_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `);
  if (!rows) return emptyBlock();
  return block(rows.flatMap((row) => {
    const id = idOf(row.id);
    const title = text(row.title);
    if (!id || !title) return [];
    return [{
      id,
      title,
      detail: text(row.body),
      href: text(row.link),
      days_left: null,
    }];
  }));
}

async function yearHeadlines(writer: Writer, scope: Scope, today: string): Promise<YearBlock> {
  const from = `${today.slice(0, 4)}-01-01`;
  const reportScope: ReportScope = {
    from,
    to: today,
    groupBy: 'month',
    compare: null,
    entity: scope.entity === 'PO' || scope.entity === 'CVPO' ? scope.entity : 'both',
    entities: [...(scope.po ? ['PO'] : []), ...(scope.cvpo ? ['CVPO'] : [])],
    po: scope.po,
    cvpo: scope.cvpo,
  };
  const [sales, expenses, stock] = await Promise.all([
    headline(scope, () => salesReport(writer, reportScope)),
    headline(scope, () => expensesReport(writer, reportScope)),
    headline(scope, () => stockReport(writer, reportScope)),
  ]);
  return { from, to: today, sales, expenses, stock };
}

async function headline(scope: Scope, load: () => Promise<{ totals: ReportMetrics }>): Promise<ReportMetrics> {
  if (!scope.po && !scope.cvpo) return zeroMetrics();
  try {
    return (await load()).totals;
  } catch (error) {
    if (missing(error)) return zeroMetrics();
    throw error;
  }
}

async function verifactuPending(writer: Writer, scope: Scope): Promise<{ count: number; since: string | null }> {
  const rows = await readOptional<Record<string, unknown>>(writer, `
    SELECT count(*)::INTEGER AS n, min(v.generated_at) AS since
    FROM regulatory.verifactu_record v
    JOIN core.legal_entity e ON e.id = v.legal_entity_id
    WHERE v.send_status IN ('pending', 'sending')
      AND ${entityPredicate(scope)}
  `);
  const row = rows?.[0];
  if (!row) return { count: 0, since: null };
  const count = Number(row.n ?? 0);
  return { count: Number.isFinite(count) ? count : 0, since: count > 0 ? text(row.since) : null };
}

async function failedSubmissions(writer: Writer, scope: Scope, today: string): Promise<AttentionBlock> {
  const rows = await readOptional<Record<string, unknown>>(writer, `
    SELECT s.id, s.flow, s.kind, s.status, CAST(s.due_date AS VARCHAR) AS due_date
    FROM regulatory.submission s
    JOIN core.legal_entity e ON e.id = s.legal_entity_id
    WHERE s.status IN ('failed', 'rejected')
      AND ${entityPredicate(scope)}
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT 100
  `);
  if (!rows) return emptyBlock();
  return block(rows.flatMap((row) => {
    const id = idOf(row.id);
    const flow = text(row.flow) ?? 'Envío';
    const kind = text(row.kind);
    if (!id) return [];
    const due = dateOf(row.due_date);
    return [{
      id,
      title: kind ? `${flow} · ${kind}` : flow,
      detail: text(row.status),
      href: '/regulatorio',
      days_left: due ? daysBetween(today, due) : null,
    }];
  }));
}

async function stockGaps(writer: Writer, scope: Scope): Promise<AttentionBlock> {
  const rows = await readOptional<Record<string, unknown>>(writer, `
    SELECT d.id, d.explanation, d.difference_ml
    FROM regulatory.reconciliation_diff d
    JOIN regulatory.reconciliation_run r ON r.id = d.run_id
    JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE r.kind = 'physical_vs_fiscal'
      AND r.status = 'differences'
      AND d.difference_ml <> 0
      AND ${entityPredicate(scope)}
    ORDER BY r.run_at DESC, d.id DESC
    LIMIT 100
  `);
  if (!rows) return emptyBlock();
  return block(rows.flatMap((row) => {
    const id = idOf(row.id);
    if (!id) return [];
    const ml = text(row.difference_ml);
    return [{
      id,
      title: text(row.explanation) ?? 'Descuadre físico y fiscal',
      detail: ml ? `${ml} ml` : null,
      href: '/stock',
      days_left: null,
    }];
  }));
}

function missing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

function idOf(value: unknown): string | null {
  if (value == null) return null;
  const textValue = String(value).trim().toLowerCase();
  return textValue === '' ? null : textValue;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw === '' ? null : raw;
}

function dateOf(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value) ?? '');
  return match?.[1] ?? null;
}

function decimalText(value: unknown): string {
  const raw = text(value);
  return raw && /^-?\d+(\.\d+)?$/.test(raw) ? raw : '0';
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

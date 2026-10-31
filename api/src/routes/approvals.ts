import { isOwner, type UserCtx } from '../core/auth/permissions';
import { machineOf, requestIdFor, sessionOf } from '../auth/guard';
import type { HttpDeps } from './auth-credentials';
import { openApprovalService } from '../core/approvals/sql-store';
import { listPolicyViews, loadApprovalPolicies, saveApprovalPolicy, type PolicyView } from '../core/approvals/policy-store';
import { isApprovalKind, resolvePolicy, type ResolvedPolicy } from '../core/approvals/policy';
import type { ApprovalKind, ApprovalPolicy } from '../core/approvals/types';
import { readStepUp, sessionHash } from '../core/auth/stepup/session';
import { sql } from '../core/db/sql';
import type { Actor } from '../core/db/writer';
import { domainError } from '../core/errors';
import { syncSubmissionFromApproval } from '../core/regulatory/submissions';

const PAGE_SIZE = 50;
const LIST_CAP = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TITLES: Record<ApprovalKind, string> = {
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

const FIELD_LABELS: Record<string, string> = {
  litres: 'Litros',
  records: 'Registros',
  period: 'Periodo',
  destination: 'Destino',
  amount: 'Importe',
  description: 'Descripción',
};

interface RequestRow {
  id: string;
  kind: ApprovalKind;
  legalEntityId: string | null;
  legalEntityCode: string | null;
  summary: string;
  payloadSha256: string;
  details: unknown;
  status: string;
  requestedBy: string;
  requesterName: string | null;
  requestedAt: string;
  expiresAt: string;
  approvalsCount: number;
}

export async function listApprovals(deps: HttpDeps, request: Request) {
  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get('status'));
  const kind = parseKind(url.searchParams.get('kind'));
  const entity = parseEntity(url.searchParams.get('entity'));
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const now = deps.now();
  const rows = await loadRows(deps, now, { status, kind, entity });
  const visible = await visibleRows(deps, request, rows);
  return presentPage(deps, request, visible, cursor, now);
}

export async function getApproval(deps: HttpDeps, request: Request, id: string) {
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  const now = deps.now();
  const rows = await loadRows(deps, now, { status: 'all', kind: null, entity: null, id });
  const visible = await visibleRows(deps, request, rows);
  const row = visible[0];
  if (!row || row.id !== id.toLowerCase()) throw domainError('WC_NOT_FOUND');
  const summary = await toSummary(deps, request, row, now);
  const names = await displayNames(deps);
  const decisions = await deps.writer.read<Record<string, unknown>>(sql`
    SELECT decided_by, decision, note, decided_at, step_up_method
    FROM ops.approval_decision
    WHERE request_id = CAST(${row.id} AS UUID)
    ORDER BY decided_at, id
  `);
  return {
    ...summary,
    payload_display: payloadDisplay(row.details),
    decisions: decisions.map((decision) => ({
      decided_by: person(text(decision.decided_by) ?? '', names),
      decision: decision.decision === 'reject' ? 'reject' : 'approve',
      note: decision.note == null ? null : String(decision.note),
      decided_at: asIso(String(decision.decided_at)),
      step_up_method: decision.step_up_method === 'passkey' || decision.step_up_method === 'totp'
        ? decision.step_up_method
        : null,
    })),
  };
}

export async function decideApproval(deps: HttpDeps, request: Request, id: string, payload: unknown) {
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  const body = objectBody(payload);
  const now = deps.now();
  const rows = await loadRows(deps, now, { status: 'all', kind: null, entity: null, id });
  const visible = await visibleRows(deps, request, rows);
  const row = visible[0];
  if (!row || row.id !== id.toLowerCase()) throw domainError('WC_NOT_FOUND');

  const machine = machineOf(request);
  const clock = { now: deps.now };
  if (machine) {
    const service = await openApprovalService(deps.writer, {
      type: 'agent',
      id: machine.id,
      requestId: requestIdFor(request),
    }, clock);
    await service.decide({
      requestId: row.id,
      decision: body.decision === 'reject' ? 'reject' : 'approve',
      payloadSha256: typeof body.payload_sha256 === 'string' ? body.payload_sha256 : '',
      note: optionalNote(body.note),
      actor: {
        userId: machine.id,
        roles: [{ role: machine.roleCode, legalEntityId: null }],
        kind: machine.kind,
        stepUpAt: null,
      },
    });
    throw domainError('WC_FORBIDDEN');
  }

  const user = sessionOf(request);
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    throw domainError('WC_VALIDATION', { decision: 'La decisión no es válida' });
  }
  const step = await readStepUp(deps.writer, user.id, sessionHash(deps.config, request, user.id));
  const service = await openApprovalService(deps.writer, userActor(request, user.id), clock);
  await service.decide({
    requestId: row.id,
    decision: body.decision,
    payloadSha256: typeof body.payload_sha256 === 'string' ? body.payload_sha256 : '',
    note: optionalNote(body.note),
    stepUpMethod: step?.method ?? null,
    ip: clientIp(request),
    userAgent: clientAgent(request),
    actor: {
      userId: user.id,
      roles: user.roles.map((role) => ({ role: role.role, legalEntityId: role.legalEntityId })),
      kind: 'user',
      stepUpAt: step?.at ?? null,
    },
  });
  if (row.kind === 'regulatory_submission') {
    await syncSubmissionFromApproval(deps.writer, userActor(request, user.id), row.id);
  }
  const fresh = await loadRows(deps, deps.now(), { status: 'all', kind: null, entity: null, id: row.id });
  const updated = fresh[0];
  if (!updated) throw domainError('WC_NOT_FOUND');
  return toSummary(deps, request, updated, deps.now());
}

export async function getApprovalPolicy(deps: HttpDeps, _request: Request) {
  const items = await listPolicyViews(deps.writer);
  return { items };
}

export async function putApprovalPolicy(deps: HttpDeps, request: Request, kind: string, payload: unknown): Promise<PolicyView> {
  if (!isApprovalKind(kind)) {
    throw domainError('WC_VALIDATION', { kind: 'El tipo de aprobación no es válido' });
  }
  const body = objectBody(payload);
  const user = sessionOf(request);
  const allowedRoles = roleList(body.allowed_roles);
  const minApprovals = intField(body.min_approvals, 'min_approvals', 1, 3);
  const requiresStepUp = boolField(body.requires_step_up, 'requires_step_up');
  const validityHours = intField(body.validity_hours, 'validity_hours', 1, 168);
  const allowSelfApproval = boolField(body.allow_self_approval, 'allow_self_approval');
  if (allowedRoles.length === 0) {
    throw domainError('WC_VALIDATION', { allowed_roles: 'Ningún tipo puede quedar sin aprobador' });
  }
  return saveApprovalPolicy(deps.writer, userActor(request, user.id), {
    kind,
    legalEntityId: null,
    allowedRoles,
    minApprovals,
    requiresStepUp,
    validityMinutes: validityHours * 60,
    allowSelfApproval,
    updatedBy: user.id,
  }, deps.now());
}

async function loadRows(
  deps: HttpDeps,
  now: Date,
  filter: { status: 'pending' | 'decided' | 'all'; kind: ApprovalKind | null; entity: string | null; id?: string },
): Promise<RequestRow[]> {
  const where = [sql`TRUE`];
  if (filter.id) where.push(sql`r.id = CAST(${filter.id} AS UUID)`);
  if (filter.kind) where.push(sql`r.kind = ${filter.kind}`);
  if (filter.entity) where.push(sql`e.code = ${filter.entity}`);
  if (filter.status === 'pending') {
    where.push(sql`r.status = 'pending' AND r.expires_at >= ${now}`);
  } else if (filter.status === 'decided') {
    where.push(sql`(
      r.status IN ('rejected', 'consumed')
      OR (r.status = 'approved' AND r.expires_at >= ${now})
    )`);
  }
  const rows = await deps.writer.read<Record<string, unknown>>(`
    SELECT r.id, r.kind, r.legal_entity_id, e.code AS legal_entity_code, r.summary,
           r.payload_sha256, r.details, r.status, r.requested_by, r.requested_at, r.expires_at,
           (
             SELECT count(*) FROM ops.approval_decision d
             WHERE d.request_id = r.id AND d.decision = 'approve'
           ) AS approvals_count
    FROM ops.approval_request r
    LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.requested_at DESC, r.id DESC
    LIMIT ${LIST_CAP}
  `);
  const names = await displayNames(deps);
  return rows.flatMap((row) => {
    const kind = text(row.kind);
    const id = text(row.id);
    if (!kind || !isApprovalKind(kind) || !id) return [];
    const requestedBy = text(row.requested_by) ?? '';
    return [{
      id: id.toLowerCase(),
      kind,
      legalEntityId: row.legal_entity_id == null ? null : String(row.legal_entity_id).toLowerCase(),
      legalEntityCode: row.legal_entity_code == null ? null : String(row.legal_entity_code),
      summary: text(row.summary) ?? '',
      payloadSha256: (text(row.payload_sha256) ?? '').toLowerCase(),
      details: row.details,
      status: text(row.status) ?? '',
      requestedBy,
      requesterName: names.get(requestedBy.toLowerCase()) ?? null,
      requestedAt: asIso(text(row.requested_at) ?? ''),
      expiresAt: asIso(text(row.expires_at) ?? ''),
      approvalsCount: asInt(row.approvals_count),
    }];
  });
}

async function visibleRows(deps: HttpDeps, request: Request, rows: RequestRow[]): Promise<RequestRow[]> {
  const machine = machineOf(request);
  if (machine) return rows;
  const user = sessionOf(request);
  if (isOwner(user)) return rows;
  const policies = await loadApprovalPolicies(deps.writer);
  return rows.filter((row) => {
    if (row.requestedBy.toLowerCase() === user.id.toLowerCase()) return true;
    const policy = resolvePolicy(policies, { kind: row.kind, legalEntityId: row.legalEntityId });
    return roleMayDecide(policy, row.legalEntityId, user);
  });
}

async function toSummary(deps: HttpDeps, request: Request, row: RequestRow, now: Date) {
  const policies = await loadApprovalPolicies(deps.writer);
  const decided = await decidedIds(deps, request);
  return summaryOf(request, row, policies, decided, now);
}

async function presentPage(
  deps: HttpDeps,
  request: Request,
  rows: RequestRow[],
  cursor: { at: string; id: string } | null,
  now: Date,
) {
  let start = 0;
  if (cursor) {
    const index = rows.findIndex((row) => row.id === cursor.id);
    if (index === -1 || rows[index]?.requestedAt !== cursor.at) {
      throw domainError('WC_VALIDATION', { cursor: 'El cursor no es válido' });
    }
    start = index + 1;
  }
  const slice = rows.slice(start, start + PAGE_SIZE);
  const policies = await loadApprovalPolicies(deps.writer);
  const decided = await decidedIds(deps, request);
  const last = slice[slice.length - 1];
  return {
    items: slice.map((row) => summaryOf(request, row, policies, decided, now)),
    next_cursor: start + PAGE_SIZE < rows.length && last ? encodeCursor(last.requestedAt, last.id) : null,
    total: rows.length,
  };
}

function summaryOf(
  request: Request,
  row: RequestRow,
  policies: readonly ApprovalPolicy[],
  decided: Set<string>,
  now: Date,
) {
  const policy = resolvePolicy(policies, { kind: row.kind, legalEntityId: row.legalEntityId });
  const access = decisionAccess(request, row, policy, decided.has(row.id), now);
  return {
    id: row.id,
    kind: row.kind,
    legal_entity_code: row.legalEntityCode,
    title: TITLES[row.kind],
    summary: row.summary,
    requested_by: {
      id: row.requestedBy,
      display_name: row.requesterName ?? row.requestedBy,
    },
    requested_at: row.requestedAt,
    expires_at: row.expiresAt,
    status: effectiveStatus(row, now),
    min_approvals: policy.requiredApprovals,
    approvals_count: row.approvalsCount,
    payload_sha256: row.payloadSha256,
    can_decide: access.canDecide,
    reason_cannot_decide: access.reason,
  };
}

function decisionAccess(
  request: Request,
  row: RequestRow,
  policy: ResolvedPolicy,
  already: boolean,
  now: Date,
): { canDecide: boolean; reason: string | null } {
  const machine = machineOf(request);
  if (machine) {
    return { canDecide: false, reason: 'Solo una persona puede decidir una aprobación' };
  }
  const user = sessionOf(request);
  const status = effectiveStatus(row, now);
  if (status === 'expired') return { canDecide: false, reason: 'La aprobación ha caducado' };
  if (status !== 'pending') return { canDecide: false, reason: 'La aprobación no está pendiente' };
  if (already) return { canDecide: false, reason: 'Ya has decidido esta solicitud' };
  if (!roleMayDecide(policy, row.legalEntityId, user)) {
    return { canDecide: false, reason: `Solo puede decidir: ${policy.allowedRoles.join(', ')}` };
  }
  if (!policy.allowSelfApproval && user.id.toLowerCase() === row.requestedBy.toLowerCase()) {
    return { canDecide: false, reason: 'El solicitante no puede decidir su propia solicitud' };
  }
  return { canDecide: true, reason: null };
}

function roleMayDecide(policy: ResolvedPolicy, entityId: string | null, user: UserCtx): boolean {
  if (policy.allowedUserIds.length > 0 && !policy.allowedUserIds.includes(user.id.toLowerCase())) {
    return false;
  }
  return user.roles.some((assignment) => {
    if (!policy.allowedRoles.includes(assignment.role)) return false;
    if (assignment.legalEntityId === null) return true;
    if (entityId === null) return false;
    return assignment.legalEntityId.toLowerCase() === entityId;
  });
}

function effectiveStatus(row: RequestRow, now: Date): string {
  const expires = Date.parse(row.expiresAt);
  if ((row.status === 'pending' || row.status === 'approved') && !Number.isNaN(expires) && expires < now.getTime()) {
    return 'expired';
  }
  return row.status;
}

async function decidedIds(deps: HttpDeps, request: Request): Promise<Set<string>> {
  const machine = machineOf(request);
  if (machine) return new Set();
  const user = sessionOf(request);
  const rows = await deps.writer.read<{ request_id: string }>(sql`
    SELECT request_id FROM ops.approval_decision
    WHERE decided_by = CAST(${user.id} AS UUID)
  `);
  return new Set(rows.map((row) => row.request_id.toLowerCase()));
}

async function displayNames(deps: HttpDeps): Promise<Map<string, string>> {
  const rows = await deps.writer.read<{ id: string; display_name: string }>(`
    SELECT id, display_name FROM core.app_user
  `);
  return new Map(rows.map((row) => [row.id.toLowerCase(), row.display_name]));
}

function person(id: string, names: Map<string, string>) {
  return { id, display_name: names.get(id.toLowerCase()) ?? id };
}

function payloadDisplay(details: unknown): { label: string; value: string }[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  return Object.keys(details).sort().map((key) => ({
    label: FIELD_LABELS[key] ?? key.replaceAll('_', ' '),
    value: displayValue((details as Record<string, unknown>)[key]).slice(0, 2000),
  }));
}

function displayValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function parseStatus(value: string | null): 'pending' | 'decided' | 'all' {
  if (value === null || value === '' || value === 'pending') return 'pending';
  if (value === 'decided' || value === 'all') return value;
  throw domainError('WC_VALIDATION', { status: 'El estado no es válido' });
}

function parseKind(value: string | null): ApprovalKind | null {
  if (value === null || value.trim() === '') return null;
  if (!isApprovalKind(value)) {
    throw domainError('WC_VALIDATION', { kind: 'El tipo de aprobación no es válido' });
  }
  return value;
}

function parseEntity(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(trimmed)) {
    throw domainError('WC_VALIDATION', { entity: 'La entidad no es válida' });
  }
  return trimmed;
}

function parseCursor(value: string | null): { at: string; id: string } | null {
  if (value === null || value.trim() === '') return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw domainError('WC_VALIDATION', { cursor: 'El cursor no es válido' });
  }
  const split = decoded.lastIndexOf('|');
  if (split <= 0) throw domainError('WC_VALIDATION', { cursor: 'El cursor no es válido' });
  const at = decoded.slice(0, split);
  const id = decoded.slice(split + 1);
  if (!UUID_RE.test(id) || Number.isNaN(Date.parse(at))) {
    throw domainError('WC_VALIDATION', { cursor: 'El cursor no es válido' });
  }
  return { at, id: id.toLowerCase() };
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}

function userActor(request: Request, userId: string): Actor {
  return { type: 'user', id: userId, requestId: requestIdFor(request) };
}

function optionalNote(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw domainError('WC_VALIDATION', { note: 'La nota no es válida' });
  }
  return value;
}

function roleList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw domainError('WC_VALIDATION', { allowed_roles: 'Los roles no son válidos' });
  }
  const roles: string[] = [];
  for (const role of value) {
    if (role === 'agent' || role === 'mcp_client' || role === 'machine') {
      throw domainError('WC_VALIDATION', { allowed_roles: 'Un cliente de máquina no puede ser aprobador' });
    }
    if (!['owner', 'approver', 'admin', 'cellar', 'field', 'advisor'].includes(role)) {
      throw domainError('WC_VALIDATION', { allowed_roles: 'Los roles no son válidos' });
    }
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

function intField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw domainError('WC_VALIDATION', { [field]: 'El valor no es válido' });
  }
  return value;
}

function boolField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw domainError('WC_VALIDATION', { [field]: 'El valor no es válido' });
  }
  return value;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError('WC_VALIDATION');
  return value as Record<string, unknown>;
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (/^[0-9a-fA-F:.]{3,64}$/.test(forwarded)) return forwarded;
  return null;
}

function clientAgent(request: Request): string | null {
  const agent = request.headers.get('user-agent')?.replace(/[\u0000-\u001f]/g, '').trim() ?? '';
  if (agent === '') return null;
  return agent.slice(0, 300);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

function asInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function asIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

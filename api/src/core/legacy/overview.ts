import Decimal from 'decimal.js';
import type { UserCtx } from '../auth/permissions';
import type { Writer } from '../db/writer';
import { businessDate } from '../time';
import {
  contactVisibility,
  entityPredicate,
  legacyScope,
  parseEntityParam,
  type LegacyScope,
} from './scope';

export interface LegacyInvoiceRow {
  id: string;
  number: string;
  issue_date: string;
  counterparty_name: string;
  total: string;
  pending: string | null;
  status_holded: string;
  kind: string;
  entity_code: string;
}

export interface CompanyFigures {
  PO: string;
  CVPO: string;
}

export interface CompanyCounts {
  PO: number;
  CVPO: number;
}

export interface LegacyOverview {
  entity: LegacyScope['entity'];
  year: number;
  kpis: {
    sales_this_year: CompanyFigures;
    sales_last_year: CompanyFigures;
    pending_receivables: CompanyFigures;
    pending_receivables_count: CompanyCounts;
    contacts: number;
    open_payables: string;
    open_payables_count: number;
  };
  recent_invoices: LegacyInvoiceRow[];
  top_customers: { name: string; total: string; invoices: number }[];
  months: { month: number; PO: string; CVPO: string }[];
  has_imported: boolean;
}

/**
 * Ventas del panel: facturas emitidas en WineCore, por sociedad y año civil.
 * El histórico proyectado (`origin = 'holded_import'`) no suma: es la misma
 * factura que `legacy.holded_invoice` y sigue viviendo en los libros registro.
 * Una sustitución emitida quita el original.
 */
const NATIVE_SALE = `
  i.status = 'issued'
  AND COALESCE(i.origin, 'native') <> 'holded_import'
  AND NOT EXISTS (
    SELECT 1
    FROM billing.invoice_rectification r
    JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
    WHERE r.relation = 'substituted'
      AND rect.status = 'issued'
      AND (
        r.rectified_invoice_id = i.id
        OR (
          r.rectified_number = i.number
          AND r.rectified_issue_date = i.issue_date
          AND rect.legal_entity_id = i.legal_entity_id
        )
      )
  )`;

const CUSTOMER_NAME = `COALESCE(NULLIF(trim(json_extract_string(i.customer_snapshot, '$.name')), ''), c.legal_name, '')`;

export async function loadLegacyOverview(writer: Writer, user: UserCtx, url: URL, now: Date): Promise<LegacyOverview> {
  const scope = legacyScope(user, parseEntityParam(url.searchParams.get('entity')));
  const today = businessDate(now);
  const year = Number(today.slice(0, 4));
  const entity = entityPredicate(scope);
  const contacts = contactVisibility(scope);
  const thisFrom = `${year}-01-01`;
  const thisTo = `${year}-12-31`;
  const lastFrom = `${year - 1}-01-01`;
  const lastTo = `${year - 1}-12-31`;

  const [sales, receivables, payables, contactRows, recent, customers, months, presence] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      SELECT e.code AS code,
             COALESCE(SUM(CASE WHEN i.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}' THEN i.total END), 0) AS this_year,
             COALESCE(SUM(CASE WHEN i.issue_date BETWEEN DATE '${lastFrom}' AND DATE '${lastTo}' THEN i.total END), 0) AS last_year
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
       WHERE ${NATIVE_SALE}
         AND i.issue_date BETWEEN DATE '${lastFrom}' AND DATE '${thisTo}'
         AND ${entity}
       GROUP BY e.code
    `),
    writer.read<Record<string, unknown>>(`
      SELECT code, COALESCE(SUM(outstanding), 0) AS amount, COUNT(*) AS n
        FROM (
          SELECT e.code AS code, (i.total - i.amount_paid) AS outstanding
            FROM billing.invoice i
            JOIN core.legal_entity e ON e.id = i.legal_entity_id
           WHERE ${NATIVE_SALE}
             AND i.payment_status IN ('unpaid', 'partially_paid')
             AND i.total > i.amount_paid
             AND ${entity}
          UNION ALL
          SELECT e.code, (o.amount - o.amount_paid)
            FROM legacy.open_item o
            JOIN core.legal_entity e ON e.id = o.entity_id
           WHERE o.direction = 'receivable'
             AND o.status IN ('open', 'partially_paid')
             AND o.amount > o.amount_paid
             AND ${entity}
        ) dues
       GROUP BY code
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COALESCE(SUM(outstanding), 0) AS amount, COUNT(*) AS n
        FROM (
          SELECT (s.total - s.amount_paid) AS outstanding
            FROM purchasing.supplier_invoice s
            JOIN core.legal_entity e ON e.id = s.legal_entity_id
           WHERE s.status = 'approved'
             AND COALESCE(s.origin, 'native') <> 'holded_import'
             AND s.payment_status IN ('unpaid', 'partially_paid')
             AND s.total > s.amount_paid
             AND ${entity}
          UNION ALL
          SELECT (o.amount - o.amount_paid)
            FROM legacy.open_item o
            JOIN core.legal_entity e ON e.id = o.entity_id
           WHERE o.direction = 'payable'
             AND o.status IN ('open', 'partially_paid')
             AND o.amount > o.amount_paid
             AND ${entity}
        ) dues
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS contacts
        FROM party.contact c
       WHERE c.archived_at IS NULL AND c.merged_into_id IS NULL
         AND ${contacts}
    `),
    writer.read<Record<string, unknown>>(`
      SELECT i.id, i.number, CAST(i.issue_date AS VARCHAR) AS issue_date,
             ${CUSTOMER_NAME} AS counterparty_name,
             CAST(i.total AS VARCHAR) AS total,
             CAST(i.total - i.amount_paid AS VARCHAR) AS pending,
             i.status, i.payment_status, e.code AS entity_code
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
        LEFT JOIN party.contact c ON c.id = i.customer_id
       WHERE i.status IN ('issued', 'voided')
         AND COALESCE(i.origin, 'native') <> 'holded_import'
         AND ${entity}
       ORDER BY i.issue_date DESC, i.number DESC, i.id DESC
       LIMIT 8
    `),
    writer.read<Record<string, unknown>>(`
      SELECT ${CUSTOMER_NAME} AS name,
             CAST(COALESCE(SUM(i.total), 0) AS VARCHAR) AS total,
             COUNT(*) AS invoices
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
        LEFT JOIN party.contact c ON c.id = i.customer_id
       WHERE ${NATIVE_SALE}
         AND i.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
         AND ${entity}
       GROUP BY 1
       ORDER BY SUM(i.total) DESC, 1
       LIMIT 5
    `),
    writer.read<Record<string, unknown>>(`
      SELECT e.code AS code,
             CAST(month(i.issue_date) AS INTEGER) AS month,
             CAST(COALESCE(SUM(i.total), 0) AS VARCHAR) AS total
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
       WHERE ${NATIVE_SALE}
         AND i.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
         AND ${entity}
       GROUP BY 1, 2
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS invoices
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
       WHERE COALESCE(i.origin, 'native') <> 'holded_import'
         AND ${entity}
    `),
  ]);

  const byMonth = new Map<string, string>();
  for (const row of months) {
    const code = codeOf(row.code);
    const month = intOf(row.month);
    if (code && month >= 1 && month <= 12) byMonth.set(`${code}:${month}`, money2(row.total));
  }
  const payable = payables[0] ?? {};
  const contactCount = intOf(contactRows[0]?.contacts);
  const nativeInvoices = intOf(presence[0]?.invoices);

  return {
    entity: scope.entity,
    year,
    kpis: {
      sales_this_year: figuresOf(sales, scope, 'this_year'),
      sales_last_year: figuresOf(sales, scope, 'last_year'),
      pending_receivables: figuresOf(receivables, scope, 'amount'),
      pending_receivables_count: countsOf(receivables, scope),
      contacts: contactCount,
      open_payables: money2(payable.amount),
      open_payables_count: intOf(payable.n),
    },
    recent_invoices: recent.map(nativeInvoiceOf),
    top_customers: customers.map((row) => ({
      name: String(row.name ?? ''),
      total: money2(row.total),
      invoices: intOf(row.invoices),
    })),
    months: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return {
        month,
        PO: scope.po ? byMonth.get(`PO:${month}`) ?? '0.00' : '0.00',
        CVPO: scope.cvpo ? byMonth.get(`CVPO:${month}`) ?? '0.00' : '0.00',
      };
    }),
    has_imported: nativeInvoices > 0 || contactCount > 0,
  };
}

function figuresOf(rows: Record<string, unknown>[], scope: LegacyScope, field: string): CompanyFigures {
  const figures: CompanyFigures = { PO: '0.00', CVPO: '0.00' };
  for (const row of rows) {
    const code = codeOf(row.code);
    if (!code || !visible(scope, code)) continue;
    figures[code] = money2(row[field]);
  }
  return figures;
}

function countsOf(rows: Record<string, unknown>[], scope: LegacyScope): CompanyCounts {
  const counts: CompanyCounts = { PO: 0, CVPO: 0 };
  for (const row of rows) {
    const code = codeOf(row.code);
    if (!code || !visible(scope, code)) continue;
    counts[code] = intOf(row.n);
  }
  return counts;
}

function visible(scope: LegacyScope, code: 'PO' | 'CVPO'): boolean {
  return code === 'PO' ? scope.po : scope.cvpo;
}

function codeOf(value: unknown): 'PO' | 'CVPO' | null {
  const code = String(value ?? '');
  return code === 'PO' || code === 'CVPO' ? code : null;
}

function nativeInvoiceOf(row: Record<string, unknown>): LegacyInvoiceRow {
  const pending = row.pending == null || row.pending === '' ? null : money2(row.pending);
  return {
    id: String(row.id),
    number: String(row.number ?? ''),
    issue_date: dateOf(row.issue_date),
    counterparty_name: String(row.counterparty_name ?? ''),
    total: money2(row.total),
    pending,
    status_holded: saleStatus(row.status, row.payment_status),
    kind: 'sale',
    entity_code: String(row.entity_code ?? ''),
  };
}

function saleStatus(status: unknown, payment: unknown): string {
  if (status === 'voided') return 'Anulada';
  if (status === 'draft') return 'Borrador';
  if (payment === 'paid') return 'Cobrada';
  if (payment === 'partially_paid') return 'Cobro parcial';
  if (payment === 'uncollectible') return 'Incobrable';
  if (payment === 'unpaid') return 'Pendiente';
  return String(payment ?? status ?? '');
}

export function invoiceOf(row: Record<string, unknown>): LegacyInvoiceRow {
  const pending = row.pending == null || row.pending === '' ? null : money2(row.pending);
  return {
    id: String(row.id),
    number: String(row.number ?? ''),
    issue_date: dateOf(row.issue_date),
    counterparty_name: String(row.counterparty_name ?? ''),
    total: money2(row.total),
    pending,
    status_holded: String(row.status_holded ?? ''),
    kind: String(row.kind ?? ''),
    entity_code: String(row.entity_code ?? ''),
  };
}

export function money2(value: unknown): string {
  if (value == null || value === '') return '0.00';
  try {
    return new Decimal(String(value)).toFixed(2);
  } catch {
    return '0.00';
  }
}

export function intOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function dateOf(value: unknown): string {
  const text = String(value ?? '');
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match?.[1] ?? text;
}

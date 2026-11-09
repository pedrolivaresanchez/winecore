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
    /** Facturas emitidas del año, una por documento. */
    issued_count: CompanyCounts;
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
 * Ventas del panel: cada factura emitida cuenta una vez, partida por sociedad.
 * La proyección `origin = holded_import` y la fila de `legacy.holded_invoice`
 * son la misma factura. Entra la de billing (nativa o importada) y la de Holded
 * solo si todavía no está proyectada, ni por `holded_invoice_id` ni por número,
 * fecha y sociedad. Una sustitución emitida quita el original.
 * Cifras que Pedro espera en producción para 2026: P.O. 88 emitidas y
 * 73.401,27 €; CVPO 111 emitidas y 103.071,74 €.
 * Cobros y pagos son el saldo abierto del año en curso. La partida de Holded
 * cuenta una vez; la copia `holded_import` no se suma otra vez al saldo.
 */
const NOT_SUBSTITUTED = `
  NOT EXISTS (
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

const HOLDED_NOT_PROJECTED = `
  h.kind = 'sale'
  AND lower(trim(h.status_holded)) NOT IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada')
  AND NOT EXISTS (
    SELECT 1
    FROM billing.invoice bi
    WHERE bi.holded_invoice_id = h.id
       OR (
         bi.legal_entity_id = h.entity_id
         AND bi.number = h.number
         AND bi.issue_date = h.issue_date
         AND bi.status IN ('issued', 'voided')
       )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM billing.invoice_rectification r
    JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
    WHERE r.relation = 'substituted'
      AND rect.status = 'issued'
      AND r.rectified_number = h.number
      AND r.rectified_issue_date = h.issue_date
      AND rect.legal_entity_id = h.entity_id
  )`;

function countedSales(entity: string): string {
  return `
    counted AS (
      SELECT e.code AS code, i.issue_date AS issue_date, i.total AS total,
             ${CUSTOMER_NAME} AS customer_name
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
        LEFT JOIN party.contact c ON c.id = i.customer_id
       WHERE i.status = 'issued'
         AND ${NOT_SUBSTITUTED}
         AND ${entity}
      UNION ALL
      SELECT e.code, h.issue_date, h.total, h.counterparty_name
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${HOLDED_NOT_PROJECTED}
         AND ${entity}
    )`;
}

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

  const counted = countedSales(entity);
  const [sales, receivables, payables, contactRows, recent, customers, months, presence] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      WITH ${counted}
      SELECT code,
             COALESCE(SUM(CASE WHEN issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}' THEN total END), 0) AS this_year,
             COALESCE(SUM(CASE WHEN issue_date BETWEEN DATE '${lastFrom}' AND DATE '${lastTo}' THEN total END), 0) AS last_year,
             COALESCE(SUM(CASE WHEN issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}' THEN 1 ELSE 0 END), 0) AS this_count
        FROM counted
       WHERE issue_date BETWEEN DATE '${lastFrom}' AND DATE '${thisTo}'
       GROUP BY code
    `),
    writer.read<Record<string, unknown>>(`
      SELECT code, COALESCE(SUM(outstanding), 0) AS amount, COUNT(*) AS n
        FROM (
          SELECT e.code AS code, (i.total - i.amount_paid) AS outstanding
            FROM billing.invoice i
            JOIN core.legal_entity e ON e.id = i.legal_entity_id
           WHERE i.status = 'issued'
             AND COALESCE(i.origin, 'native') <> 'holded_import'
             AND ${NOT_SUBSTITUTED}
             AND i.payment_status IN ('unpaid', 'partially_paid')
             AND i.total > i.amount_paid
             AND i.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
             AND ${entity}
          UNION ALL
          SELECT e.code, (o.amount - o.amount_paid)
            FROM legacy.open_item o
            JOIN core.legal_entity e ON e.id = o.entity_id
           WHERE o.direction = 'receivable'
             AND o.status IN ('open', 'partially_paid')
             AND o.amount > o.amount_paid
             AND o.document_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
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
             AND s.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
             AND ${entity}
          UNION ALL
          SELECT (o.amount - o.amount_paid)
            FROM legacy.open_item o
            JOIN core.legal_entity e ON e.id = o.entity_id
           WHERE o.direction = 'payable'
             AND o.status IN ('open', 'partially_paid')
             AND o.amount > o.amount_paid
             AND o.document_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
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
      SELECT id, number, CAST(issue_date AS VARCHAR) AS issue_date, counterparty_name,
             CAST(total AS VARCHAR) AS total, CAST(pending AS VARCHAR) AS pending,
             status, payment_status, entity_code
        FROM (
          SELECT CAST(i.id AS VARCHAR) AS id, i.number, i.issue_date,
                 ${CUSTOMER_NAME} AS counterparty_name,
                 i.total, (i.total - i.amount_paid) AS pending,
                 i.status, i.payment_status, e.code AS entity_code
            FROM billing.invoice i
            JOIN core.legal_entity e ON e.id = i.legal_entity_id
            LEFT JOIN party.contact c ON c.id = i.customer_id
           WHERE i.status IN ('issued', 'voided')
             AND ${entity}
          UNION ALL
          SELECT CAST(h.id AS VARCHAR), h.number, h.issue_date, h.counterparty_name,
                 h.total, h.pending,
                 CASE
                   WHEN lower(trim(h.status_holded)) IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada') THEN 'voided'
                   ELSE 'issued'
                 END,
                 CASE
                   WHEN lower(trim(h.status_holded)) IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada') THEN 'unpaid'
                   WHEN COALESCE(h.pending, 0) <= 0 THEN 'paid'
                   WHEN h.pending < h.total THEN 'partially_paid'
                   ELSE 'unpaid'
                 END,
                 e.code
            FROM legacy.holded_invoice h
            JOIN core.legal_entity e ON e.id = h.entity_id
           WHERE h.kind = 'sale'
             AND NOT EXISTS (
               SELECT 1 FROM billing.invoice bi
               WHERE bi.holded_invoice_id = h.id
                  OR (
                    bi.legal_entity_id = h.entity_id
                    AND bi.number = h.number
                    AND bi.issue_date = h.issue_date
                    AND bi.status IN ('issued', 'voided')
                  )
             )
             AND ${entity}
        ) recent
       ORDER BY issue_date DESC NULLS LAST, number DESC NULLS LAST, id DESC
       LIMIT 8
    `),
    writer.read<Record<string, unknown>>(`
      WITH ${counted}
      SELECT customer_name AS name,
             CAST(COALESCE(SUM(total), 0) AS VARCHAR) AS total,
             COUNT(*) AS invoices
        FROM counted
       WHERE issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
       GROUP BY customer_name
       ORDER BY SUM(total) DESC, customer_name
       LIMIT 5
    `),
    writer.read<Record<string, unknown>>(`
      WITH ${counted}
      SELECT code,
             CAST(month(issue_date) AS INTEGER) AS month,
             CAST(COALESCE(SUM(total), 0) AS VARCHAR) AS total
        FROM counted
       WHERE issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
       GROUP BY code, month(issue_date)
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS invoices
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
       WHERE ${entity}
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
      issued_count: countsField(sales, scope, 'this_count'),
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
  return countsField(rows, scope, 'n');
}

function countsField(rows: Record<string, unknown>[], scope: LegacyScope, field: string): CompanyCounts {
  const counts: CompanyCounts = { PO: 0, CVPO: 0 };
  for (const row of rows) {
    const code = codeOf(row.code);
    if (!code || !visible(scope, code)) continue;
    counts[code] = intOf(row[field]);
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

import Decimal from 'decimal.js';
import type { UserCtx } from '../auth/permissions';
import type { Writer } from '../db/writer';
import { businessDate } from '../time';
import {
  HOLDED_NOT_CANCELLED,
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

export interface LegacyOverview {
  entity: LegacyScope['entity'];
  year: number;
  kpis: {
    sales_this_year: string;
    sales_last_year: string;
    pending_receivables: string;
    pending_receivables_count: number;
    contacts: number;
    open_payables: string;
    open_payables_count: number;
  };
  recent_invoices: LegacyInvoiceRow[];
  top_customers: { name: string; total: string; invoices: number }[];
  months: { month: number; total: string }[];
  has_imported: boolean;
}

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

  const [kpis, recent, customers, months, presence] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      SELECT
        (SELECT COALESCE(SUM(h.total), 0)
           FROM legacy.holded_invoice h
           JOIN core.legal_entity e ON e.id = h.entity_id
          WHERE h.kind = 'sale' AND ${HOLDED_NOT_CANCELLED}
            AND h.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
            AND ${entity}) AS sales_this_year,
        (SELECT COALESCE(SUM(h.total), 0)
           FROM legacy.holded_invoice h
           JOIN core.legal_entity e ON e.id = h.entity_id
          WHERE h.kind = 'sale' AND ${HOLDED_NOT_CANCELLED}
            AND h.issue_date BETWEEN DATE '${lastFrom}' AND DATE '${lastTo}'
            AND ${entity}) AS sales_last_year,
        (SELECT COALESCE(SUM(o.amount - o.amount_paid), 0)
           FROM legacy.open_item o
           JOIN core.legal_entity e ON e.id = o.entity_id
          WHERE o.direction = 'receivable' AND o.status IN ('open', 'partially_paid')
            AND ${entity}) AS pending_receivables,
        (SELECT COUNT(*)
           FROM legacy.open_item o
           JOIN core.legal_entity e ON e.id = o.entity_id
          WHERE o.direction = 'receivable' AND o.status IN ('open', 'partially_paid')
            AND ${entity}) AS pending_receivables_count,
        (SELECT COUNT(*)
           FROM party.contact c
          WHERE c.archived_at IS NULL AND c.merged_into_id IS NULL
            AND ${contacts}) AS contacts,
        (SELECT COALESCE(SUM(o.amount - o.amount_paid), 0)
           FROM legacy.open_item o
           JOIN core.legal_entity e ON e.id = o.entity_id
          WHERE o.direction = 'payable' AND o.status IN ('open', 'partially_paid')
            AND ${entity}) AS open_payables,
        (SELECT COUNT(*)
           FROM legacy.open_item o
           JOIN core.legal_entity e ON e.id = o.entity_id
          WHERE o.direction = 'payable' AND o.status IN ('open', 'partially_paid')
            AND ${entity}) AS open_payables_count
    `),
    writer.read<Record<string, unknown>>(`
      SELECT h.id, h.number, CAST(h.issue_date AS VARCHAR) AS issue_date, h.counterparty_name,
             CAST(h.total AS VARCHAR) AS total, CAST(h.pending AS VARCHAR) AS pending,
             h.status_holded, h.kind, e.code AS entity_code
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE h.kind = 'sale' AND ${entity}
       ORDER BY h.issue_date DESC, h.number DESC, h.id DESC
       LIMIT 8
    `),
    writer.read<Record<string, unknown>>(`
      SELECT h.counterparty_name AS name,
             CAST(COALESCE(SUM(h.total), 0) AS VARCHAR) AS total,
             COUNT(*) AS invoices
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE h.kind = 'sale' AND ${HOLDED_NOT_CANCELLED}
         AND h.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
         AND ${entity}
       GROUP BY h.counterparty_name
       ORDER BY SUM(h.total) DESC, h.counterparty_name
       LIMIT 5
    `),
    writer.read<Record<string, unknown>>(`
      SELECT CAST(month(h.issue_date) AS INTEGER) AS month,
             CAST(COALESCE(SUM(h.total), 0) AS VARCHAR) AS total
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE h.kind = 'sale' AND ${HOLDED_NOT_CANCELLED}
         AND h.issue_date BETWEEN DATE '${thisFrom}' AND DATE '${thisTo}'
         AND ${entity}
       GROUP BY 1
    `),
    writer.read<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*) FROM legacy.holded_invoice h
           JOIN core.legal_entity e ON e.id = h.entity_id
          WHERE ${entity}) AS invoices,
        (SELECT COUNT(*) FROM legacy.holded_product p
           JOIN core.legal_entity e ON e.id = p.entity_id
          WHERE ${entity}) AS products,
        (SELECT COUNT(*) FROM party.contact c
          WHERE c.archived_at IS NULL AND c.merged_into_id IS NULL AND ${contacts}) AS contacts
    `),
  ]);

  const kpi = kpis[0] ?? {};
  const byMonth = new Map<number, string>();
  for (const row of months) {
    const month = intOf(row.month);
    if (month >= 1 && month <= 12) byMonth.set(month, money2(row.total));
  }
  const presenceRow = presence[0] ?? {};
  const hasImported = intOf(presenceRow.invoices) > 0 || intOf(presenceRow.products) > 0 || intOf(presenceRow.contacts) > 0;

  return {
    entity: scope.entity,
    year,
    kpis: {
      sales_this_year: money2(kpi.sales_this_year),
      sales_last_year: money2(kpi.sales_last_year),
      pending_receivables: money2(kpi.pending_receivables),
      pending_receivables_count: intOf(kpi.pending_receivables_count),
      contacts: intOf(kpi.contacts),
      open_payables: money2(kpi.open_payables),
      open_payables_count: intOf(kpi.open_payables_count),
    },
    recent_invoices: recent.map(invoiceOf),
    top_customers: customers.map((row) => ({
      name: String(row.name ?? ''),
      total: money2(row.total),
      invoices: intOf(row.invoices),
    })),
    months: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      total: byMonth.get(index + 1) ?? '0.00',
    })),
    has_imported: hasImported,
  };
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

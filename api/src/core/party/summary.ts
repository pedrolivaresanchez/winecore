import { Decimal } from 'decimal.js';
import { can, entityScope, type Permission, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { daysBetween, pathUuid, todayMadrid } from '../finance/support';
import { entityPredicate, HOLDED_NOT_CANCELLED, legacyScope } from '../legacy/scope';

const INVOICE_LIMIT = 200;
const LIST_LIMIT = 50;
const ZERO = new Decimal(0);

const HOLDED_PAID = "lower(trim(h.status_holded)) IN ('pagado', 'pagada', 'cobrado', 'cobrada')";

const BILLING_SUBSTITUTED = `
  SELECT 1
  FROM billing.invoice_rectification r
  JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
  WHERE r.relation = 'substituted'
    AND rect.status = 'issued'
    AND (
      r.rectified_invoice_id = i.id
      OR (r.rectified_number = i.number AND r.rectified_issue_date = i.issue_date AND rect.legal_entity_id = i.legal_entity_id)
    )`;

const HOLDED_SUBSTITUTED = `
  SELECT 1
  FROM billing.invoice_rectification r
  JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
  WHERE r.relation = 'substituted'
    AND rect.status = 'issued'
    AND r.rectified_number = h.number
    AND r.rectified_issue_date = h.issue_date
    AND rect.legal_entity_id = h.entity_id`;

/** Una factura Holded ya reemitida en WineCore sale una sola vez, desde billing. */
const HOLDED_REISSUED = `
  SELECT 1 FROM billing.invoice bi
  WHERE bi.legal_entity_id = h.entity_id
    AND bi.number = h.number
    AND bi.issue_date = h.issue_date
    AND bi.status IN ('issued', 'voided')`;

type Source = 'winecore' | 'holded';
type InvoiceState = 'draft' | 'pending' | 'overdue' | 'paid' | 'voided';
type Row = Record<string, unknown>;

interface Owner {
  id: string;
  legalName: string | null;
}

interface InvoiceEntry {
  source: Source;
  id: string;
  number: string | null;
  issue_date: string | null;
  due_date: string | null;
  total: Decimal;
  pending: Decimal;
  state: InvoiceState;
  status: string;
  entity_code: string;
  linked_by: 'contact' | 'name';
  counted: boolean;
  sort: string;
}

/**
 * Ficha de cliente: facturación (WineCore + histórico Holded), cobros y ventas.
 * Cada bloque sale a null si el usuario no tiene el permiso de lectura de su módulo.
 * Holded solo enlaza el contacto cuando el nombre era inequívoco al importar; sin enlace
 * se casa por nombre fiscal normalizado y la fila lo indica con `linked_by = name`.
 * Si otro contacto comparte ese nombre no se casa nada: el documento sería de los dos.
 */
export async function loadContactSummary(writer: Writer, user: UserCtx, rawId: string, now: Date) {
  const id = pathUuid(rawId);
  const rows = await writer.read<{ legal_name: string; namesakes: unknown }>(`
    SELECT c.legal_name,
           (SELECT count(*) FROM party.contact x WHERE ${nameKey('x.legal_name')} = ${nameKey('c.legal_name')}) AS namesakes
    FROM party.contact c
    WHERE c.id = ${uuidOf(id)}`);
  const contact = rows[0];
  if (!contact) throw domainError('WC_NOT_FOUND');
  const owner: Owner = { id, legalName: Number(contact.namesakes) === 1 ? String(contact.legal_name) : null };
  const today = todayMadrid(now);
  const holded = entityPredicate(legacyScope(user, 'both'));
  return {
    contact_id: id,
    as_of: today,
    year: Number(today.slice(0, 4)),
    invoices: can(user, 'billing.read') ? await invoicesOf(writer, owner, scoped(user, 'billing.read'), holded, today) : null,
    receivables: can(user, 'finance.read') ? await receivablesOf(writer, owner, scoped(user, 'finance.read'), today) : null,
    payments: can(user, 'finance.read') ? await paymentsOf(writer, owner, scoped(user, 'finance.read'), holded) : null,
    sales: can(user, 'sales.read') ? await salesOf(writer, owner, scoped(user, 'sales.read'), holded) : null,
  };
}

async function invoicesOf(
  writer: Writer,
  owner: Owner,
  scope: (column: string) => string,
  holded: string,
  today: string,
) {
  const native = await writer.read<Row>(`
    SELECT CAST(i.id AS VARCHAR) AS id, i.number, i.status, i.payment_status, e.code AS entity_code,
           CAST(i.issue_date AS VARCHAR) AS issue_date,
           CAST((SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = i.id) AS VARCHAR) AS due_date,
           CAST(i.total AS VARCHAR) AS total,
           CAST(i.total - i.amount_paid AS VARCHAR) AS pending,
           CAST(i.created_at AS VARCHAR) AS created_at,
           (i.status = 'issued' AND NOT EXISTS (${BILLING_SUBSTITUTED})) AS counted
    FROM billing.invoice i
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    WHERE i.customer_id = ${uuidOf(owner.id)}
      AND i.status <> 'discarded'
      AND ${scope('i.legal_entity_id')}
  `);
  const legacy = await writer.read<Row>(`
    SELECT CAST(h.id AS VARCHAR) AS id, h.number, h.status_holded, e.code AS entity_code,
           CAST(h.issue_date AS VARCHAR) AS issue_date,
           CAST(h.due_date AS VARCHAR) AS due_date,
           CAST(h.total AS VARCHAR) AS total,
           CAST(COALESCE(o.outstanding, h.pending, 0) AS VARCHAR) AS pending,
           h.counterparty_contact_id IS NOT NULL AS linked,
           NOT (${HOLDED_NOT_CANCELLED}) AS cancelled,
           (${HOLDED_NOT_CANCELLED} AND NOT EXISTS (${HOLDED_SUBSTITUTED})) AS counted
    FROM legacy.holded_invoice h
    JOIN core.legal_entity e ON e.id = h.entity_id
    LEFT JOIN (
      SELECT holded_invoice_id,
             sum(CASE WHEN status IN ('open', 'partially_paid') THEN amount - amount_paid ELSE 0 END) AS outstanding
      FROM legacy.open_item
      WHERE direction = 'receivable' AND holded_invoice_id IS NOT NULL
      GROUP BY holded_invoice_id
    ) o ON o.holded_invoice_id = h.id
    WHERE h.kind = 'sale'
      AND ${holded}
      AND ${ownedBy(owner, 'h.counterparty_contact_id', 'h.counterparty_name')}
      AND NOT EXISTS (${HOLDED_REISSUED})
  `);
  const entries = [
    ...native.map((row) => nativeInvoice(row, today)),
    ...legacy.map((row) => holdedInvoice(row, today)),
  ].sort((left, right) => right.sort.localeCompare(left.sort) || String(right.number).localeCompare(String(left.number)));
  return {
    kpis: kpisOf(entries, today),
    months: monthsOf(entries, today),
    total_count: entries.length,
    items: entries.slice(0, INVOICE_LIMIT).map(({ counted: _counted, sort: _sort, total, pending, ...entry }) => ({
      ...entry,
      total: money(total),
      pending: money(pending),
    })),
  };
}

function nativeInvoice(row: Row, today: string): InvoiceEntry {
  const status = String(row.status);
  const pending = decimal(row.pending);
  const dueDate = textOf(row.due_date);
  const paymentStatus = textOf(row.payment_status);
  let state: InvoiceState = 'pending';
  if (status === 'draft' || status === 'pending_approval') state = 'draft';
  else if (status === 'voided') state = 'voided';
  else if (paymentStatus === 'paid' || pending.lte(0)) state = 'paid';
  else if (paymentStatus === 'uncollectible' || (dueDate !== null && dueDate < today)) state = 'overdue';
  const issueDate = textOf(row.issue_date);
  return {
    source: 'winecore',
    id: String(row.id),
    number: textOf(row.number),
    issue_date: issueDate,
    due_date: dueDate,
    total: decimal(row.total),
    pending: state === 'pending' || state === 'overdue' ? pending : ZERO,
    state,
    status,
    entity_code: String(row.entity_code),
    linked_by: 'contact',
    counted: row.counted === true && issueDate !== null,
    sort: issueDate ?? '9999-12-31',
  };
}

function holdedInvoice(row: Row, today: string): InvoiceEntry {
  const cancelled = row.cancelled === true;
  const pending = cancelled ? ZERO : Decimal.max(decimal(row.pending), ZERO);
  const dueDate = textOf(row.due_date);
  let state: InvoiceState = 'paid';
  if (cancelled) state = 'voided';
  else if (pending.gt(0)) state = dueDate !== null && dueDate < today ? 'overdue' : 'pending';
  const issueDate = String(row.issue_date);
  return {
    source: 'holded',
    id: String(row.id),
    number: textOf(row.number),
    issue_date: issueDate,
    due_date: dueDate,
    total: decimal(row.total),
    pending,
    state,
    status: String(row.status_holded),
    entity_code: String(row.entity_code),
    linked_by: row.linked === true ? 'contact' : 'name',
    counted: row.counted === true,
    sort: issueDate,
  };
}

function kpisOf(entries: InvoiceEntry[], today: string) {
  const counted = entries.filter((entry) => entry.counted && entry.issue_date !== null);
  const year = Number(today.slice(0, 4));
  const sameDayLastYear = `${year - 1}-${today.slice(5) === '02-29' ? '02-28' : today.slice(5)}`;
  const sum = (from: string, to: string) => counted
    .filter((entry) => String(entry.issue_date) >= from && String(entry.issue_date) <= to)
    .reduce((total, entry) => total.plus(entry.total), ZERO);
  const total = counted.reduce((acc, entry) => acc.plus(entry.total), ZERO);
  const dates = counted.map((entry) => String(entry.issue_date)).sort();
  return {
    invoiced_ytd: money(sum(`${year}-01-01`, today)),
    invoiced_prior_ytd: money(sum(`${year - 1}-01-01`, sameDayLastYear)),
    invoiced_last_year: money(sum(`${year - 1}-01-01`, `${year - 1}-12-31`)),
    invoiced_total: money(total),
    invoice_count: counted.length,
    average_ticket: counted.length > 0 ? money(total.div(counted.length)) : null,
    first_invoice_date: dates[0] ?? null,
    last_invoice_date: dates[dates.length - 1] ?? null,
  };
}

function monthsOf(entries: InvoiceEntry[], today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const totals = new Map<string, Decimal>();
  for (let index = 0; index < 12; index += 1) {
    totals.set(new Date(Date.UTC(year, month - 12 + index, 1)).toISOString().slice(0, 7), ZERO);
  }
  for (const entry of entries) {
    if (!entry.counted || entry.issue_date === null) continue;
    const key = entry.issue_date.slice(0, 7);
    const current = totals.get(key);
    if (current) totals.set(key, current.plus(entry.total));
  }
  return [...totals].map(([key, total]) => ({ month: key, total: money(total) }));
}

async function receivablesOf(writer: Writer, owner: Owner, scope: (column: string) => string, today: string) {
  const native = await writer.read<Row>(`
    SELECT CAST(i.id AS VARCHAR) AS id, i.number, e.code AS entity_code,
           CAST(i.issue_date AS VARCHAR) AS issue_date,
           CAST((SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = i.id) AS VARCHAR) AS due_date,
           CAST(i.total - i.amount_paid AS VARCHAR) AS outstanding
    FROM billing.invoice i
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    WHERE i.customer_id = ${uuidOf(owner.id)}
      AND i.status = 'issued'
      AND i.payment_status IN ('unpaid', 'partially_paid')
      AND i.total > i.amount_paid
      AND COALESCE(i.origin, 'native') <> 'holded_import'
      AND ${scope('i.legal_entity_id')}
  `);
  const legacy = await writer.read<Row>(`
    SELECT CAST(o.id AS VARCHAR) AS id, CAST(o.holded_invoice_id AS VARCHAR) AS invoice_id,
           o.document_number AS number, e.code AS entity_code,
           CAST(o.document_date AS VARCHAR) AS issue_date,
           CAST(o.due_date AS VARCHAR) AS due_date,
           CAST(o.amount - o.amount_paid AS VARCHAR) AS outstanding,
           COALESCE(o.counterparty_contact_id, h.counterparty_contact_id) IS NOT NULL AS linked
    FROM legacy.open_item o
    JOIN core.legal_entity e ON e.id = o.entity_id
    LEFT JOIN legacy.holded_invoice h ON h.id = o.holded_invoice_id
    WHERE o.direction = 'receivable'
      AND o.status IN ('open', 'partially_paid')
      AND o.amount > o.amount_paid
      AND ${scope('o.entity_id')}
      AND ${ownedBy(owner, 'COALESCE(o.counterparty_contact_id, h.counterparty_contact_id)', 'h.counterparty_name')}
  `);
  const items = [
    ...native.map((row) => receivableOf(row, 'winecore', today)),
    ...legacy.map((row) => receivableOf(row, 'holded', today)),
  ].sort((left, right) => String(left.due_date ?? left.issue_date).localeCompare(String(right.due_date ?? right.issue_date)));
  const total = items.reduce((acc, item) => acc.plus(item.outstanding), ZERO);
  const overdue = items.filter((item) => item.is_overdue).reduce((acc, item) => acc.plus(item.outstanding), ZERO);
  return {
    total: money(total),
    overdue: money(overdue),
    count: items.length,
    items: items.map((item) => ({ ...item, outstanding: money(item.outstanding) })),
  };
}

function receivableOf(row: Row, source: Source, today: string) {
  const dueDate = textOf(row.due_date);
  const overdue = dueDate !== null && dueDate < today;
  return {
    source,
    id: String(row.id),
    invoice_id: source === 'winecore' ? String(row.id) : textOf(row.invoice_id),
    number: textOf(row.number),
    issue_date: textOf(row.issue_date),
    due_date: dueDate,
    outstanding: decimal(row.outstanding),
    is_overdue: overdue,
    days_overdue: overdue && dueDate ? daysBetween(today, dueDate) : 0,
    entity_code: String(row.entity_code),
    linked_by: source === 'winecore' || row.linked === true ? 'contact' as const : 'name' as const,
  };
}

async function paymentsOf(writer: Writer, owner: Owner, scope: (column: string) => string, holded: string) {
  const contact = uuidOf(owner.id);
  const native = await writer.read<Row>(`
    SELECT CAST(p.id AS VARCHAR) AS id, CAST(p.value_date AS VARCHAR) AS date, CAST(p.amount AS VARCHAR) AS amount,
           p.method, p.reference, e.code AS entity_code
    FROM finance.payment p
    JOIN core.legal_entity e ON e.id = p.legal_entity_id
    WHERE p.direction = 'in'
      AND p.status = 'registered'
      AND ${scope('p.legal_entity_id')}
      AND (
        p.counterparty_id = ${contact}
        OR EXISTS (
          SELECT 1 FROM finance.payment_allocation a
          WHERE a.payment_id = p.id
            AND (
              (a.target_table = 'billing.invoice' AND a.target_id IN (SELECT bi.id FROM billing.invoice bi WHERE bi.customer_id = ${contact}))
              OR (a.target_table = 'legacy.open_item' AND a.target_id IN (
                SELECT o.id FROM legacy.open_item o
                LEFT JOIN legacy.holded_invoice h ON h.id = o.holded_invoice_id
                WHERE o.direction = 'receivable'
                  AND ${ownedBy(owner, 'COALESCE(o.counterparty_contact_id, h.counterparty_contact_id)', 'h.counterparty_name')}
              ))
            )
        )
      )
    ORDER BY p.value_date DESC, p.created_at DESC
    LIMIT ${LIST_LIMIT}
  `);
  const documents = new Map<string, string[]>();
  if (native.length > 0) {
    const allocations = await writer.read<Row>(`
      SELECT CAST(a.payment_id AS VARCHAR) AS payment_id, COALESCE(i.number, o.document_number) AS number
      FROM finance.payment_allocation a
      LEFT JOIN billing.invoice i ON a.target_table = 'billing.invoice' AND i.id = a.target_id
      LEFT JOIN legacy.open_item o ON a.target_table = 'legacy.open_item' AND o.id = a.target_id
      WHERE a.payment_id IN (${native.map((row) => uuidOf(String(row.id))).join(', ')})
      ORDER BY a.allocated_at, a.id
    `);
    for (const row of allocations) {
      const number = textOf(row.number);
      if (!number) continue;
      const key = String(row.payment_id);
      documents.set(key, [...(documents.get(key) ?? []), number]);
    }
  }
  const legacy = await writer.read<Row>(`
    SELECT CAST(h.id AS VARCHAR) AS id, h.number, h.payment_method, e.code AS entity_code,
           CAST(h.paid_on AS VARCHAR) AS paid_on,
           CAST(h.issue_date AS VARCHAR) AS issue_date,
           CAST(CASE WHEN h.paid > 0 THEN h.paid ELSE h.total END AS VARCHAR) AS amount
    FROM legacy.holded_invoice h
    JOIN core.legal_entity e ON e.id = h.entity_id
    WHERE h.kind = 'sale'
      AND ${holded}
      AND ${HOLDED_NOT_CANCELLED}
      AND (${HOLDED_PAID} OR h.paid > 0)
      AND ${ownedBy(owner, 'h.counterparty_contact_id', 'h.counterparty_name')}
    ORDER BY COALESCE(h.paid_on, h.issue_date) DESC, h.number DESC
    LIMIT ${LIST_LIMIT}
  `);
  const items = [
    ...native.map((row) => ({
      source: 'winecore' as const,
      id: String(row.id),
      date: textOf(row.date),
      document_date: null,
      amount: decimal(row.amount),
      method: textOf(row.method),
      reference: textOf(row.reference),
      entity_code: String(row.entity_code),
      documents: documents.get(String(row.id)) ?? [],
    })),
    ...legacy.map((row) => ({
      source: 'holded' as const,
      id: String(row.id),
      date: textOf(row.paid_on),
      document_date: textOf(row.issue_date),
      amount: decimal(row.amount),
      method: textOf(row.payment_method),
      reference: null,
      entity_code: String(row.entity_code),
      documents: [textOf(row.number)].filter((number): number is string => number !== null),
    })),
  ].sort((left, right) => String(right.date ?? right.document_date).localeCompare(String(left.date ?? left.document_date)));
  return {
    total: money(items.reduce((acc, item) => acc.plus(item.amount), ZERO)),
    count: items.length,
    items: items.map((item) => ({ ...item, amount: money(item.amount) })),
  };
}

async function salesOf(writer: Writer, owner: Owner, scope: (column: string) => string, holded: string) {
  const contact = uuidOf(owner.id);
  const quotes = await writer.read<Row>(`
    SELECT 'winecore' AS source, CAST(q.id AS VARCHAR) AS id, q.number, q.status,
           CAST(q.issue_date AS VARCHAR) AS date, CAST(q.total AS VARCHAR) AS total
    FROM sales.quote q
    WHERE q.customer_id = ${contact} AND ${scope('q.legal_entity_id')}
    ORDER BY q.issue_date DESC NULLS FIRST, q.created_at DESC
    LIMIT ${LIST_LIMIT}
  `);
  const holdedQuotes = await writer.read<Row>(`
    SELECT 'holded' AS source, CAST(h.id AS VARCHAR) AS id, h.number, h.status_holded AS status,
           CAST(h.issue_date AS VARCHAR) AS date, CAST(h.total AS VARCHAR) AS total
    FROM legacy.holded_quote h
    JOIN core.legal_entity e ON e.id = h.entity_id
    WHERE ${holded} AND ${ownedBy(owner, 'h.counterparty_contact_id', 'h.counterparty_name')}
    ORDER BY h.issue_date DESC, h.number DESC
    LIMIT ${LIST_LIMIT}
  `);
  const orders = await writer.read<Row>(`
    SELECT 'winecore' AS source, CAST(o.id AS VARCHAR) AS id, o.number, o.status,
           CAST(o.order_date AS VARCHAR) AS date, CAST(o.total AS VARCHAR) AS total
    FROM sales.sales_order o
    WHERE o.customer_id = ${contact} AND (o.legal_entity_id IS NULL OR ${scope('o.legal_entity_id')})
    ORDER BY o.order_date DESC, o.created_at DESC
    LIMIT ${LIST_LIMIT}
  `);
  const deliveries = await writer.read<Row>(`
    SELECT 'winecore' AS source, CAST(d.id AS VARCHAR) AS id, d.number, d.status,
           CAST(d.issue_date AS VARCHAR) AS date, NULL AS total
    FROM sales.delivery_note d
    WHERE d.customer_id = ${contact} AND ${scope('d.legal_entity_id')}
    ORDER BY d.issue_date DESC NULLS FIRST, d.created_at DESC
    LIMIT ${LIST_LIMIT}
  `);
  const byDate = (left: { date: string | null }, right: { date: string | null }) =>
    String(right.date ?? '9999').localeCompare(String(left.date ?? '9999'));
  return {
    quotes: [...quotes, ...holdedQuotes].map(salesDoc).sort(byDate).slice(0, LIST_LIMIT),
    orders: orders.map(salesDoc),
    delivery_notes: deliveries.map(salesDoc),
  };
}

function salesDoc(row: Row) {
  return {
    source: row.source === 'holded' ? 'holded' as const : 'winecore' as const,
    id: String(row.id),
    number: textOf(row.number),
    date: textOf(row.date),
    status: String(row.status),
    total: row.total == null ? null : money(decimal(row.total)),
  };
}

function scoped(user: UserCtx, permission: Permission): (column: string) => string {
  const scope = entityScope(user, permission);
  return (column) => {
    if (scope === null) return 'TRUE';
    if (scope.length === 0) return 'FALSE';
    return `${column} IN (${scope.map((entity) => uuidOf(entity)).join(', ')})`;
  };
}

function ownedBy(owner: Owner, idColumn: string, nameColumn: string): string {
  if (owner.legalName === null) return `${idColumn} = ${uuidOf(owner.id)}`;
  return `(${idColumn} = ${uuidOf(owner.id)} OR (${idColumn} IS NULL AND ${nameKey(nameColumn)} = ${nameKey(sql`${owner.legalName}`)}))`;
}

/** La misma limpieza que el importador de Holded: NBSP a espacio, blancos colapsados y recortados. */
function nameKey(expression: string): string {
  return `lower(trim(regexp_replace(replace(${expression}, chr(160), ' '), '\\s+', ' ', 'g')))`;
}

function uuidOf(id: string): string {
  return sql`CAST(${id} AS UUID)`;
}

function decimal(value: unknown): Decimal {
  if (value == null || value === '') return ZERO;
  try {
    return new Decimal(String(value));
  } catch {
    return ZERO;
  }
}

function money(value: Decimal): string {
  return value.toFixed(2);
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

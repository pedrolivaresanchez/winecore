import { Decimal } from 'decimal.js';
import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { isCreditDocument, paymentMethodOf } from '../../../db/migration/datasets/history';

type Read = Writer['read'];

const ZERO = '00000000-0000-0000-0000-000000000000';

export function isImported(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

export function money2(value: unknown): string {
  if (value == null || value === '') return '0.00';
  try {
    return new Decimal(String(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  } catch {
    return '0.00';
  }
}

export function dayOf(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] ?? null;
}

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function salePaymentStatus(status: string, paid: Decimal, pending: Decimal): string {
  if (['anulado', 'anulada'].includes(status.trim().toLowerCase())) return 'unpaid';
  if (pending.gt(0) && paid.gt(0)) return 'partially_paid';
  if (pending.gt(0)) return 'unpaid';
  return 'paid';
}

export function saleStatus(status: string): string {
  return ['anulado', 'anulada'].includes(status.trim().toLowerCase()) ? 'voided' : 'issued';
}

export function purchaseStatus(status: string): string {
  return ['anulado', 'anulada'].includes(status.trim().toLowerCase()) ? 'rejected' : 'approved';
}

/** Subconsulta de facturas emitidas: WineCore y el histórico Holded, misma forma. */
export const SALE_DOCUMENTS = `
  SELECT
    b.id,
    b.number,
    b.issue_date,
    b.legal_entity_id,
    b.customer_id,
    b.customer_snapshot,
    b.subtotal,
    b.total,
    b.amount_paid,
    (SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = b.id) AS first_due,
    b.payment_status,
    b.status,
    b.invoice_type,
    b.series_id,
    b.verifactu_record_id,
    b.updated_at,
    FALSE AS imported,
    CAST(NULL AS VARCHAR) AS holded_name
  FROM billing.invoice b
  UNION ALL
  SELECT
    h.id,
    h.number,
    h.issue_date,
    h.entity_id,
    h.counterparty_contact_id,
    CAST(NULL AS JSON),
    h.subtotal,
    h.total,
    COALESCE(h.paid, 0),
    h.due_date,
    CASE
      WHEN lower(trim(h.status_holded)) IN ('anulado', 'anulada') THEN 'unpaid'
      WHEN COALESCE(h.pending, 0) > 0 AND COALESCE(h.paid, 0) > 0 THEN 'partially_paid'
      WHEN COALESCE(h.pending, 0) > 0 THEN 'unpaid'
      ELSE 'paid'
    END,
    CASE WHEN lower(trim(h.status_holded)) IN ('anulado', 'anulada') THEN 'voided' ELSE 'issued' END,
    CASE WHEN h.total < 0 OR upper(h.number) LIKE 'CN%' THEN 'R1' ELSE 'F1' END,
    CAST(NULL AS UUID),
    CAST(NULL AS UUID),
    CAST(h.issue_date AS TIMESTAMP) + INTERVAL 12 HOUR,
    TRUE,
    h.counterparty_name
  FROM legacy.holded_invoice h
  WHERE h.kind = 'sale'
`;

export async function legacySale(read: Read, id: string): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await read<Record<string, unknown>>(sql`
    SELECT h.*, e.code AS entity_code,
           COALESCE(c.legal_name, h.counterparty_name) AS customer_name
    FROM legacy.holded_invoice h
    JOIN core.legal_entity e ON e.id = h.entity_id
    LEFT JOIN party.contact c ON c.id = h.counterparty_contact_id
    WHERE h.id = CAST(${id.toLowerCase()} AS UUID) AND h.kind = 'sale'
  `);
  const row = rows[0];
  if (!row) return null;
  const lines = await read<Record<string, unknown>>(sql`
    SELECT id, line_seq, description, item, sku, units, subtotal, total, tax_rate_label
    FROM legacy.holded_invoice_line
    WHERE entity_id = CAST(${idOf(row.entity_id)} AS UUID)
      AND kind = 'sale'
      AND document_number = ${String(row.number)}
      AND document_date = CAST(${dayOf(row.issue_date)} AS DATE)
    ORDER BY line_seq
  `);
  return saleJson(row, lines);
}

function saleJson(row: Record<string, unknown>, lines: Record<string, unknown>[]): Record<string, unknown> {
  const total = new Decimal(money2(row.total));
  const paid = new Decimal(money2(row.paid));
  const pending = new Decimal(money2(row.pending));
  const statusHolded = String(row.status_holded ?? '');
  const number = textOf(row.number) ?? '';
  const subtotal = money2(row.subtotal);
  const vat = new Decimal(money2(row.vat)).plus(money2(row.vat_2));
  const issue = dayOf(row.issue_date);
  return {
    id: idOf(row.id),
    legal_entity_id: idOf(row.entity_id),
    entity_code: String(row.entity_code),
    series_id: '',
    number,
    status: saleStatus(statusHolded),
    invoice_type: isCreditDocument(number, total) ? 'R1' : 'F1',
    rectification_kind: null,
    issue_date: issue,
    operation_date: dayOf(row.operation_date),
    customer_id: row.counterparty_contact_id == null ? null : idOf(row.counterparty_contact_id),
    customer_name: textOf(row.customer_name),
    customer_snapshot: textOf(row.counterparty_name) ? { name: textOf(row.counterparty_name) } : null,
    channel: null,
    sales_order_id: null,
    currency: 'EUR',
    language: 'es',
    description: textOf(row.description),
    notes: null,
    no_physical_return: null,
    return_delivery_note: null,
    incoterm: null,
    subtotal,
    tax_total: vat.toFixed(2),
    surcharge_total: money2(row.surcharge),
    withholding_total: money2(row.withholding),
    importe_total: new Decimal(subtotal).plus(vat).plus(money2(row.surcharge)).toFixed(2),
    total: total.toFixed(2),
    amount_paid: paid.toFixed(2),
    payment_status: salePaymentStatus(statusHolded, paid, pending),
    payment_method: paymentMethodOf(textOf(row.payment_method)),
    payment_terms_days: null,
    approval_request_id: null,
    issued_at: issue ? `${issue}T12:00:00.000Z` : null,
    verifactu_record_id: null,
    qr_url: null,
    voided_at: saleStatus(statusHolded) === 'voided' ? (issue ? `${issue}T12:00:00.000Z` : null) : null,
    void_reason: saleStatus(statusHolded) === 'voided' ? statusHolded : null,
    created_at: issue ? `${issue}T12:00:00.000Z` : '',
    updated_at: issue ? `${issue}T12:00:00.000Z` : '',
    imported: true,
    read_only: true,
    lines: lines.map((line) => lineJson(line)),
    taxes: [],
    dues: dayOf(row.due_date) ? [{ seq: 1, due_date: dayOf(row.due_date), amount: total.toFixed(2) }] : [],
    rectifications: [],
    deliveries: [],
  };
}

function lineJson(line: Record<string, unknown>): Record<string, unknown> {
  const units = line.units == null ? new Decimal(1) : new Decimal(String(line.units));
  const base = new Decimal(money2(line.subtotal));
  const price = units.eq(0) ? base : base.div(units);
  return {
    id: idOf(line.id),
    line_no: Number(line.line_seq),
    product_id: null,
    sku: textOf(line.sku),
    description: textOf(line.description) ?? textOf(line.item) ?? '',
    lot_id: null,
    lot_code: null,
    quantity: units.toFixed(3),
    unit: 'ud',
    unit_price: price.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
    discount_pct: '0.00',
    line_base: base.toFixed(2),
    tax_code: textOf(line.tax_rate_label) ?? 'IVA',
    delivery_note_line_id: null,
    order_line_id: null,
  };
}

export async function legacyPurchase(read: Read, id: string): Promise<Record<string, unknown> | null> {
  const many = await legacyPurchases(read, [id]);
  return many[0] ?? null;
}

export async function legacyPurchases(read: Read, ids: string[]): Promise<Record<string, unknown>[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return [];
  const rows = await read<Record<string, unknown>>(
    `SELECT h.*, e.code AS entity_code,
            COALESCE(c.legal_name, h.counterparty_name) AS supplier_name,
            c.tax_id AS supplier_tax_id
     FROM legacy.holded_invoice h
     JOIN core.legal_entity e ON e.id = h.entity_id
     LEFT JOIN party.contact c ON c.id = h.counterparty_contact_id
     WHERE h.kind = 'purchase' AND h.id IN (${clean.map((id) => sql`CAST(${id.toLowerCase()} AS UUID)`).join(', ')})`,
  );
  if (rows.length === 0) return [];
  const lineRows = await read<Record<string, unknown>>(
    `SELECT entity_id, document_number, document_date, line_seq, description, item, units, subtotal, total, tax_amount, tax_rate_label, account_label
     FROM legacy.holded_invoice_line
     WHERE kind = 'purchase' AND entity_id IN (${[...new Set(rows.map((row) => idOf(row.entity_id)))].map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`,
  );
  const byDoc = new Map<string, Record<string, unknown>[]>();
  for (const line of lineRows) {
    const key = `${idOf(line.entity_id)}|${String(line.document_number)}|${dayOf(line.document_date)}`;
    const list = byDoc.get(key) ?? [];
    list.push(line);
    byDoc.set(key, list);
  }
  const order = new Map(clean.map((id, index) => [id.toLowerCase(), index]));
  return rows
    .map((row) => purchaseJson(row, byDoc.get(`${idOf(row.entity_id)}|${String(row.number)}|${dayOf(row.issue_date)}`) ?? []))
    .sort((left, right) => (order.get(String(left.id)) ?? 0) - (order.get(String(right.id)) ?? 0));
}

function purchaseJson(row: Record<string, unknown>, lines: Record<string, unknown>[]): Record<string, unknown> {
  const issue = dayOf(row.issue_date);
  const stamp = issue ? `${issue}T12:00:00.000Z` : '';
  const status = purchaseStatus(String(row.status_holded ?? ''));
  return {
    id: idOf(row.id),
    legal_entity_id: idOf(row.entity_id),
    legal_entity_code: String(row.entity_code),
    supplier_id: row.counterparty_contact_id == null ? null : idOf(row.counterparty_contact_id),
    supplier_name: textOf(row.supplier_name),
    supplier_tax_id: textOf(row.supplier_tax_id),
    supplier_invoice_number: textOf(row.number),
    issue_date: issue,
    accounting_date: dayOf(row.accounting_date) ?? issue,
    due_date: dayOf(row.due_date),
    source: 'migration',
    status,
    category_code: null,
    category_suggested: false,
    organic_relevant: false,
    currency: 'EUR',
    subtotal: money2(row.subtotal),
    tax_total: new Decimal(money2(row.vat)).plus(money2(row.vat_2)).toFixed(2),
    withholding_total: money2(row.withholding),
    total: money2(row.total),
    payment_method: paymentMethodOf(textOf(row.payment_method)),
    notes: textOf(row.description),
    ocr_confidence: 1,
    confidence: {},
    extractor: null,
    model: null,
    totals_ok: true,
    warnings: [],
    duplicate_of_id: null,
    rejection_reason: status === 'rejected' ? textOf(row.status_holded) : null,
    attachment_id: null,
    lines: lines
      .sort((left, right) => Number(left.line_seq) - Number(right.line_seq))
      .map((line, index) => ({
        line_no: Number(line.line_seq) || index + 1,
        description: textOf(line.description) ?? textOf(line.item) ?? '',
        quantity: line.units == null ? '1.000' : new Decimal(String(line.units)).toFixed(3),
        unit_price: unitPrice(line),
        line_base: money2(line.subtotal),
        vat_rate: '0.00',
        vat_quota: money2(line.tax_amount),
        withholding_rate: '0.00',
        vat_deductible_pct: '100.00',
        expense_account: textOf(line.account_label) ?? '',
      })),
    validated_at: stamp || null,
    approved_at: status === 'approved' ? stamp || null : null,
    created_at: stamp,
    updated_at: stamp,
    imported: true,
    read_only: true,
  };
}

function unitPrice(line: Record<string, unknown>): string {
  const units = line.units == null ? new Decimal(1) : new Decimal(String(line.units));
  const base = new Decimal(money2(line.subtotal));
  if (units.eq(0)) return base.toFixed(6);
  return base.div(units).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export async function legacyQuotes(read: Read, ids: string[]): Promise<Record<string, unknown>[]> {
  return legacyCommercial(read, ids, 'quote');
}

export async function legacyDeliveries(read: Read, ids: string[]): Promise<Record<string, unknown>[]> {
  return legacyCommercial(read, ids, 'delivery');
}

async function legacyCommercial(read: Read, ids: string[], kind: 'quote' | 'delivery'): Promise<Record<string, unknown>[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return [];
  const inList = clean.map((id) => sql`CAST(${id.toLowerCase()} AS UUID)`).join(', ');
  const rows = kind === 'quote'
    ? await read<Record<string, unknown>>(
      `SELECT q.*, COALESCE(c.legal_name, q.counterparty_name) AS customer_name
       FROM legacy.holded_quote q
       LEFT JOIN party.contact c ON c.id = q.counterparty_contact_id
       WHERE q.id IN (${inList})`,
    )
    : await read<Record<string, unknown>>(
      `SELECT n.*, n.destination AS customer_name
       FROM legacy.holded_delivery_note n
       WHERE n.id IN (${inList})`,
    );
  const lineKind = kind === 'quote' ? 'quote' : 'delivery_note';
  const lineRows = rows.length === 0 ? [] : await read<Record<string, unknown>>(
    `SELECT entity_id, document_number, document_date, line_seq, id, description, item, units, subtotal, sku, counterparty_name
     FROM legacy.holded_invoice_line
     WHERE kind = ${sql`${lineKind}`}
       AND entity_id IN (${[...new Set(rows.map((row) => idOf(row.entity_id)))].map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`,
  );
  const byDoc = new Map<string, Record<string, unknown>[]>();
  for (const line of lineRows) {
    const key = `${idOf(line.entity_id)}|${String(line.document_number)}|${dayOf(line.document_date)}`;
    const list = byDoc.get(key) ?? [];
    list.push(line);
    byDoc.set(key, list);
  }
  const order = new Map(clean.map((id, index) => [id.toLowerCase(), index]));
  const items = rows.map((row) => kind === 'quote'
    ? quoteJson(row, byDoc.get(`${idOf(row.entity_id)}|${String(row.number)}|${dayOf(row.issue_date)}`) ?? [])
    : deliveryJson(row, byDoc.get(`${idOf(row.entity_id)}|${String(row.number)}|${dayOf(row.issue_date)}`) ?? []));
  return items.sort((left, right) => (order.get(String(left.id)) ?? 0) - (order.get(String(right.id)) ?? 0));
}

function commercialLines(lines: Record<string, unknown>[]): Record<string, unknown>[] {
  return lines
    .sort((left, right) => Number(left.line_seq) - Number(right.line_seq))
    .map((line) => ({
      id: idOf(line.id),
      line_no: Number(line.line_seq),
      product_id: null,
      description: textOf(line.description) ?? textOf(line.item) ?? '',
      quantity: line.units == null ? '0.000' : new Decimal(String(line.units)).toFixed(3),
      unit_price: unitPrice(line),
      discount_pct: '0.00',
      tax_code: null,
    }));
}

function quoteJson(row: Record<string, unknown>, lines: Record<string, unknown>[]): Record<string, unknown> {
  const invoiced = String(row.invoiced_status ?? '');
  const estado = String(row.status_holded ?? '');
  const billed = invoiced.trim().toLowerCase();
  const status = billed === 'facturado'
    ? 'converted'
    : ['aceptado', 'aceptada'].includes(estado.trim().toLowerCase())
      ? 'accepted'
      : ['rechazado', 'rechazada'].includes(estado.trim().toLowerCase())
        ? 'rejected'
        : 'sent';
  const vat = money2(row.vat);
  return {
    id: idOf(row.id),
    legal_entity_id: idOf(row.entity_id),
    series_id: null,
    number: textOf(row.number),
    status,
    customer_id: row.counterparty_contact_id == null ? null : idOf(row.counterparty_contact_id),
    customer_name: textOf(row.customer_name),
    channel: 'other',
    issue_date: dayOf(row.issue_date),
    valid_until: dayOf(row.valid_until),
    currency: 'EUR',
    language: 'es',
    is_proforma: false,
    incoterm: null,
    notes: textOf(row.description),
    subtotal: money2(row.subtotal),
    tax_total: vat,
    total: money2(row.total),
    imported: true,
    read_only: true,
    lines: commercialLines(lines),
  };
}

function deliveryJson(row: Record<string, unknown>, lines: Record<string, unknown>[]): Record<string, unknown> {
  const invoiced = String(row.invoiced_status ?? '').trim().toLowerCase();
  const invoicing = invoiced === 'facturado' ? 'invoiced' : invoiced.startsWith('parcial') ? 'partially_invoiced' : 'not_invoiced';
  return {
    id: idOf(row.id),
    number: textOf(row.number),
    kind: 'sale',
    status: 'issued',
    invoicing_status: invoicing,
    legal_entity_id: idOf(row.entity_id),
    customer_id: null,
    customer_name: textOf(lines.find((line) => textOf(line.counterparty_name))?.counterparty_name) ?? textOf(row.destination),
    sales_order_id: null,
    channel: textOf(row.channel_label),
    issue_date: dayOf(row.issue_date),
    from_location_id: ZERO,
    to_location_id: null,
    ship_to: null,
    incoterm: null,
    is_valued: true,
    tracking_ref: null,
    shipped_at: null,
    delivered_at: null,
    cancelled_reason: null,
    source_delivery_note_id: null,
    notes: textOf(row.description),
    imported: true,
    read_only: true,
    lines: commercialLines(lines),
  };
}

export async function legacyPayment(read: Read, id: string): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await read<Record<string, unknown>>(sql`
    SELECT h.*, COALESCE(c.legal_name, h.counterparty_name) AS customer_name
    FROM legacy.holded_invoice h
    LEFT JOIN party.contact c ON c.id = h.counterparty_contact_id
    WHERE h.id = CAST(${id.toLowerCase()} AS UUID) AND COALESCE(h.paid, 0) > 0
  `);
  const row = rows[0];
  if (!row) return null;
  const paid = money2(row.paid);
  const date = dayOf(row.paid_on) ?? dayOf(row.issue_date);
  return {
    id: idOf(row.id),
    legal_entity_id: idOf(row.entity_id),
    direction: String(row.kind) === 'purchase' ? 'out' : 'in',
    method: paymentMethodOf(textOf(row.payment_method)),
    amount: paid,
    currency: 'EUR',
    value_date: date,
    counterparty_id: row.counterparty_contact_id == null ? null : idOf(row.counterparty_contact_id),
    counterparty_name: textOf(row.customer_name),
    bank_account_id: null,
    reference: textOf(row.number),
    source: 'migration',
    status: 'registered',
    reversal_reason: null,
    allocations: [],
    unallocated: paid,
    imported: true,
    read_only: true,
  };
}

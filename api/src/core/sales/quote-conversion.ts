import { Decimal } from 'decimal.js';

import { sessionOf } from '../../auth/guard';
import { can, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { holdedQuoteBase, quoteStatusSql } from '../sales-documents/status';
import { businessDate } from '../time';
import { lineBase } from './totals';

/**
 * Presupuestado frente a lo facturado.
 *
 * WineCore: presupuesto → pedido (`sales_order.quote_id`) → albarán
 * (`delivery_note.sales_order_id`) → factura (`invoice_line.delivery_note_line_id`
 * o, si se facturó el pedido directo, `invoice_line.order_line_id`).
 * La línea se ata en `sales.quote_line_link` al convertir; si falta, se usa
 * el mismo número de línea del único pedido del presupuesto.
 * Solo cuentan facturas emitidas y no sustituidas. Un borrador no es facturado.
 *
 * Holded no guarda el albarán ni la factura de destino. El importe facturado
 * es el «Total facturado» de la cabecera y las botellas se reparten en la
 * misma proporción. `linked` queda en false.
 *
 * Los importes salen con 2 decimales (HALF_UP). Las botellas, hasta 3.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_ALIAS: Record<string, readonly string[]> = {
  abierto: ['draft', 'sent'],
  open: ['draft', 'sent'],
  aceptado: ['accepted'],
  rechazado: ['rejected'],
  convertido: ['converted'],
  caducado: ['expired'],
};

const NATIVE_STATUS = new Set(['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted']);

const ISSUED = `
  i.status = 'issued'
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
  )
`;

export interface ConversionDoc {
  id: string;
  number: string | null;
  status: string;
  total: string | null;
}

export interface ConversionLine {
  line_no: number;
  description: string;
  product_id: string | null;
  wine_id: string | null;
  wine: string | null;
  vintage: number | null;
  lots: string[];
  bottles_budgeted: string;
  bottles_invoiced: string;
  amount_budgeted: string;
  amount_invoiced: string;
  difference_bottles: string;
  difference_amount: string;
}

export interface ConversionQuote {
  id: string;
  origin: 'winecore' | 'holded';
  number: string | null;
  entity_code: string;
  status: string;
  customer: string;
  issue_date: string | null;
  partial: boolean;
  linked: boolean;
  bottles_budgeted: string;
  bottles_invoiced: string;
  base_possible: string;
  total_possible: string;
  base_invoiced: string;
  total_invoiced: string;
  delivery_notes: ConversionDoc[];
  invoices: ConversionDoc[];
  lines: ConversionLine[];
}

export interface ConversionReference {
  wine_id: string | null;
  wine: string | null;
  vintage: number | null;
  lots: string[];
  product_id: string | null;
  label: string;
  bottles_budgeted: string;
  bottles_invoiced: string;
  amount_budgeted: string;
  amount_invoiced: string;
  average_price: string | null;
  average_price_invoiced: string | null;
}

export interface ConversionReport {
  summary: {
    quotes: number;
    bottles_budgeted: string;
    base_possible: string;
    total_possible: string;
    bottles_invoiced: string;
    base_invoiced: string;
    total_invoiced: string;
    conversion_bottles_pct: string | null;
    conversion_amount_pct: string | null;
  };
  by_reference: ConversionReference[];
  quote: ConversionQuote | null;
  quotes?: ConversionQuote[];
}

interface Scope {
  po: boolean;
  cvpo: boolean;
  from: string | null;
  to: string | null;
  quoteId: string | null;
  customerId: string | null;
  statuses: Set<string>;
  origin: 'holded' | 'winecore' | null;
  includeQuotes: boolean;
  today: string;
}

interface RawLine {
  lineId: string | null;
  lineNo: number;
  productId: string | null;
  description: string;
  kind: string | null;
  quantity: Decimal;
  base: Decimal;
  wineId: string | null;
  wine: string | null;
  vintage: number | null;
}

interface RawQuote {
  origin: 'winecore' | 'holded';
  id: string;
  number: string | null;
  entity: string;
  status: string;
  customer: string;
  issueDate: string | null;
  subtotal: Decimal;
  total: Decimal;
  invoicedTotal: Decimal | null;
  lines: RawLine[];
}

interface BillLine {
  invoiceLineId: string;
  taxCode: string;
  base: Decimal;
  rate: Decimal;
  surcharge: Decimal;
  withholding: Decimal;
  quantity: Decimal;
}

interface LineFulfillment {
  bottles: Decimal;
  base: Decimal;
  lots: Set<string>;
  deliveries: Map<string, ConversionDoc>;
  invoices: Map<string, { doc: ConversionDoc; lines: BillLine[] }>;
}

export function linkQuoteLines(
  tx: Tx,
  quoteId: string,
  quoteLines: readonly { id: string; line_no: number }[],
  orderId: string,
  orderLines: readonly { id?: unknown; line_no?: unknown }[],
): void {
  for (const line of quoteLines) {
    const match = orderLines.find((item) => Number(item.line_no) === line.line_no && typeof item.id === 'string');
    if (!match || typeof match.id !== 'string') continue;
    tx.write(sql`
      INSERT INTO sales.quote_line_link (quote_line_id, quote_id, order_id, order_line_id)
      VALUES (
        CAST(${line.id} AS UUID),
        CAST(${quoteId} AS UUID),
        CAST(${orderId} AS UUID),
        CAST(${match.id} AS UUID)
      )
    `);
    tx.audit({
      table: 'sales.quote_line_link',
      rowId: line.id,
      action: 'INSERT',
      before: null,
      after: { quote_id: quoteId, order_id: orderId, order_line_id: match.id },
    });
  }
}

export async function quoteConversion(writer: Writer, request: Request, now = new Date()): Promise<ConversionReport> {
  const scope = parseScope(new URL(request.url), sessionOf(request), now);
  const native = scope.origin === 'holded' ? [] : await loadNative(writer, scope);
  const holded = scope.origin === 'winecore' ? [] : await loadHolded(writer, scope);
  const events = scope.origin === 'holded' ? new Map<string, LineFulfillment>() : await loadFulfillment(writer, scope);
  const folded = [...foldNative(native, events), ...foldHolded(holded)];
  const visible = scope.quoteId
    ? folded
    : folded.filter((quote) => scope.statuses.size === 0 || scope.statuses.has(quote.status));
  if (scope.quoteId && visible.length === 0) throw domainError('WC_NOT_FOUND');
  return reportOf(visible, scope);
}

function parseScope(url: URL, user: UserCtx, now: Date): Scope {
  const params = url.searchParams;
  const fields: Record<string, string> = {};
  const from = dateParam(params.get('from'), 'from', fields);
  const to = dateParam(params.get('to'), 'to', fields);
  if (from && to && from > to) fields.to = 'Debe ser igual o posterior a from';

  let requested: 'PO' | 'CVPO' | 'both' = 'both';
  const entityRaw = params.get('entity')?.trim().toLowerCase().replace(/\./g, '') ?? '';
  if (entityRaw === '') requested = 'both';
  else if (entityRaw === 'po') requested = 'PO';
  else if (entityRaw === 'cvpo') requested = 'CVPO';
  else if (entityRaw === 'both' || entityRaw === 'ambas' || entityRaw === 'all' || entityRaw === 'todas') requested = 'both';
  else fields.entity = 'La entidad debe ser PO o CVPO';

  const quoteRaw = params.get('quote_id')?.trim().toLowerCase() ?? '';
  if (quoteRaw !== '' && !UUID.test(quoteRaw)) fields.quote_id = 'Identificador no válido';
  const customerRaw = params.get('customer_id')?.trim().toLowerCase() ?? '';
  if (customerRaw !== '' && !UUID.test(customerRaw)) fields.customer_id = 'Identificador no válido';

  const originRaw = params.get('origin')?.trim().toLowerCase() ?? '';
  let origin: Scope['origin'] = null;
  if (originRaw === '' ) origin = null;
  else if (originRaw === 'holded' || originRaw === 'winecore') origin = originRaw;
  else fields.origin = 'Debe ser holded o winecore';

  const includeRaw = params.get('include')?.trim().toLowerCase() ?? '';
  if (includeRaw !== '' && includeRaw !== 'quotes') fields.include = 'Debe ser quotes';

  const statuses = new Set<string>();
  const statusRaw = params.get('status')?.trim().toLowerCase() ?? '';
  if (statusRaw !== '') {
    for (const token of statusRaw.split(',').map((item) => item.trim()).filter(Boolean)) {
      const alias = STATUS_ALIAS[token];
      if (alias) {
        for (const status of alias) statuses.add(status);
      } else if (NATIVE_STATUS.has(token)) statuses.add(token);
      else fields.status = 'Estado no válido: abierto, aceptado, rechazado o convertido';
    }
  }

  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);

  const allowed = allowedEntities(user);
  if (requested === 'PO' && !allowed.has('PO')) throw domainError('WC_FORBIDDEN');
  if (requested === 'CVPO' && !allowed.has('CVPO')) throw domainError('WC_FORBIDDEN');
  const po = requested !== 'CVPO' && allowed.has('PO');
  const cvpo = requested !== 'PO' && allowed.has('CVPO');
  if (!po && !cvpo) throw domainError('WC_FORBIDDEN');

  return {
    po,
    cvpo,
    from,
    to,
    quoteId: quoteRaw === '' ? null : quoteRaw,
    customerId: customerRaw === '' ? null : customerRaw,
    statuses: quoteRaw === '' ? statuses : new Set<string>(),
    origin: quoteRaw === '' ? origin : null,
    includeQuotes: includeRaw === 'quotes',
    today: businessDate(now),
  };
}

function allowedEntities(user: UserCtx): Set<string> {
  const codes = new Set<string>();
  let unrestricted = false;
  for (const role of user.roles) {
    if (!can({ ...user, roles: [role] }, 'sales.read')) continue;
    if (role.legalEntityId === null) unrestricted = true;
    else if (role.legalEntityCode === 'PO' || role.legalEntityCode === 'CVPO') codes.add(role.legalEntityCode);
  }
  if (unrestricted) {
    codes.add('PO');
    codes.add('CVPO');
  }
  return codes;
}

function dateParam(raw: string | null, field: string, fields: Record<string, string>): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (!DAY.test(value)) fields[field] = 'Fecha AAAA-MM-DD';
  return value;
}

function whereOf(scope: Scope, dateSql: string, customerSql: string): string {
  const parts = [
    `((${sql`${scope.po}`} AND e.code = 'PO') OR (${sql`${scope.cvpo}`} AND e.code = 'CVPO'))`,
  ];
  if (scope.from) parts.push(`${dateSql} >= CAST(${sql`${scope.from}`} AS DATE)`);
  if (scope.to) parts.push(`${dateSql} <= CAST(${sql`${scope.to}`} AS DATE)`);
  if (scope.quoteId) parts.push(`q.id = CAST(${sql`${scope.quoteId}`} AS UUID)`);
  if (scope.customerId) parts.push(`${customerSql} = CAST(${sql`${scope.customerId}`} AS UUID)`);
  return parts.join(' AND ');
}

function dayExpr(iso: string): string {
  if (!DAY.test(iso)) throw new Error('fecha');
  return `DATE '${iso}'`;
}

async function loadNative(writer: Writer, scope: Scope): Promise<RawQuote[]> {
  const dateSql = `COALESCE(q.issue_date, CAST(q.created_at AT TIME ZONE 'Europe/Madrid' AS DATE))`;
  const status = quoteStatusSql({
    base: 'q.status',
    validUntil: 'q.valid_until',
    today: dayExpr(scope.today),
  });
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT CAST(q.id AS VARCHAR) AS quote_id, q.number, e.code AS entity_code,
           ${status} AS status,
           CAST(${dateSql} AS VARCHAR) AS sort_date,
           COALESCE(c.legal_name, '') AS customer,
           CAST(q.subtotal AS VARCHAR) AS subtotal,
           CAST(q.total AS VARCHAR) AS total,
           CAST(ql.id AS VARCHAR) AS line_id, ql.line_no,
           CAST(ql.product_id AS VARCHAR) AS product_id, ql.description, p.kind,
           CAST(ql.quantity AS VARCHAR) AS quantity,
           CAST(ql.unit_price AS VARCHAR) AS unit_price,
           CAST(ql.discount_pct AS VARCHAR) AS discount_pct,
           CAST(COALESCE(po.wine_id, p.wine_id) AS VARCHAR) AS wine_id,
           w.name AS wine, p.vintage
    FROM sales.quote q
    JOIN core.legal_entity e ON e.id = q.legal_entity_id
    LEFT JOIN party.contact c ON c.id = q.customer_id
    LEFT JOIN sales.quote_line ql ON ql.quote_id = q.id
    LEFT JOIN catalog.product p ON p.id = ql.product_id
    LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
    LEFT JOIN catalog.wine_visible w ON w.id = COALESCE(po.wine_id, p.wine_id)
    WHERE ${whereOf(scope, dateSql, 'q.customer_id')}
    ORDER BY q.id, ql.line_no
  `);
  return groupQuotes('winecore', rows, null);
}

async function loadHolded(writer: Writer, scope: Scope): Promise<RawQuote[]> {
  const status = quoteStatusSql({
    base: holdedQuoteBase('q.status_holded', 'q.invoiced_status'),
    validUntil: 'q.valid_until',
    today: dayExpr(scope.today),
  });
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT CAST(q.id AS VARCHAR) AS quote_id, q.number, e.code AS entity_code,
           ${status} AS status,
           CAST(q.issue_date AS VARCHAR) AS sort_date,
           q.counterparty_name AS customer,
           CAST(q.subtotal AS VARCHAR) AS subtotal,
           CAST(q.total AS VARCHAR) AS total,
           CAST(q.invoiced_total AS VARCHAR) AS invoiced_total,
           CAST(hl.id AS VARCHAR) AS line_id, hl.line_seq AS line_no,
           CAST(hl.matched_product_id AS VARCHAR) AS product_id,
           COALESCE(hl.description, hl.item, q.description, 'Presupuesto') AS description,
           p.kind,
           CAST(COALESCE(hl.units, 0) AS VARCHAR) AS quantity,
           CAST(COALESCE(hl.subtotal, 0) AS VARCHAR) AS line_base,
           CAST(COALESCE(po.wine_id, p.wine_id) AS VARCHAR) AS wine_id,
           w.name AS wine, p.vintage
    FROM legacy.holded_quote q
    JOIN core.legal_entity e ON e.id = q.entity_id
    LEFT JOIN legacy.holded_invoice_line hl
      ON hl.entity_id = q.entity_id
     AND hl.kind = 'quote'
     AND hl.document_number = q.number
     AND hl.document_date = q.issue_date
     AND hl.is_draft = FALSE
    LEFT JOIN catalog.product p ON p.id = hl.matched_product_id
    LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
    LEFT JOIN catalog.wine_visible w ON w.id = COALESCE(po.wine_id, p.wine_id)
    WHERE ${whereOf(scope, 'q.issue_date', 'q.counterparty_contact_id')}
    ORDER BY q.id, hl.line_seq
  `);
  return groupQuotes('holded', rows, 'invoiced_total');
}

function groupQuotes(origin: 'winecore' | 'holded', rows: Record<string, unknown>[], invoicedField: string | null): RawQuote[] {
  const quotes = new Map<string, RawQuote>();
  for (const row of rows) {
    const id = idOf(row.quote_id);
    if (!id) continue;
    let quote = quotes.get(id);
    if (!quote) {
      quote = {
        origin,
        id,
        number: textOrNull(row.number),
        entity: text(row.entity_code),
        status: text(row.status),
        customer: text(row.customer),
        issueDate: dayOf(row.sort_date),
        subtotal: dec(row.subtotal),
        total: dec(row.total),
        invoicedTotal: invoicedField ? (row[invoicedField] == null ? new Decimal(0) : dec(row[invoicedField])) : null,
        lines: [],
      };
      quotes.set(id, quote);
    }
    const lineId = idOf(row.line_id);
    if (!lineId) continue;
    const quantity = dec(row.quantity);
    const base = row.line_base == null
      ? lineBase(quantity, dec(row.unit_price), dec(row.discount_pct))
      : money.round2(dec(row.line_base));
    quote.lines.push({
      lineId,
      lineNo: Number(row.line_no) || quote.lines.length + 1,
      productId: idOf(row.product_id),
      description: text(row.description) || 'Línea',
      kind: textOrNull(row.kind),
      quantity,
      base,
      wineId: idOf(row.wine_id),
      wine: textOrNull(row.wine),
      vintage: vintageOf(row.vintage),
    });
  }
  return [...quotes.values()];
}

async function loadFulfillment(writer: Writer, scope: Scope): Promise<Map<string, LineFulfillment>> {
  const dateSql = `COALESCE(q.issue_date, CAST(q.created_at AT TIME ZONE 'Europe/Madrid' AS DATE))`;
  const where = whereOf(scope, dateSql, 'q.customer_id');
  const linked = await writer.read<Record<string, unknown>>(fulfillmentSql('link.quote_line_id', `
    FROM sales.quote_line_link link
    JOIN sales.quote q ON q.id = link.quote_id
    JOIN sales.sales_order_line ol ON ol.id = link.order_line_id
  `, where));
  const fallback = await writer.read<Record<string, unknown>>(fulfillmentSql('ql.id', `
    FROM sales.quote_line ql
    JOIN sales.quote q ON q.id = ql.quote_id
    JOIN sales.sales_order o ON o.quote_id = q.id
    JOIN sales.sales_order_line ol ON ol.order_id = o.id AND ol.line_no = ql.line_no
      AND (ql.product_id IS NULL OR ol.product_id = ql.product_id)
  `, `${where} AND NOT EXISTS (SELECT 1 FROM sales.quote_line_link link WHERE link.quote_line_id = ql.id)
      AND (SELECT count(*) FROM sales.sales_order other WHERE other.quote_id = q.id) = 1`));
  const direct = await writer.read<Record<string, unknown>>(`
    SELECT CAST(link.quote_line_id AS VARCHAR) AS quote_line_id,
           CAST(NULL AS VARCHAR) AS delivery_note_id, CAST(NULL AS VARCHAR) AS delivery_number,
           CAST(NULL AS VARCHAR) AS delivery_status, CAST(NULL AS VARCHAR) AS delivery_line_id,
           CAST(i.id AS VARCHAR) AS invoice_id, i.number AS invoice_number,
           CAST(il.id AS VARCHAR) AS invoice_line_id,
           lot.code AS lot_code,
           CAST(il.quantity AS VARCHAR) AS quantity,
           CAST(il.line_base AS VARCHAR) AS line_base,
           il.tax_code,
           CAST(COALESCE(tc.rate, 0) AS VARCHAR) AS tax_rate,
           CAST(COALESCE(tc.surcharge_rate, 0) AS VARCHAR) AS surcharge_rate,
           CAST(COALESCE(tc.withholding_rate, 0) AS VARCHAR) AS withholding_rate
    FROM sales.quote_line_link link
    JOIN sales.quote q ON q.id = link.quote_id
    JOIN core.legal_entity e ON e.id = q.legal_entity_id
    JOIN billing.invoice_line il ON il.order_line_id = link.order_line_id AND il.delivery_note_line_id IS NULL
    JOIN billing.invoice i ON i.id = il.invoice_id AND ${ISSUED}
    LEFT JOIN inventory.lot lot ON lot.id = il.lot_id
    LEFT JOIN billing.tax_code tc ON tc.code = il.tax_code
    WHERE ${where}
  `);
  const map = new Map<string, LineFulfillment>();
  const seen = new Set<string>();
  for (const row of [...linked, ...fallback, ...direct]) absorb(map, seen, row);
  return map;
}

function fulfillmentSql(lineExpr: string, from: string, where: string): string {
  return `
    SELECT CAST(${lineExpr} AS VARCHAR) AS quote_line_id,
           CAST(dn.id AS VARCHAR) AS delivery_note_id, dn.number AS delivery_number, dn.status AS delivery_status,
           CAST(dnl.id AS VARCHAR) AS delivery_line_id,
           CAST(i.id AS VARCHAR) AS invoice_id, i.number AS invoice_number,
           CAST(il.id AS VARCHAR) AS invoice_line_id,
           lot.code AS lot_code,
           CAST(CASE WHEN i.id IS NULL THEN NULL ELSE il.quantity END AS VARCHAR) AS quantity,
           CAST(CASE WHEN i.id IS NULL THEN NULL ELSE il.line_base END AS VARCHAR) AS line_base,
           CASE WHEN i.id IS NULL THEN NULL ELSE il.tax_code END AS tax_code,
           CAST(COALESCE(tc.rate, 0) AS VARCHAR) AS tax_rate,
           CAST(COALESCE(tc.surcharge_rate, 0) AS VARCHAR) AS surcharge_rate,
           CAST(COALESCE(tc.withholding_rate, 0) AS VARCHAR) AS withholding_rate
    ${from}
    JOIN core.legal_entity e ON e.id = q.legal_entity_id
    JOIN sales.delivery_note_line dnl ON dnl.order_line_id = ol.id
    JOIN sales.delivery_note dn ON dn.id = dnl.delivery_note_id AND dn.status <> 'cancelled'
    LEFT JOIN billing.invoice_line il ON il.delivery_note_line_id = dnl.id
    LEFT JOIN billing.invoice i ON i.id = il.invoice_id AND ${ISSUED}
    LEFT JOIN inventory.lot lot ON lot.id = COALESCE(il.lot_id, dnl.lot_id)
    LEFT JOIN billing.tax_code tc ON tc.code = il.tax_code
    WHERE ${where}
  `;
}

function absorb(map: Map<string, LineFulfillment>, seen: Set<string>, row: Record<string, unknown>): void {
  const lineId = idOf(row.quote_line_id);
  if (!lineId) return;
  const invoiceLineId = idOf(row.invoice_line_id);
  const deliveryLineId = idOf(row.delivery_line_id);
  const key = `${lineId}|${deliveryLineId ?? ''}|${invoiceLineId ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  const slot = map.get(lineId) ?? emptyFulfillment();
  map.set(lineId, slot);
  const deliveryId = idOf(row.delivery_note_id);
  if (deliveryId && !slot.deliveries.has(deliveryId)) {
    slot.deliveries.set(deliveryId, {
      id: deliveryId,
      number: textOrNull(row.delivery_number),
      status: text(row.delivery_status),
      total: null,
    });
  }
  const invoiceId = idOf(row.invoice_id);
  if (!invoiceId || !invoiceLineId) {
    const lot = textOrNull(row.lot_code);
    if (lot) slot.lots.add(lot);
    return;
  }
  const quantity = dec(row.quantity);
  const base = money.round2(dec(row.line_base));
  slot.bottles = slot.bottles.plus(quantity);
  slot.base = money.add(slot.base, base);
  const lot = textOrNull(row.lot_code);
  if (lot) slot.lots.add(lot);
  const invoice = slot.invoices.get(invoiceId) ?? {
    doc: { id: invoiceId, number: textOrNull(row.invoice_number), status: 'issued', total: null },
    lines: [],
  };
  invoice.lines.push({
    invoiceLineId,
    taxCode: text(row.tax_code) || 'IVA21',
    base,
    rate: dec(row.tax_rate),
    surcharge: dec(row.surcharge_rate),
    withholding: dec(row.withholding_rate),
    quantity,
  });
  slot.invoices.set(invoiceId, invoice);
}

function emptyFulfillment(): LineFulfillment {
  return { bottles: new Decimal(0), base: new Decimal(0), lots: new Set(), deliveries: new Map(), invoices: new Map() };
}

function foldNative(quotes: readonly RawQuote[], events: Map<string, LineFulfillment>): ConversionQuote[] {
  return quotes.map((quote) => {
    const lines: ConversionLine[] = [];
    const deliveries = new Map<string, ConversionDoc>();
    const invoices = new Map<string, { doc: ConversionDoc; lines: BillLine[] }>();
    let bottles = new Decimal(0);
    let invoicedBottles = new Decimal(0);
    let invoicedBase = new Decimal(0);
    for (const line of quote.lines) {
      const got = line.lineId ? events.get(line.lineId) : undefined;
      const budgetBottles = bottleQty(line);
      const sold = got?.bottles ?? new Decimal(0);
      const soldBase = got?.base ?? new Decimal(0);
      bottles = bottles.plus(budgetBottles);
      invoicedBottles = invoicedBottles.plus(sold);
      invoicedBase = money.add(invoicedBase, soldBase);
      if (got) {
        for (const [id, doc] of got.deliveries) deliveries.set(id, doc);
        for (const [id, invoice] of got.invoices) {
          const current = invoices.get(id);
          if (!current) invoices.set(id, { doc: invoice.doc, lines: [...invoice.lines] });
          else current.lines.push(...invoice.lines);
        }
      }
      lines.push(lineView(line, budgetBottles, sold, soldBase, [...(got?.lots ?? [])].sort()));
    }
    const invoicedTotal = invoiceMoney(invoices);
    return viewOf(quote, bottles, invoicedBottles, quote.subtotal, quote.total, invoicedBase, invoicedTotal, deliveries, invoices, lines, deliveries.size + invoices.size > 0);
  });
}

function foldHolded(quotes: readonly RawQuote[]): ConversionQuote[] {
  return quotes.map((quote) => {
    const source = quote.lines.length > 0 ? quote.lines : [synthetic(quote)];
    const weights = source.map((line) => line.base);
    const qtyWeights = source.map((line) => bottleQty(line));
    const budgetBottles = qtyWeights.reduce((acc, value) => acc.plus(value), new Decimal(0));
    const invoicedHeader = quote.invoicedTotal ?? new Decimal(0);
    const invoicedBase = share(quote.subtotal, invoicedHeader, quote.total);
    const invoicedBottles = shareQty(budgetBottles, invoicedHeader, quote.total);
    const bases = allocateMoney(invoicedBase, weights);
    const bottles = allocateQty(invoicedBottles, qtyWeights);
    const lines = source.map((line, index) => lineView(
      line,
      bottleQty(line),
      bottles[index] ?? new Decimal(0),
      bases[index] ?? new Decimal(0),
      [],
    ));
    const linked = false;
    return viewOf(
      quote,
      budgetBottles,
      invoicedBottles,
      quote.subtotal,
      quote.total,
      invoicedBase,
      money.round2(invoicedHeader),
      new Map(),
      new Map(),
      lines,
      linked,
    );
  });
}

function synthetic(quote: RawQuote): RawLine {
  return {
    lineId: null,
    lineNo: 1,
    productId: null,
    description: quote.number ? `Presupuesto ${quote.number}` : 'Presupuesto',
    kind: null,
    quantity: new Decimal(0),
    base: money.round2(quote.subtotal),
    wineId: null,
    wine: null,
    vintage: null,
  };
}

function viewOf(
  quote: RawQuote,
  bottles: Decimal,
  invoicedBottles: Decimal,
  base: Decimal,
  total: Decimal,
  invoicedBase: Decimal,
  invoicedTotal: Decimal,
  deliveries: Map<string, ConversionDoc>,
  invoices: Map<string, { doc: ConversionDoc; lines: BillLine[] }>,
  lines: ConversionLine[],
  linked: boolean,
): ConversionQuote {
  const invoiceDocs = [...invoices.values()].map((invoice) => ({
    ...invoice.doc,
    total: money.toString(billTotal(invoice.lines)),
  }));
  return {
    id: quote.id,
    origin: quote.origin,
    number: quote.number,
    entity_code: quote.entity,
    status: quote.status,
    customer: quote.customer,
    issue_date: quote.issueDate,
    partial: partialOf(bottles, invoicedBottles, total, invoicedTotal),
    linked,
    bottles_budgeted: qtyOut(bottles),
    bottles_invoiced: qtyOut(invoicedBottles),
    base_possible: money.toString(base),
    total_possible: money.toString(total),
    base_invoiced: money.toString(invoicedBase),
    total_invoiced: money.toString(invoicedTotal),
    delivery_notes: [...deliveries.values()],
    invoices: invoiceDocs,
    lines,
  };
}

function lineView(line: RawLine, budget: Decimal, sold: Decimal, soldBase: Decimal, lots: string[]): ConversionLine {
  return {
    line_no: line.lineNo,
    description: line.description,
    product_id: line.productId,
    wine_id: line.wineId,
    wine: line.wine,
    vintage: line.vintage,
    lots,
    bottles_budgeted: qtyOut(budget),
    bottles_invoiced: qtyOut(sold),
    amount_budgeted: money.toString(line.base),
    amount_invoiced: money.toString(soldBase),
    difference_bottles: qtyOut(budget.minus(sold)),
    difference_amount: money.toString(money.sub(line.base, soldBase)),
  };
}

function reportOf(quotes: readonly ConversionQuote[], scope: Scope): ConversionReport {
  let bottles = new Decimal(0);
  let invoicedBottles = new Decimal(0);
  let base = new Decimal(0);
  let total = new Decimal(0);
  let invoicedBase = new Decimal(0);
  let invoicedTotal = new Decimal(0);
  const refs = new Map<string, RefAcc>();
  for (const quote of quotes) {
    bottles = bottles.plus(dec(quote.bottles_budgeted));
    invoicedBottles = invoicedBottles.plus(dec(quote.bottles_invoiced));
    base = money.add(base, dec(quote.base_possible));
    total = money.add(total, dec(quote.total_possible));
    invoicedBase = money.add(invoicedBase, dec(quote.base_invoiced));
    invoicedTotal = money.add(invoicedTotal, dec(quote.total_invoiced));
    for (const line of quote.lines) addRef(refs, line);
  }
  const picked = scope.quoteId ? quotes.find((quote) => quote.id === scope.quoteId) ?? null : null;
  const body: ConversionReport = {
    summary: {
      quotes: quotes.length,
      bottles_budgeted: qtyOut(bottles),
      base_possible: money.toString(base),
      total_possible: money.toString(total),
      bottles_invoiced: qtyOut(invoicedBottles),
      base_invoiced: money.toString(invoicedBase),
      total_invoiced: money.toString(invoicedTotal),
      conversion_bottles_pct: pct(invoicedBottles, bottles),
      conversion_amount_pct: pct(invoicedTotal, total),
    },
    by_reference: [...refs.values()].map(refView).sort((a, b) => a.label.localeCompare(b.label, 'es')),
    quote: picked,
  };
  if (scope.includeQuotes) body.quotes = [...quotes];
  return body;
}

interface RefAcc {
  wineId: string | null;
  wine: string | null;
  vintage: number | null;
  productId: string | null;
  fallback: string;
  lots: Set<string>;
  bottles: Decimal;
  invoicedBottles: Decimal;
  amount: Decimal;
  invoiced: Decimal;
}

function addRef(refs: Map<string, RefAcc>, line: ConversionLine): void {
  const key = line.product_id
    ? `product:${line.product_id}`
    : `${line.wine_id ?? ''}|${line.vintage ?? ''}|${line.description}`;
  const acc = refs.get(key) ?? {
    wineId: line.wine_id,
    wine: line.wine,
    vintage: line.vintage,
    productId: line.product_id,
    fallback: line.description,
    lots: new Set<string>(),
    bottles: new Decimal(0),
    invoicedBottles: new Decimal(0),
    amount: new Decimal(0),
    invoiced: new Decimal(0),
  };
  acc.bottles = acc.bottles.plus(dec(line.bottles_budgeted));
  acc.invoicedBottles = acc.invoicedBottles.plus(dec(line.bottles_invoiced));
  acc.amount = money.add(acc.amount, dec(line.amount_budgeted));
  acc.invoiced = money.add(acc.invoiced, dec(line.amount_invoiced));
  for (const lot of line.lots) acc.lots.add(lot);
  refs.set(key, acc);
}

function refView(acc: RefAcc): ConversionReference {
  const lots = [...acc.lots].sort((a, b) => a.localeCompare(b, 'es'));
  const label = [acc.wine ?? acc.fallback, acc.vintage == null ? null : String(acc.vintage), lots.length > 0 ? lots.join(', ') : null]
    .filter((part): part is string => part != null && part !== '')
    .join(' · ');
  return {
    wine_id: acc.wineId,
    wine: acc.wine,
    vintage: acc.vintage,
    lots,
    product_id: acc.productId,
    label: label || acc.fallback,
    bottles_budgeted: qtyOut(acc.bottles),
    bottles_invoiced: qtyOut(acc.invoicedBottles),
    amount_budgeted: money.toString(acc.amount),
    amount_invoiced: money.toString(acc.invoiced),
    average_price: acc.bottles.gt(0) ? money.toString(acc.amount.div(acc.bottles)) : null,
    average_price_invoiced: acc.invoicedBottles.gt(0) ? money.toString(acc.invoiced.div(acc.invoicedBottles)) : null,
  };
}

function invoiceMoney(invoices: Map<string, { lines: BillLine[] }>): Decimal {
  let total = new Decimal(0);
  for (const invoice of invoices.values()) total = money.add(total, billTotal(invoice.lines));
  return total;
}

function billTotal(lines: readonly BillLine[]): Decimal {
  const groups = new Map<string, { base: Decimal; rate: Decimal; surcharge: Decimal; withholding: Decimal }>();
  for (const line of lines) {
    const current = groups.get(line.taxCode);
    if (current) current.base = money.add(current.base, line.base);
    else groups.set(line.taxCode, { base: line.base, rate: line.rate, surcharge: line.surcharge, withholding: line.withholding });
  }
  let total = new Decimal(0);
  for (const group of groups.values()) {
    const quota = money.round2(group.base.mul(group.rate).div(100));
    const surcharge = money.round2(group.base.mul(group.surcharge).div(100));
    const withholding = money.round2(group.base.mul(group.withholding).div(100));
    total = money.add(total, money.sub(money.add(money.add(group.base, quota), surcharge), withholding));
  }
  return total;
}

function bottleQty(line: RawLine): Decimal {
  if (line.kind != null && line.kind !== 'wine' && line.kind !== 'bulk_wine') return new Decimal(0);
  return line.quantity;
}

function partialOf(budgetQty: Decimal, invoicedQty: Decimal, budgetTotal: Decimal, invoicedTotal: Decimal): boolean {
  const started = invoicedQty.gt(0) || invoicedTotal.gt(0);
  if (!started) return false;
  const openQty = budgetQty.gt(0) && invoicedQty.lt(budgetQty);
  const openAmount = budgetTotal.gt(0) && money.round2(invoicedTotal).lt(money.round2(budgetTotal));
  return openQty || openAmount;
}

function share(whole: Decimal, invoiced: Decimal, total: Decimal): Decimal {
  if (invoiced.isZero() || whole.isZero()) return new Decimal(0);
  if (!total.isZero() && invoiced.eq(total)) return money.round2(whole);
  if (total.isZero()) return new Decimal(0);
  return money.round2(whole.mul(invoiced).div(total));
}

function shareQty(whole: Decimal, invoiced: Decimal, total: Decimal): Decimal {
  if (invoiced.isZero() || whole.isZero() || total.isZero()) return new Decimal(0);
  if (invoiced.eq(total)) return whole;
  return whole.mul(invoiced).div(total).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

function allocateMoney(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  if (weights.length === 0) return [];
  const target = money.round2(total);
  const sum = weights.reduce((acc, weight) => acc.plus(weight), new Decimal(0));
  const parts = sum.isZero()
    ? weights.map(() => money.round2(target.div(weights.length)))
    : weights.map((weight) => money.round2(target.mul(weight).div(sum)));
  const assigned = parts.reduce((acc, part) => money.add(acc, part), new Decimal(0));
  const last = parts.length - 1;
  const current = parts[last];
  if (current !== undefined) parts[last] = money.add(current, money.sub(target, assigned));
  return parts;
}

function allocateQty(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  if (weights.length === 0) return [];
  const target = total.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  const sum = weights.reduce((acc, weight) => acc.plus(weight), new Decimal(0));
  const parts = sum.isZero()
    ? weights.map(() => target.div(weights.length).toDecimalPlaces(3, Decimal.ROUND_HALF_UP))
    : weights.map((weight) => target.mul(weight).div(sum).toDecimalPlaces(3, Decimal.ROUND_HALF_UP));
  const assigned = parts.reduce((acc, part) => acc.plus(part), new Decimal(0));
  const last = parts.length - 1;
  const current = parts[last];
  if (current !== undefined) parts[last] = current.plus(target.minus(assigned));
  return parts;
}

function pct(part: Decimal, whole: Decimal): string | null {
  if (!whole.gt(0)) return null;
  return money.toString(part.div(whole).mul(100));
}

function qtyOut(value: Decimal): string {
  const rounded = value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) return '0';
  return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function dec(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  const raw = text(value).trim();
  if (raw === '') return new Decimal(0);
  return new Decimal(raw);
}

function text(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function textOrNull(value: unknown): string | null {
  const raw = text(value).trim();
  return raw === '' ? null : raw;
}

function idOf(value: unknown): string | null {
  const raw = text(value).trim().toLowerCase();
  return raw === '' ? null : raw;
}

function dayOf(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value).trim());
  return match?.[1] ?? null;
}

function vintageOf(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

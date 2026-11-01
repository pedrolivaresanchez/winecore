import { can, type Permission, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { contactLinkCtes, contactLinkSql, type ContactMatch } from '../legacy/contactLink';
import { dateOf, intOf, money2 } from '../legacy/overview';
import { entityPredicate, legacyScope, likePattern, parseEntityParam, type LegacyScope } from '../legacy/scope';
import { businessDate } from '../time';
import {
  holdedDeliveryNoteStatus,
  holdedInvoiceBase,
  holdedQuoteBase,
  invoiceStatusSql,
  nativeDeliveryNoteStatus,
  nativeInvoiceBase,
  NOT_COUNTED,
  quoteStatusSql,
  RECEIVABLE,
  statusesOf,
  statusLabel,
  supplierInvoiceBase,
  type Direction,
  type DocumentKind,
} from './status';

export type Origin = 'holded' | 'winecore';
type EntityCode = 'PO' | 'CVPO';
type Sort = 'date' | 'number' | 'customer' | 'total' | 'pending';
type Verifactu = 'pending' | 'accepted' | 'rejected';
type Delivery = 'pending' | 'sent' | 'failed' | 'no_recipient' | 'none';

const ORIGINS: readonly Origin[] = ['holded', 'winecore'];
const ENTITY_CODES: readonly EntityCode[] = ['PO', 'CVPO'];
const SORTS: readonly Sort[] = ['date', 'number', 'customer', 'total', 'pending'];
const VERIFACTU: readonly Verifactu[] = ['pending', 'accepted', 'rejected'];
const DELIVERIES: readonly Delivery[] = ['pending', 'sent', 'failed', 'no_recipient', 'none'];
const ORIGIN_LABELS: Record<Origin, string> = { holded: 'Holded', winecore: 'WineCore' };
const ENTITY_LABELS: Record<EntityCode, string> = { PO: 'P.O', CVPO: 'CVPO' };

/** Los mismos permisos que /v1/legacy/invoices y /v1/legacy/documents. */
const HOLDED_INVOICES: readonly Permission[] = ['reports.read', 'finance.read', 'sales.read', 'billing.read', 'purchasing.read'];
const HOLDED_DOCUMENTS: readonly Permission[] = ['reports.read', 'finance.read', 'sales.read', 'billing.read'];

export const SALES_DOCUMENTS_READ: readonly Permission[] = HOLDED_INVOICES;

export interface SalesDocumentItem {
  id: string;
  origin: Origin;
  kind: DocumentKind;
  number: string | null;
  issue_date: string | null;
  due_date: string | null;
  customer: { id: string | null; name: string; match: ContactMatch | null };
  entity_code: string;
  total: string | null;
  pending: string | null;
  currency: string;
  status: string;
  status_label: string;
  /** Solo facturas de venta WineCore emitidas o anuladas; null en el resto. */
  verifactu: Verifactu | null;
  delivery: Delivery | null;
  api_path: string;
}

interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface SalesDocumentPage {
  kind: DocumentKind;
  direction: Direction;
  as_of: string;
  entity: LegacyScope['entity'];
  origins: Origin[];
  items: SalesDocumentItem[];
  total: number;
  limit: number;
  offset: number;
  sort: Sort;
  dir: 'asc' | 'desc';
  totals: { amount: string; pending: string };
  facets: { status: Facet[]; entity: Facet[]; origin: Facet[] };
}

interface Query {
  kind: DocumentKind;
  direction: Direction;
  origins: Origin[];
  entity: EntityCode | null;
  statuses: string[];
  from: string | null;
  to: string | null;
  q: string | null;
  customerId: string | null;
  verifactu: Verifactu | null;
  delivery: Delivery | null;
  sort: Sort;
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

type Codes = { po: boolean; cvpo: boolean };

export async function listSalesDocuments(writer: Writer, user: UserCtx, url: URL, now: Date): Promise<SalesDocumentPage> {
  const query = parseQuery(url);
  if (query.entity) legacyScope(user, query.entity);
  const books = readableBooks(user, query.kind, query.direction, legacyScope(user, 'both'));
  const origins = ORIGINS.filter((origin) => readable(books[origin]));
  const visible: Codes = { po: books.holded.po || books.winecore.po, cvpo: books.holded.cvpo || books.winecore.cvpo };
  if (origins.length === 0) throw domainError('WC_FORBIDDEN');
  if (query.entity && !(query.entity === 'PO' ? visible.po : visible.cvpo)) throw domainError('WC_FORBIDDEN');
  if (query.origins.length > 0 && !query.origins.some((origin) => origins.includes(origin))) throw domainError('WC_FORBIDDEN');
  const today = businessDate(now);
  const page: SalesDocumentPage = {
    kind: query.kind,
    direction: query.direction,
    as_of: today,
    entity: query.entity ?? scopeOf(visible).entity,
    origins,
    items: [],
    total: 0,
    limit: query.limit,
    offset: query.offset,
    sort: query.sort,
    dir: query.dir,
    totals: { amount: '0.00', pending: '0.00' },
    facets: { status: [], entity: [], origin: [] },
  };

  const rows = rowsCte(query, books, today);
  const common = commonFilters(query);
  const originOk = query.origins.length > 0 ? `origin IN (${query.origins.map((origin) => sql`${origin}`).join(', ')})` : 'TRUE';
  const entityOk = query.entity ? sql`entity_code = ${query.entity}` : 'TRUE';
  const statusOk = query.statuses.length > 0 ? `status IN (${query.statuses.map((status) => sql`${status}`).join(', ')})` : 'TRUE';
  const excluded = NOT_COUNTED.filter((status) => !query.statuses.includes(status));
  const counted = excluded.length > 0 ? `status NOT IN (${excluded.map((status) => sql`${status}`).join(', ')})` : 'TRUE';
  const receivable = `status IN (${RECEIVABLE.map((status) => sql`${status}`).join(', ')})`;

  const [listed, stats] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      ${rows}
      SELECT origin, id, number, CAST(issue_date AS VARCHAR) AS issue_date, CAST(due_date AS VARCHAR) AS due_date,
             customer_id, customer_match, customer_name, entity_code,
             CAST(total AS VARCHAR) AS total, CAST(pending AS VARCHAR) AS pending, currency, status,
             verifactu, delivery
        FROM rows
       WHERE ${common} AND ${originOk} AND ${entityOk} AND ${statusOk}
       ORDER BY ${orderBy(query.sort, query.dir)}
       LIMIT ${query.limit} OFFSET ${query.offset}
    `),
    writer.read<Record<string, unknown>>(`
      ${rows},
      filtered AS (
        SELECT *, ${originOk} AS origin_ok, ${entityOk} AS entity_ok, ${statusOk} AS status_ok
          FROM rows
         WHERE ${common}
      )
      SELECT 'status' AS facet, status AS value, count(*) AS n, CAST(NULL AS VARCHAR) AS amount, CAST(NULL AS VARCHAR) AS pending
        FROM filtered WHERE origin_ok AND entity_ok GROUP BY status
      UNION ALL
      SELECT 'entity', entity_code, count(*), NULL, NULL
        FROM filtered WHERE origin_ok AND status_ok GROUP BY entity_code
      UNION ALL
      SELECT 'origin', origin, count(*), NULL, NULL
        FROM filtered WHERE entity_ok AND status_ok GROUP BY origin
      UNION ALL
      SELECT 'total', NULL, count(*),
             CAST(COALESCE(sum(CASE WHEN ${counted} THEN total END), 0) AS VARCHAR),
             CAST(COALESCE(sum(CASE WHEN ${receivable} THEN pending END), 0) AS VARCHAR)
        FROM filtered WHERE origin_ok AND entity_ok AND status_ok
    `),
  ]);

  const counts = { status: new Map<string, number>(), entity: new Map<string, number>(), origin: new Map<string, number>() };
  for (const row of stats) {
    const facet = String(row.facet);
    if (facet === 'total') {
      page.total = intOf(row.n);
      page.totals = { amount: money2(row.amount), pending: money2(row.pending) };
    } else if (facet === 'status' || facet === 'entity' || facet === 'origin') {
      counts[facet].set(String(row.value), intOf(row.n));
    }
  }
  page.items = listed.map((row) => itemOf(row, query));
  page.facets = {
    status: statusesOf(query.kind).map((value) => ({
      value,
      label: statusLabel(query.kind, value, query.direction),
      count: counts.status.get(value) ?? 0,
    })),
    entity: ENTITY_CODES.filter((code) => (code === 'PO' ? visible.po : visible.cvpo)).map((value) => ({
      value,
      label: ENTITY_LABELS[value],
      count: counts.entity.get(value) ?? 0,
    })),
    origin: origins.map((value) => ({ value, label: ORIGIN_LABELS[value], count: counts.origin.get(value) ?? 0 })),
  };
  return page;
}

function readableBooks(user: UserCtx, kind: DocumentKind, direction: Direction, scope: LegacyScope): Record<Origin, Codes> {
  const native: readonly Permission[] = kind !== 'invoice'
    ? ['sales.read']
    : direction === 'purchase' ? ['purchasing.read'] : ['billing.read'];
  return {
    holded: codesFor(user, kind === 'invoice' ? HOLDED_INVOICES : HOLDED_DOCUMENTS, scope),
    winecore: codesFor(user, native, scope),
  };
}

function codesFor(user: UserCtx, permissions: readonly Permission[], scope: LegacyScope): Codes {
  let po = false;
  let cvpo = false;
  for (const role of user.roles) {
    if (!permissions.some((permission) => can({ ...user, roles: [role] }, permission))) continue;
    if (role.legalEntityId == null) {
      po = true;
      cvpo = true;
    } else if (role.legalEntityCode === 'PO') {
      po = true;
    } else if (role.legalEntityCode === 'CVPO') {
      cvpo = true;
    }
  }
  return { po: po && scope.po, cvpo: cvpo && scope.cvpo };
}

function scopeOf(codes: Codes): LegacyScope {
  return { entity: codes.po && codes.cvpo ? 'both' : codes.po ? 'PO' : 'CVPO', po: codes.po, cvpo: codes.cvpo };
}

function readable(codes: Codes): boolean {
  return codes.po || codes.cvpo;
}

function rowsCte(query: Query, books: Record<Origin, Codes>, today: string): string {
  const branches: string[] = [];
  const holded = readable(books.holded) ? entityPredicate(scopeOf(books.holded)) : null;
  const native = readable(books.winecore) ? entityPredicate(scopeOf(books.winecore)) : null;
  const ctes = [contactLinkCtes([query.kind === 'invoice' ? query.direction : query.kind])];
  let status: string;
  if (query.kind === 'invoice') {
    if (holded) branches.push(holdedInvoices(query.direction, holded));
    if (native && query.direction === 'purchase') branches.push(nativeSupplierInvoices(native));
    if (native && query.direction === 'sale') {
      ctes.push(INVOICE_TRACKING);
      branches.push(nativeInvoices(native));
    }
    status = invoiceStatusSql({
      base: 'base',
      pending: 'pending',
      total: 'total',
      dueDate: 'due_date',
      flaggedOverdue: 'flagged_overdue',
      today: sql`CAST(${today} AS DATE)`,
    });
  } else if (query.kind === 'quote') {
    if (holded) branches.push(holdedQuotes(holded));
    if (native) branches.push(nativeQuotes(native));
    status = quoteStatusSql({ base: 'base', validUntil: 'due_date', today: sql`CAST(${today} AS DATE)` });
  } else {
    if (holded) branches.push(holdedDeliveryNotes(holded));
    if (native) {
      ctes.push(NOTE_TOTALS);
      branches.push(nativeDeliveryNotes(native));
    }
    status = 'base';
  }
  return `
    WITH ${ctes.join(',\n')},
    docs AS (
      ${branches.join('\n      UNION ALL\n')}
    ),
    rows AS (
      SELECT origin, id, number, issue_date, sort_date, due_date, customer_id, customer_match, customer_name,
             entity_code, total, pending, currency, ${status} AS status, verifactu, delivery
        FROM docs
    )`;
}

const UNTRACKED = 'CAST(NULL AS VARCHAR) AS verifactu, CAST(NULL AS VARCHAR) AS delivery';

/** Último registro Verifactu y último intento de envío de cada factura emitida en WineCore. */
const INVOICE_TRACKING = `
    verifactu_latest AS (
      SELECT invoice_id, arg_max(send_status, generated_at) AS send_status
        FROM regulatory.verifactu_record
       GROUP BY invoice_id
    ),
    delivery_latest AS (
      SELECT invoice_id, arg_max(status, attempt) AS status
        FROM billing.invoice_delivery
       GROUP BY invoice_id
    )`;

function holdedInvoices(direction: Direction, entity: string): string {
  const link = contactLinkSql({
    alias: 'h',
    stored: 'COALESCE(o.counterparty_contact_id, h.counterparty_contact_id)',
    entity: 'h.entity_id',
    kind: 'h.kind',
    number: 'h.number',
    date: 'h.issue_date',
    name: 'h.counterparty_name',
  });
  const base = holdedInvoiceBase('h.status_holded', 'o.status');
  return `
      SELECT 'holded' AS origin, CAST(h.id AS VARCHAR) AS id, h.number, h.issue_date, h.issue_date AS sort_date,
             COALESCE(o.due_date, h.due_date) AS due_date,
             ${link.id} AS customer_id, ${link.match} AS customer_match,
             h.counterparty_name AS customer_name, e.code AS entity_code,
             CAST(h.total AS DECIMAL(14,2)) AS total,
             CAST(CASE
               WHEN (${base}) = 'void' THEN 0
               WHEN o.id IS NOT NULL THEN o.amount - o.amount_paid
               WHEN h.pending IS NOT NULL THEN h.pending
               WHEN (${base}) = 'paid' THEN 0
               ELSE h.total - COALESCE(h.paid, 0)
             END AS DECIMAL(14,2)) AS pending,
             'EUR' AS currency, ${base} AS base,
             lower(trim(h.status_holded)) IN ('vencido', 'vencida') AS flagged_overdue, ${UNTRACKED}
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
        LEFT JOIN legacy.open_item o ON o.holded_invoice_id = h.id
        ${link.joins}
       WHERE h.kind = ${sql`${direction}`} AND ${entity}`;
}

function nativeInvoices(entity: string): string {
  return `
      SELECT 'winecore' AS origin, CAST(i.id AS VARCHAR) AS id, i.number, i.issue_date,
             COALESCE(i.issue_date, CAST(i.created_at AT TIME ZONE 'Europe/Madrid' AS DATE)) AS sort_date,
             d.due_date,
             CAST(i.customer_id AS VARCHAR) AS customer_id,
             CASE WHEN i.customer_id IS NOT NULL THEN 'contact' END AS customer_match,
             COALESCE(NULLIF(trim(json_extract_string(i.customer_snapshot, '$.name')), ''), c.legal_name, '') AS customer_name,
             e.code AS entity_code,
             CAST(i.total AS DECIMAL(14,2)) AS total,
             CAST(CASE WHEN i.status = 'issued' THEN i.total - i.amount_paid WHEN i.status = 'voided' THEN 0 END AS DECIMAL(14,2)) AS pending,
             i.currency, ${nativeInvoiceBase('i.status', 'i.payment_status')} AS base, FALSE AS flagged_overdue,
             CASE
               WHEN i.status NOT IN ('issued', 'voided') THEN NULL
               WHEN v.send_status = 'rejected' THEN 'rejected'
               WHEN v.send_status IN ('accepted', 'accepted_with_errors', 'not_required') THEN 'accepted'
               ELSE 'pending'
             END AS verifactu,
             CASE WHEN i.status IN ('issued', 'voided') THEN COALESCE(dl.status, 'none') END AS delivery
        FROM billing.invoice i
        JOIN core.legal_entity e ON e.id = i.legal_entity_id
        LEFT JOIN party.contact c ON c.id = i.customer_id
        LEFT JOIN (
          SELECT invoice_id, min(due_date) AS due_date FROM billing.invoice_due GROUP BY invoice_id
        ) d ON d.invoice_id = i.id
        LEFT JOIN verifactu_latest v ON v.invoice_id = i.id
        LEFT JOIN delivery_latest dl ON dl.invoice_id = i.id
       WHERE ${entity}`;
}

function nativeSupplierInvoices(entity: string): string {
  return `
      SELECT 'winecore' AS origin, CAST(s.id AS VARCHAR) AS id, s.supplier_invoice_number AS number, s.issue_date,
             COALESCE(s.issue_date, CAST(s.created_at AT TIME ZONE 'Europe/Madrid' AS DATE)) AS sort_date,
             s.due_date,
             CAST(s.supplier_id AS VARCHAR) AS customer_id,
             CASE WHEN s.supplier_id IS NOT NULL THEN 'contact' END AS customer_match,
             COALESCE(c.legal_name, NULLIF(trim(json_extract_string(s.ocr_extraction, '$.supplier_name')), ''), '') AS customer_name,
             e.code AS entity_code,
             CAST(s.total AS DECIMAL(14,2)) AS total,
             CAST(CASE
               WHEN s.status = 'approved' THEN s.total - s.amount_paid
               WHEN s.status IN ('rejected', 'duplicate') THEN 0
             END AS DECIMAL(14,2)) AS pending,
             s.currency, ${supplierInvoiceBase('s.status', 's.payment_status')} AS base, FALSE AS flagged_overdue, ${UNTRACKED}
        FROM purchasing.supplier_invoice s
        JOIN core.legal_entity e ON e.id = s.legal_entity_id
        LEFT JOIN party.contact c ON c.id = s.supplier_id
       WHERE ${entity}`;
}

function holdedQuotes(entity: string): string {
  const link = contactLinkSql({
    alias: 'h',
    stored: 'h.counterparty_contact_id',
    entity: 'h.entity_id',
    kind: "'quote'",
    number: 'h.number',
    date: 'h.issue_date',
    name: 'h.counterparty_name',
  });
  return `
      SELECT 'holded' AS origin, CAST(h.id AS VARCHAR) AS id, h.number, h.issue_date, h.issue_date AS sort_date,
             h.valid_until AS due_date,
             ${link.id} AS customer_id, ${link.match} AS customer_match,
             h.counterparty_name AS customer_name, e.code AS entity_code,
             CAST(h.total AS DECIMAL(14,2)) AS total, CAST(NULL AS DECIMAL(14,2)) AS pending,
             'EUR' AS currency, ${holdedQuoteBase('h.status_holded', 'h.invoiced_status')} AS base, FALSE AS flagged_overdue,
             ${UNTRACKED}
        FROM legacy.holded_quote h
        JOIN core.legal_entity e ON e.id = h.entity_id
        ${link.joins}
       WHERE ${entity}`;
}

function nativeQuotes(entity: string): string {
  return `
      SELECT 'winecore' AS origin, CAST(q.id AS VARCHAR) AS id, q.number, q.issue_date,
             COALESCE(q.issue_date, CAST(q.created_at AT TIME ZONE 'Europe/Madrid' AS DATE)) AS sort_date,
             q.valid_until AS due_date,
             CAST(q.customer_id AS VARCHAR) AS customer_id, 'contact' AS customer_match,
             COALESCE(c.legal_name, '') AS customer_name, e.code AS entity_code,
             CAST(q.total AS DECIMAL(14,2)) AS total, CAST(NULL AS DECIMAL(14,2)) AS pending,
             q.currency, q.status AS base, FALSE AS flagged_overdue, ${UNTRACKED}
        FROM sales.quote q
        JOIN core.legal_entity e ON e.id = q.legal_entity_id
        LEFT JOIN party.contact c ON c.id = q.customer_id
       WHERE ${entity}`;
}

function holdedDeliveryNotes(entity: string): string {
  const link = contactLinkSql({
    alias: 'h',
    stored: 'NULL',
    entity: 'h.entity_id',
    kind: "'delivery_note'",
    number: 'h.number',
    date: 'h.issue_date',
    name: 'NULL',
  });
  return `
      SELECT 'holded' AS origin, CAST(h.id AS VARCHAR) AS id, h.number, h.issue_date, h.issue_date AS sort_date,
             CAST(NULL AS DATE) AS due_date,
             ${link.id} AS customer_id, ${link.match} AS customer_match,
             COALESCE(${link.lineName}, NULLIF(trim(h.destination), ''), NULLIF(trim(h.description), ''), '') AS customer_name,
             e.code AS entity_code,
             CAST(h.total AS DECIMAL(14,2)) AS total, CAST(NULL AS DECIMAL(14,2)) AS pending,
             'EUR' AS currency, ${holdedDeliveryNoteStatus('h.invoiced_status')} AS base, FALSE AS flagged_overdue,
             ${UNTRACKED}
        FROM legacy.holded_delivery_note h
        JOIN core.legal_entity e ON e.id = h.entity_id
        ${link.joins}
       WHERE ${entity}`;
}

/** Importe de un albarán valorado: bases por código de IVA más su cuota, como priceTotals. */
const NOTE_TOTALS = `
    note_totals AS (
      SELECT g.delivery_note_id, sum(g.base) + sum(round(g.base * COALESCE(tc.rate, 0) * 0.01, 2)) AS total
        FROM (
          SELECT l.delivery_note_id, l.tax_code,
                 sum(round(l.quantity * l.unit_price * (1 - l.discount_pct * 0.01), 2)) AS base
            FROM sales.delivery_note_line l
           WHERE l.unit_price IS NOT NULL
           GROUP BY l.delivery_note_id, l.tax_code
        ) g
        LEFT JOIN billing.tax_code tc ON tc.code = g.tax_code
       GROUP BY g.delivery_note_id
    )`;

function nativeDeliveryNotes(entity: string): string {
  return `
      SELECT 'winecore' AS origin, CAST(n.id AS VARCHAR) AS id, n.number, n.issue_date,
             COALESCE(n.issue_date, CAST(n.created_at AT TIME ZONE 'Europe/Madrid' AS DATE)) AS sort_date,
             CAST(NULL AS DATE) AS due_date,
             CAST(n.customer_id AS VARCHAR) AS customer_id,
             CASE WHEN n.customer_id IS NOT NULL THEN 'contact' END AS customer_match,
             COALESCE(c.legal_name, tl.name, '') AS customer_name, e.code AS entity_code,
             CAST(CASE WHEN n.is_valued THEN COALESCE(t.total, 0) END AS DECIMAL(14,2)) AS total,
             CAST(NULL AS DECIMAL(14,2)) AS pending,
             n.currency, ${nativeDeliveryNoteStatus('n.status', 'n.invoicing_status')} AS base, FALSE AS flagged_overdue,
             ${UNTRACKED}
        FROM sales.delivery_note n
        JOIN core.legal_entity e ON e.id = n.legal_entity_id
        LEFT JOIN party.contact c ON c.id = n.customer_id
        LEFT JOIN inventory.location tl ON tl.id = n.to_location_id
        LEFT JOIN note_totals t ON t.delivery_note_id = n.id
       WHERE ${entity}`;
}

function commonFilters(query: Query): string {
  const filters = ['TRUE'];
  if (query.q) {
    const pattern = likePattern(fold(query.q));
    filters.push(sql`(
      strip_accents(lower(COALESCE(number, ''))) LIKE ${pattern} ESCAPE '\\'
      OR strip_accents(lower(customer_name)) LIKE ${pattern} ESCAPE '\\'
    )`);
  }
  if (query.from) filters.push(sql`sort_date >= CAST(${query.from} AS DATE)`);
  if (query.to) filters.push(sql`sort_date <= CAST(${query.to} AS DATE)`);
  if (query.customerId) filters.push(sql`customer_id = ${query.customerId}`);
  if (query.verifactu) filters.push(sql`verifactu = ${query.verifactu}`);
  if (query.delivery) filters.push(sql`delivery = ${query.delivery}`);
  return filters.join(' AND ');
}

/** Columnas calificadas: sin `rows.` total y pending ordenarían por su alias de texto. */
function orderBy(sort: Sort, dir: 'asc' | 'desc'): string {
  const way = dir === 'asc' ? 'ASC' : 'DESC';
  const tail = `rows.sort_date DESC, rows.number DESC NULLS LAST, rows.id DESC`;
  if (sort === 'number') return `lower(rows.number) ${way} NULLS LAST, ${tail}`;
  if (sort === 'customer') return `strip_accents(lower(rows.customer_name)) ${way}, ${tail}`;
  if (sort === 'total') return `rows.total ${way} NULLS LAST, ${tail}`;
  if (sort === 'pending') return `rows.pending ${way} NULLS LAST, ${tail}`;
  return `rows.sort_date ${way}, rows.number ${way} NULLS LAST, rows.id ${way}`;
}

function itemOf(row: Record<string, unknown>, query: Query): SalesDocumentItem {
  const origin: Origin = row.origin === 'holded' ? 'holded' : 'winecore';
  const id = String(row.id).toLowerCase();
  const status = String(row.status);
  const match = row.customer_match;
  return {
    id,
    origin,
    kind: query.kind,
    number: textOrNull(row.number),
    issue_date: row.issue_date == null ? null : dateOf(row.issue_date),
    due_date: row.due_date == null ? null : dateOf(row.due_date),
    customer: {
      id: row.customer_id == null ? null : String(row.customer_id).toLowerCase(),
      name: String(row.customer_name ?? ''),
      match: match === 'contact' || match === 'tax_id' || match === 'name' ? match : null,
    },
    entity_code: String(row.entity_code ?? ''),
    total: row.total == null ? null : money2(row.total),
    pending: row.pending == null ? null : money2(row.pending),
    currency: String(row.currency ?? 'EUR'),
    status,
    status_label: statusLabel(query.kind, status, query.direction),
    verifactu: oneOf(row.verifactu, VERIFACTU),
    delivery: oneOf(row.delivery, DELIVERIES),
    api_path: apiPath(origin, query, id),
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function apiPath(origin: Origin, query: Query, id: string): string {
  if (origin === 'holded') return query.kind === 'invoice' ? `/v1/legacy/invoices/${id}` : `/v1/legacy/documents/${id}`;
  if (query.kind === 'quote') return `/v1/quotes/${id}`;
  if (query.kind === 'delivery_note') return `/v1/delivery-notes/${id}`;
  return query.direction === 'purchase' ? `/v1/supplier-invoices/${id}` : `/v1/invoices/${id}`;
}

function parseQuery(url: URL): Query {
  const params = url.searchParams;
  const fields: Record<string, string> = {};
  const kindRaw = params.get('kind')?.trim() ?? '';
  const kind = KINDS[kindRaw] ?? null;
  if (!kind) fields.kind = 'Debe ser invoice, quote o delivery_note';
  const directionRaw = params.get('direction')?.trim() ?? '';
  let direction: Direction = 'sale';
  if (directionRaw === 'purchase' || directionRaw === 'compra') direction = 'purchase';
  else if (directionRaw !== '' && directionRaw !== 'sale' && directionRaw !== 'venta') fields.direction = 'Debe ser sale o purchase';
  if (kind && kind !== 'invoice' && direction === 'purchase') fields.direction = 'Solo las facturas tienen compras';

  const origins = listParam(params, 'origin');
  if (origins.some((origin) => !(ORIGINS as readonly string[]).includes(origin))) fields.origin = 'Debe ser holded o winecore';

  let entity: EntityCode | null = null;
  try {
    const parsed = parseEntityParam(params.get('entity'));
    entity = parsed === 'both' ? null : parsed;
  } catch {
    fields.entity = 'La entidad debe ser PO o CVPO';
  }

  const statuses = listParam(params, 'status');
  if (kind && statuses.some((status) => !statusesOf(kind).includes(status))) {
    fields.status = `Estados válidos: ${statusesOf(kind).join(', ')}`;
  }

  const from = dateParam(params.get('from'), 'from', fields);
  const to = dateParam(params.get('to'), 'to', fields);
  if (from && to && from > to) fields.to = 'Debe ser igual o posterior a from';

  const q = params.get('q')?.trim() || null;
  if (q && q.length > 120) fields.q = 'La búsqueda es demasiado larga';

  const customerRaw = params.get('customer_id')?.trim() || null;
  if (customerRaw && !UUID.test(customerRaw)) fields.customer_id = 'Identificador no válido';

  const salesInvoices = kind === 'invoice' && direction === 'sale';
  const verifactuRaw = params.get('verifactu')?.trim().toLowerCase() || null;
  const verifactu = verifactuRaw === 'pendiente' ? 'pending' : verifactuRaw;
  if (verifactu && !(VERIFACTU as readonly string[]).includes(verifactu)) fields.verifactu = `Debe ser ${VERIFACTU.join(', ')}`;
  else if (verifactu && !salesInvoices) fields.verifactu = 'Solo las facturas de venta pasan por Verifactu';
  const delivery = params.get('delivery')?.trim().toLowerCase() || null;
  if (delivery && !(DELIVERIES as readonly string[]).includes(delivery)) fields.delivery = `Debe ser ${DELIVERIES.join(', ')}`;
  else if (delivery && !salesInvoices) fields.delivery = 'Solo las facturas de venta se envían al cliente';

  const sortRaw = params.get('sort')?.trim() || 'date';
  if (!(SORTS as readonly string[]).includes(sortRaw)) fields.sort = `Debe ser ${SORTS.join(', ')}`;
  const dirRaw = params.get('dir')?.trim().toLowerCase() || 'desc';
  if (dirRaw !== 'asc' && dirRaw !== 'desc') fields.dir = 'Debe ser asc o desc';

  const limit = intParam(params.get('limit'), 50, 1, 200, 'limit', fields);
  const offset = intParam(params.get('offset'), 0, 0, 1_000_000, 'offset', fields);
  if (Object.keys(fields).length > 0 || !kind) throw domainError('WC_VALIDATION', fields);
  return {
    kind,
    direction,
    origins: ORIGINS.filter((origin) => origins.includes(origin)),
    entity,
    statuses: [...new Set(statuses)],
    from,
    to,
    q,
    customerId: customerRaw ? customerRaw.toLowerCase() : null,
    verifactu: verifactu as Verifactu | null,
    delivery: delivery as Delivery | null,
    sort: sortRaw as Sort,
    dir: dirRaw as 'asc' | 'desc',
    limit,
    offset,
  };
}

const KINDS: Record<string, DocumentKind> = {
  invoice: 'invoice',
  factura: 'invoice',
  quote: 'quote',
  presupuesto: 'quote',
  delivery_note: 'delivery_note',
  albaran: 'delivery_note',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listParam(params: URLSearchParams, name: string): string[] {
  return params.getAll(name)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '');
}

function dateParam(raw: string | null, field: string, fields: Record<string, string>): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fields[field] = 'La fecha debe ser AAAA-MM-DD';
    return null;
  }
  return value;
}

function intParam(raw: string | null, fallback: number, min: number, max: number, field: string, fields: Record<string, string>): number {
  const value = raw?.trim() ?? '';
  if (value === '') return fallback;
  if (!/^\d{1,7}$/.test(value) || Number(value) < min || Number(value) > max) {
    fields[field] = `Debe ser un entero entre ${min} y ${max}`;
    return fallback;
  }
  return Number(value);
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

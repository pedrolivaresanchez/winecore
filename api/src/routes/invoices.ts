import { can, type Permission, type UserCtx } from '../core/auth/permissions';
import { requestIdFor, sessionOf } from '../auth/guard';
import { canonicalJson } from '../core/db/audit';
import { sql } from '../core/db/sql';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { sha256Hex } from '../core/hash';
import { newId } from '../core/ids';
import { executeBatchIssue, requestBatchIssue } from '../core/billing/batch';
import { exportIssuedBook, periodBounds } from '../core/billing/books';
import { createDraft, discardDraft, updateDraft } from '../core/billing/drafts';
import { day, idOf, isUuid, jsonObject, moneyText, stamp, text } from '../core/billing/format';
import { issueInvoice } from '../core/billing/issue';
import { loadEntity, loadEntityByCode, loadInvoice, presentInvoice } from '../core/billing/readModel';
import { validateInvoice } from '../core/billing/validate';
import { voidInvoice } from '../core/billing/void';

const ISSUE_ROUTE = 'POST /v1/invoices/:id/issue';

export async function listInvoices(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const query = parseListQuery(new URL(request.url));
  const scope = entityScope(user, 'billing.read');
  if (query.entity && !scope.all && !scope.ids.includes(query.entity)) throw domainError('WC_FORBIDDEN');
  const filters = ['TRUE'];
  if (!scope.all) {
    if (scope.ids.length === 0) return { items: [], next_cursor: null, total: 0 };
    filters.push(`i.legal_entity_id IN (${scope.ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`);
  }
  if (query.entity) filters.push(sql`i.legal_entity_id = CAST(${query.entity} AS UUID)`);
  if (query.status) filters.push(sql`i.status = ${query.status}`);
  if (query.series) filters.push(sql`i.series_id = CAST(${query.series} AS UUID)`);
  if (query.customerId) filters.push(sql`i.customer_id = CAST(${query.customerId} AS UUID)`);
  if (query.from) filters.push(sql`i.issue_date >= CAST(${query.from} AS DATE)`);
  if (query.to) filters.push(sql`i.issue_date <= CAST(${query.to} AS DATE)`);
  if (query.paymentStatus) filters.push(sql`i.payment_status = ${query.paymentStatus}`);
  if (query.verifactuStatus === 'pending') filters.push('i.verifactu_record_id IS NULL');
  if (query.verifactuStatus === 'accepted') filters.push('i.verifactu_record_id IS NOT NULL');
  if (query.deliveryStatus === 'none') filters.push('del.invoice_id IS NULL');
  else if (query.deliveryStatus) filters.push(sql`del.status = ${query.deliveryStatus}`);
  const where = filters.join(' AND ');
  const cursor = query.cursor;
  const pageWhere = cursor
    ? `${where} AND (i.updated_at < CAST(${sql`${cursor.at}`} AS TIMESTAMPTZ) OR (i.updated_at = CAST(${sql`${cursor.at}`} AS TIMESTAMPTZ) AND i.id < CAST(${sql`${cursor.id}`} AS UUID)))`
    : where;
  const rows = await writer.read(`
    SELECT i.*, e.code AS entity_code, c.legal_name AS customer_name,
           (SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = i.id) AS first_due,
           del.status AS delivery_status,
           COALESCE(del.sent_at, del.created_at) AS last_delivery_at
    FROM billing.invoice i
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    LEFT JOIN party.contact c ON c.id = i.customer_id
    ${DELIVERY_JOIN}
    WHERE ${pageWhere}
    ORDER BY i.updated_at DESC, i.id DESC
    LIMIT ${query.limit + 1}
  `);
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*)::INTEGER AS total
    FROM billing.invoice i
    ${DELIVERY_JOIN}
    WHERE ${where}
  `);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(listItem),
    next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), idOf(last.id)) : null,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export async function exportInvoices(writer: Writer, request: Request): Promise<Response> {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entity = await resolveEntityParam(writer, url.searchParams.get('entity') ?? url.searchParams.get('entity_id'));
  if (!entity) throw domainError('WC_VALIDATION', { entity: 'Indica la entidad' });
  if (!can(user, 'billing.read', entity.id)) throw domainError('WC_FORBIDDEN');
  const range = rangeOf(url);
  const book = await exportIssuedBook(writer, { entityId: entity.id, from: range.from, to: range.to });
  const filename = `libro-emitidas-${entity.code}-${range.from}-${range.to}.csv`;
  const bytes = Buffer.from(book.csv.startsWith('\uFEFF') ? book.csv : `\uFEFF${book.csv}`, 'utf8');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function createInvoice(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readOptionalJson(request);
  const id = await writer.withWrite(actor(user, request), (tx) => createDraft(tx, raw, actor(user, request), user, new Date()));
  return presentInvoice(await loadInvoice(writer, id));
}

export async function getInvoice(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await loadInvoice(writer, id);
  if (!can(user, 'billing.read', view.header.legalEntityId)) throw domainError('WC_FORBIDDEN');
  return presentInvoice(view);
}

export async function patchInvoice(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await request.json().catch(() => {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  });
  await writer.withWrite(actor(user, request), (tx) => updateDraft(
    tx,
    id,
    raw,
    actor(user, request),
    user,
    request.headers.get('if-match'),
    new Date(),
  ));
  return presentInvoice(await loadInvoice(writer, id));
}

export async function validateInvoiceRoute(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await loadInvoice(writer, id);
  if (!can(user, 'billing.write', view.header.legalEntityId)) throw domainError('WC_FORBIDDEN');
  if (view.header.status !== 'draft' && view.header.status !== 'pending_approval') {
    throw domainError('WC_INV_NOT_DRAFT');
  }
  const result = await writer.withWrite(actor(user, request), (tx) => validateInvoice(tx, id, new Date()));
  return {
    errors: result.errors,
    warnings: result.warnings,
  };
}

export async function issueInvoiceRoute(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const key = idempotencyKey(request);
  const raw = await readOptionalJson(request);
  const hash = sha256Hex(canonicalJson({ invoice_id: id.toLowerCase(), body: raw }));
  const preview = isUuid(id) ? await loadInvoice(writer, id).catch(() => null) : null;
  if (preview && !can(user, 'billing.issue', preview.header.legalEntityId)) throw domainError('WC_FORBIDDEN');
  return writer.withWrite(actor(user, request), async (tx) => {
    const prior = await tx.read<{ request_sha256: unknown; status_code: unknown; response: unknown }>(sql`
      SELECT request_sha256, status_code, response
      FROM ops.idempotency_key
      WHERE principal = ${`user:${user.id}`} AND key = ${key}
    `);
    const stored = prior[0];
    if (stored) {
      if (String(stored.request_sha256) !== hash) throw domainError('WC_IDEMPOTENCY_MISMATCH');
      return { status: Number(stored.status_code), body: stored.response };
    }
    const current = await loadInvoice(tx, id);
    if (!can(user, 'billing.issue', current.header.legalEntityId)) throw domainError('WC_FORBIDDEN');
    const result = await issueInvoice(tx, { invoiceId: id, actor: actor(user, request), now: new Date() });
    tx.write(sql`
      INSERT INTO ops.idempotency_key (key, principal, route, request_sha256, status_code, response, created_at)
      VALUES (
        ${key},
        ${`user:${user.id}`},
        ${ISSUE_ROUTE},
        ${hash},
        200,
        ${sql.json(result)},
        ${new Date()}
      )
    `);
    return { status: 200, body: result };
  });
}

export async function voidInvoiceRoute(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readOptionalJson(request);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const reasonCode = typeof body.reason_code === 'string' ? body.reason_code : typeof body.reasonCode === 'string' ? body.reasonCode : '';
  const reasonText = typeof body.reason_text === 'string' ? body.reason_text : typeof body.reasonText === 'string' ? body.reasonText : null;
  const outcome = await writer.withWrite(actor(user, request), (tx) => voidInvoice(tx, {
    invoiceId: id,
    reasonCode,
    reasonText,
    actor: actor(user, request),
    user,
    now: new Date(),
  }));
  return { status: outcome.status === 'pending' ? 202 : 200, body: outcome };
}

export async function discardInvoice(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readOptionalJson(request);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const reason = typeof body.reason === 'string' ? body.reason : null;
  await writer.withWrite(actor(user, request), (tx) => discardDraft(tx, id, actor(user, request), user, reason, new Date()));
  return presentInvoice(await loadInvoice(writer, id));
}

export async function batchIssueRequest(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readOptionalJson(request);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const ids = body.invoice_ids ?? body.invoiceIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isUuid(id))) {
    throw domainError('WC_VALIDATION', { invoice_ids: 'Indica los identificadores de los borradores' });
  }
  const result = await writer.withWrite(actor(user, request), (tx) => requestBatchIssue(
    tx,
    ids.map((id) => id.toLowerCase()),
    actor(user, request),
    user,
    new Date(),
  ));
  return result;
}

export async function batchIssueExecute(writer: Writer, request: Request, requestId: string) {
  const user = sessionOf(request);
  return executeBatchIssue(writer, requestId, actor(user, request), user, new Date());
}

function listItem(row: Record<string, unknown>) {
  const snapshot = jsonObject(row.customer_snapshot);
  return {
    id: idOf(row.id),
    number: text(row.number),
    issue_date: day(row.issue_date),
    legal_entity_id: idOf(row.legal_entity_id),
    entity_code: String(row.entity_code),
    customer_id: row.customer_id == null ? null : idOf(row.customer_id),
    customer_name: text(snapshot?.name) ?? text(row.customer_name),
    subtotal: moneyText(row.subtotal),
    total: moneyText(row.total),
    amount_paid: moneyText(row.amount_paid) ?? '0.00',
    first_due_date: day(row.first_due),
    payment_status: String(row.payment_status),
    status: String(row.status),
    invoice_type: String(row.invoice_type),
    series_id: idOf(row.series_id),
    verifactu_record_id: row.verifactu_record_id == null ? null : idOf(row.verifactu_record_id),
    delivery_status: deliveryStatusOf(row.delivery_status),
    last_delivery_at: stamp(row.last_delivery_at),
    updated_at: String(row.updated_at),
  };
}

const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'no_recipient', 'none'] as const;

const DELIVERY_JOIN = `
  LEFT JOIN billing.invoice_delivery del
    ON del.invoice_id = i.id
   AND del.attempt = (
     SELECT max(latest.attempt) FROM billing.invoice_delivery latest WHERE latest.invoice_id = i.id
   )
`;

function deliveryStatusOf(value: unknown): 'pending' | 'sent' | 'failed' | 'no_recipient' | 'none' {
  const status = value == null ? 'none' : String(value);
  if (status === 'pending' || status === 'sent' || status === 'failed' || status === 'no_recipient') return status;
  return 'none';
}

function parseListQuery(url: URL) {
  const fields: Record<string, string> = {};
  const entityRaw = url.searchParams.get('entity') ?? url.searchParams.get('legal_entity_id');
  const entity = entityRaw && isUuid(entityRaw) ? entityRaw.toLowerCase() : null;
  if (entityRaw && !entity) fields.entity = 'Identificador no válido';
  const status = url.searchParams.get('status');
  if (status && !['draft', 'pending_approval', 'issued', 'voided', 'discarded'].includes(status)) {
    fields.status = 'Estado no válido';
  }
  const series = url.searchParams.get('series');
  if (series && !isUuid(series)) fields.series = 'Identificador no válido';
  const customerId = url.searchParams.get('customer_id');
  if (customerId && !isUuid(customerId)) fields.customer_id = 'Identificador no válido';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) fields.from = 'Fecha no válida';
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fields.to = 'Fecha no válida';
  const paymentStatus = url.searchParams.get('payment_status');
  if (paymentStatus && !['unpaid', 'partially_paid', 'paid', 'uncollectible'].includes(paymentStatus)) {
    fields.payment_status = 'Estado de cobro no válido';
  }
  const verifactuStatus = url.searchParams.get('verifactu_status');
  const deliveryStatus = url.searchParams.get('delivery_status');
  if (deliveryStatus && !(DELIVERY_STATUSES as readonly string[]).includes(deliveryStatus)) {
    fields.delivery_status = 'Estado de entrega no válido';
  }
  const limitRaw = url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw && limitRaw.trim() !== '') {
    if (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) fields.limit = 'Debe ser un entero entre 1 y 100';
    else limit = Number(limitRaw);
  }
  const cursorRaw = url.searchParams.get('cursor');
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) fields.cursor = 'Cursor no válido';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    entity,
    status: status || null,
    series: series ? series.toLowerCase() : null,
    customerId: customerId ? customerId.toLowerCase() : null,
    from: from || null,
    to: to || null,
    paymentStatus: paymentStatus || null,
    verifactuStatus: verifactuStatus || null,
    deliveryStatus: deliveryStatus || null,
    limit,
    cursor,
  };
}

function rangeOf(url: URL): { from: string; to: string } {
  const period = url.searchParams.get('period');
  if (period) {
    const bounds = periodBounds(period);
    if (!bounds) throw domainError('WC_VALIDATION', { period: 'Usa 2026-Q4 o 2026-10' });
    return bounds;
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw domainError('WC_VALIDATION', { period: 'Indica period o from y to' });
  }
  return { from, to };
}

async function resolveEntityParam(writer: Writer, value: string | null) {
  if (!value) return null;
  if (isUuid(value)) return loadEntity(writer, value.toLowerCase());
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(value)) throw domainError('WC_VALIDATION', { entity: 'Entidad no válida' });
  return loadEntityByCode(writer, value);
}

function entityScope(user: UserCtx, permission: Permission): { all: true } | { all: false; ids: string[] } {
  const global = user.roles.some((role) => role.legalEntityId === null && can({ ...user, roles: [role] }, permission));
  if (global) return { all: true };
  const ids = [...new Set(user.roles.flatMap((role) => {
    if (!role.legalEntityId) return [];
    return can(user, permission, role.legalEntityId) ? [role.legalEntityId.toLowerCase()] : [];
  }))];
  return { all: false, ids };
}

function actor(user: UserCtx, request: Request) {
  return {
    type: 'user' as const,
    id: user.id,
    requestId: requestIdFor(request),
  };
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128) {
    throw domainError('WC_VALIDATION', { 'idempotency-key': 'La clave debe tener entre 8 y 128 caracteres' });
  }
  return key;
}

async function readOptionalJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(`${updatedAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const textValue = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = textValue.lastIndexOf('|');
    if (split <= 0) return null;
    const at = textValue.slice(0, split);
    const id = textValue.slice(split + 1);
    if (!Number.isFinite(Date.parse(at)) || !isUuid(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

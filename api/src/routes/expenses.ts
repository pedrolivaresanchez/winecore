import { createHash } from 'node:crypto';
import { requestIdFor, sessionOf } from '../auth/guard';
import { canonicalJson } from '../core/db/audit';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { sha256Hex } from '../core/hash';
import type { SupplierInvoiceApprovalHook } from '../core/purchasing/approval';
import { exportReceivedBook, parseQuarter } from '../core/purchasing/books';
import type { OcrWorkforce } from '../core/purchasing/extract';
import {
  approveInvoice,
  captureInvoice,
  requestPurchaseApproval,
  findEntity,
  getInvoice,
  listExpenseCategories,
  listInvoices,
  patchInvoice,
  rejectInvoice,
  validateInvoice,
  type CaptureCommand,
} from '../core/purchasing/invoice';
import { can } from '../core/auth/permissions';

export type ExpenseDeps = {
  ocr: OcrWorkforce;
  approvalHook: SupplierInvoiceApprovalHook;
};

export async function listCategories(writer: Writer) {
  return listExpenseCategories(writer);
}

export async function listExpenses(writer: Writer, request: Request) {
  return listInvoices(writer, sessionOf(request), new URL(request.url));
}

export async function getExpense(writer: Writer, request: Request, id: string) {
  return getInvoice(writer, sessionOf(request), id);
}

export async function captureExpense(writer: Writer, request: Request, deps: ExpenseDeps) {
  const user = sessionOf(request);
  const command = await readCapture(request);
  const result = await captureInvoice(
    writer,
    actor(user.id, request),
    user,
    command,
    deps.ocr,
  );
  return result;
}

export async function patchExpense(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return patchInvoice(
    writer,
    actor(user.id, request),
    user,
    id,
    await readJson(request),
    request.headers.get('if-match'),
  );
}

export async function validateExpense(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return validateInvoice(writer, actor(user.id, request), user, id, request.headers.get('if-match'));
}

export async function requestExpenseApproval(writer: Writer, request: Request, id: string, deps: ExpenseDeps) {
  const user = sessionOf(request);
  return requestPurchaseApproval(
    writer,
    actor(user.id, request),
    user,
    id,
    request.headers.get('if-match'),
    deps.approvalHook,
  );
}

export async function approveExpense(writer: Writer, request: Request, id: string, deps: ExpenseDeps) {
  const user = sessionOf(request);
  return approveInvoice(
    writer,
    actor(user.id, request),
    user,
    id,
    request.headers.get('if-match'),
    deps.approvalHook,
  );
}

export async function rejectExpense(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = await readJson(request);
  const reason = body && typeof body === 'object' && 'reason' in body
    ? (body as { reason?: unknown }).reason
    : undefined;
  return rejectInvoice(writer, actor(user.id, request), user, id, request.headers.get('if-match'), reason);
}

export async function exportExpenses(writer: Writer, request: Request): Promise<Response> {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const period = (url.searchParams.get('period') ?? '').trim();
  const quarter = parseQuarter(period);
  if (!quarter) throw domainError('WC_VALIDATION', { period: 'El periodo debe ser un trimestre, por ejemplo 2027-T1' });
  const ref = (url.searchParams.get('entity') ?? url.searchParams.get('legal_entity_id') ?? '').trim();
  if (ref === '') throw domainError('WC_VALIDATION', { entity: 'La entidad es obligatoria' });
  const entity = await findEntity(writer, ref);
  if (!entity) throw domainError('WC_VALIDATION', { entity: 'No se reconoce la entidad' });
  if (!can(user, 'purchasing.read', entity.id)) throw domainError('WC_FORBIDDEN');
  const book = await exportReceivedBook(writer, { entityId: entity.id, from: quarter.from, to: quarter.to });
  const filename = `libro-recibidas-${entity.code}-${quarter.year}-T${quarter.quarter}.csv`;
  return new Response(Buffer.from(book.csv, 'utf8'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Winecore-Book-Invoices': String(book.totals.invoices),
      'X-Winecore-Book-Total': book.totals.total,
    },
  });
}

async function readCapture(request: Request): Promise<CaptureCommand> {
  const key = idempotencyKey(request);
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await readJson(request);
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!record) throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
    const filename = typeof record.filename === 'string' ? record.filename.trim() : '';
    const encoded = typeof record.content_base64 === 'string' ? record.content_base64.trim() : '';
    if (filename === '') throw domainError('WC_VALIDATION', { filename: 'El nombre del fichero es obligatorio' });
    if (encoded === '') throw domainError('WC_VALIDATION', { content_base64: 'Falta el fichero' });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
    } catch {
      throw domainError('WC_VALIDATION', { content_base64: 'El fichero no es base64' });
    }
    const entityRef = stringOrNull(record.legal_entity_id) ?? stringOrNull(record.entity);
    const extraction = 'extraction' in record ? record.extraction : null;
    return {
      bytes,
      filename,
      entityRef,
      source: stringOrNull(record.source),
      notes: stringOrNull(record.note) ?? stringOrNull(record.notes),
      extraction,
      idempotencyKey: key,
      requestHash: sha256Hex(canonicalJson({
        file: sha256Bytes(bytes),
        filename,
        entity: entityRef,
        source: stringOrNull(record.source),
        extraction,
      })),
    };
  }
  const form = await readForm(request);
  const upload = fileOf(form.get('file'));
  if (!upload) throw domainError('WC_VALIDATION', { file: 'Falta el fichero' });
  if (upload.size === 0) throw domainError('WC_VALIDATION', { file: 'El fichero está vacío' });
  const bytes = new Uint8Array(await upload.blob.arrayBuffer());
  const entityRef = textOf(form.get('legal_entity_id')) || textOf(form.get('entity')) || null;
  const source = textOf(form.get('source')) || null;
  const notes = textOf(form.get('note')) || textOf(form.get('notes')) || null;
  return {
    bytes,
    filename: upload.name,
    entityRef,
    source,
    notes,
    extraction: null,
    idempotencyKey: key,
    requestHash: sha256Hex(canonicalJson({
      file: sha256Bytes(bytes),
      filename: upload.name,
      entity: entityRef,
      source,
      notes,
    })),
  };
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128) {
    throw domainError('WC_VALIDATION', { 'idempotency-key': 'La clave debe tener entre 8 y 128 caracteres' });
  }
  return key;
}

function actor(userId: string, request: Request) {
  return { type: 'user' as const, id: userId, requestId: requestIdFor(request) };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

async function readForm(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'Se espera multipart con el fichero' });
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function fileOf(value: unknown): { blob: Blob; name: string; size: number } | null {
  if (typeof File !== 'undefined' && value instanceof File) {
    return { blob: value, name: value.name || 'factura', size: value.size };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { blob: value, name: 'factura', size: value.size };
  }
  return null;
}

import { requestIdFor, sessionOf } from '../auth/guard';
import { can } from '../core/auth/permissions';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import {
  getDeliveryPackage,
  listPendingDeliveries,
  markDeliveryFailed,
  markDeliverySent,
  resendDelivery,
} from '../core/billing/delivery/service';
import { knowledgeBaseInvoiceDocuments, type InvoiceDocumentStore } from '../core/billing/pdf/documents';
import { loadInvoiceDocument } from '../core/billing/pdf/load';

export interface DeliveryRouteDeps {
  writer: Writer;
  documents?: InvoiceDocumentStore;
}

export async function listInvoiceDeliveries(deps: DeliveryRouteDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entity = url.searchParams.get('entity');
  const older = url.searchParams.get('older_than_hours');
  const cursor = url.searchParams.get('cursor');
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw domainError('WC_VALIDATION', { limit: 'El límite debe estar entre 1 y 100' });
  }
  if (entity && !/^[0-9a-f-]{36}$/i.test(entity)) {
    throw domainError('WC_VALIDATION', { entity: 'Entidad no válida' });
  }
  const olderThanHours = older === null ? null : Number(older);
  if (older !== null && (!Number.isFinite(olderThanHours) || (olderThanHours ?? 0) < 0)) {
    throw domainError('WC_VALIDATION', { older_than_hours: 'Horas no válidas' });
  }
  return deps.writer.withWrite(userActor(user.id, request, 'Listar entregas'), async (tx) => {
    const page = await listPendingDeliveries(tx, {
      legalEntityId: entity,
      olderThanHours,
      cursor,
      limit,
    });
    const items = page.items
      .filter((item) => can(user, 'billing.deliver', item.legal_entity_id))
      .map(({ legal_entity_id: _entity, ...item }) => item);
    return { items, next_cursor: page.nextCursor };
  });
}

export async function getInvoiceDelivery(deps: DeliveryRouteDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const documents = deps.documents ?? knowledgeBaseInvoiceDocuments();
  return deps.writer.withWrite(userActor(user.id, request, 'Preparar entrega'), async (tx) => {
    const found = await loadInvoiceDocument(tx, id);
    if (found.kind === 'missing') throw domainError('WC_NOT_FOUND');
    if (!can(user, 'billing.deliver', found.legalEntityId)) throw domainError('WC_FORBIDDEN');
    if (found.kind !== 'ready') throw domainError('WC_VALIDATION', { status: 'La factura no está emitida' });
    return getDeliveryPackage(tx, found.invoice, documents);
  });
}

export async function markInvoiceDeliverySent(deps: DeliveryRouteDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const body = await readJson(request);
  const attempt = requiredInt(body.attempt, 'attempt');
  if (typeof body.message_id !== 'string') throw domainError('WC_VALIDATION', { message_id: 'Falta el identificador del mensaje' });
  if (!Array.isArray(body.recipients)) throw domainError('WC_VALIDATION', { recipients: 'Faltan los destinatarios' });
  const sentAt = parseDate(body.sent_at);
  return deps.writer.withWrite(userActor(user.id, request, 'Registrar envío de CVBOT'), async (tx) => {
    await assertInvoiceAccess(tx, user, id);
    return markDeliverySent(tx, {
      invoiceId: id,
      attempt,
      messageId: body.message_id as string,
      sentAt,
      recipients: body.recipients as string[],
      markedBy: user.id,
    });
  });
}

export async function markInvoiceDeliveryFailed(deps: DeliveryRouteDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const body = await readJson(request);
  const attempt = requiredInt(body.attempt, 'attempt');
  if (typeof body.error !== 'string') throw domainError('WC_VALIDATION', { error: 'Falta el texto del error' });
  return deps.writer.withWrite(userActor(user.id, request, 'Registrar fallo de CVBOT'), async (tx) => {
    await assertInvoiceAccess(tx, user, id);
    return markDeliveryFailed(tx, {
      invoiceId: id,
      attempt,
      error: body.error as string,
      markedBy: user.id,
    });
  });
}

export async function resendInvoiceDelivery(deps: DeliveryRouteDeps, request: Request, id: string) {
  const user = sessionOf(request);
  return deps.writer.withWrite(userActor(user.id, request, 'Reenviar factura'), async (tx) => {
    const found = await loadInvoiceDocument(tx, id);
    if (found.kind === 'missing') throw domainError('WC_NOT_FOUND');
    if (!can(user, 'billing.deliver', found.legalEntityId)) throw domainError('WC_FORBIDDEN');
    if (found.kind !== 'ready') throw domainError('WC_VALIDATION', { status: 'La factura no está emitida' });
    const created = await resendDelivery(tx, found.invoice, user.id);
    return { invoice_id: created.invoiceId, attempt: created.attempt, status: created.status };
  });
}

async function assertInvoiceAccess(
  tx: Parameters<typeof loadInvoiceDocument>[0],
  user: ReturnType<typeof sessionOf>,
  id: string,
): Promise<void> {
  const found = await loadInvoiceDocument(tx, id);
  if (found.kind === 'missing') throw domainError('WC_NOT_FOUND');
  if (!can(user, 'billing.deliver', found.legalEntityId)) throw domainError('WC_FORBIDDEN');
}

function userActor(id: string, request: Request, reason: string) {
  return { type: 'user' as const, id, requestId: requestIdFor(request), reason };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === 'DomainError') throw error;
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

function requiredInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw domainError('WC_VALIDATION', { [field]: 'Intento no válido' });
  }
  return value;
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { sent_at: 'Fecha de envío no válida' });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw domainError('WC_VALIDATION', { sent_at: 'Fecha de envío no válida' });
  return date;
}

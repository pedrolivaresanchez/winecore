import type { Writer } from '../../db/writer';
import { domainError } from '../../errors';
import { knowledgeBaseInvoiceDocuments } from '../pdf/documents';
import { loadInvoiceDocument } from '../pdf/load';
import {
  getDeliveryPackage,
  listPendingDeliveries,
  markDeliveryFailed,
  markDeliverySent,
  type PendingDeliveryItem,
} from './service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeliveryToolContext {
  writer: Writer;
  actorId: string;
  /** `machine` is the CVBOT client. It is not a person and cannot be granted by a user role. */
  actorType: 'user' | 'machine';
  permissions: ReadonlySet<string>;
  now?: () => Date;
}

export const billingInvoicesPendingDeliveryListTool = {
  name: 'billing_invoices_pending_delivery_list',
  permission: 'billing.read',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', format: 'uuid' },
      older_than_hours: { type: 'number' },
      cursor: { type: 'string' },
      limit: { type: 'integer' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array' },
      next_cursor: { type: 'string' },
    },
  },
} as const;

export const billingInvoicePdfGetTool = {
  name: 'billing_invoice_pdf_get',
  permission: 'billing.read',
  inputSchema: {
    type: 'object',
    required: ['invoice_id'],
    properties: { invoice_id: { type: 'string', format: 'uuid' } },
  },
  outputSchema: {
    type: 'object',
    required: ['filename', 'mime', 'base64', 'to', 'subject_es', 'body_es', 'attempt'],
    properties: {
      filename: { type: 'string' },
      mime: { const: 'application/pdf' },
      base64: { type: 'string' },
      to: { type: 'array', items: { type: 'string' } },
      subject_es: { type: 'string' },
      body_es: { type: 'string' },
      attempt: { type: 'integer' },
    },
  },
} as const;

export const billingInvoiceDeliveryMarkSentTool = {
  name: 'billing_invoice_delivery_mark_sent',
  permission: 'billing.deliver',
  inputSchema: {
    type: 'object',
    required: ['invoice_id', 'attempt', 'message_id', 'sent_at', 'recipients'],
    properties: {
      invoice_id: { type: 'string', format: 'uuid' },
      attempt: { type: 'integer' },
      message_id: { type: 'string' },
      sent_at: { type: 'string', format: 'date-time' },
      recipients: { type: 'array', items: { type: 'string' } },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['status'],
    properties: { status: { const: 'sent' } },
  },
} as const;

export const billingInvoiceDeliveryMarkFailedTool = {
  name: 'billing_invoice_delivery_mark_failed',
  permission: 'billing.deliver',
  inputSchema: {
    type: 'object',
    required: ['invoice_id', 'attempt', 'error'],
    properties: {
      invoice_id: { type: 'string', format: 'uuid' },
      attempt: { type: 'integer' },
      error: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['status'],
    properties: { status: { const: 'failed' } },
  },
} as const;

export async function billingInvoicesPendingDeliveryList(
  ctx: DeliveryToolContext,
  input: { entity?: string; older_than_hours?: number; cursor?: string; limit?: number },
): Promise<{ items: Omit<PendingDeliveryItem, 'legal_entity_id'>[]; next_cursor: string | null }> {
  assertTool(ctx, billingInvoicesPendingDeliveryListTool.permission);
  const entity = input.entity === undefined ? null : uuid(input.entity, 'entity');
  const older = input.older_than_hours;
  if (older !== undefined && (!Number.isFinite(older) || older < 0 || older > 24 * 14)) {
    throw domainError('WC_VALIDATION', { older_than_hours: 'Horas no válidas' });
  }
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw domainError('WC_VALIDATION', { limit: 'El límite debe estar entre 1 y 100' });
  }
  return ctx.writer.withWrite(actorOf(ctx), async (tx) => {
    const listed = await listPendingDeliveries(tx, {
      legalEntityId: entity,
      olderThanHours: older ?? null,
      cursor: input.cursor ?? null,
      limit,
    });
    return {
      items: listed.items.map(({ legal_entity_id: _entity, ...item }) => item),
      next_cursor: listed.nextCursor,
    };
  });
}

export async function billingInvoicePdfGet(
  ctx: DeliveryToolContext,
  input: { invoice_id?: string },
): Promise<{
  filename: string;
  mime: 'application/pdf';
  base64: string;
  to: string[];
  subject_es: string;
  body_es: string;
  attempt: number;
}> {
  assertTool(ctx, billingInvoicePdfGetTool.permission);
  const invoiceId = uuid(input.invoice_id, 'invoice_id');
  return ctx.writer.withWrite(actorOf(ctx), async (tx) => {
    const found = await loadInvoiceDocument(tx, invoiceId);
    if (found.kind !== 'ready') throw domainError('WC_NOT_FOUND');
    return getDeliveryPackage(tx, found.invoice, knowledgeBaseInvoiceDocuments());
  });
}

export async function billingInvoiceDeliveryMarkSent(
  ctx: DeliveryToolContext,
  input: { invoice_id?: string; attempt?: number; message_id?: string; sent_at?: string; recipients?: string[] },
): Promise<{ status: 'sent' }> {
  assertTool(ctx, billingInvoiceDeliveryMarkSentTool.permission);
  const invoiceId = uuid(input.invoice_id, 'invoice_id');
  const attempt = integer(input.attempt, 'attempt');
  if (typeof input.message_id !== 'string') throw domainError('WC_VALIDATION', { message_id: 'Falta el identificador del mensaje' });
  if (!Array.isArray(input.recipients)) throw domainError('WC_VALIDATION', { recipients: 'Faltan los destinatarios' });
  const sentAt = parseDate(input.sent_at);
  await ctx.writer.withWrite(actorOf(ctx), async (tx) => {
    await markDeliverySent(tx, {
      invoiceId,
      attempt,
      messageId: input.message_id as string,
      sentAt,
      recipients: input.recipients as string[],
      markedBy: ctx.actorId,
    });
  });
  return { status: 'sent' };
}

export async function billingInvoiceDeliveryMarkFailed(
  ctx: DeliveryToolContext,
  input: { invoice_id?: string; attempt?: number; error?: string },
): Promise<{ status: 'failed' }> {
  assertTool(ctx, billingInvoiceDeliveryMarkFailedTool.permission);
  const invoiceId = uuid(input.invoice_id, 'invoice_id');
  const attempt = integer(input.attempt, 'attempt');
  if (typeof input.error !== 'string') throw domainError('WC_VALIDATION', { error: 'Falta el texto del error' });
  await ctx.writer.withWrite(actorOf(ctx), async (tx) => {
    await markDeliveryFailed(tx, {
      invoiceId,
      attempt,
      error: input.error as string,
      markedBy: ctx.actorId,
      now: ctx.now?.(),
    });
  });
  return { status: 'failed' };
}

function assertTool(ctx: DeliveryToolContext, permission: string): void {
  if (!ctx.permissions.has(permission)) throw domainError('WC_FORBIDDEN');
}

function actorOf(ctx: DeliveryToolContext) {
  return {
    type: ctx.actorType === 'machine' ? 'agent' as const : 'user' as const,
    id: ctx.actorId,
    requestId: ctx.actorId,
    reason: 'Entrega de factura',
  };
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  }
  return value;
}

function integer(value: unknown, field: string): number {
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

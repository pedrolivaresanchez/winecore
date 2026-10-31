import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import { domainError } from '../../errors';
import { newId } from '../../ids';
import type { InvoiceDocumentStore } from '../pdf/documents';
import { ensureIssuedInvoicePdf, pdfFilename } from '../pdf/issue';
import { invoiceRecipients, type LoadedInvoice } from '../pdf/load';
import { notifyInvoiceDelivery } from './alerts';
import { spanishDeliveryMessage } from './template';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'no_recipient';
export type DeliveryChannel = 'cvbot_outlook' | 'download';

export interface DeliveryRecord {
  id: string;
  invoiceId: string;
  attempt: number;
  channel: DeliveryChannel;
  recipients: string[];
  status: DeliveryStatus;
  messageId: string | null;
  error: string | null;
  requestedBy: string;
  markedBy: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface MoneyAmount {
  amount: string;
  currency: string;
}

export interface PendingDeliveryItem {
  invoice_id: string;
  number: string;
  entity: string;
  customer: string;
  issue_date: string;
  total: MoneyAmount;
  delivery_status: 'pending' | 'failed' | 'no_recipient';
  attempt: number;
  pending_since: string;
  legal_entity_id: string;
}

export async function openDeliveryOnIssue(
  tx: Tx,
  invoice: LoadedInvoice,
  documents: InvoiceDocumentStore,
  now = new Date(),
): Promise<DeliveryRecord> {
  if (invoice.status !== 'issued') {
    throw domainError('WC_VALIDATION', { status: 'La factura no está emitida' });
  }
  const existing = await readAttempt(tx, invoice.id, 1);
  if (existing) return existing;

  await ensureIssuedInvoicePdf(tx, invoice, documents, 'system');
  const recipients = await invoiceRecipients(tx, invoice.customerId);
  const status: DeliveryStatus = recipients.length === 0 ? 'no_recipient' : 'pending';
  const id = newId();
  tx.write(sql`
    INSERT INTO billing.invoice_delivery (
      id, invoice_id, attempt, channel, recipients, status, requested_by, created_at
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${invoice.id} AS UUID),
      1,
      'cvbot_outlook',
      ${recipientList(recipients)},
      ${status},
      'system',
      ${now}
    )
  `);
  writeIssuedEvent(tx, invoice, status, 1, now);
  if (status === 'no_recipient') {
    await notifyInvoiceDelivery(tx, {
      legalEntityId: invoice.legalEntityId,
      invoiceId: invoice.id,
      number: invoice.number,
      kind: 'delivery.no_recipient',
      title: `Factura ${invoice.number} sin destinatario`,
      body: 'El cliente no tiene un correo de facturación. CVBOT no puede enviar la factura.',
      now,
    });
  }
  tx.audit({
    table: 'billing.invoice_delivery',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { invoice_id: invoice.id, attempt: 1, status, channel: 'cvbot_outlook' },
  });
  return {
    id,
    invoiceId: invoice.id,
    attempt: 1,
    channel: 'cvbot_outlook',
    recipients,
    status,
    messageId: null,
    error: null,
    requestedBy: 'system',
    markedBy: null,
    createdAt: now.toISOString(),
    sentAt: null,
  };
}

export async function listPendingDeliveries(
  tx: Tx,
  query: { legalEntityId?: string | null; olderThanHours?: number | null; cursor?: string | null; limit: number },
): Promise<{ items: PendingDeliveryItem[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const cutoff = query.olderThanHours == null
    ? null
    : new Date(Date.now() - query.olderThanHours * 60 * 60 * 1000);
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT d.invoice_id, d.attempt, d.status, d.created_at,
           i.number, i.issue_date, i.total, i.currency, i.customer_snapshot, i.legal_entity_id,
           e.code AS entity_code
    FROM billing.invoice_delivery d
    JOIN billing.invoice i ON i.id = d.invoice_id
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    JOIN (
      SELECT invoice_id, max(attempt) AS attempt
      FROM billing.invoice_delivery
      GROUP BY invoice_id
    ) latest ON latest.invoice_id = d.invoice_id AND latest.attempt = d.attempt
    WHERE d.status IN ('pending', 'failed', 'no_recipient')
      AND (${query.legalEntityId ?? null} IS NULL OR i.legal_entity_id = CAST(${query.legalEntityId ?? null} AS UUID))
      AND (${cutoff} IS NULL OR d.created_at <= ${cutoff})
      AND (
        ${cursor?.at ?? null} IS NULL
        OR d.created_at > ${cursor?.at ?? null}
        OR (d.created_at = ${cursor?.at ?? null} AND d.invoice_id > CAST(${cursor?.id ?? '00000000-0000-0000-0000-000000000000'} AS UUID))
      )
    ORDER BY d.created_at, d.invoice_id
    LIMIT ${query.limit + 1}
  `);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(pendingItem),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor(String(last.created_at), String(last.invoice_id))
      : null,
  };
}

export async function getDeliveryPackage(
  tx: Tx,
  invoice: LoadedInvoice,
  documents: InvoiceDocumentStore,
): Promise<{
  filename: string;
  mime: 'application/pdf';
  base64: string;
  to: string[];
  subject_es: string;
  body_es: string;
  attempt: number;
}> {
  const delivery = await latestDelivery(tx, invoice.id);
  if (!delivery) throw domainError('WC_NOT_FOUND');
  const pdf = await ensureIssuedInvoicePdf(tx, invoice, documents, 'system');
  const to = await invoiceRecipients(tx, invoice.customerId);
  const message = spanishDeliveryMessage({
    number: invoice.number,
    issuerName: invoice.issuer.legalName,
    total: invoice.totalToPay,
    currency: invoice.currency,
    dueDate: invoice.dues[0]?.dueDate ?? null,
  });
  return {
    filename: pdf.filename || pdfFilename(invoice.number),
    mime: 'application/pdf',
    base64: Buffer.from(pdf.bytes).toString('base64'),
    to,
    subject_es: message.subject,
    body_es: message.body,
    attempt: delivery.attempt,
  };
}

export async function markDeliverySent(
  tx: Tx,
  input: {
    invoiceId: string;
    attempt: number;
    messageId: string;
    sentAt: Date;
    recipients: readonly string[];
    markedBy: string;
  },
): Promise<{ status: 'sent'; already: boolean }> {
  const messageId = cleanToken(input.messageId, 'message_id', 200);
  const recipients = cleanEmails(input.recipients);
  if (Number.isNaN(input.sentAt.getTime())) {
    throw domainError('WC_VALIDATION', { sent_at: 'Fecha de envío no válida' });
  }
  const row = await requireAttempt(tx, input.invoiceId, input.attempt);
  if (row.status === 'sent') {
    if (row.messageId === messageId) return { status: 'sent', already: true };
    throw domainError('WC_IDEMPOTENCY_MISMATCH');
  }
  if (row.status === 'no_recipient') {
    throw domainError('WC_VALIDATION', { status: 'No hay destinatario al que marcar el envío' });
  }
  tx.write(sql`
    UPDATE billing.invoice_delivery
    SET status = 'sent',
        message_id = ${messageId},
        sent_at = ${input.sentAt},
        marked_by = ${input.markedBy},
        recipients = ${recipientList(recipients)}
    WHERE id = CAST(${row.id} AS UUID)
      AND status IN ('pending', 'failed')
  `);
  tx.audit({
    table: 'billing.invoice_delivery',
    rowId: row.id,
    action: 'UPDATE',
    before: { status: row.status, message_id: row.messageId },
    after: { status: 'sent', message_id: messageId, sent_at: input.sentAt.toISOString() },
  });
  return { status: 'sent', already: false };
}

export async function markDeliveryFailed(
  tx: Tx,
  input: { invoiceId: string; attempt: number; error: string; markedBy: string; now?: Date },
): Promise<{ status: 'failed'; already: boolean }> {
  const errorText = sanitizeDeliveryError(input.error);
  const row = await requireAttempt(tx, input.invoiceId, input.attempt);
  if (row.status === 'failed') return { status: 'failed', already: true };
  if (row.status === 'sent') {
    throw domainError('WC_VALIDATION', { status: 'Un envío ya registrado no pasa a fallido' });
  }
  const now = input.now ?? new Date();
  tx.write(sql`
    UPDATE billing.invoice_delivery
    SET status = 'failed', error = ${errorText}, marked_by = ${input.markedBy}
    WHERE id = CAST(${row.id} AS UUID)
      AND status IN ('pending', 'no_recipient')
  `);
  const invoice = await invoiceHeader(tx, input.invoiceId);
  await notifyInvoiceDelivery(tx, {
    legalEntityId: invoice.legalEntityId,
    invoiceId: input.invoiceId,
    number: invoice.number,
    kind: 'delivery.failed',
    title: `Envío de la factura ${invoice.number} fallido`,
    body: `CVBOT no ha podido enviar la factura. ${errorText}`,
    now,
  });
  tx.audit({
    table: 'billing.invoice_delivery',
    rowId: row.id,
    action: 'UPDATE',
    before: { status: row.status },
    after: { status: 'failed', error: errorText },
  });
  return { status: 'failed', already: false };
}

export async function resendDelivery(
  tx: Tx,
  invoice: LoadedInvoice,
  requestedBy: string,
  now = new Date(),
): Promise<DeliveryRecord> {
  const latest = await latestDelivery(tx, invoice.id);
  if (!latest) throw domainError('WC_NOT_FOUND');
  if (latest.status === 'pending') {
    throw domainError('WC_VALIDATION', { status: 'Ya hay un envío pendiente' });
  }
  const recipients = await invoiceRecipients(tx, invoice.customerId);
  const status: DeliveryStatus = recipients.length === 0 ? 'no_recipient' : 'pending';
  const attempt = latest.attempt + 1;
  const id = newId();
  tx.write(sql`
    INSERT INTO billing.invoice_delivery (
      id, invoice_id, attempt, channel, recipients, status, requested_by, created_at
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${invoice.id} AS UUID),
      ${attempt},
      'cvbot_outlook',
      ${recipientList(recipients)},
      ${status},
      ${requestedBy},
      ${now}
    )
  `);
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at
    ) VALUES (
      'billing.delivery.resend',
      'billing.invoice',
      CAST(${invoice.id} AS UUID),
      CAST(${invoice.legalEntityId} AS UUID),
      ${sql.json({
        invoice_id: invoice.id,
        number: invoice.number,
        attempt,
        delivery_status: status,
        total: invoice.totalToPay,
        currency: invoice.currency,
      })},
      ${now}
    )
  `);
  if (status === 'no_recipient') {
    await notifyInvoiceDelivery(tx, {
      legalEntityId: invoice.legalEntityId,
      invoiceId: invoice.id,
      number: invoice.number,
      kind: 'delivery.no_recipient',
      title: `Factura ${invoice.number} sin destinatario`,
      body: 'El reenvío no tiene correo de facturación.',
      now,
    });
  }
  tx.audit({
    table: 'billing.invoice_delivery',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { invoice_id: invoice.id, attempt, status },
  });
  return {
    id,
    invoiceId: invoice.id,
    attempt,
    channel: 'cvbot_outlook',
    recipients,
    status,
    messageId: null,
    error: null,
    requestedBy,
    markedBy: null,
    createdAt: now.toISOString(),
    sentAt: null,
  };
}

export async function sweepDeliveryAlerts(
  tx: Tx,
  alertHours: number,
  now = new Date(),
): Promise<{ overdue: number; notifications: number }> {
  const cutoff = new Date(now.getTime() - alertHours * 60 * 60 * 1000);
  const rows = await tx.read<{
    invoice_id: string;
    status: string;
    number: string;
    legal_entity_id: string;
    created_at: string;
  }>(sql`
    SELECT d.invoice_id, d.status, d.created_at, i.number, i.legal_entity_id
    FROM billing.invoice_delivery d
    JOIN billing.invoice i ON i.id = d.invoice_id
    JOIN (
      SELECT invoice_id, max(attempt) AS attempt
      FROM billing.invoice_delivery
      GROUP BY invoice_id
    ) latest ON latest.invoice_id = d.invoice_id AND latest.attempt = d.attempt
    WHERE d.status IN ('pending', 'failed', 'no_recipient')
      AND (
        d.status <> 'pending'
        OR d.created_at <= ${cutoff}
      )
  `);
  let overdue = 0;
  let notifications = 0;
  for (const row of rows) {
    const status = String(row.status);
    const kind = status === 'failed'
      ? 'delivery.failed'
      : status === 'no_recipient'
        ? 'delivery.no_recipient'
        : 'delivery.overdue';
    if (kind === 'delivery.overdue') overdue += 1;
    const title = kind === 'delivery.overdue'
      ? `Factura ${row.number} sin enviar`
      : kind === 'delivery.failed'
        ? `Envío de la factura ${row.number} fallido`
        : `Factura ${row.number} sin destinatario`;
    const body = kind === 'delivery.overdue'
      ? `Sigue pendiente de envío más de ${alertHours} h.`
      : kind === 'delivery.failed'
        ? 'El envío a CVBOT figura como fallido.'
        : 'El cliente no tiene correo de facturación.';
    notifications += await notifyInvoiceDelivery(tx, {
      legalEntityId: String(row.legal_entity_id),
      invoiceId: String(row.invoice_id),
      number: String(row.number),
      kind,
      title,
      body,
      now,
    });
  }
  return { overdue, notifications };
}

export function sanitizeDeliveryError(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > 500) {
    throw domainError('WC_VALIDATION', { error: 'El texto del error no es válido' });
  }
  return cleaned;
}

function writeIssuedEvent(
  tx: Tx,
  invoice: LoadedInvoice,
  status: DeliveryStatus,
  attempt: number,
  now: Date,
): void {
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at
    ) VALUES (
      'billing.invoice.issued',
      'billing.invoice',
      CAST(${invoice.id} AS UUID),
      CAST(${invoice.legalEntityId} AS UUID),
      ${sql.json({
        invoice_id: invoice.id,
        number: invoice.number,
        legal_entity_id: invoice.legalEntityId,
        total: invoice.totalToPay,
        currency: invoice.currency,
        delivery_status: status,
        attempt,
      })},
      ${now}
    )
  `);
}

function recipientList(recipients: readonly string[]): readonly string[] | null {
  return recipients.length === 0 ? null : recipients;
}

async function readAttempt(tx: Tx, invoiceId: string, attempt: number): Promise<DeliveryRecord | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, invoice_id, attempt, channel, recipients, status, message_id, error,
           requested_by, marked_by, created_at, sent_at,
           len(recipients) AS recipient_count
    FROM billing.invoice_delivery
    WHERE invoice_id = CAST(${invoiceId} AS UUID) AND attempt = ${attempt}
  `);
  const row = rows[0];
  return row ? deliveryFrom(row) : null;
}

async function requireAttempt(tx: Tx, invoiceId: string, attempt: number): Promise<DeliveryRecord> {
  if (!UUID.test(invoiceId) || !Number.isInteger(attempt) || attempt < 1) throw domainError('WC_NOT_FOUND');
  const row = await readAttempt(tx, invoiceId, attempt);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function latestDelivery(tx: Tx, invoiceId: string): Promise<DeliveryRecord | null> {
  const rows = await tx.read<{ attempt: number }>(sql`
    SELECT max(attempt) AS attempt
    FROM billing.invoice_delivery
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
  `);
  const attempt = Number(rows[0]?.attempt ?? 0);
  if (!attempt) return null;
  return readAttempt(tx, invoiceId, attempt);
}

async function invoiceHeader(tx: Tx, invoiceId: string): Promise<{ number: string; legalEntityId: string }> {
  const rows = await tx.read<{ number: string; legal_entity_id: string }>(sql`
    SELECT number, legal_entity_id FROM billing.invoice WHERE id = CAST(${invoiceId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return { number: String(row.number), legalEntityId: String(row.legal_entity_id) };
}

function deliveryFrom(row: Record<string, unknown>): DeliveryRecord {
  const status = String(row.status);
  if (status !== 'pending' && status !== 'sent' && status !== 'failed' && status !== 'no_recipient') {
    throw domainError('WC_VALIDATION', { status: 'Estado de entrega desconocido' });
  }
  const channel = String(row.channel);
  if (channel !== 'cvbot_outlook' && channel !== 'download') {
    throw domainError('WC_VALIDATION', { channel: 'Canal de entrega desconocido' });
  }
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    attempt: Number(row.attempt),
    channel,
    recipients: asEmails(row.recipients),
    status,
    messageId: row.message_id == null ? null : String(row.message_id),
    error: row.error == null ? null : String(row.error),
    requestedBy: String(row.requested_by),
    markedBy: row.marked_by == null ? null : String(row.marked_by),
    createdAt: String(row.created_at),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
  };
}

function pendingItem(row: Record<string, unknown>): PendingDeliveryItem {
  const status = String(row.status);
  if (status !== 'pending' && status !== 'failed' && status !== 'no_recipient') {
    throw domainError('WC_VALIDATION', { status: 'Estado de entrega desconocido' });
  }
  const snapshot = row.customer_snapshot;
  const customer = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? String((snapshot as { legal_name?: unknown }).legal_name ?? '')
    : '';
  return {
    invoice_id: String(row.invoice_id),
    number: String(row.number),
    entity: String(row.entity_code),
    customer,
    issue_date: String(row.issue_date).slice(0, 10),
    total: { amount: moneyAmount(row.total), currency: String(row.currency) },
    delivery_status: status,
    attempt: Number(row.attempt),
    pending_since: String(row.created_at),
    legal_entity_id: String(row.legal_entity_id),
  };
}

function moneyAmount(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return String(value);
}

function asEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function cleanEmails(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!EMAIL.test(email)) throw domainError('WC_VALIDATION', { recipients: 'Correo no válido' });
    seen.add(email);
  }
  if (seen.size === 0) throw domainError('WC_VALIDATION', { recipients: 'Falta el destinatario' });
  return [...seen];
}

function cleanToken(value: string, field: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/gu, '').trim();
  if (cleaned.length === 0 || cleaned.length > max) {
    throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  }
  return cleaned;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}\n${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } {
  let decoded = '';
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
  const split = decoded.indexOf('\n');
  const at = decoded.slice(0, split);
  const id = decoded.slice(split + 1);
  if (split < 0 || !UUID.test(id)) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  return { at, id };
}

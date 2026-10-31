import { sql } from '../../db/sql';
import type { Actor, Writer } from '../../db/writer';
import { domainError } from '../../errors';
import type { InvoiceDocumentStore } from '../pdf/documents';
import { ensureIssuedInvoicePdf } from '../pdf/issue';
import { invoiceRecipients, loadInvoiceDocument, type LoadedInvoice } from '../pdf/load';
import type { BatchSendApprovalHook } from './approval';
import { invoiceEmailDraft } from './email';
import type { MailProvider } from './provider';

export interface DeliverCommand {
  invoiceId: string;
  /** True only when a person clicked Enviar for this invoice. */
  confirm: boolean;
  channel: 'email' | 'download';
  /** Set only for a batch. Ignored as an override: the approval hook must accept it. */
  approvalId: string | null;
}

export interface DeliverDeps {
  documents: InvoiceDocumentStore;
  mail: MailProvider;
  approvals: BatchSendApprovalHook;
  authorize: (legalEntityId: string) => void;
  downloadPath: (invoiceId: string) => string;
  now?: () => Date;
}

export type DeliverBody =
  | {
      invoice_id: string;
      delivered: false;
      channel: 'manual';
      notice: string;
      download_path: string;
      email: { to: string[]; subject: string; text: string };
    }
  | {
      invoice_id: string;
      delivered: true;
      channel: 'email' | 'download';
      sent_at: string;
      sent_by: string;
      recipients: string[];
      download_path: string;
      already_recorded: boolean;
    };

/**
 * Sends one invoice, or records a download, only for a human actor.
 * A job, an agent or a machine token is rejected even if an approval id is present.
 * With no outbound mailbox (Q-014), Enviar returns a download path and copy-ready text.
 */
export async function deliverInvoice(
  writer: Writer,
  actor: Actor,
  command: DeliverCommand,
  deps: DeliverDeps,
): Promise<DeliverBody> {
  if (actor.type !== 'user') throw domainError('WC_FORBIDDEN');

  return writer.withWrite(actor, async (tx) => {
    const found = await loadInvoiceDocument(tx, command.invoiceId);
    if (found.kind === 'missing') throw domainError('WC_NOT_FOUND');
    deps.authorize(found.legalEntityId);
    if (found.kind !== 'ready') {
      throw domainError('WC_VALIDATION', { status: 'La factura no está emitida' });
    }
    if (found.invoice.status !== 'issued') {
      throw domainError('WC_VALIDATION', { status: 'Una factura anulada no se envía' });
    }

    if (command.approvalId) {
      const approved = await deps.approvals.isApproved({
        approvalId: command.approvalId,
        invoiceId: command.invoiceId,
      });
      if (!approved) throw domainError('WC_FORBIDDEN');
    } else if (command.confirm !== true) {
      throw domainError('WC_VALIDATION', {
        confirm: 'Hace falta la acción explícita de una persona (Enviar)',
      });
    }

    const invoice = found.invoice;
    const recipients = await invoiceRecipients(tx, invoice.customerId);
    const path = deps.downloadPath(invoice.id);
    const now = deps.now?.() ?? new Date();

    if (command.channel === 'download') {
      await ensureIssuedInvoicePdf(tx, invoice, deps.documents, actor.id);
      if (invoice.sentAt) return recorded(invoice, path, recipients, true);
      writeSent(tx, invoice, actor.id, 'download', now);
      return recorded(invoice, path, recipients, false, now.toISOString(), actor.id, 'download');
    }

    if (invoice.sentChannel === 'email' && invoice.sentAt) {
      return recorded(invoice, path, recipients, true);
    }

    if (!deps.mail.enabled) {
      await ensureIssuedInvoicePdf(tx, invoice, deps.documents, actor.id);
      const draft = invoiceEmailDraft(invoice, invoice.language, recipients);
      const notice = recipients.length === 0
        ? 'No hay un buzón de salida configurado. Descargue el PDF y copie el texto del correo. El cliente no tiene personas que reciban facturas.'
        : 'No hay un buzón de salida configurado. Descargue el PDF y copie el texto del correo.';
      tx.audit({
        table: 'billing.invoice',
        rowId: invoice.id,
        action: 'EVENT',
        before: null,
        after: { channel: 'manual', reason: 'mail_provider_disabled', recipients },
      });
      return {
        invoice_id: invoice.id,
        delivered: false,
        channel: 'manual',
        notice,
        download_path: path,
        email: draft,
      };
    }

    if (recipients.length === 0) {
      throw domainError('WC_VALIDATION', { recipients: 'El cliente no tiene personas que reciban facturas' });
    }
    const pdf = await ensureIssuedInvoicePdf(tx, invoice, deps.documents, actor.id);
    const draft = invoiceEmailDraft(invoice, invoice.language, recipients);
    await deps.mail.send({
      to: draft.to,
      subject: draft.subject,
      text: draft.text,
      attachments: [{ filename: pdf.filename, mime: 'application/pdf', bytes: pdf.bytes }],
    });
    writeSent(tx, invoice, actor.id, 'email', now);
    return recorded(invoice, path, draft.to, false, now.toISOString(), actor.id, 'email');
  });
}

function writeSent(
  tx: { write: (statement: string) => void; audit: (change: { table: string; rowId: string; action: 'UPDATE'; before: unknown; after: unknown }) => void },
  invoice: LoadedInvoice,
  userId: string,
  channel: 'download' | 'email',
  now: Date,
): void {
  // DuckDB cannot UPDATE billing.invoice once lines exist (the child FK blocks it).
  // The outbox row is the send record; the audit row is the human trace.
  const sentAt = now.toISOString();
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at
    ) VALUES (
      'billing.invoice.sent',
      'billing.invoice',
      CAST(${invoice.id} AS UUID),
      CAST(${invoice.legalEntityId} AS UUID),
      ${sql.json({ channel, sent_by: userId, sent_at: sentAt })},
      ${now}
    )
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: invoice.id,
    action: 'UPDATE',
    before: { sent_at: invoice.sentAt, sent_by: invoice.sentBy, sent_channel: invoice.sentChannel },
    after: { sent_at: sentAt, sent_by: userId, sent_channel: channel },
  });
}

function recorded(
  invoice: LoadedInvoice,
  path: string,
  recipients: readonly string[],
  already: boolean,
  sentAt = invoice.sentAt ?? '',
  sentBy = invoice.sentBy ?? '',
  channel: 'email' | 'download' = invoice.sentChannel === 'email' ? 'email' : 'download',
): DeliverBody {
  return {
    invoice_id: invoice.id,
    delivered: true,
    channel,
    sent_at: sentAt,
    sent_by: sentBy,
    recipients: channel === 'email' ? [...recipients] : [],
    download_path: path,
    already_recorded: already,
  };
}

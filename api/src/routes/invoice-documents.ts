import type { Config } from '../config';
import { requestIdFor, sessionOf } from '../auth/guard';
import { can } from '../core/auth/permissions';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { knowledgeBaseInvoiceDocuments, type InvoiceDocumentStore } from '../core/billing/pdf/documents';
import { ensureIssuedInvoicePdf, pdfFilename } from '../core/billing/pdf/issue';
import { loadInvoiceDocument } from '../core/billing/pdf/load';
import { closedBatchSendApproval, type BatchSendApprovalHook } from '../core/billing/send/approval';
import { deliverInvoice, type DeliverBody } from '../core/billing/send/deliver';
import { mailProviderFromConfig, type MailProvider } from '../core/billing/send/provider';

export interface InvoiceDocumentDeps {
  writer: Writer;
  config: Config;
  documents?: InvoiceDocumentStore;
  mail?: MailProvider;
  approvals?: BatchSendApprovalHook;
}

export async function downloadInvoicePdf(
  deps: InvoiceDocumentDeps,
  request: Request,
  id: string,
): Promise<Response> {
  const user = sessionOf(request);
  const documents = deps.documents ?? knowledgeBaseInvoiceDocuments();
  const stored = await deps.writer.withWrite(
    {
      type: 'user',
      id: user.id,
      requestId: requestIdFor(request),
      reason: 'Generar PDF de factura',
    },
    async (tx) => {
      const found = await loadInvoiceDocument(tx, id);
      if (found.kind === 'missing') throw domainError('WC_NOT_FOUND');
      if (!can(user, 'billing.read', found.legalEntityId)) throw domainError('WC_FORBIDDEN');
      if (found.kind !== 'ready') {
        throw domainError('WC_VALIDATION', { status: 'La factura no está emitida' });
      }
      return ensureIssuedInvoicePdf(tx, found.invoice, documents, user.id);
    },
  );
  const filename = stored.filename || pdfFilename('factura');
  return new Response(Buffer.from(stored.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function sendInvoiceDocument(
  deps: InvoiceDocumentDeps,
  request: Request,
  id: string,
): Promise<DeliverBody> {
  const user = sessionOf(request);
  const command = parseSend(await readJson(request), id);
  const documents = deps.documents ?? knowledgeBaseInvoiceDocuments();
  const mail = deps.mail ?? mailProviderFromConfig(deps.config);
  const approvals = deps.approvals ?? closedBatchSendApproval;
  return deliverInvoice(
    deps.writer,
    {
      type: 'user',
      id: user.id,
      requestId: requestIdFor(request),
      reason: 'Enviar factura',
    },
    command,
    {
      documents,
      mail,
      approvals,
      authorize: (legalEntityId) => {
        if (!can(user, 'billing.issue', legalEntityId)) throw domainError('WC_FORBIDDEN');
      },
      downloadPath: (invoiceId) => `${deps.config.apiBasePath}/v1/invoices/${invoiceId}/pdf`,
    },
  );
}

function parseSend(raw: unknown, invoiceId: string): {
  invoiceId: string;
  confirm: boolean;
  channel: 'email' | 'download';
  approvalId: string | null;
} {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
  const body = raw as Record<string, unknown>;
  let channel: 'email' | 'download' = 'email';
  if (body.channel !== undefined) {
    if (body.channel !== 'email' && body.channel !== 'download') {
      throw domainError('WC_VALIDATION', { channel: 'El canal debe ser email o download' });
    }
    channel = body.channel;
  }
  let approvalId: string | null = null;
  if (body.approval_id !== undefined && body.approval_id !== null) {
    if (typeof body.approval_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.approval_id)) {
      throw domainError('WC_VALIDATION', { approval_id: 'Identificador de aprobación no válido' });
    }
    approvalId = body.approval_id;
  }
  return { invoiceId, confirm: body.confirm === true, channel, approvalId };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

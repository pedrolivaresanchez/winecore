import type { Config } from '../config';
import { requestIdFor, sessionOf } from '../auth/guard';
import { can } from '../core/auth/permissions';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { knowledgeBaseInvoiceDocuments, type InvoiceDocumentStore } from '../core/billing/pdf/documents';
import { ensureIssuedInvoicePdf, pdfFilename } from '../core/billing/pdf/issue';
import { loadInvoiceDocument } from '../core/billing/pdf/load';

export interface InvoiceDocumentDeps {
  writer: Writer;
  config: Config;
  documents?: InvoiceDocumentStore;
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

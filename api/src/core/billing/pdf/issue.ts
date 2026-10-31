import type { Tx } from '../../db/writer';
import { domainError } from '../../errors';
import type { InvoiceDocumentStore } from './documents';
import { renderInvoicePdf } from './render';
import type { LoadedInvoice } from './load';

export function pdfFilename(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_|_$/gu, '');
  return `factura-${safe === '' ? 'sin-numero' : safe}.pdf`;
}

/**
 * Stores the issued PDF once. A second call returns the stored bytes and does
 * not render again, so a later change of layout cannot replace a issued invoice.
 */
export async function ensureIssuedInvoicePdf(
  tx: Tx,
  invoice: LoadedInvoice,
  store: InvoiceDocumentStore,
  createdBy: string,
): Promise<{ attachmentId: string; sha256: string; bytes: Uint8Array; filename: string }> {
  const filename = pdfFilename(invoice.number);
  const existingId = invoice.pdfAttachmentId ?? await store.findInvoicePdf(tx, invoice.id);
  if (existingId) {
    const stored = await store.read(tx, existingId);
    if (!stored) throw domainError('WC_NOT_FOUND');
    return {
      attachmentId: existingId,
      sha256: stored.sha256,
      bytes: stored.bytes,
      filename: stored.filename,
    };
  }
  const bytes = await renderInvoicePdf(invoice, invoice.language);
  const stored = await store.putOnce(tx, {
    invoiceId: invoice.id,
    bytes,
    filename,
    createdBy,
    existingAttachmentId: null,
  });
  return { attachmentId: stored.attachmentId, sha256: stored.sha256, bytes, filename };
}

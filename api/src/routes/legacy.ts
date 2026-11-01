import { sessionOf } from '../auth/guard';
import { listLinks, readContent } from '../core/attachments/store';
import { loadLegacyDocument, loadLegacyInvoice, readHoldedDocument, readHoldedInvoice } from '../core/legacy/detail';
import { listLegacyDocuments } from '../core/legacy/documents';
import { listLegacyInvoices } from '../core/legacy/invoices';
import { loadLegacyOverview } from '../core/legacy/overview';
import { holdedDocumentPdfInput, holdedPdfFilename, holdedPdfInput } from '../core/legacy/pdf';
import { renderDocumentPdf } from '../core/pdf/document';
import { listLegacyProducts } from '../core/legacy/products';
import type { Writer } from '../core/db/writer';

export function getLegacyOverview(writer: Writer, request: Request, now = new Date()) {
  return loadLegacyOverview(writer, sessionOf(request), new URL(request.url), now);
}

export function getLegacyInvoices(writer: Writer, request: Request) {
  return listLegacyInvoices(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyInvoice(writer: Writer, request: Request, id: string, now = new Date()) {
  return loadLegacyInvoice(writer, sessionOf(request), id, now);
}

export async function getLegacyInvoicePdf(writer: Writer, request: Request, id: string): Promise<Response> {
  const loaded = await readHoldedInvoice(writer, sessionOf(request), id);
  const stored = await storedPdf(writer, 'legacy.holded_invoice', loaded.detail.id, ['invoice_pdf', 'supplier_invoice_scan']);
  const bytes = stored ?? await renderDocumentPdf(holdedPdfInput(loaded));
  return pdfResponse(bytes, holdedPdfFilename(loaded.detail.number));
}

export async function getLegacyDocumentPdf(writer: Writer, request: Request, id: string): Promise<Response> {
  const loaded = await readHoldedDocument(writer, sessionOf(request), id);
  const quote = loaded.detail.kind === 'quote';
  const table = quote ? 'legacy.holded_quote' : 'legacy.holded_delivery_note';
  const stored = await storedPdf(writer, table, loaded.detail.id, quote ? ['contract', 'other'] : ['delivery_note_pdf', 'other']);
  const bytes = stored ?? await renderDocumentPdf(holdedDocumentPdfInput(loaded));
  return pdfResponse(bytes, holdedPdfFilename(loaded.detail.number, quote ? 'presupuesto' : 'albaran'));
}

/** La UI lo pinta desde un blob, así que `inline` solo cuenta si alguien abre la URL de la API. */
function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}

/** El original adjunto gana a la copia generada, pero solo si de verdad es un PDF (un escaneo puede ser una foto). */
async function storedPdf(writer: Writer, table: string, id: string, roles: string[]): Promise<Uint8Array | null> {
  const links = await listLinks(writer.read.bind(writer), table, id);
  for (const role of roles) {
    const link = links.find((item) => item.role === role && item.mime_type === 'application/pdf');
    if (!link) continue;
    try {
      return await readContent(writer.read.bind(writer), link.sha256);
    } catch {
      continue;
    }
  }
  return null;
}

export function getLegacyDocument(writer: Writer, request: Request, id: string, now = new Date()) {
  return loadLegacyDocument(writer, sessionOf(request), id, now);
}

export function getLegacyProducts(writer: Writer, request: Request) {
  return listLegacyProducts(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyDocuments(writer: Writer, request: Request) {
  return listLegacyDocuments(writer, sessionOf(request), new URL(request.url));
}

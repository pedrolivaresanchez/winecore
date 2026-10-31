import { sessionOf } from '../auth/guard';
import { listLinks, readContent } from '../core/attachments/store';
import { loadLegacyDocument, loadLegacyInvoice, readHoldedInvoice } from '../core/legacy/detail';
import { listLegacyDocuments } from '../core/legacy/documents';
import { listLegacyInvoices } from '../core/legacy/invoices';
import { loadLegacyOverview } from '../core/legacy/overview';
import { holdedPdfFilename, holdedPdfInput, renderHoldedInvoicePdf } from '../core/legacy/pdf';
import { listLegacyProducts } from '../core/legacy/products';
import type { Writer } from '../core/db/writer';

export function getLegacyOverview(writer: Writer, request: Request, now = new Date()) {
  return loadLegacyOverview(writer, sessionOf(request), new URL(request.url), now);
}

export function getLegacyInvoices(writer: Writer, request: Request) {
  return listLegacyInvoices(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyInvoice(writer: Writer, request: Request, id: string) {
  return loadLegacyInvoice(writer, sessionOf(request), id);
}

export async function getLegacyInvoicePdf(writer: Writer, request: Request, id: string): Promise<Response> {
  const loaded = await readHoldedInvoice(writer, sessionOf(request), id);
  const stored = await storedInvoicePdf(writer, id);
  const bytes = stored ?? await renderHoldedInvoicePdf(holdedPdfInput(loaded));
  const filename = holdedPdfFilename(loaded.detail.number);
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function storedInvoicePdf(writer: Writer, id: string): Promise<Uint8Array | null> {
  const links = await listLinks(writer.read.bind(writer), 'legacy.holded_invoice', id);
  const link = links.find((item) => item.role === 'invoice_pdf' || item.role === 'supplier_invoice_scan');
  if (!link) return null;
  try {
    return await readContent(writer.read.bind(writer), link.sha256);
  } catch {
    return null;
  }
}

export function getLegacyDocument(writer: Writer, request: Request, id: string) {
  return loadLegacyDocument(writer, sessionOf(request), id);
}

export function getLegacyProducts(writer: Writer, request: Request) {
  return listLegacyProducts(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyDocuments(writer: Writer, request: Request) {
  return listLegacyDocuments(writer, sessionOf(request), new URL(request.url));
}

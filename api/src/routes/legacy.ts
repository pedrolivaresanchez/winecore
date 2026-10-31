import { sessionOf } from '../auth/guard';
import { listLegacyDocuments } from '../core/legacy/documents';
import { listLegacyInvoices } from '../core/legacy/invoices';
import { loadLegacyOverview } from '../core/legacy/overview';
import { listLegacyProducts } from '../core/legacy/products';
import type { Writer } from '../core/db/writer';

export function getLegacyOverview(writer: Writer, request: Request, now = new Date()) {
  return loadLegacyOverview(writer, sessionOf(request), new URL(request.url), now);
}

export function getLegacyInvoices(writer: Writer, request: Request) {
  return listLegacyInvoices(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyProducts(writer: Writer, request: Request) {
  return listLegacyProducts(writer, sessionOf(request), new URL(request.url));
}

export function getLegacyDocuments(writer: Writer, request: Request) {
  return listLegacyDocuments(writer, sessionOf(request), new URL(request.url));
}

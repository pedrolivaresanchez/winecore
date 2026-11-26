import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { exportSalesDocuments } from '../core/sales-documents/export';
import { listSalesDocuments } from '../core/sales-documents/list';

export function getSalesDocuments(writer: Writer, request: Request, now = new Date()) {
  return listSalesDocuments(writer, sessionOf(request), new URL(request.url), now);
}

export function getSalesDocumentsExport(writer: Writer, request: Request, now = new Date()) {
  return exportSalesDocuments(writer, sessionOf(request), new URL(request.url), now);
}

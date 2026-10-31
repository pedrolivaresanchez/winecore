import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { listReceivables } from '../core/finance/receivables';

export function getReceivables(writer: Writer, request: Request) {
  return listReceivables(writer, sessionOf(request), request);
}

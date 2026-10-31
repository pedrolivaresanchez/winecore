import { sessionOf } from '../auth/guard';
import { loadDashboard } from '../core/dashboard/panel';
import type { Writer } from '../core/db/writer';

export function getDashboard(writer: Writer, request: Request, now = new Date()) {
  return loadDashboard(writer, sessionOf(request), new URL(request.url), now);
}

import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { assessReadiness } from '../core/setup/readiness';

export function getReadiness(writer: Writer, request: Request, now: Date, deliveryAlertHours: number) {
  sessionOf(request);
  return assessReadiness(writer, { now, deliveryAlertHours });
}

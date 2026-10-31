import { refreshRegulatoryCalendar } from "../core/regulatory/obligations";
import type { Writer } from "../core/db/writer";
import type { Scheduler } from "./scheduler";

export const REGULATORY_DEADLINES_JOB_ID = "regulatory-deadlines";
export const REGULATORY_DEADLINES_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function registerRegulatoryDeadlines(
  scheduler: Scheduler,
  deps: { writer: Writer; now?: () => Date },
): void {
  scheduler.register(REGULATORY_DEADLINES_JOB_ID, REGULATORY_DEADLINES_INTERVAL_MS, async () => {
    await refreshRegulatoryCalendar(deps.writer, deps.now?.() ?? new Date());
  });
}

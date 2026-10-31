import { runSeasonalReminders } from '../core/enology/reminders';
import type { Writer } from '../core/db/writer';
import type { Scheduler } from './scheduler';

export const ENOLOGY_REMINDERS_JOB_ID = 'enology-reminders';
export const ENOLOGY_REMINDERS_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function registerEnologyReminders(scheduler: Scheduler, deps: { writer: Writer }): void {
  scheduler.register(ENOLOGY_REMINDERS_JOB_ID, ENOLOGY_REMINDERS_INTERVAL_MS, async () => {
    await runSeasonalReminders(deps.writer, new Date());
  });
}

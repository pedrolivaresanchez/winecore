import type { Writer } from '../core/db/writer';
import { newId } from '../core/ids';
import { scanCueReminders } from '../core/vineyard-notebook/cue';
import type { Scheduler } from './scheduler';

export const CUE_REMINDER_JOB_ID = 'cue-reminder';
/** Cada hora: el aviso depende de la fecha, no de la hora. */
export const CUE_REMINDER_INTERVAL_MS = 60 * 60 * 1000;

export function registerCueReminder(
  scheduler: Scheduler,
  writer: Writer,
  now: () => Date = () => new Date(),
): void {
  scheduler.register(CUE_REMINDER_JOB_ID, CUE_REMINDER_INTERVAL_MS, async () => {
    await scanCueReminders(writer, {
      type: 'system',
      id: 'cue-reminder',
      requestId: newId(),
      reason: 'aviso de anotación en el CUE',
    }, now());
  });
}

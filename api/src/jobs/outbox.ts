import { dispatchOutbox, type DispatchDeps } from '../core/events/dispatch';
import type { Scheduler } from './scheduler';

export const OUTBOX_JOB_ID = 'outbox-dispatch';
export const OUTBOX_INTERVAL_MS = 30_000;

export function registerOutboxDispatch(scheduler: Scheduler, deps: DispatchDeps): void {
  scheduler.register(OUTBOX_JOB_ID, OUTBOX_INTERVAL_MS, async () => {
    await dispatchOutbox(deps);
  });
}

import type { Writer } from '../core/db/writer';
import { runFermentationAlerts } from '../core/winemaking/service';
import type { Scheduler } from './scheduler';

export const FERMENTATION_ALERTS_JOB_ID = 'fermentation-alerts';
export const FERMENTATION_ALERTS_INTERVAL_MS = 60 * 60 * 1000;

export function registerFermentationAlerts(scheduler: Scheduler, deps: { writer: Writer }): void {
  scheduler.register(FERMENTATION_ALERTS_JOB_ID, FERMENTATION_ALERTS_INTERVAL_MS, async () => {
    await runFermentationAlerts(deps.writer);
  });
}

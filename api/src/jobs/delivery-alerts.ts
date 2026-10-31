import type { Writer } from '../core/db/writer';
import { sql } from '../core/db/sql';
import { newId } from '../core/ids';
import { sweepDeliveryAlerts } from '../core/billing/delivery/service';

export async function runDeliveryAlertJob(
  writer: Writer,
  alertHours: number,
  now = new Date(),
): Promise<{ overdue: number; notifications: number }> {
  const runId = newId();
  await writer.withWrite(
    { type: 'system', id: 'delivery-alerts', requestId: runId, reason: 'Avisos de entrega' },
    async (tx) => {
      tx.write(sql`
        INSERT INTO ops.job_run (id, job_name, started_at, status, summary)
        VALUES (CAST(${runId} AS UUID), 'delivery-alerts', ${now}, 'running', ${sql.json({})})
      `);
    },
  );
  try {
    const result = await writer.withWrite(
      { type: 'system', id: 'delivery-alerts', requestId: runId, reason: 'Avisos de entrega' },
      async (tx) => sweepDeliveryAlerts(tx, alertHours, now),
    );
    await writer.withWrite(
      { type: 'system', id: 'delivery-alerts', requestId: runId, reason: 'Avisos de entrega' },
      async (tx) => {
        tx.write(sql`
          UPDATE ops.job_run
          SET status = 'succeeded', finished_at = ${new Date()}, summary = ${sql.json(result)}
          WHERE id = CAST(${runId} AS UUID)
        `);
      },
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Error interno';
    await writer.withWrite(
      { type: 'system', id: 'delivery-alerts', requestId: newId(), reason: 'Avisos de entrega' },
      async (tx) => {
        tx.write(sql`
          UPDATE ops.job_run
          SET status = 'failed', finished_at = ${new Date()}, error = ${message}
          WHERE id = CAST(${runId} AS UUID)
        `);
      },
    ).catch(() => undefined);
    throw error;
  }
}

/** Hourly check. The host calls this from the process entrypoint; nothing is mailed. */
export function startDeliveryAlertJob(writer: Writer, alertHours: number): () => void {
  const tick = () => {
    void runDeliveryAlertJob(writer, alertHours).catch(() => undefined);
  };
  const first = setTimeout(tick, 10_000);
  const timer = setInterval(tick, 60 * 60 * 1000);
  if (typeof first.unref === 'function') first.unref();
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

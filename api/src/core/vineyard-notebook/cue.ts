import type { RoleCode } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { notificationId } from '../events/notify';
import { businessDate } from '../time';
import { CUE_ELECTRONIC_FROM, cueClock } from './dates';
import { asCivilDate, uuidText } from './rows';

const ROLES: readonly RoleCode[] = ['owner', 'advisor', 'cellar', 'field'];
const KIND = 'vineyard.cue.pending';

export interface CuePendingItem {
  treatment_id: string;
  parcel_code: string;
  applied_on: string;
  warn_on: string | null;
  due_on: string | null;
  status: string;
}

export async function listCuePending(writer: Writer, asOf: string): Promise<{ as_of: string; items: CuePendingItem[] }> {
  const rows = await loadOpen(writer, asOf);
  return {
    as_of: asOf,
    items: rows.filter((item) => item.status === 'pending' || item.status === 'warn' || item.status === 'overdue'),
  };
}

export async function scanCueReminders(
  writer: Writer,
  actor: Actor,
  now: Date,
): Promise<{ as_of: string; pending: number; recipients: number }> {
  const asOf = businessDate(now);
  const due = (await loadOpen(writer, asOf)).filter((item) => item.status === 'warn' || item.status === 'overdue');
  if (due.length === 0) return { as_of: asOf, pending: 0, recipients: 0 };
  let recipients = 0;
  await writer.withWrite(actor, async (tx) => {
    const users = await recipientIds(tx);
    recipients = users.length;
    for (const item of due) {
      for (const userId of users) {
        const id = notificationId(item.treatment_id, userId, KIND);
        const title = 'Cuaderno sin anotar en el CUE';
        const body = `Tratamiento del ${item.applied_on} en ${item.parcel_code} sin anotar en el CUE pasados 20 días. Lo anota el agricultor; WineCore no lo envía.`;
        const link = `/v1/treatments/${item.treatment_id}`;
        tx.write(sql`
          INSERT INTO core.notification (id, user_id, kind, title, body, link)
          SELECT CAST(${id} AS UUID), CAST(${userId} AS UUID), ${KIND}, ${title}, ${body}, ${link}
          WHERE NOT EXISTS (SELECT 1 FROM core.notification WHERE id = CAST(${id} AS UUID))
        `);
      }
    }
  });
  return { as_of: asOf, pending: due.length, recipients };
}

async function loadOpen(reader: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> }, asOf: string): Promise<CuePendingItem[]> {
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT t.id, t.applied_on, t.record_kind, t.cue_recorded_at, p.code AS parcel_code
    FROM vineyard.treatment t
    JOIN vineyard.parcel p ON p.id = t.parcel_id
    WHERE t.record_kind = 'phytosanitary'
      AND t.applied_on >= DATE '${CUE_ELECTRONIC_FROM}'
      AND t.cue_recorded_at IS NULL
    ORDER BY t.applied_on, p.code
  `);
  return rows.map((row) => {
    const appliedOn = asCivilDate(row.applied_on);
    const clock = cueClock({
      kind: 'phytosanitary',
      appliedOn,
      recorded: false,
      asOf,
    });
    return {
      treatment_id: uuidText(row.id),
      parcel_code: String(row.parcel_code),
      applied_on: appliedOn,
      warn_on: clock.warn_on,
      due_on: clock.due_on,
      status: clock.status,
    };
  });
}

async function recipientIds(tx: Tx): Promise<string[]> {
  const roleList = ROLES.map((role) => sql`${role}`).join(', ');
  const rows = await tx.read<{ id: string }>(`
    SELECT DISTINCT u.id AS id
    FROM core.app_user u
    JOIN core.user_role r ON r.user_id = u.id
    WHERE u.status = 'active'
      AND r.revoked_at IS NULL
      AND r.role_code IN (${roleList})
  `);
  return rows.map((row) => uuidText(row.id));
}

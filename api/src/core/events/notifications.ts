import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotificationQuery {
  unread: boolean | null;
  cursor: { ms: string; id: string } | null;
  limit: number;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export function parseNotificationQuery(url: URL): NotificationQuery {
  const fields: Record<string, string> = {};
  const unreadRaw = url.searchParams.get('unread');
  let unread: boolean | null = null;
  if (unreadRaw !== null && unreadRaw !== '') {
    if (unreadRaw === 'true') unread = true;
    else if (unreadRaw === 'false') unread = false;
    else fields.unread = 'Debe ser true o false';
  }
  const limitRaw = url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw !== null && limitRaw.trim() !== '') {
    if (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) {
      fields.limit = 'Debe ser un entero entre 1 y 100';
    } else {
      limit = Number(limitRaw);
    }
  }
  const cursorRaw = url.searchParams.get('cursor')?.trim() ?? '';
  const cursor = cursorRaw === '' ? null : decodeCursor(cursorRaw);
  if (cursorRaw !== '' && !cursor) fields.cursor = 'Cursor no válido';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return { unread, cursor, limit };
}

export async function listNotifications(
  writer: Writer,
  userId: string,
  query: NotificationQuery,
): Promise<{ items: NotificationItem[]; next_cursor: string | null }> {
  const filters = [sql`n.user_id = CAST(${userId} AS UUID)`];
  if (query.unread === true) filters.push('n.read_at IS NULL');
  if (query.unread === false) filters.push('n.read_at IS NOT NULL');
  if (query.cursor) {
    const ms = Number(query.cursor.ms);
    filters.push(sql`(
      epoch_ms(n.created_at) < ${ms}
      OR (
        epoch_ms(n.created_at) = ${ms}
        AND n.id < CAST(${query.cursor.id} AS UUID)
      )
    )`);
  }
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at,
           epoch_ms(n.created_at) AS created_ms
    FROM core.notification n
    WHERE ${filters.join(' AND ')}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${query.limit + 1}
  `);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    next_cursor: hasMore && last ? encodeCursor(String(last.created_ms), String(last.id)) : null,
  };
}

export async function markNotificationRead(
  writer: Writer,
  userId: string,
  requestId: string,
  id: string,
  now = new Date(),
): Promise<NotificationItem> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  await writer.withWrite({ type: 'user', id: userId, requestId }, async (tx) => {
    const rows = await tx.read(sql`
      SELECT id FROM core.notification
      WHERE id = CAST(${id} AS UUID) AND user_id = CAST(${userId} AS UUID)
    `);
    if (!rows[0]) throw domainError('WC_NOT_FOUND');
    tx.write(sql`
      UPDATE core.notification
      SET read_at = ${now}
      WHERE id = CAST(${id} AS UUID)
        AND user_id = CAST(${userId} AS UUID)
        AND read_at IS NULL
    `);
  });
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, kind, title, body, link, created_at, read_at
    FROM core.notification
    WHERE id = CAST(${id} AS UUID) AND user_id = CAST(${userId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toItem(row);
}

export async function markAllNotificationsRead(
  writer: Writer,
  userId: string,
  requestId: string,
  now = new Date(),
): Promise<{ updated: number }> {
  let updated = 0;
  await writer.withWrite({ type: 'user', id: userId, requestId }, async (tx: Tx) => {
    const rows = await tx.read<{ total: number }>(sql`
      SELECT count(*)::INTEGER AS total
      FROM core.notification
      WHERE user_id = CAST(${userId} AS UUID) AND read_at IS NULL
    `);
    updated = Number(rows[0]?.total ?? 0);
    if (updated === 0) return;
    tx.write(sql`
      UPDATE core.notification
      SET read_at = ${now}
      WHERE user_id = CAST(${userId} AS UUID) AND read_at IS NULL
    `);
  });
  return { updated };
}

function toItem(row: Record<string, unknown>): NotificationItem {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    link: row.link == null ? null : String(row.link),
    created_at: String(row.created_at),
    read_at: row.read_at == null ? null : String(row.read_at),
  };
}

function encodeCursor(createdMs: string, id: string): string {
  return Buffer.from(`${createdMs}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { ms: string; id: string } | null {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = text.lastIndexOf('|');
    if (split <= 0) return null;
    const ms = text.slice(0, split);
    const id = text.slice(split + 1);
    if (!/^\d{1,16}$/.test(ms) || !UUID.test(id)) return null;
    return { ms, id };
  } catch {
    return null;
  }
}

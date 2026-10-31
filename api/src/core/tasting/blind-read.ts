import { uuidList } from '../cellar/service/http';
import type { Writer } from '../db/writer';
import { isUuid } from './validate';

const BLIND = new Set([
  'tasting.blind_vote',
  'tasting.blind_sample',
  'tasting.blind_pick',
  'tasting.blind_session',
]);

const VOTE_CONTENT = ['vote', 'score', 'comment'];
const SAMPLE_IDENTITY = ['lot_id', 'lot_code', 'vessel_id', 'vessel_code'];

/**
 * Mientras la sesión no está revelada, la auditoría no enseña el voto,
 * la puntuación, el comentario ni la identidad de la muestra.
 * El organizador ve quién ha votado. Cada catador ve solo su papeleta.
 */
export async function redactBlindAuditRows(
  writer: Writer,
  viewerId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const parsed = rows.flatMap((row) => {
    const table = String(row.table_name ?? '');
    if (!BLIND.has(table)) return [];
    return [{
      row,
      table,
      rowId: row.row_id == null ? '' : String(row.row_id).toLowerCase(),
      before: asRecord(row.before_data),
      after: asRecord(row.after_data),
    }];
  });
  if (parsed.length === 0) return;

  const sessionIds = new Set<string>();
  const missingVotes: string[] = [];
  const missingSamples: string[] = [];
  const missingPicks: string[] = [];
  for (const item of parsed) {
    const inline = uuidOf(item.after?.session_id) ?? uuidOf(item.before?.session_id);
    if (item.table === 'tasting.blind_session' && isUuid(item.rowId)) sessionIds.add(item.rowId);
    if (inline) sessionIds.add(inline);
    else if (item.table === 'tasting.blind_vote' && isUuid(item.rowId)) missingVotes.push(item.rowId);
    else if (item.table === 'tasting.blind_sample' && isUuid(item.rowId)) missingSamples.push(item.rowId);
    else if (item.table === 'tasting.blind_pick' && isUuid(item.rowId)) missingPicks.push(item.rowId);
  }

  const voteSession = await sessionByRow(writer, 'tasting.blind_vote', missingVotes);
  const sampleSession = await sessionByRow(writer, 'tasting.blind_sample', missingSamples);
  const pickSession = await sessionByRow(writer, 'tasting.blind_pick', missingPicks);
  for (const id of voteSession.values()) sessionIds.add(id);
  for (const id of sampleSession.values()) sessionIds.add(id);
  for (const id of pickSession.values()) sessionIds.add(id);
  const sessions = await loadSessions(writer, [...sessionIds]);
  const viewer = viewerId.toLowerCase();

  for (const item of parsed) {
    const sessionId = uuidOf(item.after?.session_id)
      ?? uuidOf(item.before?.session_id)
      ?? (item.table === 'tasting.blind_session' && isUuid(item.rowId) ? item.rowId : null)
      ?? voteSession.get(item.rowId)
      ?? sampleSession.get(item.rowId)
      ?? pickSession.get(item.rowId)
      ?? null;
    const state = sessionId ? sessions.get(sessionId) : undefined;
    if (state?.status === 'revealed') continue;
    const organiser = state !== undefined && state.createdBy === viewer;
    const own = String(item.row.actor_id ?? '').toLowerCase() === viewer
      || uuidOf(item.after?.taster_user_id) === viewer
      || uuidOf(item.before?.taster_user_id) === viewer;
    const keys = hiddenKeys(item.table, organiser, own);
    if (keys.length === 0) continue;
    if (item.before) item.row.before_data = without(item.before, keys);
    if (item.after) item.row.after_data = without(item.after, keys);
  }
}

function hiddenKeys(table: string, organiser: boolean, own: boolean): string[] {
  if (table === 'tasting.blind_vote') {
    const keys = organiser || !own ? [...VOTE_CONTENT] : [];
    if (!organiser && !own) keys.push('taster_name');
    return keys;
  }
  if (table === 'tasting.blind_sample' || table === 'tasting.blind_pick') return [...SAMPLE_IDENTITY];
  return [];
}

async function sessionByRow(writer: Writer, table: 'tasting.blind_vote' | 'tasting.blind_sample' | 'tasting.blind_pick', ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await writer.read<{ id: string; session_id: string }>(`
    SELECT id::VARCHAR AS id, session_id::VARCHAR AS session_id
    FROM ${table}
    WHERE id IN (${uuidList(ids)})
  `);
  for (const row of rows) map.set(String(row.id).toLowerCase(), String(row.session_id).toLowerCase());
  return map;
}

async function loadSessions(writer: Writer, ids: string[]): Promise<Map<string, { status: string; createdBy: string }>> {
  const map = new Map<string, { status: string; createdBy: string }>();
  if (ids.length === 0) return map;
  const rows = await writer.read<{ id: string; status: string; created_by: string }>(`
    SELECT id::VARCHAR AS id, status, created_by
    FROM tasting.blind_session
    WHERE id IN (${uuidList(ids)})
  `);
  for (const row of rows) {
    map.set(String(row.id).toLowerCase(), {
      status: String(row.status),
      createdBy: String(row.created_by).toLowerCase(),
    });
  }
  return map;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function uuidOf(value: unknown): string | null {
  if (typeof value !== 'string' || !isUuid(value)) return null;
  return value.toLowerCase();
}

function without(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const hidden = new Set(keys);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!hidden.has(key)) next[key] = value;
  }
  return next;
}

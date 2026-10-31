import { Decimal } from 'decimal.js';
import type { KbClient } from './client';
import { sha256Hex } from '../hash';
import { sql } from './sql';

export interface AuditActor {
  type: 'user' | 'agent' | 'system' | 'migration';
  id: string;
  onBehalfOf?: string;
  requestId: string;
  reason?: string;
}

export interface AuditChange {
  table: string;
  rowId: string | null;
  action: string;
  before: unknown;
  after: unknown;
}

export interface AuditRecord {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor_id: string;
  on_behalf_of: string | null;
  request_id: string | null;
  reason: string | null;
  table_name: string;
  row_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  prev_hash: string | null;
}

export interface AuditChainStatus {
  intact: boolean;
  firstBrokenId?: number;
}

function sortValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Decimal) return value.toFixed();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined) continue;
      sorted[key] = sortValue(child);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? 'null';
}

export function chainHash(entry: AuditRecord): string {
  return sha256Hex((entry.prev_hash ?? '') + canonicalJson(entry));
}

function asNumberId(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Identificador de auditoría fuera de rango');
  }
  return Number(value);
}

function recordOf(
  id: number,
  occurredAt: string,
  actor: AuditActor,
  change: AuditChange,
  prevHash: string | null,
): AuditRecord {
  return {
    id,
    occurred_at: occurredAt,
    actor_type: actor.type,
    actor_id: actor.id,
    on_behalf_of: actor.onBehalfOf ?? null,
    request_id: actor.requestId,
    reason: actor.reason ?? null,
    table_name: change.table,
    row_id: change.rowId,
    action: change.action,
    before: change.before ?? null,
    after: change.after ?? null,
    prev_hash: prevHash,
  };
}

function jsonOrNull(value: unknown): ReturnType<typeof sql.json> | null {
  if (value == null) return null;
  return sql.json(JSON.parse(canonicalJson(value)) as unknown);
}

export async function auditInserts(
  client: KbClient,
  actor: AuditActor,
  changes: readonly AuditChange[],
  now: Date = new Date(),
): Promise<string[]> {
  const last = await client.query<{ id: string; hash: string | null }>(
    'SELECT id, hash FROM audit.audit_log ORDER BY id DESC LIMIT 1',
  );
  const latest = last[0];
  let nextId = latest ? BigInt(latest.id) + 1n : 1n;
  let prevHash = latest?.hash ?? null;
  const occurredAt = now.toISOString();
  const statements: string[] = [];

  for (const change of changes) {
    const entry = recordOf(asNumberId(nextId), occurredAt, actor, change, prevHash);
    const hash = chainHash(entry);
    statements.push(sql`
      INSERT INTO audit.audit_log (
        id, occurred_at, actor_type, actor_id, on_behalf_of, request_id, reason,
        table_name, row_id, action, before_data, after_data, prev_hash, hash
      ) VALUES (
        ${entry.id},
        ${now},
        ${entry.actor_type},
        ${entry.actor_id},
        ${entry.on_behalf_of},
        ${entry.request_id},
        ${entry.reason},
        ${entry.table_name},
        ${entry.row_id},
        ${entry.action},
        ${jsonOrNull(entry.before)},
        ${jsonOrNull(entry.after)},
        ${entry.prev_hash},
        ${hash}
      )
    `);
    prevHash = hash;
    nextId += 1n;
  }
  return statements;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function entryFromRow(row: Record<string, unknown>): AuditRecord {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id)) throw new Error('Identificador de auditoría no válido');
  return {
    id,
    occurred_at: String(row.occurred_at),
    actor_type: String(row.actor_type),
    actor_id: String(row.actor_id),
    on_behalf_of: textOrNull(row.on_behalf_of),
    request_id: textOrNull(row.request_id),
    reason: textOrNull(row.reason),
    table_name: String(row.table_name),
    row_id: textOrNull(row.row_id),
    action: String(row.action),
    before: row.before_data ?? null,
    after: row.after_data ?? null,
    prev_hash: textOrNull(row.prev_hash),
  };
}

export async function verifyAuditChain(client: KbClient): Promise<AuditChainStatus> {
  const rows = await client.query(
    `SELECT id, occurred_at, actor_type, actor_id, on_behalf_of, request_id, reason,
            table_name, row_id, action, before_data, after_data, prev_hash, hash
     FROM audit.audit_log
     ORDER BY id`,
  );
  let expectedPrev: string | null = null;
  for (const row of rows) {
    const entry = entryFromRow(row);
    const stored = textOrNull(row.hash);
    if ((entry.prev_hash ?? null) !== expectedPrev || stored === null || stored !== chainHash(entry)) {
      return { intact: false, firstBrokenId: entry.id };
    }
    expectedPrev = stored;
  }
  return { intact: true };
}

export function changedFields(
  before: unknown,
  after: unknown,
): { field: string; before: unknown; after: unknown }[] {
  const left = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const right = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changes: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of keys) {
    const previous = field in left ? left[field] : null;
    const next = field in right ? right[field] : null;
    if (canonicalJson(previous ?? null) !== canonicalJson(next ?? null)) {
      changes.push({ field, before: previous ?? null, after: next ?? null });
    }
  }
  return changes;
}

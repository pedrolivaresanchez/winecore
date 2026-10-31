import { sessionOf } from '../auth/guard';
import { changedFields } from '../core/db/audit';
import { sql } from '../core/db/sql';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';

export async function listAudit(writer: Writer, request: Request) {
  sessionOf(request);
  const url = new URL(request.url);
  const table = optional(url.searchParams.get('table'), 'table');
  const rowId = optional(url.searchParams.get('row_id'), 'row_id');
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const limit = parseLimit(url.searchParams.get('limit'));
  const filters = ['TRUE'];
  if (table) filters.push(sql`table_name = ${table}`);
  if (rowId) filters.push(sql`row_id = ${rowId}`);
  if (cursor !== null) filters.push(sql`id < ${cursor}`);
  const listed = await writer.read(`
    SELECT id, occurred_at, actor_type, actor_id, on_behalf_of, request_id, reason,
           table_name, row_id, action, before_data, after_data
    FROM audit.audit_log
    WHERE ${filters.join(' AND ')}
    ORDER BY id DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = listed.length > limit;
  const page = hasMore ? listed.slice(0, limit) : listed;
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    next_cursor: hasMore && last ? String(last.id) : null,
  };
}

function toItem(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    occurred_at: String(row.occurred_at),
    actor: {
      type: String(row.actor_type),
      id: String(row.actor_id),
      on_behalf_of: row.on_behalf_of == null ? null : String(row.on_behalf_of),
    },
    action: String(row.action),
    table: String(row.table_name),
    row_id: row.row_id == null ? null : String(row.row_id),
    reason: row.reason == null ? null : String(row.reason),
    changes: changedFields(row.before_data ?? null, row.after_data ?? null),
  };
}

export async function verifyAudit(writer: Writer, request: Request) {
  sessionOf(request);
  const result = await writer.verifyAuditChain();
  return {
    intact: result.intact,
    first_broken_id: result.firstBrokenId ?? null,
  };
}

function optional(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw domainError('WC_VALIDATION', { [field]: 'Valor demasiado largo' });
  }
  return trimmed;
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === '') return 50;
  if (!/^\d{1,3}$/.test(value)) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  return parsed;
}

function parseCursor(value: string | null): bigint | null {
  if (value === null || value.trim() === '') return null;
  if (!/^\d{1,18}$/.test(value)) {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
  return BigInt(value);
}

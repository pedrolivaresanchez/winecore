import { domainError } from '../errors';
import { isUuid } from './fields';

export interface KeyCursor {
  k: string;
  id: string;
}

export function limitParam(url: URL): number {
  const value = url.searchParams.get('limit');
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

export function cursorParam(url: URL): KeyCursor | null {
  const value = url.searchParams.get('cursor');
  if (value === null || value.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
  const k = (parsed as { k?: unknown }).k;
  const id = (parsed as { id?: unknown }).id;
  if (typeof k !== 'string' || typeof id !== 'string' || k.length === 0 || k.length > 200 || !isUuid(id)) {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
  return { k, id };
}

export function encodeCursor(cursor: KeyCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function activeParam(url: URL): boolean | null {
  const value = url.searchParams.get('active');
  if (value === null || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw domainError('WC_VALIDATION', { active: 'Usa true o false' });
}

export function flagParam(url: URL, name: string): boolean | null {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw domainError('WC_VALIDATION', { [name]: 'Usa true o false' });
}

export function asCount(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function pageOf<T extends { id: string }>(
  rows: T[],
  limit: number,
  total: number,
  keyOf: (row: T) => string,
): { items: T[]; next_cursor: string | null; total: number } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ k: keyOf(last), id: last.id }) : null,
    total,
  };
}

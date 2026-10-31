import { sessionOf, requestIdFor } from '../../../auth/guard';
import { sql } from '../../db/sql';
import type { Actor, Tx } from '../../db/writer';
import { DomainError, domainError, isErrorCode } from '../../errors';
import type { PlanFailure } from '../types';

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CODE_RE = /^[A-Z0-9-]{2,20}$/;

export interface ListBody<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export function actorFor(request: Request, reason?: string): Actor {
  const user = sessionOf(request);
  return {
    type: 'user',
    id: user.id,
    requestId: requestIdFor(request),
    reason,
  };
}

export function invalid(fields: Record<string, string>): never {
  throw domainError('WC_VALIDATION', fields);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === '') invalid({ body: 'El cuerpo está vacío' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    invalid({ body: 'El JSON no es válido' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid({ body: 'El cuerpo debe ser un objeto' });
  }
  return parsed as Record<string, unknown>;
}

export function parseLimit(value: string | null): number {
  if (value === null || value.trim() === '') return 50;
  if (!/^\d{1,3}$/.test(value)) invalid({ limit: 'Debe ser un entero entre 1 y 100' });
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) invalid({ limit: 'Debe ser un entero entre 1 y 100' });
  return parsed;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    invalid({ [field]: 'Debe ser un UUID' });
  }
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid({ [field]: 'Debe ser un texto' });
  const trimmed = value.trim();
  if (trimmed.length === 0) invalid({ [field]: 'Es obligatorio' });
  if (trimmed.length > max) invalid({ [field]: `Máximo ${max} caracteres` });
  return trimmed;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalid({ [field]: 'Debe ser un texto' });
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) invalid({ [field]: `Máximo ${max} caracteres` });
  return trimmed;
}

export function requireCode(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || !CODE_RE.test(value)) {
    invalid({ [field]: 'Debe cumplir ^[A-Z0-9-]{2,20}$' });
  }
  return value;
}

export function requireBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid({ [field]: 'Debe ser verdadero o falso' });
  return value;
}

export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBool(value, field);
}

export function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid({ [field]: 'Debe ser un entero positivo' });
  }
  return value;
}

export function intOf(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint') {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error('Entero de base de datos fuera de rango');
}

export function textOf(value: unknown): string {
  if (value == null) throw new Error('Texto ausente');
  return String(value);
}

export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function boolOf(value: unknown): boolean {
  return value === true;
}

export function jsonObject(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

export function encodeOpCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeOpCursor(value: string | null): { occurredAt: string; id: string } | null {
  if (value === null || value.trim() === '') return null;
  let text: string;
  try {
    text = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    invalid({ cursor: 'Cursor no válido' });
  }
  const sep = text.indexOf('|');
  if (sep <= 0) invalid({ cursor: 'Cursor no válido' });
  const occurredAt = text.slice(0, sep);
  const id = text.slice(sep + 1);
  if (!isUuid(id)) invalid({ cursor: 'Cursor no válido' });
  return { occurredAt, id };
}

export function slicePage<T>(rows: readonly T[], limit: number, total: number, cursorOf: (row: T) => string): ListBody<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? cursorOf(last) : null,
    total,
  };
}

export async function countOf(txOrRead: { read<T>(sql: string): Promise<T[]> }, statement: string): Promise<number> {
  const rows = await txOrRead.read<{ total: unknown }>(statement);
  return intOf(rows[0]?.total ?? 0);
}

export function uuidList(ids: readonly string[]): string {
  if (ids.length === 0) throw new Error('Lista de UUID vacía');
  return ids.map((id) => {
    if (!UUID_RE.test(id)) throw new Error('UUID no válido');
    return sql`CAST(${id.toLowerCase()} AS UUID)`;
  }).join(', ');
}

export function auditInsert(tx: Tx, table: string, rowId: string, after: unknown, statement: string): void {
  tx.write(statement);
  tx.audit({ table, rowId, action: 'INSERT', before: null, after });
}

export function auditUpdate(
  tx: Tx,
  table: string,
  rowId: string,
  before: unknown,
  after: unknown,
  statement: string,
): void {
  tx.write(statement);
  tx.audit({ table, rowId, action: 'UPDATE', before, after });
}

export function spanishPlanMessage(code: string, message: string): string {
  const stripped = message.replace(new RegExp(`^${code}:\\s*`), '');
  if (stripped.length === 0) return message;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function fromPlan(failure: PlanFailure): DomainError {
  const message = spanishPlanMessage(failure.code, failure.message);
  const status = isErrorCode(failure.code) ? undefined : failure.code === 'WC_VESSEL_NOT_IN_SERVICE' ? 409 : 422;
  const fields = fieldsFrom(failure.details, message);
  if (isErrorCode(failure.code) && status === undefined) {
    const base = domainError(failure.code, fields);
    return new DomainError(failure.code, base.httpStatus, message, fields, failure.details);
  }
  return new DomainError(failure.code, status ?? 422, message, fields, failure.details);
}

function fieldsFrom(details: unknown, message: string): Record<string, string> | undefined {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const field = (details as { field?: unknown }).field;
  if (typeof field !== 'string' || field.length === 0) return undefined;
  return { [field]: message };
}

export function fillPct(volumeMl: number, capacityMl: number): string {
  if (capacityMl <= 0 || volumeMl <= 0) return '0.0';
  const tenths = Math.round((volumeMl * 1000) / capacityMl);
  const negative = tenths < 0;
  const abs = Math.abs(tenths);
  const whole = Math.trunc(abs / 10);
  const frac = abs % 10;
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid({ [field]: `Debe ser uno de: ${allowed.join(', ')}` });
  }
  return value as T;
}

import { Decimal } from 'decimal.js';
import { domainError } from '../errors';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FieldBag {
  readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.fields[field] === undefined) this.fields[field] = message;
  }

  fail(): void {
    if (Object.keys(this.fields).length > 0) throw domainError('WC_VALIDATION', this.fields);
  }
}

export function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  return body as Record<string, unknown>;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
  return readObject(parsed);
}

export function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[], errors: FieldBag): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors.add(key, 'Campo no reconocido');
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuid(value: string, field = 'id'): string {
  if (!isUuid(value)) throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  return value;
}

export function scale(value: unknown, digits: number): string {
  return new Decimal(String(value)).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits);
}

export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  errors: FieldBag,
): T | null {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.add(field, 'Valor no válido');
    return null;
  }
  return value as T;
}

export function boolValue(value: unknown, field: string, errors: FieldBag): boolean | null {
  if (typeof value !== 'boolean') {
    errors.add(field, 'Debe ser verdadero o falso');
    return null;
  }
  return value;
}

export function textValue(
  value: unknown,
  field: string,
  errors: FieldBag,
  opts: { required?: boolean; min?: number; max?: number; pattern?: RegExp; patternMessage?: string },
): string | null {
  if (value == null) {
    if (opts.required) errors.add(field, 'Obligatorio');
    return null;
  }
  if (typeof value !== 'string') {
    errors.add(field, 'Debe ser un texto');
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    if (opts.required) errors.add(field, 'Obligatorio');
    return null;
  }
  if (opts.min !== undefined && trimmed.length < opts.min) {
    errors.add(field, `Mínimo ${opts.min} caracteres`);
    return null;
  }
  if (opts.max !== undefined && trimmed.length > opts.max) {
    errors.add(field, `Máximo ${opts.max} caracteres`);
    return null;
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    errors.add(field, opts.patternMessage ?? 'Formato no válido');
    return null;
  }
  return trimmed;
}

export function intValue(
  value: unknown,
  field: string,
  errors: FieldBag,
  opts: { min: number; max: number },
): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < opts.min || parsed > opts.max) {
    errors.add(field, `Debe ser un entero entre ${opts.min} y ${opts.max}`);
    return null;
  }
  return parsed;
}

export function decimalValue(
  value: unknown,
  field: string,
  errors: FieldBag,
  opts: { scale: number; min?: string; exclusiveMin?: boolean; max?: string },
): Decimal | null {
  if (typeof value !== 'string') {
    errors.add(field, 'Debe ser una cadena decimal');
    return null;
  }
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    errors.add(field, 'Importe no válido');
    return null;
  }
  const fraction = trimmed.split('.')[1];
  if (fraction && fraction.length > opts.scale) {
    errors.add(field, `Máximo ${opts.scale} decimales`);
    return null;
  }
  const parsed = new Decimal(trimmed);
  if (!parsed.isFinite()) {
    errors.add(field, 'Importe no válido');
    return null;
  }
  if (opts.min !== undefined) {
    const min = new Decimal(opts.min);
    const below = opts.exclusiveMin ? parsed.lte(min) : parsed.lt(min);
    if (below) {
      errors.add(field, opts.exclusiveMin ? 'Debe ser mayor que 0' : 'No puede ser negativo');
      return null;
    }
  }
  if (opts.max !== undefined && parsed.gt(opts.max)) {
    errors.add(field, `No puede ser mayor que ${opts.max}`);
    return null;
  }
  return parsed;
}

export function dateValue(value: unknown, field: string, errors: FieldBag): string | null {
  if (typeof value !== 'string' || !isCalendarDate(value)) {
    errors.add(field, 'Fecha no válida (AAAA-MM-DD)');
    return null;
  }
  return value;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function jsonObjectValue(
  value: unknown,
  field: string,
  errors: FieldBag,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.add(field, 'Debe ser un objeto');
    return null;
  }
  const encoded = JSON.stringify(value);
  if (encoded.length > 4000) {
    errors.add(field, 'Demasiado grande');
    return null;
  }
  return value as Record<string, unknown>;
}

export function assertIfMatch(request: Request, updatedAt: string): void {
  const header = request.headers.get('if-match');
  if (header == null || header.trim() === '') {
    throw domainError('WC_VALIDATION', { 'if-match': 'Falta la cabecera If-Match' });
  }
  let sent = header.trim();
  if (sent.startsWith('W/')) sent = sent.slice(2).trim();
  if (sent.startsWith('"') && sent.endsWith('"') && sent.length >= 2) sent = sent.slice(1, -1);
  if (sent === updatedAt) return;
  const left = Date.parse(sent);
  const right = Date.parse(updatedAt);
  if (Number.isFinite(left) && left === right) return;
  throw domainError('WC_STALE_VERSION');
}

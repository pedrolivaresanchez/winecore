import { Decimal } from 'decimal.js';
import { money } from '../money';

export function asDecimal(value: unknown): Decimal {
  if (value instanceof Decimal) return money.fromString(value.toFixed());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Número no finito');
    return money.fromString(String(value));
  }
  if (typeof value === 'string' && value.trim() !== '') return money.fromString(value.trim());
  throw new TypeError('Importe no válido');
}

export function euros(value: Decimal): string {
  return money.toString(value);
}

export function price6(value: Decimal): string {
  return money.round6(value).toFixed(6);
}

export function qty3(value: Decimal): string {
  return money.fromString(value.toFixed(12)).toDecimalPlaces(3).toFixed(3);
}

export function dateText(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match?.[1]) throw new TypeError('Fecha no válida');
  return match[1];
}

export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text === '' ? null : text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidText(value: unknown): string {
  const text = String(value ?? '').toLowerCase();
  if (!UUID.test(text)) throw new TypeError('Identificador no válido');
  return text;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Safe IN list. Only validated UUIDs are interpolated. */
export function uuidIn(column: string, ids: readonly string[]): string {
  if (!/^[a-z_]+(\.[a-z_]+)?$/.test(column)) throw new Error('Columna SQL no permitida');
  if (ids.length === 0) return 'FALSE';
  const list = ids.map((id) => `CAST('${uuidText(id)}' AS UUID)`).join(', ');
  return `${column} IN (${list})`;
}

import { invalid } from '../cellar/service/http';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function requireFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid({ [field]: 'Debe ser un número' });
  }
  if (Math.abs(value) > 1_000_000) invalid({ [field]: 'El valor se sale del plano' });
  return value;
}

export function requireSpan(value: unknown, field: string): number {
  const parsed = requireFinite(value, field);
  if (parsed <= 0) invalid({ [field]: 'Debe ser mayor que cero' });
  return parsed;
}

export function requireRotation(value: unknown): number {
  const parsed = requireFinite(value, 'rotation');
  if (parsed < -360 || parsed > 360) invalid({ rotation: 'Debe estar entre -360 y 360' });
  return parsed;
}

export function nonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid({ [field]: 'Debe ser un entero mayor o igual que cero' });
  }
  return value;
}

export function nonzeroInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
    invalid({ [field]: 'Debe ser un entero distinto de cero' });
  }
  return value;
}

export function requireYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1950 || value > 2100) {
    invalid({ year_made: 'Debe ser un año entre 1950 y 2100' });
  }
  return value;
}

export function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid({ [field]: 'Debe ser una fecha YYYY-MM-DD' });
  return assertDate(value.trim(), field);
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireDate(value, field);
}

function assertDate(value: string, field: string): string {
  const match = DATE_RE.exec(value);
  if (!match) invalid({ [field]: 'Debe ser una fecha YYYY-MM-DD' });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    invalid({ [field]: 'La fecha no existe' });
  }
  return value;
}

export function requireMoney(value: unknown, field: string): string {
  const text = moneyText(value, field);
  if (text === null) invalid({ [field]: 'Debe ser un importe' });
  return text;
}

export function optionalMoney(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireMoney(value, field);
}

function moneyText(value: unknown, field: string): string | null {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) invalid({ [field]: 'Debe ser un importe con hasta 2 decimales' });
  return Number(text).toFixed(2);
}

export function doubleOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Coordenada no válida');
}

export function dateOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] ?? String(value);
}

export function moneyOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return String(value);
  return parsed.toFixed(2);
}

export function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

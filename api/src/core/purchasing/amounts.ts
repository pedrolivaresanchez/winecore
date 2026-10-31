import { Decimal } from 'decimal.js';
import { money } from '../money';

const CENT = new Decimal('0.01');

export function dec(value: string): Decimal {
  return money.fromString(value);
}

export function money2(value: Decimal): string {
  return money.toString(value);
}

export function near(left: Decimal, right: Decimal): boolean {
  return left.minus(right).abs().lte(CENT);
}

export function add(values: readonly Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0));
}

/** Importe con punto decimal. Admite la coma española si no hay punto. */
export function parseAmount(raw: string | null | undefined): Decimal | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\s/g, '');
  if (trimmed === '') return null;
  let normalized = trimmed;
  if (trimmed.includes(',') && trimmed.includes('.')) {
    normalized = trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')
      ? trimmed.replaceAll('.', '').replace(',', '.')
      : trimmed.replaceAll(',', '');
  } else if (trimmed.includes(',')) {
    normalized = trimmed.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  try {
    const value = money.fromString(normalized);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

export function isoDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function rate2(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function qty3(value: Decimal): string {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function price6(value: Decimal): string {
  const fixed = value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
  return trimmed.includes('.') ? trimmed : `${trimmed}.00`;
}

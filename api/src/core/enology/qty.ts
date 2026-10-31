import { Decimal } from 'decimal.js';
import { money } from '../money';

const DECIMAL_TEXT = /^-?\d{1,10}(\.\d{1,6})?$/u;

/** Cantidades con el mismo Decimal HALF_UP que el dinero. */
export function q(value: string): Decimal {
  return money.fromString(value);
}

export function round(value: Decimal, places: number): Decimal {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

export function fixed(value: Decimal, places: number): string {
  return round(value, places).toFixed(places);
}

export function plain(value: Decimal): string {
  const text = round(value, 6).toFixed(6);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/u, '').replace(/\.$/u, '');
}

export function zero(): Decimal {
  return q('0');
}

export function max0(value: Decimal): Decimal {
  return value.isNeg() ? zero() : value;
}

export function decimalText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DECIMAL_TEXT.test(trimmed) ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = Object.is(value, -0) ? '0' : String(value);
    return DECIMAL_TEXT.test(text) ? text : null;
  }
  return null;
}

export function esNum(value: string): string {
  return value.replace('.', ',');
}

import { Decimal } from 'decimal.js';
import { domainError } from '../errors';
import { money } from '../money';
import { businessDate } from '../time';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

export function text(value: unknown): string | null {
  if (value == null) return null;
  const out = String(value);
  return out.length === 0 ? null : out;
}

export function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

/** Devolución física de una rectificativa, guardada en legacy_refs (DuckDB no altera CHECKs). */
export function rectificationDetail(refs: Record<string, unknown> | null): {
  noPhysicalReturn: boolean | null;
  returnDeliveryNote: string | null;
} {
  const raw = refs?.rectification;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { noPhysicalReturn: null, returnDeliveryNote: null };
  }
  const record = raw as Record<string, unknown>;
  const flagValue = record.no_physical_return;
  const note = record.return_delivery_note;
  return {
    noPhysicalReturn: typeof flagValue === 'boolean' ? flagValue : null,
    returnDeliveryNote: typeof note === 'string' && note.trim() !== '' ? note : null,
  };
}

export function mergeRectification(
  refs: Record<string, unknown>,
  detail: { noPhysicalReturn: boolean | null; returnDeliveryNote: string | null },
): Record<string, unknown> {
  const next = { ...refs };
  if (detail.noPhysicalReturn == null && detail.returnDeliveryNote == null) {
    delete next.rectification;
    return next;
  }
  next.rectification = {
    no_physical_return: detail.noPhysicalReturn === true,
    return_delivery_note: detail.returnDeliveryNote,
  };
  return next;
}

export function day(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return businessDate(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] ?? null;
}

export function stamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

export function decimalOf(value: unknown): Decimal {
  try {
    if (value instanceof Decimal) {
      if (!value.isFinite()) throw new Error('nan');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('nan');
      return money.fromString(Object.is(value, -0) ? '0' : value.toString());
    }
    if (typeof value === 'string' && value.trim() !== '') return money.fromString(value.trim());
    throw new Error('type');
  } catch (error) {
    if (error instanceof Error && error.name === 'DomainError') throw error;
    throw domainError('WC_VALIDATION', { amount: 'Importe no válido' });
  }
}

export function scale(value: Decimal, places: number): Decimal {
  return decimalOf(value).toDecimalPlaces(places);
}

export function fixed(value: unknown, places: number): string {
  return scale(decimalOf(value), places).toFixed(places);
}

export function moneyText(value: unknown): string | null {
  if (value == null) return null;
  return money.toString(decimalOf(value));
}

/** Mediodía UTC: el mismo día civil en Europe/Madrid, con o sin horario de verano. */
export function instantOn(civilDate: string): Date {
  return new Date(`${civilDate}T12:00:00Z`);
}

export function today(now = new Date()): string {
  return businessDate(now);
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return asObject(value);
}

export function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
}

export function seriesDocType(invoiceType: string): 'invoice' | 'credit_note' | 'simplified_invoice' {
  if (invoiceType.startsWith('R')) return 'credit_note';
  if (invoiceType === 'F2') return 'simplified_invoice';
  return 'invoice';
}

export function addMoney(left: string | null, right: string | null): string {
  return money.toString(money.add(decimalOf(left ?? '0'), decimalOf(right ?? '0')));
}

export function importeOf(subtotal: string | null, tax: string | null, surcharge: string | null): string | null {
  if (subtotal == null || tax == null || surcharge == null) return null;
  return money.toString(money.add(money.add(decimalOf(subtotal), decimalOf(tax)), decimalOf(surcharge)));
}

import { Decimal } from 'decimal.js';
import { domainError } from '../errors';
import { money } from '../money';
import { businessDate } from '../time';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TARGETS = ['billing.invoice', 'purchasing.supplier_invoice', 'legacy.open_item'] as const;
export type TargetTable = (typeof TARGETS)[number];

export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '>90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const CASH_PROFESSIONAL_LIMIT = money.fromString('1000.00');

export function objectOf(value: unknown, field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'El cuerpo debe ser un objeto' });
  }
  return value as Record<string, unknown>;
}

export function pick(body: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (body[name] !== undefined) return body[name];
  }
  return undefined;
}

export function requiredText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') {
    throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw domainError('WC_VALIDATION', { [field]: `Debe tener entre ${min} y ${max} caracteres` });
  }
  return text;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Debe ser texto' });
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) throw domainError('WC_VALIDATION', { [field]: `Debe tener como máximo ${max} caracteres` });
  return text;
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  }
  return value.toLowerCase();
}

export function pathUuid(value: string): string {
  if (!UUID.test(value)) throw domainError('WC_NOT_FOUND');
  return value.toLowerCase();
}

export function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'La fecha debe ser AAAA-MM-DD' });
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw domainError('WC_VALIDATION', { [field]: 'La fecha no existe' });
  }
  return value;
}

export function assertNotFuture(date: string, field: string, today = businessDate(new Date())): void {
  if (date > today) {
    throw domainError('WC_VALIDATION', { [field]: 'La fecha valor no puede ser futura' });
  }
}

export function assertNotPast(date: string, field: string, today = businessDate(new Date())): void {
  if (date < today) {
    throw domainError('WC_VALIDATION', { [field]: 'La fecha no puede ser anterior a hoy' });
  }
}

export function parseAmount(value: unknown, field: string): Decimal {
  let text: string | null = null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(',', '.');
    if (/^\d+(\.\d{1,2})?$/.test(trimmed)) text = new Decimal(trimmed).toFixed(2);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const dec = new Decimal(value);
    if (dec.gte(0) && dec.decimalPlaces() <= 2 && dec.eq(dec.toDecimalPlaces(2))) text = dec.toFixed(2);
  }
  if (!text) {
    throw domainError('WC_VALIDATION', { [field]: 'El importe debe ser positivo con hasta 2 decimales' });
  }
  const amount = money.fromString(text);
  if (!amount.gt(0)) {
    throw domainError('WC_VALIDATION', { [field]: 'El importe debe ser mayor que cero' });
  }
  if (amount.gte(new Decimal('1000000000000'))) {
    throw domainError('WC_VALIDATION', { [field]: 'El importe supera el máximo' });
  }
  return amount;
}

export function decimalOf(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'bigint') return new Decimal(value.toString());
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  if (typeof value === 'string' && value.trim() !== '') return new Decimal(value.trim());
  throw new Error('Importe no numérico');
}

export function moneyText(value: Decimal): string {
  return money.toString(value);
}

export function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] ?? null;
}

export function textOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function daysBetween(later: string, earlier: string): number {
  const end = Date.parse(`${later}T00:00:00Z`);
  const start = Date.parse(`${earlier}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function ageingOf(dueDate: string | null, issueDate: string, today: string): {
  bucket: AgingBucket;
  days: number;
  isOverdue: boolean;
} {
  const raw = daysBetween(today, dueDate ?? issueDate);
  const days = Math.max(0, raw);
  const bucket: AgingBucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '>90';
  return { bucket, days, isOverdue: dueDate !== null && dueDate < today };
}

export function isAgingBucket(value: string): value is AgingBucket {
  return (AGING_BUCKETS as readonly string[]).includes(value) || value === 'over_90';
}

export function normalizeAging(value: string): AgingBucket {
  if (value === 'over_90' || value === '>90') return '>90';
  if (value === '0-30' || value === '31-60' || value === '61-90') return value;
  throw domainError('WC_VALIDATION', { aging: 'Usa 0-30, 31-60, 61-90 o >90' });
}

/**
 * WC100 si la suma imputada supera el pago o el pendiente.
 * WC101 si el documento no está en un estado cobrable o pagable.
 * El orden es el de finance.refresh_document_payment.
 */
export function allocationError(input: {
  paymentAmount: Decimal;
  alreadyAllocated: Decimal;
  adding: Decimal;
  payable: boolean;
  outstanding: Decimal;
}): 'WC100' | 'WC101' | null {
  if (input.alreadyAllocated.plus(input.adding).gt(input.paymentAmount)) return 'WC100';
  if (!input.payable) return 'WC101';
  if (input.adding.gt(input.outstanding)) return 'WC100';
  return null;
}

export function raiseAllocation(code: 'WC100' | 'WC101', details?: Record<string, unknown>): never {
  throw domainError(code, undefined, details);
}

export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

export function compact(value: string): string {
  return fold(value).replace(/\s+/g, ' ').trim();
}

export function isTargetTable(value: string): value is TargetTable {
  return (TARGETS as readonly string[]).includes(value);
}

export function todayMadrid(now = new Date()): string {
  return businessDate(now);
}

import { Decimal } from 'decimal.js';
import { money } from '../money';
import { domainError } from '../errors';

const KG = /^(?:0|[1-9]\d{0,7})(?:\.(\d{1,3}))?$/;
const AREA = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/;
const MEASURE = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/;

export interface Kilograms {
  kg: string;
  grams: number;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function parseKg(value: unknown, field: string): Kilograms {
  const text = asText(value);
  if (text === null || !KG.test(text)) {
    throw domainError('WC_VALIDATION', { [field]: 'Kilos con hasta 3 decimales' });
  }
  const [whole, frac = ''] = text.split('.');
  if (whole === undefined) {
    throw domainError('WC_VALIDATION', { [field]: 'Kilos con hasta 3 decimales' });
  }
  const grams = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  if (!Number.isSafeInteger(grams)) {
    throw domainError('WC_VALIDATION', { [field]: 'Los kilos no caben en gramos enteros' });
  }
  return { kg: `${whole}.${frac.padEnd(3, '0')}`, grams };
}

export function formatKg(grams: number): string {
  const sign = grams < 0 ? '-' : '';
  const abs = Math.abs(grams);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

export function parseArea(value: unknown, field: string): string {
  const text = asText(value);
  if (text === null || !AREA.test(text)) {
    throw domainError('WC_VALIDATION', { [field]: 'Hectáreas con hasta 4 decimales' });
  }
  const area = decimalOf(text, field);
  if (area.lte(0)) throw domainError('WC_VALIDATION', { [field]: 'La superficie tiene que ser mayor que cero' });
  return area.toDecimalPlaces(4).toFixed(4);
}

export function formatArea(value: string): string {
  return decimalOf(value, 'area_ha').toDecimalPlaces(4).toFixed(4);
}

export function parseMeasure(value: unknown, field: string, max: number): string {
  const text = asText(value);
  if (text === null || !MEASURE.test(text)) {
    throw domainError('WC_VALIDATION', { [field]: 'Número con hasta 2 decimales' });
  }
  const measure = decimalOf(text, field);
  if (measure.lt(0) || measure.gt(max)) {
    throw domainError('WC_VALIDATION', { [field]: `Tiene que estar entre 0 y ${max}` });
  }
  return measure.toDecimalPlaces(2).toFixed(2);
}

export function yieldKgPerHa(netKg: string, areaHa: string): string {
  const kg = decimalOf(netKg, 'net_kg');
  const hectares = decimalOf(areaHa, 'area_ha');
  if (hectares.lte(0)) throw domainError('WC_VALIDATION', { area_ha: 'La superficie tiene que ser mayor que cero' });
  return kg.div(hectares).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}

export function parseSigned1(value: unknown, field: string, min: number, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^-?(?:0|[1-9]\d{0,2})(?:\.\d)?$/.test(text)) {
    throw domainError('WC_VALIDATION', { [field]: 'Un decimal como máximo' });
  }
  const parsed = decimalOf(text, field);
  if (parsed.lt(min) || parsed.gt(max)) {
    throw domainError('WC_VALIDATION', { [field]: `Tiene que estar entre ${min} y ${max}` });
  }
  return parsed.toDecimalPlaces(1).toFixed(1);
}

export function areaExceeds(sumHa: string, parcelHa: string): boolean {
  return decimalOf(sumHa, 'area_ha').gt(decimalOf(parcelHa, 'area_ha'));
}

export function addAreas(values: readonly string[]): string {
  let total = money.fromString('0');
  for (const value of values) total = money.add(total, decimalOf(value, 'area_ha'));
  return total.toDecimalPlaces(4).toFixed(4);
}

function decimalOf(value: string, field: string): Decimal {
  try {
    return money.fromString(value);
  } catch {
    throw domainError('WC_VALIDATION', { [field]: 'Número no válido' });
  }
}

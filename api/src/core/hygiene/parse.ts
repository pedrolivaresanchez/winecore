import { money } from '../money';
import { businessDate } from '../time';
import { isBusinessDate, isInstant } from '../inventory/periods';
import {
  invalid,
  jsonObject,
  optionalText,
  requireText,
} from '../cellar/service/http';
import { APPLICABLE_CLASSES } from './constants';

const CLASS_SET = new Set<string>(APPLICABLE_CLASSES);

export function parseDecimal3(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid({ [field]: 'Debe ser un decimal en texto' });
  }
  let parsed: ReturnType<typeof money.fromString>;
  try {
    parsed = money.fromString(value.trim());
  } catch {
    invalid({ [field]: 'Decimal no válido' });
  }
  if (parsed.decimalPlaces() > 3) invalid({ [field]: 'Como máximo 3 decimales' });
  if (!parsed.gt(0)) invalid({ [field]: 'Debe ser mayor que cero' });
  return parsed.toFixed(3);
}

export function decimalOut(value: unknown): string {
  return money.fromString(String(value)).toFixed(3);
}

export function parseClasses(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid({ [field]: 'Indica al menos una clase de recipiente o equipo' });
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !CLASS_SET.has(item)) {
      invalid({ [field]: 'Hay una clase que no existe' });
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export function classesOf(value: unknown): string[] {
  const parsed = jsonObject(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

export function parseInstant(value: unknown, field: string): string {
  const text = requireText(value, field, 40);
  if (!isInstant(text)) invalid({ [field]: 'Debe ser un instante con zona horaria' });
  if (businessDate(new Date(text)) > businessDate(new Date())) {
    invalid({ [field]: 'La fecha no puede ser futura' });
  }
  return text;
}

export function parseDay(value: unknown, field: string): string {
  const text = requireText(value, field, 10);
  if (!isBusinessDate(text)) invalid({ [field]: 'Debe ser una fecha YYYY-MM-DD' });
  return text;
}

export function optionalDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return parseDay(value, field);
}

export function positiveUnits(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
    invalid({ [field]: 'Debe ser un entero entre 1 y 1000000' });
  }
  return value;
}

export function nonNegativeUnits(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    invalid({ [field]: 'Debe ser un entero entre 0 y 1000000' });
  }
  return value;
}

export function contactMinutes(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 10_080) {
    invalid({ [field]: 'Debe ser un entero de minutos mayor que cero' });
  }
  return value;
}

export function dayOf(value: unknown): string {
  return String(value).slice(0, 10);
}

export function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

export function flagOf(value: unknown): boolean {
  return value === true;
}

export function noteOf(value: unknown, field: string, max = 500): string | null {
  return optionalText(value, field, max);
}

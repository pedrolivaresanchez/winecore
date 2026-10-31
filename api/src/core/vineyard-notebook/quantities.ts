import { money } from '../money';
import { FieldBag } from '../catalog/fields';

const DECIMAL = /^\d+(\.\d+)?$/;

export function parseQuantity(
  value: unknown,
  field: string,
  errors: FieldBag,
  scale: number,
  max: string,
): string | null {
  if (typeof value !== 'string') {
    errors.add(field, 'Debe ser una cadena decimal');
    return null;
  }
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) {
    errors.add(field, 'Cantidad no válida');
    return null;
  }
  const fraction = trimmed.split('.')[1];
  if (fraction && fraction.length > scale) {
    errors.add(field, `Máximo ${scale} decimales`);
    return null;
  }
  try {
    const parsed = money.fromString(trimmed);
    if (!parsed.isFinite() || parsed.lte(0)) {
      errors.add(field, 'Debe ser mayor que 0');
      return null;
    }
    if (parsed.gt(money.fromString(max))) {
      errors.add(field, `No puede ser mayor que ${max}`);
      return null;
    }
    return parsed.toDecimalPlaces(scale).toFixed(scale);
  } catch {
    errors.add(field, 'Cantidad no válida');
    return null;
  }
}

export function multiplyQuantity(left: string, right: string, scale: number): string {
  return money.mul(money.fromString(left), money.fromString(right)).toDecimalPlaces(scale).toFixed(scale);
}

export function greaterThan(left: string, right: string): boolean {
  return money.fromString(left).gt(money.fromString(right));
}

export function decimalText(value: unknown, scale: number): string {
  const text = decimalSource(value);
  return money.fromString(text).toDecimalPlaces(scale).toFixed(scale);
}

function decimalSource(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cantidad no finita');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && 'toString' in value) {
    const text = String(value);
    if (text !== '[object Object]') return text;
  }
  throw new Error('Cantidad no legible');
}

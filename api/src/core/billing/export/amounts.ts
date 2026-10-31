import { Decimal } from 'decimal.js';
import { money } from '../../money';
import type { ExportLine } from './types';

export function lineAmount(line: ExportLine): Decimal | null {
  if (line.line_base != null) {
    const base = strictDecimal(line.line_base);
    return base ? money.round2(base) : null;
  }
  if (line.unit_price == null) return null;
  const quantity = strictDecimal(line.quantity);
  const price = strictDecimal(line.unit_price);
  if (!quantity || !price) return null;
  const discount = strictDecimal(line.discount_pct ?? '0') ?? new Decimal(0);
  if (discount.lt(0) || discount.gt(100)) return null;
  const factor = new Decimal(1).minus(discount.div(100));
  return money.round2(quantity.mul(price).mul(factor));
}

export function lineQuantity(line: ExportLine): Decimal | null {
  const quantity = strictDecimal(line.quantity);
  if (!quantity || !quantity.gt(0)) return null;
  return quantity;
}

export function quantityText(value: Decimal): string {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
}

export function kilograms(quantity: Decimal, grams: number): Decimal {
  return quantity.mul(grams).div(1000).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function weightKg(line: ExportLine, kind: 'net' | 'gross'): string | null {
  const grams = kind === 'net' ? line.unit_net_weight_g : line.unit_gross_weight_g;
  const quantity = lineQuantity(line);
  if (grams == null || quantity == null || !Number.isInteger(grams) || grams < 1) return null;
  return kilograms(quantity, grams).toFixed(3);
}

function strictDecimal(value: string): Decimal | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

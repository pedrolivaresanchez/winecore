import { Decimal } from 'decimal.js';
import { money } from '../money';
import { moneyText } from './db';

/** Base de línea: round_half_up(cantidad × precio × (1 − dto/100), 2). */
export function lineBase(quantity: Decimal, unitPrice: Decimal, discountPct: Decimal): Decimal {
  const factor = new Decimal(1).minus(discountPct.div(100));
  return money.round2(quantity.mul(unitPrice).mul(factor));
}

export function taxQuota(base: Decimal, rate: Decimal): Decimal {
  return money.round2(base.mul(rate).div(100));
}

export type PricedLine = {
  quantity: Decimal;
  unitPrice: Decimal;
  discountPct: Decimal;
  taxCode: string;
  taxRate: Decimal;
};

export type Totals = {
  subtotal: string;
  tax_total: string;
  total: string;
  lines: { line_base: string }[];
};

export function priceTotals(lines: readonly PricedLine[]): Totals {
  const bases = lines.map((line) => lineBase(line.quantity, line.unitPrice, line.discountPct));
  const byTax = new Map<string, { base: Decimal; rate: Decimal }>();
  lines.forEach((line, index) => {
    const base = bases[index] ?? new Decimal(0);
    const current = byTax.get(line.taxCode);
    if (current) current.base = money.add(current.base, base);
    else byTax.set(line.taxCode, { base, rate: line.taxRate });
  });
  let tax = new Decimal(0);
  for (const group of byTax.values()) {
    tax = money.add(tax, taxQuota(group.base, group.rate));
  }
  const subtotal = bases.reduce((acc, value) => money.add(acc, value), new Decimal(0));
  return {
    subtotal: moneyText(subtotal),
    tax_total: moneyText(tax),
    total: moneyText(money.add(subtotal, tax)),
    lines: bases.map((base) => ({ line_base: moneyText(base) })),
  };
}

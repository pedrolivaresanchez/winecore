import { money } from '../money';

/** Importes del borrador: cadenas con dos decimales y redondeo HALF_UP. */
export function norm(value: string): string {
  return money.toString(money.fromString(value));
}

export function sum(values: readonly string[]): string {
  let total = money.fromString('0');
  for (const value of values) total = money.add(total, money.fromString(value));
  return money.toString(total);
}

export function sub(left: string, right: string): string {
  return money.toString(money.sub(money.fromString(left), money.fromString(right)));
}

export function same(left: string, right: string): boolean {
  return money.fromString(left).eq(money.fromString(right));
}

export function gt(left: string, right: string): boolean {
  return money.fromString(left).gt(money.fromString(right));
}

export function abs(value: string): string {
  return money.toString(money.fromString(value).abs());
}

export function nonzero(value: string): boolean {
  return !same(norm(value), '0.00');
}

/** Cuota = round(base × tipo / 100, 2) HALF_UP. */
export function percent(base: string, rate: string): string {
  const raw = money.fromString(base).times(money.fromString(rate)).div(100);
  return money.toString(money.round2(raw));
}

import { Decimal } from 'decimal.js';

/**
 * Arithmetic uses this constructor only. The global Decimal config stays untouched
 * (default precision 20), so other modules are unaffected.
 * Precision 40 keeps a numeric(14,3) × numeric(14,6) × discount factor exact
 * until round2 applies ROUND_HALF_UP at two decimal places.
 */
const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

function decimal(value: Decimal, name: string): Decimal {
  if (!(value instanceof Decimal)) {
    throw new TypeError(`${name} debe ser Decimal`);
  }
  return new MoneyDecimal(value);
}

export const money = {
  add(left: Decimal, right: Decimal): Decimal {
    return decimal(left, 'left').plus(decimal(right, 'right'));
  },
  sub(left: Decimal, right: Decimal): Decimal {
    return decimal(left, 'left').minus(decimal(right, 'right'));
  },
  mul(left: Decimal, right: Decimal): Decimal {
    return decimal(left, 'left').times(decimal(right, 'right'));
  },
  round2(value: Decimal): Decimal {
    return decimal(value, 'value').toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
  },
  fromString(value: string): Decimal {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError('El importe debe ser una cadena');
    }
    try {
      const parsed = new MoneyDecimal(value);
      if (!parsed.isFinite()) throw new Error('non-finite');
      return parsed;
    } catch {
      throw new TypeError('Importe no válido');
    }
  },
  toString(value: Decimal): string {
    return decimal(value, 'value').toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
  },
};

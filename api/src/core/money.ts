import { Decimal } from 'decimal.js';

const ROUND = Decimal.ROUND_HALF_UP;

function decimal(value: Decimal, name: string): Decimal {
  if (!(value instanceof Decimal)) {
    throw new TypeError(`${name} debe ser Decimal`);
  }
  return value;
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
    return decimal(value, 'value').toDecimalPlaces(2, ROUND);
  },
  fromString(value: string): Decimal {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError('El importe debe ser una cadena');
    }
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) throw new Error('non-finite');
      return parsed;
    } catch {
      throw new TypeError('Importe no válido');
    }
  },
  toString(value: Decimal): string {
    return decimal(value, 'value').toDecimalPlaces(2, ROUND).toFixed(2);
  },
};

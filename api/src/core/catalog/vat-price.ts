import { Decimal } from 'decimal.js';

const HALF_UP = Decimal.ROUND_HALF_UP;

/**
 * PVP con IVA incluido → base del documento.
 * 25,00 € al 21 % → 20,66 de base. El IVA es lo que falta para volver al PVP (4,34).
 */
export function grossToBase(gross: Decimal | string, ratePct = '21'): Decimal {
  const price = new Decimal(gross);
  const rate = new Decimal(ratePct);
  if (price.isNeg() || rate.isNeg()) throw new Error('El precio y el tipo no pueden ser negativos');
  const divisor = new Decimal(1).plus(rate.div(100));
  return price.div(divisor).toDecimalPlaces(2, HALF_UP);
}

export function vatOnBase(base: Decimal, ratePct = '21'): Decimal {
  return base.mul(new Decimal(ratePct).div(100)).toDecimalPlaces(2, HALF_UP);
}

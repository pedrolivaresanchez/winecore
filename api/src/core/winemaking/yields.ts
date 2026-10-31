import { money } from '../money';

/** Temperatura de estabilización por frío: −(grado/2 + 1) °C. 13 % vol → −7,5. */
export function coldStabilisationTargetC(abvPct: string): string {
  return money.fromString(abvPct)
    .div(money.fromString('2'))
    .plus(money.fromString('1'))
    .negated()
    .toDecimalPlaces(1)
    .toFixed(1);
}

/** Litros de mosto por 100 kg de uva, con 3 decimales. */
export function litresPer100Kg(mustMl: number, grapeG: number): string {
  return money
    .fromString(String(mustMl))
    .mul(money.fromString('100'))
    .div(money.fromString(String(grapeG)))
    .toDecimalPlaces(3)
    .toFixed(3);
}

/** Cociente con 3 decimales (masa de orujo / masa de uva, o volumen de mosto). */
export function ratio3(numerator: number, denominator: number): string {
  return money
    .fromString(String(numerator))
    .div(money.fromString(String(denominator)))
    .toDecimalPlaces(3)
    .toFixed(3);
}

/** Gramos de orujo por litro de mosto de entrada. */
export function gramsPerLitre(massG: number, volumeMl: number): string {
  return money
    .fromString(String(massG))
    .mul(money.fromString('1000'))
    .div(money.fromString(String(volumeMl)))
    .toDecimalPlaces(3)
    .toFixed(3);
}

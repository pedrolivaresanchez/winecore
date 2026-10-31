import { Decimal } from "decimal.js";

/** Litros con 3 decimales a partir de mililitros enteros. */
export function mlToLitres(ml: number): string {
  return new Decimal(ml).div(1000).toFixed(3);
}

/** Hectolitros con 3 decimales a partir de mililitros enteros. */
export function mlToHl(ml: number): string {
  return new Decimal(ml).div(100_000).toFixed(3);
}

/** Media de hectolitros. `parts` es el número de campañas. */
export function averageHl(totalMl: number, parts: number): string {
  return new Decimal(totalMl).div(parts).div(100_000).toFixed(3);
}

/** Kilogramos con 3 decimales a partir de gramos enteros. */
export function gToKg(grams: number): string {
  return new Decimal(grams).div(1000).toFixed(3);
}

export function addMl(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("el volumen se sale del rango");
  }
  return sum;
}

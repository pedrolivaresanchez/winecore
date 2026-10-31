import { Decimal } from 'decimal.js';

/** Cómo se cuenta el material: por botella, por caja o por palé. */
export type MaterialPer = 'unit' | 'case' | 'pallet';

/** Cajas necesarias. Una fracción de caja cuenta como caja entera. */
export function casesFor(units: number, unitsPerCase: number): number {
  return Math.ceil(units / unitsPerCase);
}

/** Palés necesarios. Una fracción de palé (de `casesPerPallet` cajas) cuenta como palé entero. */
export function palletsFor(cases: number, casesPerPallet: number): number {
  return Math.ceil(cases / casesPerPallet);
}

export function basisFor(
  per: MaterialPer,
  units: number,
  unitsPerCase: number,
  casesPerPallet: number,
): number {
  if (per === 'unit') return units;
  const cases = casesFor(units, unitsPerCase);
  if (per === 'case') return cases;
  return palletsFor(cases, casesPerPallet);
}

/**
 * Unidades de material a consumir (`quantity` de la lista × base).
 * Null si el resultado no es un entero positivo que quepa en el stock.
 */
export function consumptionUnits(quantity: Decimal, basis: number): number | null {
  if (!Number.isSafeInteger(basis) || basis <= 0) return null;
  const total = quantity.mul(basis);
  if (!total.isFinite() || !total.isInteger() || total.lte(0)) return null;
  const value = total.toNumber();
  return Number.isSafeInteger(value) ? value : null;
}

export interface GoodsBucket {
  location_id: string;
  qty_units: number;
}

/**
 * Toma `required` unidades. Primero la ubicación del envasado, luego el resto por id.
 * Null si no cubren el total: no se devuelve un consumo parcial.
 */
export function allocateUnits(
  required: number,
  buckets: readonly GoodsBucket[],
  preferredLocationId: string | null,
): { location_id: string; qty_units: number }[] | null {
  if (!Number.isSafeInteger(required) || required <= 0) return null;
  const pools = buckets.filter((row) => row.qty_units > 0).map((row) => ({ ...row }));
  pools.sort((left, right) => {
    const rank = (id: string) => (id === preferredLocationId ? 0 : 1);
    const byPreference = rank(left.location_id) - rank(right.location_id);
    if (byPreference !== 0) return byPreference;
    return left.location_id < right.location_id ? -1 : left.location_id > right.location_id ? 1 : 0;
  });
  let left = required;
  const taken: { location_id: string; qty_units: number }[] = [];
  for (const pool of pools) {
    if (left === 0) break;
    const qty = Math.min(pool.qty_units, left);
    if (!Number.isSafeInteger(qty) || qty <= 0) continue;
    taken.push({ location_id: pool.location_id, qty_units: qty });
    left -= qty;
  }
  return left === 0 ? taken : null;
}

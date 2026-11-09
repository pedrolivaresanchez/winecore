export type PlacementStock = {
  id: string;
  locationId: string;
  lotId: string | null;
  productId: string | null;
  productState: string;
  bottleMl: number | null;
  bottles: number;
  lineNo: number;
  nicheNumber: number | null;
};

export type Allocation = {
  placementId: string;
  units: number;
  volumeMl: number;
};

/**
 * Reparte un delta (negativo = sale) entre los huecos del mismo lote, producto,
 * estado y ubicación. Si no hay hueco, no hace nada: el libro físico sigue su curso.
 * Si el hueco no cubre toda la salida, agota lo que hay y deja el resto solo en el libro.
 */
export function planBottledDelta(rows: readonly PlacementStock[], request: {
  locationId: string;
  lotId: string | null;
  productId: string | null;
  productState: string;
  units: number;
}): Allocation[] {
  if (request.units === 0 || !request.lotId || !request.productId) return [];
  const pool = rows
    .filter((row) =>
      row.locationId === request.locationId
      && row.lotId === request.lotId
      && row.productId === request.productId
      && row.productState === request.productState
      && row.bottleMl != null
      && row.bottleMl > 0)
    .sort((left, right) => (left.nicheNumber ?? 10_000) - (right.nicheNumber ?? 10_000) || left.lineNo - right.lineNo);
  if (pool.length === 0) return [];
  if (request.units > 0) {
    const target = pool[0];
    if (!target?.bottleMl) return [];
    return [{ placementId: target.id, units: request.units, volumeMl: request.units * target.bottleMl }];
  }
  let left = -request.units;
  const planned: Allocation[] = [];
  for (const row of pool) {
    if (left === 0) break;
    if (row.bottles <= 0 || !row.bottleMl) continue;
    const take = Math.min(row.bottles, left);
    planned.push({ placementId: row.id, units: -take, volumeMl: -(take * row.bottleMl) });
    left -= take;
  }
  return planned;
}

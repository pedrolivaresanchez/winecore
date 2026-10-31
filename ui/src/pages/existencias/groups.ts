import type { StockBalance } from "@/pages/existencias/api";

export type StockGroup = {
  id: string;
  code: string;
  name: string;
  volumeMl: number;
  units: number;
  rows: StockBalance[];
};

export function groupBalances(rows: StockBalance[]): StockGroup[] {
  const groups = new Map<string, StockGroup>();
  for (const row of rows) {
    const current = groups.get(row.location_id) ?? {
      id: row.location_id,
      code: row.location_code,
      name: row.location_name,
      volumeMl: 0,
      units: 0,
      rows: [],
    };
    current.volumeMl += row.volume_ml;
    current.units += row.qty_units;
    current.rows.push(row);
    groups.set(row.location_id, current);
  }
  return [...groups.values()];
}

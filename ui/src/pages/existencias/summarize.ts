import type { FiscalBalance, StockBalance } from "@/pages/existencias/api";
import { formatFormatLabel } from "@/pages/existencias/volume";

export type FormatTotal = { nominal: number; units: number; label: string };

export function summarizePhysical(rows: StockBalance[]): { bulkMl: number; formats: FormatTotal[] } {
  let bulkMl = 0;
  const formats = new Map<number, number>();
  for (const row of rows) {
    if (row.product_state === "wine" || row.product_state === "must") bulkMl += row.volume_ml;
    else if (row.nominal_volume_ml && row.qty_units) {
      formats.set(row.nominal_volume_ml, (formats.get(row.nominal_volume_ml) ?? 0) + row.qty_units);
    }
  }
  return {
    bulkMl,
    formats: [...formats.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([nominal, units]) => ({ nominal, units, label: formatFormatLabel(nominal) })),
  };
}

export function summarizeByOwner(rows: StockBalance[]): { code: string; bulkMl: number; units: number }[] {
  const totals = new Map<string, { bulkMl: number; units: number }>()
  for (const row of rows) {
    const code = row.owner_code || "—"
    const current = totals.get(code) ?? { bulkMl: 0, units: 0 }
    if (row.product_state === "wine" || row.product_state === "must") current.bulkMl += row.volume_ml
    current.units += row.qty_units
    totals.set(code, current)
  }
  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "es"))
    .map(([code, total]) => ({ code, ...total }))
}

export function summarizeFiscalByEntity(rows: FiscalBalance[]): { code: string; volumeMl: number; units: number }[] {
  const totals = new Map<string, { volumeMl: number; units: number }>()
  for (const row of rows) {
    const code = row.legal_entity_code || "—"
    const current = totals.get(code) ?? { volumeMl: 0, units: 0 }
    current.volumeMl += row.volume_ml
    current.units += row.units
    totals.set(code, current)
  }
  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "es"))
    .map(([code, total]) => ({ code, ...total }))
}

export function summarizeFiscal(rows: FiscalBalance[]): Record<"bulk" | "bulk_wood" | "packaged", { volumeMl: number; units: number }> {
  const empty = () => ({ volumeMl: 0, units: 0 });
  const totals = { bulk: empty(), bulk_wood: empty(), packaged: empty() };
  for (const row of rows) {
    totals[row.product_class].volumeMl += row.volume_ml;
    totals[row.product_class].units += row.units;
  }
  return totals;
}

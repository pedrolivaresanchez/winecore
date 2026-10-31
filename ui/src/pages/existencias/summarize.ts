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

export function summarizeFiscal(rows: FiscalBalance[]): Record<"bulk" | "bulk_wood" | "packaged", { volumeMl: number; units: number }> {
  const empty = () => ({ volumeMl: 0, units: 0 });
  const totals = { bulk: empty(), bulk_wood: empty(), packaged: empty() };
  for (const row of rows) {
    totals[row.product_class].volumeMl += row.volume_ml;
    totals[row.product_class].units += row.units;
  }
  return totals;
}

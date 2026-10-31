import type { CountLine, FiscalBalance, FiscalMove, InventoryCount, PhysicalMove, StockBalance } from "@/pages/existencias/api";
import { isPackaged, productLabel } from "@/pages/existencias/labels";
import { madridDate } from "@/pages/existencias/time";

function haystack(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLocaleLowerCase("es");
}

function matches(query: string, parts: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLocaleLowerCase("es");
  if (!needle) return true;
  return haystack(parts).includes(needle);
}

export function filterBalances(
  rows: StockBalance[],
  input: { ownerEntityId?: string; locationId?: string; state?: string; q?: string },
): StockBalance[] {
  return rows.filter((row) => {
    if (input.ownerEntityId && row.owner_entity_id !== input.ownerEntityId) return false;
    if (input.locationId && row.location_id !== input.locationId) return false;
    if (input.state && row.product_state !== input.state) return false;
    return matches(input.q ?? "", [row.location_code, row.location_name, row.vessel_code, row.lot_code, row.product_name, row.wine_name, productLabel(row)]);
  });
}

export function filterFiscal(
  rows: FiscalBalance[],
  input: { legalEntityId?: string; q?: string },
): FiscalBalance[] {
  return rows.filter((row) => {
    if (input.legalEntityId && row.legal_entity_id !== input.legalEntityId) return false;
    return matches(input.q ?? "", [row.tax_warehouse_name, row.excise_product_key, row.lot_code, row.product_name, row.wine_name, productLabel(row)]);
  });
}

export function filterPhysicalMoves(
  rows: PhysicalMove[],
  input: { ownerEntityId?: string; from?: string; to?: string; moveType?: string; q?: string },
): PhysicalMove[] {
  return rows.filter((row) => {
    if (input.ownerEntityId && row.owner_entity_id !== input.ownerEntityId) return false;
    if (input.moveType && row.move_type !== input.moveType) return false;
    const day = madridDate(row.occurred_at);
    if (input.from && day < input.from) return false;
    if (input.to && day > input.to) return false;
    return matches(input.q ?? "", [row.document_ref, row.justification_ref, row.lot_code, row.vessel_code, row.location_code, row.product_name, row.wine_name, row.silicie_ref]);
  });
}

export function filterFiscalMoves(
  rows: FiscalMove[],
  input: { legalEntityId?: string; from?: string; to?: string; moveType?: string; q?: string },
): FiscalMove[] {
  return rows.filter((row) => {
    if (input.legalEntityId && row.legal_entity_id !== input.legalEntityId) return false;
    if (input.moveType && row.move_type !== input.moveType) return false;
    const day = row.fiscal_date.slice(0, 10);
    if (input.from && day < input.from) return false;
    if (input.to && day > input.to) return false;
    return matches(input.q ?? "", [row.justification_ref, row.lot_code, row.excise_product_key, row.product_name, row.wine_name, row.silicie_ref, row.tax_warehouse_name]);
  });
}

export function filterCounts(rows: InventoryCount[], input: { legalEntityId?: string; kind?: string; q?: string }): InventoryCount[] {
  return rows.filter((row) => {
    if (input.legalEntityId && row.legal_entity_id !== input.legalEntityId) return false;
    if (input.kind && row.kind !== input.kind) return false;
    return matches(input.q ?? "", [row.number, ...row.location_codes]);
  });
}

export function lineGap(line: Pick<CountLine, "product_state" | "expected_qty_units" | "expected_volume_ml" | "counted_qty_units" | "counted_volume_ml">): number | null {
  if (isPackaged(line.product_state)) {
    if (line.counted_qty_units == null) return null;
    return line.counted_qty_units - line.expected_qty_units;
  }
  if (line.counted_volume_ml == null) return null;
  return line.counted_volume_ml - line.expected_volume_ml;
}

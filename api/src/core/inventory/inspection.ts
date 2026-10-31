import { DomainError } from "../errors";
import { stockAt } from "./balances";
import { resolveBusinessDate } from "./periods";
import { STOCK_GROUP_KEYS, type Balance, type ProductState, type StockMove } from "./types";

export interface InspectionFilters {
  location_id?: string;
  owner_entity_id?: string;
  product_id?: string;
  lot_id?: string;
  product_state?: ProductState;
}

export interface InspectionRow {
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  /** Litres with 3 decimal places, for the screen only. */
  litres: string;
}

export interface InspectionLotGroup {
  lot_id: string | null;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  litres: string;
  lines: InspectionRow[];
}

export interface InspectionLocationGroup {
  location_id: string;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  litres: string;
  lots: InspectionLotGroup[];
}

export interface InspectionProductTotal {
  product_id: string | null;
  qty_units: number;
  volume_ml: number;
}

export interface InspectionTotals {
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  bulk_volume_ml: number;
  bulk_litres: string;
  packaged_units: number;
  packaged_volume_ml: number;
  goods_units: number;
  grape_mass_g: number;
  packaged_by_product: InspectionProductTotal[];
}

export interface InspectionReport {
  at: string;
  business_date: string;
  filters: InspectionFilters;
  rows: InspectionRow[];
  by_location: InspectionLocationGroup[];
  totals: InspectionTotals;
}

function formatLitres(volumeMl: number): string {
  const negative = volumeMl < 0;
  const abs = Math.abs(volumeMl);
  const whole = Math.trunc(abs / 1000);
  const frac = abs % 1000;
  const text = `${whole}.${String(frac).padStart(3, "0")}`;
  return negative ? `-${text}` : text;
}

function matches(move: StockMove, filters: InspectionFilters): boolean {
  if (filters.location_id !== undefined && move.location_id !== filters.location_id) return false;
  if (filters.owner_entity_id !== undefined && move.owner_entity_id !== filters.owner_entity_id) return false;
  if (filters.product_id !== undefined && move.product_id !== filters.product_id) return false;
  if (filters.lot_id !== undefined && move.lot_id !== filters.lot_id) return false;
  if (filters.product_state !== undefined && move.product_state !== filters.product_state) return false;
  return true;
}

function cmp(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

function rowFromBalance(balance: Balance): InspectionRow {
  const locationId = balance.location_id;
  const ownerId = balance.owner_entity_id;
  const state = balance.product_state;
  if (locationId === null || ownerId === null || state === null) {
    throw new DomainError("WC_VALIDATION", 422, "La fila de existencias no tiene ubicación, propietario o estado.");
  }
  return {
    location_id: locationId,
    vessel_id: balance.vessel_id,
    owner_entity_id: ownerId,
    lot_id: balance.lot_id,
    product_id: balance.product_id,
    product_state: state,
    qty_units: balance.qty_units,
    volume_ml: balance.volume_ml,
    mass_g: balance.mass_g,
    litres: formatLitres(balance.volume_ml),
  };
}

function isBulk(state: ProductState): boolean {
  return state === "must" || state === "wine";
}

function isPackaged(state: ProductState): boolean {
  return state === "packaged_unlabeled" || state === "packaged_labeled";
}

/**
 * Rows for the "existencias a fecha" / inspection screen: one line per stock
 * key, nested by location and lot, with bulk litres and packaged units.
 */
export function inspectionReport(
  moves: readonly StockMove[],
  at: string,
  filters: InspectionFilters = {},
): InspectionReport {
  const selected = moves.filter((move) => matches(move, filters));
  const rows = stockAt(selected, at, STOCK_GROUP_KEYS).map(rowFromBalance);
  rows.sort(
    (left, right) =>
      cmp(left.location_id, right.location_id) ||
      cmp(left.lot_id, right.lot_id) ||
      cmp(left.vessel_id, right.vessel_id) ||
      cmp(left.owner_entity_id, right.owner_entity_id) ||
      cmp(left.product_state, right.product_state) ||
      cmp(left.product_id, right.product_id),
  );
  const byLocation = new Map<string, InspectionLocationGroup>();
  for (const row of rows) {
    let location = byLocation.get(row.location_id);
    if (!location) {
      location = {
        location_id: row.location_id,
        qty_units: 0,
        volume_ml: 0,
        mass_g: 0,
        litres: "0.000",
        lots: [],
      };
      byLocation.set(row.location_id, location);
    }
    const lotKey = row.lot_id ?? "";
    let lot = location.lots.find((item) => (item.lot_id ?? "") === lotKey);
    if (!lot) {
      lot = {
        lot_id: row.lot_id,
        qty_units: 0,
        volume_ml: 0,
        mass_g: 0,
        litres: "0.000",
        lines: [],
      };
      location.lots.push(lot);
    }
    lot.lines.push(row);
    lot.qty_units += row.qty_units;
    lot.volume_ml += row.volume_ml;
    lot.mass_g += row.mass_g;
    location.qty_units += row.qty_units;
    location.volume_ml += row.volume_ml;
    location.mass_g += row.mass_g;
  }
  const by_location = [...byLocation.values()];
  for (const location of by_location) {
    location.litres = formatLitres(location.volume_ml);
    for (const lot of location.lots) lot.litres = formatLitres(lot.volume_ml);
  }

  const packaged = new Map<string, InspectionProductTotal>();
  const totals: InspectionTotals = {
    qty_units: 0,
    volume_ml: 0,
    mass_g: 0,
    bulk_volume_ml: 0,
    bulk_litres: "0.000",
    packaged_units: 0,
    packaged_volume_ml: 0,
    goods_units: 0,
    grape_mass_g: 0,
    packaged_by_product: [],
  };
  for (const row of rows) {
    totals.qty_units += row.qty_units;
    totals.volume_ml += row.volume_ml;
    totals.mass_g += row.mass_g;
    if (isBulk(row.product_state)) totals.bulk_volume_ml += row.volume_ml;
    if (isPackaged(row.product_state)) {
      totals.packaged_units += row.qty_units;
      totals.packaged_volume_ml += row.volume_ml;
      const productKey = row.product_id ?? "";
      const current = packaged.get(productKey) ?? {
        product_id: row.product_id,
        qty_units: 0,
        volume_ml: 0,
      };
      current.qty_units += row.qty_units;
      current.volume_ml += row.volume_ml;
      packaged.set(productKey, current);
    }
    if (row.product_state === "goods") totals.goods_units += row.qty_units;
    if (row.product_state === "grape") totals.grape_mass_g += row.mass_g;
  }
  totals.bulk_litres = formatLitres(totals.bulk_volume_ml);
  totals.packaged_by_product = [...packaged.values()].sort((left, right) => {
    if (left.product_id === right.product_id) return 0;
    if (left.product_id === null) return -1;
    if (right.product_id === null) return 1;
    return left.product_id < right.product_id ? -1 : 1;
  });

  return {
    at,
    business_date: resolveBusinessDate(at),
    filters: { ...filters },
    rows,
    by_location,
    totals,
  };
}

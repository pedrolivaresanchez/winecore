import { DomainError } from "../../src/core/errors";
import {
  isFiscalMove,
  isStockMove,
  type AdjustmentDraft,
  type CountLine,
  type CountPlanContext,
  type FiscalMove,
  type OpeningCountContext,
  type PeriodLock,
  type StockMove,
} from "../../src/core/inventory/types";

/** Synthetic ids only. Hex, so they cannot look like a personal id or a phone. */
export function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const PO = id(1);
export const CVPO = id(2);
export const BOD = id(0x10);
export const VLC = id(0x11);
export const WH = id(0x20);
export const V1 = id(0x30);
export const V2 = id(0x31);
export const V3 = id(0x32);
export const LOT1 = id(0x40);
export const LOT2 = id(0x41);
export const PROD = id(0x50);
export const PROD2 = id(0x51);
export const COUNT_ID = id(0x60);

export function stockMove(overrides: Partial<StockMove> = {}): StockMove {
  return {
    occurred_at: "2027-06-01T10:00:00Z",
    move_type: "cellar_in",
    location_id: BOD,
    vessel_id: V1,
    owner_entity_id: PO,
    lot_id: LOT1,
    product_id: null,
    product_state: "wine",
    qty_units: 0,
    volume_ml: 0,
    mass_g: 0,
    loss_kind: null,
    source_table: "cellar.operation",
    source_id: id(0x70),
    source_line_id: null,
    reverses_move_id: null,
    created_by: "tester",
    ...overrides,
  };
}

export function fiscalMove(overrides: Partial<FiscalMove> = {}): FiscalMove {
  return {
    tax_warehouse_id: WH,
    fiscal_date: "2027-06-01",
    physical_date: null,
    move_type: "opening",
    product_class: "bulk",
    lot_id: LOT1,
    product_id: null,
    volume_ml: 1_000,
    units: 0,
    abv_pct: null,
    excise_product_key: "GRANEL-TINTO",
    nc_code: null,
    justification_type: "count_record",
    justification_ref: "AF-2027-01",
    counterparty_contact_id: null,
    counterparty_excise_number: null,
    fiscal_trigger: "count",
    source_table: "inventory.inventory_count",
    source_id: COUNT_ID,
    source_line_id: null,
    silicie_entry_id: null,
    reverses_move_id: null,
    reason: null,
    created_by: "tester",
    ...overrides,
  };
}

export function countLine(overrides: Partial<CountLine> = {}): CountLine {
  return {
    id: id(0x80),
    location_id: BOD,
    vessel_id: V1,
    owner_entity_id: PO,
    lot_id: LOT1,
    product_id: null,
    product_state: "wine",
    expected_qty_units: 0,
    expected_volume_ml: 0,
    counted_qty_units: 0,
    counted_volume_ml: 0,
    method: "dipstick",
    difference_reason: null,
    photo_attachment_id: null,
    ...overrides,
  };
}

export function physicalCtx(overrides: Partial<CountPlanContext> = {}): CountPlanContext {
  return {
    ledger: "physical",
    count_id: COUNT_ID,
    count_number: "AF-2027-01",
    counted_at: "2027-06-20T18:00:00+02:00",
    fiscal_date: "2027-06-20",
    created_by: "tester",
    ...overrides,
  };
}

export function fiscalCtx(overrides: Partial<CountPlanContext> = {}): CountPlanContext {
  return physicalCtx({ ledger: "fiscal", ...overrides });
}

export function openingCtx(overrides: Partial<OpeningCountContext> = {}): OpeningCountContext {
  return {
    count_id: COUNT_ID,
    count_number: "AF-2026-12",
    as_of: "2027-01-01T00:00:00+01:00",
    fiscal_date: "2027-01-01",
    physical_date: "2026-12-31",
    created_by: "tester",
    ...overrides,
  };
}

export function lock(until: string, ledger: "physical" | "fiscal" = "physical"): PeriodLock {
  return {
    ledger,
    locked_until: until,
    locked_by: "tester",
    locked_at: "2027-02-01T09:00:00+01:00",
    reason: "cierre de periodo",
  };
}

export function catchDomain(run: () => void): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error("se esperaba un DomainError");
}

export function stockDrafts(drafts: readonly AdjustmentDraft[]): StockMove[] {
  return drafts.map((draft) => {
    if (!isStockMove(draft.move)) throw new Error("se esperaba un movimiento físico");
    return draft.move;
  });
}

export function fiscalDrafts(drafts: readonly AdjustmentDraft[]): FiscalMove[] {
  return drafts.map((draft) => {
    if (!isFiscalMove(draft.move)) throw new Error("se esperaba un movimiento fiscal");
    return draft.move;
  });
}

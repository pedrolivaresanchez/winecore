/**
 * Pure inventory types. Column names match docs/02-ddl/0007_ledgers.sql
 * (`inventory.stock_move`, `inventory.fiscal_move`, `inventory.period_lock`,
 * `inventory.inventory_count_line`). Quantities are safe integers: millilitres,
 * units and grams — never decimal litres. Instants are ISO-8601 strings with a
 * zone; business dates are `YYYY-MM-DD`. No clock is read here.
 * Domain errors are `DomainError` from `../errors`.
 */

export type IsoDate = string;
export type IsoDateTime = string;

export type PhysicalMoveType =
  | "opening"
  | "cellar_in"
  | "cellar_out"
  | "loss"
  | "delivery_out"
  | "transfer_in"
  | "return_in"
  | "ownership_out"
  | "ownership_in"
  | "purchase_in"
  | "count_adjust_in"
  | "count_adjust_out"
  | "reversal";

export type FiscalMoveType =
  | "opening"
  | "production"
  | "bulk_receipt"
  | "packaging_out_bulk"
  | "packaging_in_packaged"
  | "loss"
  | "destruction"
  | "exit_domestic"
  | "exit_export"
  | "exit_intra_eu"
  | "exit_canary"
  | "ledger_change_out"
  | "ledger_change_in"
  | "return_in"
  | "regularization_in"
  | "regularization_out"
  | "reversal";

export type ProductState =
  | "grape"
  | "must"
  | "wine"
  | "packaged_unlabeled"
  | "packaged_labeled"
  | "goods";

/** States allowed on `inventory.inventory_count_line`. */
export type CountProductState = Exclude<ProductState, "grape">;

export type ProductClass = "bulk" | "bulk_wood" | "packaged";

export type LossKind = "authorized" | "incident";

export type CountMethod =
  | "dipstick"
  | "flowmeter"
  | "level_gauge"
  | "unit_count"
  | "weight"
  | "estimate";

export type JustificationType =
  | "invoice"
  | "delivery_note"
  | "e_ad"
  | "customs_declaration"
  | "internal"
  | "count_record";

export type FiscalTrigger = "invoice" | "delivery_note" | "operation" | "count" | "manual";

export type LedgerName = "physical" | "fiscal";

/** Physical balance dimensions. `product` is `product_id`. */
export type StockGroupKey =
  | "location"
  | "vessel"
  | "owner_entity"
  | "lot"
  | "product_state"
  | "product";

/** Fiscal balance key (D2): establishment, SILICIE ledger class, excise reference. */
export type FiscalLedgerKey = "tax_warehouse" | "product_class" | "excise_product_key";

export const STOCK_GROUP_KEYS = [
  "location",
  "vessel",
  "owner_entity",
  "lot",
  "product_state",
  "product",
] as const satisfies readonly StockGroupKey[];

export const FISCAL_LEDGER_KEYS = [
  "tax_warehouse",
  "product_class",
  "excise_product_key",
] as const satisfies readonly FiscalLedgerKey[];

export interface StockMove {
  id?: string;
  occurred_at: IsoDateTime;
  move_type: PhysicalMoveType;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState;
  /** Integer units. Outflows are negative. */
  qty_units: number;
  /** Integer millilitres. Outflows are negative. */
  volume_ml: number;
  /** Integer grams. Outflows are negative. */
  mass_g: number;
  loss_kind: LossKind | null;
  source_table: string;
  source_id: string;
  source_line_id: string | null;
  reverses_move_id: string | null;
  created_by: string;
  created_at?: IsoDateTime;
}

export interface FiscalMove {
  id?: string;
  tax_warehouse_id: string;
  fiscal_date: IsoDate;
  physical_date: IsoDate | null;
  move_type: FiscalMoveType;
  product_class: ProductClass;
  lot_id: string | null;
  product_id: string | null;
  /** Integer millilitres. Outflows are negative. Never zero. */
  volume_ml: number;
  /** Integer units. Outflows are negative. */
  units: number;
  /** Decimal string with up to 2 places, or null. Range 0–25. */
  abv_pct: string | null;
  excise_product_key: string | null;
  nc_code: string | null;
  justification_type: JustificationType;
  justification_ref: string;
  counterparty_contact_id: string | null;
  counterparty_excise_number: string | null;
  fiscal_trigger: FiscalTrigger;
  source_table: string;
  source_id: string;
  source_line_id: string | null;
  silicie_entry_id: string | null;
  reverses_move_id: string | null;
  reason: string | null;
  created_by: string;
  created_at?: IsoDateTime;
}

/**
 * Physical balance. Dimensions that were not requested in `groupBy` are null.
 * A grouped dimension whose value is null (no vessel, no lot) is also null.
 */
export interface Balance {
  location_id: string | null;
  vessel_id: string | null;
  owner_entity_id: string | null;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState | null;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
}

/** Fiscal balance. Dimensions omitted from `ledgerKey` are null. */
export interface FiscalBalance {
  tax_warehouse_id: string | null;
  product_class: ProductClass | null;
  excise_product_key: string | null;
  volume_ml: number;
  units: number;
}

export interface NegativeBalance {
  code: "WC024" | "WC027";
  message: string;
  /** Index of the causing move in the input array, before sorting. */
  move_index: number;
  at: string;
  location_id: string | null;
  vessel_id: string | null;
  owner_entity_id: string | null;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState | null;
  tax_warehouse_id: string | null;
  product_class: ProductClass | null;
  excise_product_key: string | null;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  units: number;
}

/**
 * One line of `inventory.inventory_count_line`, plus the fiscal classification
 * the ledger needs (the count table does not store it). `expected_*` is ignored
 * by the planner: the book argument is the expected position.
 */
export interface CountLine {
  id: string;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: CountProductState;
  expected_qty_units: number;
  expected_volume_ml: number;
  counted_qty_units: number | null;
  counted_volume_ml: number | null;
  method: CountMethod | null;
  difference_reason: string | null;
  photo_attachment_id: string | null;
  /** Omitted or null → 0 once the line is counted. The count table has no mass column. */
  counted_mass_g?: number | null;
  /** Set when the location is inside the fiscal perimeter (`location.tax_warehouse_id`). */
  tax_warehouse_id?: string | null;
  product_class?: ProductClass | null;
  excise_product_key?: string | null;
  /** When set, packaged moves must satisfy WC023 against this nominal volume. */
  nominal_volume_ml?: number | null;
  abv_pct?: string | null;
  nc_code?: string | null;
}

export interface CountPlanContext {
  ledger: LedgerName;
  count_id: string;
  /** Count number, used as the fiscal justification (J12). */
  count_number: string;
  /** Instant of the physical count. Drafts are posted at this instant. */
  counted_at: IsoDateTime;
  /** Business date of the fiscal regularization. */
  fiscal_date: IsoDate;
  created_by: string;
}

export interface OpeningCountContext {
  count_id: string;
  count_number: string;
  /** Instant of the physical opening moves (for example 2027-01-01T00:00:00+01:00). */
  as_of: IsoDateTime;
  /** Business date of the fiscal opening moves. */
  fiscal_date: IsoDate;
  /** Physical count date when it differs from `fiscal_date` (the cut-off day). */
  physical_date?: IsoDate | null;
  created_by: string;
}

/** A count adjustment that still needs `inventory_adjustment` approval before posting. */
export interface AdjustmentDraft {
  approval_required: true;
  approval_kind: "inventory_adjustment";
  /** Spanish reason. Copied onto `fiscal_move.reason` for regularizations. */
  reason: string;
  move: StockMove | FiscalMove;
}

export interface OpeningCountPlan {
  approval_required: true;
  approval_kind: "inventory_adjustment";
  physical: StockMove[];
  fiscal: FiscalMove[];
}

export interface PeriodLock {
  ledger: LedgerName;
  /** Inclusive. A move whose business date is on or before this day is rejected (WC021). */
  locked_until: IsoDate;
  locked_by: string;
  locked_at: IsoDateTime;
  reason: string;
}

export function isStockMove(move: StockMove | FiscalMove): move is StockMove {
  return "occurred_at" in move;
}

export function isFiscalMove(move: StockMove | FiscalMove): move is FiscalMove {
  return "fiscal_date" in move && !("occurred_at" in move);
}

/**
 * Pure cellar-operation drafts. Field names follow
 * docs/02-ddl/0005_inventory_base.sql, 0006_cellar.sql and 0007_ledgers.sql.
 * Volumes are integer millilitres. This module does not touch a clock or a database.
 */

export type VesselKind =
  | "tank_storage"
  | "tank_fermenter"
  | "barrel"
  | "demijohn"
  | "ibc"
  | "other";

export type VesselMaterial =
  | "stainless_steel"
  | "oak"
  | "glass"
  | "concrete"
  | "plastic"
  | "other";

export type VesselStatus = "in_service" | "out_of_service" | "retired";

/** inventory.stock_move.product_state / cellar.operation_line.product_state */
export type ProductState =
  | "grape"
  | "must"
  | "wine"
  | "packaged_unlabeled"
  | "packaged_labeled"
  | "goods";

export type BulkProductState = "must" | "wine";

export type PackagedProductState = "packaged_unlabeled" | "packaged_labeled";

export type LotKind = "grape" | "must" | "wine" | "bottled";

export type LossKind = "authorized" | "incident";

/** SILICIE ledger. Oak barrels are `bulk_wood`; every other vessel is `bulk`. */
export type FiscalLedger = "bulk" | "bulk_wood";

export type FiscalProductClass = FiscalLedger | "packaged";

export interface VesselState {
  id: string;
  kind: VesselKind;
  material: VesselMaterial;
  capacity_ml: number;
  /** Current lot, or null when the vessel is empty. */
  lot_id: string | null;
  volume_ml: number;
  owner_entity_id: string;
  product_state: BulkProductState | null;
  location_id: string;
  status: VesselStatus;
  /** Null when the vessel sits outside the CAE perimeter. */
  tax_warehouse_id: string | null;
  /**
   * SILICIE reference for wine held in this vessel's ledger
   * (for example GRANEL-TINTO or CRIANZA-TINTO). Null when unknown.
   */
  excise_product_key: string | null;
}

export type VesselStateAfter = VesselState;

export interface LotRef {
  id: string;
  code: string;
  kind: LotKind;
  vintage: number | null;
  producer_entity_id: string;
  wine_id: string | null;
  is_organic: boolean;
  /**
   * Strict ancestors (parents, grandparents, …), not including this lot.
   * Used to reject a genealogy cycle (WC030).
   */
  ancestor_lot_ids: readonly string[];
  excise_product_key: string | null;
  /** numeric(5,2) as a decimal string, or null when no analysis is known. */
  abv_pct: string | null;
}

export interface OperationHeader {
  /** cellar.operation.id — already assigned on the draft being confirmed. */
  id: string;
  legal_entity_id: string;
  /** ISO-8601 instant supplied by the caller. The engine never reads the clock. */
  occurred_at: string;
  /** Business date YYYY-MM-DD supplied by the caller (Europe/Madrid is upstream). */
  fiscal_date: string;
  performed_by: string;
  created_by: string;
  reason: string | null;
  /** Present when a human approval (cellar_loss) has already been granted. */
  approval_request_id: string | null;
}

export interface TransferLineInput {
  role: "input";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
}

export interface TransferLineOutput {
  role: "output";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
}

export interface TransferLineLoss {
  role: "loss";
  lot: LotRef;
  /** Null leaves the loss unassigned. Ambiguous across ledgers is WC028. */
  vessel_id: string | null;
  volume_ml: number;
  loss_kind: LossKind;
  product_state: BulkProductState;
}

export type TransferLine = TransferLineInput | TransferLineOutput | TransferLineLoss;

/** Trasiego (`cellar.operation.op_type = racking`). Same lot, one or more destinations. */
export interface TransferRequest extends OperationHeader {
  op_type: "racking";
  lines: readonly TransferLine[];
}

export interface BlendLineInput {
  role: "input";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
}

export interface BlendLineOutput {
  role: "output";
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
}

export interface BlendLineLoss {
  role: "loss";
  lot: LotRef;
  vessel_id: string | null;
  volume_ml: number;
  loss_kind: LossKind;
  product_state: BulkProductState;
}

export type BlendLine = BlendLineInput | BlendLineOutput | BlendLineLoss;

/** Ensamblaje without a tasting formula (`op_type = blend`). */
export interface BlendRequest extends OperationHeader {
  op_type: "blend";
  lines: readonly BlendLine[];
  new_lot: {
    /** When omitted, the engine draws one from `ids.newId()`. */
    id?: string;
    code: string;
    /** When omitted, inherited only if every input shares the same wine. */
    wine_id?: string | null;
    excise_product_key?: string | null;
  };
}

export interface AdditionRequest extends OperationHeader {
  op_type: "addition";
  vessel_id: string;
  lot: LotRef;
  addition: {
    additive_product_id: string;
    /** numeric(12,3) as a decimal string. Additive quantity, not wine volume. */
    quantity: string;
    quantity_unit: "g" | "kg" | "ml" | "l";
    dose: string;
    dose_unit: "g/hl" | "mg/l" | "g/l";
    purpose: "acidification" | "sulphiting" | "cleaning" | "other";
    supplier_invoice_id: string | null;
    /** True when the oenological product is marked fit for organic wine. */
    organic_approved: boolean;
  };
}

export interface BottlingLineInput {
  role: "input";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: "wine";
}

export interface BottlingLineOutput {
  role: "output";
  location_id: string;
  product_id: string;
  product_state: PackagedProductState;
  qty_units: number;
  /** Must equal qty_units × nominal_volume_ml (WC023). */
  volume_ml: number;
  nominal_volume_ml: number;
  excise_product_key: string | null;
  nc_code: string | null;
}

export interface BottlingLineLoss {
  role: "loss";
  lot: LotRef;
  vessel_id: string | null;
  volume_ml: number;
  loss_kind: LossKind;
  product_state: "wine";
}

export type BottlingLine = BottlingLineInput | BottlingLineOutput | BottlingLineLoss;

/** Envasado (`op_type = bottling`). */
export interface BottlingRequest extends OperationHeader {
  op_type: "bottling";
  lines: readonly BottlingLine[];
  new_lot: {
    id?: string;
    code: string;
  };
}

export interface LossLine {
  role: "loss";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  loss_kind: LossKind;
  product_state: BulkProductState;
}

/** Merma (`loss`) or destrucción (`destruction`). */
export interface LossRequest extends OperationHeader {
  op_type: "loss" | "destruction";
  lines: readonly LossLine[];
}

export interface CleaningRequest extends OperationHeader {
  op_type: "cleaning";
  cleaning: {
    vessel_id: string | null;
    location_id: string | null;
    product_id: string;
    active_substance: string;
    quantity: string;
    quantity_unit: "g" | "kg" | "ml" | "l";
    efficacy_check: string;
    supplier_invoice_id: string | null;
  };
}

/**
 * Entrada de uva (`op_type = reception`). Solo salidas: un lote de uva en gramos
 * en el recipiente destino. No hay movimiento fiscal: el asiento A02 se anota
 * desde la operación (silicie.md §5). El prensado (mosto) es otra operación.
 */
export interface ReceptionRequest extends OperationHeader {
  op_type: "reception";
  vessel_id: string;
  /** Net grams. Positive safe integer. */
  mass_g: number;
  lot_code: string;
  vintage: number;
  is_organic: boolean;
  notes: string | null;
  /**
   * Lot already stored in the vessel by mass, when the volume model still
   * sees the vessel as empty. Volume occupancy is `vessel.volume_ml`.
   */
  occupying_lot_id: string | null;
}

/** Phase of a lot inside a fermenter. Null means no phase has been recorded. */
export type FermentationPhaseName =
  | "alcoholic"
  | "alcoholic_done"
  | "malolactic"
  | "malolactic_done";

export interface PressingInputLine {
  role: "input";
  lot: LotRef;
  vessel_id: string | null;
  location_id: string;
  product_state: "grape" | "must";
  mass_g: number;
  volume_ml: number;
}

export interface PressingOutputLine {
  role: "output";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: "must";
}

/** Solids (orujo). Mass only: it does not move the wine ledger. */
export interface PressingPomaceLine {
  role: "pomace";
  lot: LotRef;
  location_id: string;
  mass_g: number;
}

export interface PressingVolumeLossLine {
  role: "loss";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  loss_kind: LossKind;
  product_state: "must";
}

export type PressingLine =
  | PressingInputLine
  | PressingOutputLine
  | PressingPomaceLine
  | PressingVolumeLossLine;

/** Prensado (`crushing_pressing`): uva o mosto → mosto + orujo. */
export interface PressingRequest extends OperationHeader {
  op_type: "crushing_pressing";
  lines: readonly PressingLine[];
}

export interface FermentationStartRequest extends OperationHeader {
  op_type: "fermentation_start" | "malolactic_start";
  vessel_id: string;
  lot: LotRef;
  current_phase: FermentationPhaseName | null;
}

export interface FermentationVolumeLine {
  role: "input" | "output" | "loss";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
  loss_kind: LossKind | null;
}

/** Fin de FA (`fermentation_end`) o fin de FML (`malolactic_end`). */
export interface FermentationEndRequest extends OperationHeader {
  op_type: "fermentation_end" | "malolactic_end";
  lines: readonly FermentationVolumeLine[];
  current_phase: FermentationPhaseName | null;
  /** numeric(5,2). Obligatorio en el fin de la fermentación alcohólica (A15). */
  abv_pct: string | null;
}

export interface BleedingRequest extends OperationHeader {
  op_type: "bleeding";
  lines: readonly FermentationVolumeLine[];
  new_lot: { code: string; id?: string };
}

export interface PressingOffLine {
  role: "input" | "output" | "loss";
  lot: LotRef;
  vessel_id: string;
  volume_ml: number;
  product_state: BulkProductState;
  loss_kind: LossKind | null;
  /** Set on an output that births a child lot. Null keeps the parent lot. */
  new_lot_code: string | null;
}

export interface PressingOffRequest extends OperationHeader {
  op_type: "pressing_off";
  lines: readonly PressingOffLine[];
}

export interface DelestageRequest extends OperationHeader {
  op_type: "delestage";
  vessel_id: string;
  lot: LotRef;
  started_at: string;
  ended_at: string;
  notes: string | null;
}

export interface TemperatureControlRequest extends OperationHeader {
  op_type: "temperature_control";
  vessel_id: string;
  lot: LotRef;
  previous_setpoint_c: string;
  new_setpoint_c: string;
}

/** Toma de muestras. No mueve volumen: el depósito y el lote se quedan igual. */
export interface SamplingRequest extends OperationHeader {
  op_type: "sampling";
  vessel_id: string;
  lot: LotRef;
  sampled_at: string;
  sample_code: string;
  destination: "internal" | "lab";
  lab_contact_id: string | null;
}

export type OperationRequest =
  | TransferRequest
  | BlendRequest
  | AdditionRequest
  | BottlingRequest
  | LossRequest
  | CleaningRequest
  | ReceptionRequest
  | PressingRequest
  | FermentationStartRequest
  | FermentationEndRequest
  | BleedingRequest
  | PressingOffRequest
  | DelestageRequest
  | TemperatureControlRequest
  | SamplingRequest;

/** Hecho de SILICIE que no es una fila de inventory.fiscal_move (A14 uva, A32 elaboración). */
export interface SilicieFactDraft {
  kind: "crushing" | "elaboration_loss";
  mass_g: number | null;
  volume_ml: number | null;
  ledger_reference: string | null;
  abv_pct: string | null;
}

export interface LotKindUpdate {
  lot_id: string;
  kind: LotKind;
}

export interface PressingYieldDraft {
  input_state: "grape" | "must";
  input_mass_g: number;
  input_volume_ml: number;
  must_volume_ml: number;
  pomace_mass_g: number;
  must_yield: string;
  must_yield_unit: "l_per_100kg" | "volume_ratio";
  pomace_yield: string;
  pomace_yield_unit: "mass_ratio" | "g_per_l";
}

export interface FermentationPhaseDraft {
  lot_id: string;
  vessel_id: string;
  phase: FermentationPhaseName;
  previous_phase: FermentationPhaseName | null;
}

export interface CellarState {
  vessels: ReadonlyMap<string, VesselState>;
}

export interface IdSource {
  newId(): string;
}

/** inventory.stock_move columns the planner fills. `created_at` is a database default. */
export interface StockMoveDraft {
  id: string;
  occurred_at: string;
  move_type: "cellar_in" | "cellar_out" | "loss";
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  loss_kind: LossKind | null;
  source_table: "cellar.operation";
  source_id: string;
  source_line_id: string | null;
  reverses_move_id: null;
  created_by: string;
}

/** inventory.fiscal_move columns. Emitted only when the operation has a fiscal effect. */
export interface FiscalMoveDraft {
  id: string;
  tax_warehouse_id: string;
  fiscal_date: string;
  physical_date: string | null;
  move_type:
    | "production"
    | "packaging_out_bulk"
    | "packaging_in_packaged"
    | "loss"
    | "destruction"
    | "ledger_change_out"
    | "ledger_change_in";
  product_class: FiscalProductClass;
  lot_id: string | null;
  product_id: string | null;
  volume_ml: number;
  units: number;
  abv_pct: string | null;
  excise_product_key: string | null;
  nc_code: string | null;
  justification_type: "internal";
  justification_ref: string;
  counterparty_contact_id: null;
  counterparty_excise_number: null;
  fiscal_trigger: "operation";
  source_table: "cellar.operation";
  source_id: string;
  source_line_id: string | null;
  silicie_entry_id: null;
  reverses_move_id: null;
  reason: string | null;
  created_by: string;
}

/** inventory.lot columns for a lot born in this operation. */
export interface LotDraft {
  id: string;
  producer_entity_id: string;
  code: string;
  kind: LotKind;
  wine_id: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: "active";
  origin: "operation" | "reception";
  created_by_operation_id: string;
  notes: string | null;
}

/** inventory.lot_edge. Volume is the millilitres the parent contributed. */
export interface LotEdgeDraft {
  child_lot_id: string;
  parent_lot_id: string;
  operation_id: string;
  volume_ml: number;
  mass_g: number;
}

export interface PlanSuccess {
  ok: true;
  stockMoves: readonly StockMoveDraft[];
  fiscalMoves: readonly FiscalMoveDraft[];
  newLots: readonly LotDraft[];
  lotEdges: readonly LotEdgeDraft[];
  vesselsAfter: readonly VesselStateAfter[];
  silicieFacts: readonly SilicieFactDraft[];
  lotUpdates: readonly LotKindUpdate[];
  pressingYield: PressingYieldDraft | null;
  fermentationPhase: FermentationPhaseDraft | null;
  /** Avisos que no son asientos. El descube y el sangrado citan Q-040. */
  notes: readonly string[];
}

export interface PlanFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export type PlanResult = PlanSuccess | PlanFailure;

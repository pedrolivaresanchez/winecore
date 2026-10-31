/**
 * Shared checks for the cellar planner.
 *
 * Volume model: an input line is wine removed from a vessel (including the
 * part declared as loss). Output lines are wine that arrives. Loss lines are
 * the declared merma and are NOT removed a second time. Stock moves split the
 * removal into `cellar_out` (the part that arrives) and `loss`, so the sum of
 * every stock-move volume equals minus the declared losses.
 *
 * Fiscal model (silicie.md §5–§6 and §11 case 5): a wine ledger is the pair
 * (class, colour). Class is `bulk` or `bulk_wood` (oak barrel). Colour is
 * TINTO, BLANCO or ROSADO, written on the draft as `GRANEL-*` or `CRIANZA-*`.
 * Moving wine between two such ledgers (tank ↔ barrel, or a rosé blend)
 * posts a balanced `ledger_change_out/in`. A declared racking or blend loss
 * is always a fiscal `loss` on the ledger of the vessel that loses it, even
 * when the transfer itself stays on one ledger. Must posts nothing fiscal.
 * Bottling lees stay non-fiscal (A32) and are handled in ops/bottling.ts.
 */

import type {
  BulkProductState,
  CellarState,
  FermentationPhaseDraft,
  FiscalLedger,
  FiscalMoveDraft,
  IdSource,
  LossKind,
  LotKind,
  LotKindUpdate,
  LotRef,
  OperationHeader,
  PlanFailure,
  PlanSuccess,
  PressingYieldDraft,
  SilicieFactDraft,
  StockMoveDraft,
  VesselState,
  VesselStateAfter,
} from "./types";

type PlanExtra = "silicieFacts" | "lotUpdates" | "pressingYield" | "fermentationPhase";

export function fail(code: string, message: string, details?: unknown): PlanFailure {
  if (details === undefined) return { ok: false, code, message };
  return { ok: false, code, message, details };
}

export function succeed(
  parts: Omit<PlanSuccess, "ok" | PlanExtra> &
    Partial<Pick<PlanSuccess, PlanExtra>>,
): PlanSuccess {
  return {
    ok: true,
    silicieFacts: [] as readonly SilicieFactDraft[],
    lotUpdates: [] as readonly LotKindUpdate[],
    pressingYield: null as PressingYieldDraft | null,
    fermentationPhase: null as FermentationPhaseDraft | null,
    ...parts,
  };
}

export function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function ledgerOf(vessel: VesselState): FiscalLedger {
  if (vessel.kind === "barrel" && vessel.material === "oak") return "bulk_wood";
  return "bulk";
}

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ABV = /^(0|[1-9]\d?)(?:\.(\d{1,2}))?$/;
const NC_CODE = /^[0-9]{8}$/;
const DECIMAL_3 = /^(0|[1-9]\d{0,8})(?:\.(\d{1,3}))?$/;

export function isLotCode(code: string): boolean {
  return LOT_CODE.test(code);
}

export function isNcCode(code: string): boolean {
  return NC_CODE.test(code);
}

/** Positive numeric(12,3) held as an integer count of thousandths. */
export function parsePositiveDecimal3(value: string): number | null {
  const match = DECIMAL_3.exec(value);
  if (match === null) return null;
  const whole = match[1];
  const frac = match[2];
  if (whole === undefined) return null;
  const milli = Number(whole) * 1000 + Number((frac ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli <= 0) return null;
  return milli;
}

export function abvOk(value: string | null): boolean {
  if (value === null) return true;
  const match = ABV.exec(value);
  if (match === null) return false;
  const whole = match[1];
  const frac = match[2];
  if (whole === undefined) return false;
  const cents = Number(whole) * 100 + Number((frac ?? "").padEnd(2, "0"));
  return cents >= 0 && cents <= 2500;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isFiscalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const lengths = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dim = lengths[month - 1];
  return dim !== undefined && day <= dim;
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function assertHeader(req: OperationHeader): PlanFailure | null {
  if (!nonEmpty(req.id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el identificador de la operación.", {
      field: "id",
    });
  }
  if (!nonEmpty(req.legal_entity_id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta la entidad de la operación.", {
      field: "legal_entity_id",
    });
  }
  if (typeof req.occurred_at !== "string" || !ISO_INSTANT.test(req.occurred_at)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la fecha de la operación no es un instante válido.", {
      field: "occurred_at",
    });
  }
  if (typeof req.fiscal_date !== "string" || !isFiscalDate(req.fiscal_date)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la fecha fiscal no es válida.", {
      field: "fiscal_date",
    });
  }
  if (!nonEmpty(req.performed_by)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta quien realiza la operación.", {
      field: "performed_by",
    });
  }
  if (!nonEmpty(req.created_by)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta quien registra la operación.", {
      field: "created_by",
    });
  }
  if (req.reason !== null && typeof req.reason !== "string") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el motivo no es válido.", { field: "reason" });
  }
  if (req.approval_request_id !== null && !nonEmpty(req.approval_request_id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la aprobación no es válida.", {
      field: "approval_request_id",
    });
  }
  return null;
}

export function assertLot(lot: LotRef, field: string): PlanFailure | null {
  if (lot === null || typeof lot !== "object") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el lote.", { field });
  }
  if (!nonEmpty(lot.id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el identificador del lote.", { field });
  }
  if (typeof lot.code !== "string" || !isLotCode(lot.code)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el código de lote no es válido.", {
      field,
      code: lot.code,
    });
  }
  const kinds: readonly LotKind[] = ["grape", "must", "wine", "bottled"];
  if (!kinds.includes(lot.kind)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de lote no es válido.", { field });
  }
  if (lot.vintage !== null && (!isSafeInt(lot.vintage) || lot.vintage < 1990 || lot.vintage > 2100)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la añada del lote no es válida.", { field });
  }
  if (!nonEmpty(lot.producer_entity_id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el productor del lote.", { field });
  }
  if (typeof lot.is_organic !== "boolean") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta si el lote es ecológico.", { field });
  }
  if (!Array.isArray(lot.ancestor_lot_ids) || lot.ancestor_lot_ids.some((id) => !nonEmpty(id))) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la genealogía del lote no es válida.", { field });
  }
  if (lot.excise_product_key !== null && !nonEmpty(lot.excise_product_key)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la clave de impuesto especial no es válida.", {
      field,
    });
  }
  if (!abvOk(lot.abv_pct)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el grado alcohólico no es válido.", { field });
  }
  return null;
}

export function assertPositiveMl(value: unknown, field: string): PlanFailure | null {
  if (!isSafeInt(value) || (value as number) <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen debe ser mililitros enteros y positivos.", {
      field,
      value,
    });
  }
  return null;
}

export function sumMl(values: readonly number[]): number | PlanFailure {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el volumen total no cabe en un entero seguro.");
    }
  }
  return total;
}

export function assertVesselShape(vessel: VesselState): PlanFailure | null {
  if (!nonEmpty(vessel.id) || !nonEmpty(vessel.location_id) || !nonEmpty(vessel.owner_entity_id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el estado del recipiente está incompleto.", {
      vessel_id: vessel.id,
    });
  }
  if (!isSafeInt(vessel.capacity_ml) || vessel.capacity_ml <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la capacidad del recipiente no es válida.", {
      vessel_id: vessel.id,
    });
  }
  if (!isSafeInt(vessel.volume_ml) || vessel.volume_ml < 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen del recipiente no es válido.", {
      vessel_id: vessel.id,
    });
  }
  const empty = vessel.volume_ml === 0;
  if (empty !== (vessel.lot_id === null) || empty !== (vessel.product_state === null)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente vacío no puede tener lote, y al revés.", {
      vessel_id: vessel.id,
    });
  }
  if (vessel.volume_ml > vessel.capacity_ml) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el estado ya supera la capacidad del recipiente.", {
      vessel_id: vessel.id,
    });
  }
  return null;
}

export function loadVessel(state: CellarState, vesselId: string): VesselState | PlanFailure {
  if (!nonEmpty(vesselId)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el recipiente.", { field: "vessel_id" });
  }
  const vessel = state.vessels.get(vesselId);
  if (vessel === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente no existe.", { vessel_id: vesselId });
  }
  const shape = assertVesselShape(vessel);
  if (shape !== null) return shape;
  return vessel;
}

export function assertInService(vessel: VesselState): PlanFailure | null {
  if (vessel.status !== "in_service") {
    return fail(
      "WC_VESSEL_NOT_IN_SERVICE",
      "WC_VESSEL_NOT_IN_SERVICE: el recipiente no está en servicio.",
      { vessel_id: vessel.id, status: vessel.status },
    );
  }
  return null;
}

export function assertSameWarehouse(vessels: readonly VesselState[]): PlanFailure | null {
  const ids = new Set(vessels.map((vessel) => vessel.tax_warehouse_id));
  if (ids.size <= 1) return null;
  return fail(
    "WC_VALIDATION",
    "WC_VALIDATION: los recipientes no comparten el mismo almacén fiscal.",
    { tax_warehouse_ids: [...ids] },
  );
}

export function warehouseId(vessels: readonly VesselState[]): string | null {
  return vessels[0]?.tax_warehouse_id ?? null;
}

export function assertIncidentApproval(
  req: OperationHeader,
  kinds: readonly LossKind[],
): PlanFailure | null {
  if (!kinds.includes("incident")) return null;
  if (!nonEmpty(req.reason) || !nonEmpty(req.approval_request_id)) {
    return fail(
      "WC_VALIDATION",
      "WC_VALIDATION: la merma por incidencia exige motivo y aprobación.",
      { field: "approval_request_id" },
    );
  }
  return null;
}

export interface VolumeCheck {
  inputs_ml: number;
  outputs_ml: number;
  losses_ml: number;
}

export function assertConserved(check: VolumeCheck, opType: string): PlanFailure | null {
  if (check.inputs_ml !== check.outputs_ml + check.losses_ml) {
    return fail(
      "WC020",
      `WC020: el volumen no cuadra: entran ${check.inputs_ml} mL, salen ${check.outputs_ml} mL y la merma es ${check.losses_ml} mL.`,
      { op_type: opType, ...check },
    );
  }
  return null;
}

export function needsEnds(inputCount: number, outputCount: number, opType: string): PlanFailure | null {
  if (inputCount === 0 || outputCount === 0) {
    return fail("WC020", `WC020: ${opType} necesita entradas y salidas.`, {
      op_type: opType,
      inputs: inputCount,
      outputs: outputCount,
    });
  }
  return null;
}

export interface Removal {
  vesselId: string;
  volume_ml: number;
}

export interface Arrival {
  vesselId: string;
  volume_ml: number;
  lot: LotRef;
  product_state: BulkProductState;
  owner_entity_id: string;
}

/**
 * Apply removals first, then arrivals. A vessel that still holds a different
 * lot cannot receive wine (WC026). Capacity is checked on the final volume.
 */
export function applyContents(
  state: CellarState,
  removals: readonly Removal[],
  arrivals: readonly Arrival[],
): VesselStateAfter[] | PlanFailure {
  const removed = new Map<string, number>();
  for (const row of removals) {
    const next = (removed.get(row.vesselId) ?? 0) + row.volume_ml;
    if (!Number.isSafeInteger(next)) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el volumen total no cabe en un entero seguro.");
    }
    removed.set(row.vesselId, next);
  }
  const added = new Map<string, Arrival>();
  for (const row of arrivals) {
    const prev = added.get(row.vesselId);
    if (prev === undefined) {
      added.set(row.vesselId, { ...row });
      continue;
    }
    if (prev.lot.id !== row.lot.id || prev.product_state !== row.product_state) {
      return fail("WC026", "WC026: el recipiente contendría más de un lote; mezclar lotes es un ensamblaje.", {
        vessel_id: row.vesselId,
      });
    }
    const volume = prev.volume_ml + row.volume_ml;
    if (!Number.isSafeInteger(volume)) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el volumen total no cabe en un entero seguro.");
    }
    added.set(row.vesselId, { ...prev, volume_ml: volume });
  }

  const ids = [...new Set([...removed.keys(), ...added.keys()])].sort(compareText);
  const after: VesselStateAfter[] = [];
  for (const id of ids) {
    const current = state.vessels.get(id);
    if (current === undefined) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente no existe.", { vessel_id: id });
    }
    const take = removed.get(id) ?? 0;
    const put = added.get(id);
    if (take > current.volume_ml) {
      return fail(
        "WC024",
        `WC024: saldo negativo en el recipiente ${current.id}: se piden ${take} mL y hay ${current.volume_ml} mL.`,
        { vessel_id: current.id, requested_ml: take, available_ml: current.volume_ml },
      );
    }
    const remaining = current.volume_ml - take;
    const extra = put?.volume_ml ?? 0;
    const finalVolume = remaining + extra;
    if (finalVolume > current.capacity_ml) {
      return fail(
        "WC025",
        `WC025: el recipiente ${current.id} supera su capacidad (${finalVolume} mL > ${current.capacity_ml} mL).`,
        { vessel_id: current.id, volume_ml: finalVolume, capacity_ml: current.capacity_ml },
      );
    }
    if (remaining > 0 && put !== undefined && current.lot_id !== put.lot.id) {
      return fail(
        "WC026",
        "WC026: el recipiente contiene otro lote; mezclar lotes es un ensamblaje.",
        { vessel_id: current.id, current_lot_id: current.lot_id, incoming_lot_id: put.lot.id },
      );
    }
    const next: VesselStateAfter = { ...current };
    if (finalVolume === 0) {
      next.volume_ml = 0;
      next.lot_id = null;
      next.product_state = null;
    } else if (remaining === 0 && put !== undefined) {
      next.volume_ml = finalVolume;
      next.lot_id = put.lot.id;
      next.product_state = put.product_state;
      next.owner_entity_id = put.owner_entity_id;
    } else {
      next.volume_ml = finalVolume;
    }
    after.push(next);
  }
  return after;
}

export function wouldCycle(childId: string, parent: LotRef): boolean {
  return childId === parent.id || parent.ancestor_lot_ids.includes(childId);
}

export function assertAcyclic(childId: string, parents: readonly LotRef[]): PlanFailure | null {
  for (const parent of parents) {
    if (wouldCycle(childId, parent)) {
      return fail(
        "WC030",
        "WC030: la genealogía de lotes tendría un ciclo.",
        { child_lot_id: childId, parent_lot_id: parent.id },
      );
    }
  }
  return null;
}

export function resolveNewId(explicit: string | undefined, ids: IdSource): string | PlanFailure {
  if (explicit === undefined) return ids.newId();
  if (!nonEmpty(explicit)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el identificador del lote nuevo no es válido.", {
      field: "new_lot.id",
    });
  }
  return explicit;
}

export function sharedVintage(lots: readonly LotRef[]): number | null {
  const first = lots[0];
  if (first === undefined) return null;
  const vintage = first.vintage;
  for (const lot of lots) {
    if (lot.vintage !== vintage) return null;
  }
  return vintage;
}

export function vintagesDisagree(lots: readonly LotRef[]): boolean {
  const first = lots[0];
  if (first === undefined) return false;
  return lots.some((lot) => lot.vintage !== first.vintage);
}

export function sharedValue<T>(values: readonly T[]): T | null {
  const first = values[0];
  if (first === undefined) return null;
  for (const value of values) {
    if (value !== first) return null;
  }
  return first;
}

export interface LossAssignment {
  /** Millilitres of loss posted against each source vessel. */
  byVessel: ReadonlyMap<string, number>;
}

export interface InputSlice {
  vessel: VesselState;
  lot: LotRef;
  volume_ml: number;
}

/**
 * Losses with a vessel must sit on a source and cannot exceed that source's
 * input. A loss without a vessel is attributed in vessel-id order when every
 * source shares one ledger. Across different ledgers (class or colour) that
 * attribution would change the ledger-change volume, so it is rejected (WC028).
 */
export function assignLosses(
  inputs: readonly InputSlice[],
  explicit: readonly { vessel_id: string; volume_ml: number }[],
  unattributed_ml: number,
): LossAssignment | PlanFailure {
  const inputByVessel = new Map<string, InputSlice>();
  for (const row of inputs) {
    const prev = inputByVessel.get(row.vessel.id);
    if (prev === undefined) {
      inputByVessel.set(row.vessel.id, row);
    } else {
      const volume = prev.volume_ml + row.volume_ml;
      if (!Number.isSafeInteger(volume)) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el volumen total no cabe en un entero seguro.");
      }
      inputByVessel.set(row.vessel.id, { ...prev, volume_ml: volume });
    }
  }

  const byVessel = new Map<string, number>();
  for (const row of explicit) {
    const source = inputByVessel.get(row.vessel_id);
    if (source === undefined) {
      return fail(
        "WC_VALIDATION",
        "WC_VALIDATION: la merma debe declararse sobre un recipiente de origen.",
        { vessel_id: row.vessel_id },
      );
    }
    byVessel.set(row.vessel_id, (byVessel.get(row.vessel_id) ?? 0) + row.volume_ml);
  }
  for (const [vesselId, loss] of byVessel) {
    const source = inputByVessel.get(vesselId);
    if (source === undefined || loss > source.volume_ml) {
      return fail(
        "WC_VALIDATION",
        "WC_VALIDATION: la merma declarada en el recipiente supera el volumen de entrada.",
        { vessel_id: vesselId, loss_ml: loss, input_ml: source?.volume_ml ?? 0 },
      );
    }
  }

  if (unattributed_ml > 0) {
    const ledgers = new Set([...inputByVessel.values()].map((row) => movementIdentity(row)));
    if (ledgers.size > 1) {
      return fail(
        "WC028",
        "WC028: el cambio de mayor no cuadra: la merma no se puede asignar a un único mayor.",
        { unattributed_ml, ledgers: [...ledgers] },
      );
    }
    let remaining = unattributed_ml;
    const sources = [...inputByVessel.values()].sort((a, b) => compareText(a.vessel.id, b.vessel.id));
    for (const source of sources) {
      if (remaining === 0) break;
      const already = byVessel.get(source.vessel.id) ?? 0;
      const slack = source.volume_ml - already;
      const take = Math.min(slack, remaining);
      if (take > 0) byVessel.set(source.vessel.id, already + take);
      remaining -= take;
    }
    if (remaining !== 0) {
      return fail(
        "WC_VALIDATION",
        "WC_VALIDATION: la merma no cabe en los recipientes de origen.",
        { unattributed_ml },
      );
    }
  }

  return { byVessel };
}

export interface FiscalIntent {
  move_type: FiscalMoveDraft["move_type"];
  product_class: FiscalMoveDraft["product_class"];
  lot_id: string | null;
  product_id: string | null;
  volume_ml: number;
  units: number;
  abv_pct: string | null;
  excise_product_key: string | null;
  nc_code: string | null;
  reason: string | null;
}

const BULK_COLOUR = /^(?:GRANEL|CRIANZA)-(TINTO|BLANCO|ROSADO)$/;

/** Colour carried by a SILICIE bulk reference, or null when the key does not say one. */
export function bulkColour(key: string | null): string | null {
  if (key === null) return null;
  const match = BULK_COLOUR.exec(key);
  return match?.[1] ?? null;
}

function movementIdentity(row: InputSlice): string {
  const colour = bulkColour(row.lot.excise_product_key) ?? bulkColour(row.vessel.excise_product_key) ?? "?";
  return `${ledgerOf(row.vessel)}:${colour}`;
}

function ledgerReference(ledger: FiscalLedger, colour: string): string {
  return `${ledger === "bulk_wood" ? "CRIANZA" : "GRANEL"}-${colour}`;
}

/**
 * Colour of the wine at a vessel. The lot wins; the vessel key is only a
 * fallback. Missing colour is WC_VALIDATION — the reference is never invented.
 */
function requireBulkColour(lot: LotRef, vessel: VesselState): string | PlanFailure {
  const colour = bulkColour(lot.excise_product_key) ?? bulkColour(vessel.excise_product_key);
  if (colour === null) {
    return fail(
      "WC_VALIDATION",
      "WC_VALIDATION: falta el color del mayor fiscal del vino (TINTO, BLANCO o ROSADO).",
      { lot_id: lot.id, vessel_id: vessel.id },
    );
  }
  return colour;
}

/**
 * Excise reference stored on a new blend lot. Inside a tax warehouse the
 * output colour is the declared one, or the single colour shared by the
 * inputs. A blend of different colours without a declared output key fails
 * instead of borrowing the destination vessel's previous colour.
 */
export function resolveBlendExciseKey(
  declared: string | null | undefined,
  inputs: readonly InputSlice[],
  productState: BulkProductState,
  taxWarehouseId: string | null,
): string | null | PlanFailure {
  if (productState !== "wine" || taxWarehouseId === null) {
    if (declared != null && declared !== "") return declared;
    return sharedValue(inputs.map((row) => row.lot.excise_product_key));
  }
  if (declared != null && declared !== "") {
    const colour = bulkColour(declared);
    if (colour === null) {
      return fail(
        "WC_VALIDATION",
        "WC_VALIDATION: la clave del mayor de salida no indica un color (TINTO, BLANCO o ROSADO).",
        { excise_product_key: declared },
      );
    }
    return ledgerReference("bulk", colour);
  }
  const colours: string[] = [];
  for (const row of inputs) {
    const colour = requireBulkColour(row.lot, row.vessel);
    if (typeof colour !== "string") return colour;
    colours.push(colour);
  }
  const shared = sharedValue(colours);
  if (shared === null) {
    return fail(
      "WC_VALIDATION",
      "WC_VALIDATION: el ensamblaje cambia de color; indique la clave del mayor de salida.",
      { field: "new_lot.excise_product_key" },
    );
  }
  return ledgerReference("bulk", shared);
}

interface FiscalBucket {
  product_class: FiscalLedger;
  key: string;
  outMl: number;
  inMl: number;
  lossMl: number;
  outLotIds: string[];
  inLotIds: string[];
  lossLotIds: string[];
  outAbv: (string | null)[];
  inAbv: (string | null)[];
  lossAbv: (string | null)[];
}

/**
 * Fiscal drafts for a wine racking or blend. Ledger changes balance across
 * every (class, colour) that gains or loses wine. Declared losses are posted
 * even when no wine changes ledger.
 */
export function fiscalLedgerChange(args: {
  product_state: BulkProductState;
  inputs: readonly InputSlice[];
  outputs: readonly { vessel: VesselState; lot: LotRef; volume_ml: number }[];
  lossByVessel: ReadonlyMap<string, number>;
  reason: string | null;
}): FiscalIntent[] | PlanFailure {
  if (args.product_state !== "wine") return [];
  const wh = warehouseId(args.inputs.map((row) => row.vessel).concat(args.outputs.map((row) => row.vessel)));
  if (wh === null) return [];

  const buckets = new Map<string, FiscalBucket>();
  const take = (ledger: FiscalLedger, colour: string): FiscalBucket => {
    const key = ledgerReference(ledger, colour);
    const id = `${ledger}|${key}`;
    const existing = buckets.get(id);
    if (existing !== undefined) return existing;
    const created: FiscalBucket = {
      product_class: ledger,
      key,
      outMl: 0,
      inMl: 0,
      lossMl: 0,
      outLotIds: [],
      inLotIds: [],
      lossLotIds: [],
      outAbv: [],
      inAbv: [],
      lossAbv: [],
    };
    buckets.set(id, created);
    return created;
  };

  for (const row of args.inputs) {
    const colour = requireBulkColour(row.lot, row.vessel);
    if (typeof colour !== "string") return colour;
    const bucket = take(ledgerOf(row.vessel), colour);
    bucket.outMl += row.volume_ml;
    bucket.outLotIds.push(row.lot.id);
    bucket.outAbv.push(row.lot.abv_pct);
  }
  for (const row of args.outputs) {
    const colour = requireBulkColour(row.lot, row.vessel);
    if (typeof colour !== "string") return colour;
    const bucket = take(ledgerOf(row.vessel), colour);
    bucket.inMl += row.volume_ml;
    bucket.inLotIds.push(row.lot.id);
    bucket.inAbv.push(row.lot.abv_pct);
  }
  for (const [vesselId, volume] of args.lossByVessel) {
    if (volume <= 0) continue;
    const source = args.inputs.find((row) => row.vessel.id === vesselId);
    if (source === undefined) continue;
    const colour = requireBulkColour(source.lot, source.vessel);
    if (typeof colour !== "string") return colour;
    const bucket = take(ledgerOf(source.vessel), colour);
    bucket.lossMl += volume;
    bucket.lossLotIds.push(source.lot.id);
    bucket.lossAbv.push(source.lot.abv_pct);
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    if (a.product_class !== b.product_class) return a.product_class < b.product_class ? -1 : 1;
    return compareText(a.key, b.key);
  });

  let exportSum = 0;
  const intents: FiscalIntent[] = [];
  for (const bucket of ordered) {
    const exported = bucket.outMl - bucket.inMl - bucket.lossMl;
    exportSum += exported;
    if (exported > 0) {
      intents.push({
        move_type: "ledger_change_out",
        product_class: bucket.product_class,
        lot_id: sharedValue(bucket.outLotIds),
        product_id: null,
        volume_ml: -exported,
        units: 0,
        abv_pct: sharedValue(bucket.outAbv),
        excise_product_key: bucket.key,
        nc_code: null,
        reason: null,
      });
    }
  }
  for (const bucket of ordered) {
    const exported = bucket.outMl - bucket.inMl - bucket.lossMl;
    if (exported < 0) {
      intents.push({
        move_type: "ledger_change_in",
        product_class: bucket.product_class,
        lot_id: sharedValue(bucket.inLotIds),
        product_id: null,
        volume_ml: -exported,
        units: 0,
        abv_pct: sharedValue(bucket.inAbv),
        excise_product_key: bucket.key,
        nc_code: null,
        reason: null,
      });
    }
  }
  if (exportSum !== 0) {
    return fail("WC028", "WC028: el cambio de mayor no cuadra.", { balance_ml: exportSum });
  }
  for (const bucket of ordered) {
    if (bucket.lossMl <= 0) continue;
    intents.push({
      move_type: "loss",
      product_class: bucket.product_class,
      lot_id: sharedValue(bucket.lossLotIds),
      product_id: null,
      volume_ml: -bucket.lossMl,
      units: 0,
      abv_pct: sharedValue(bucket.lossAbv),
      excise_product_key: bucket.key,
      nc_code: null,
      reason: args.reason,
    });
  }
  return intents;
}

export function realizeFiscal(
  req: OperationHeader,
  taxWarehouseId: string,
  intents: readonly FiscalIntent[],
  ids: IdSource,
): FiscalMoveDraft[] {
  return intents.map((intent) => ({
    id: ids.newId(),
    tax_warehouse_id: taxWarehouseId,
    fiscal_date: req.fiscal_date,
    physical_date: req.fiscal_date,
    move_type: intent.move_type,
    product_class: intent.product_class,
    lot_id: intent.lot_id,
    product_id: intent.product_id,
    volume_ml: intent.volume_ml,
    units: intent.units,
    abv_pct: intent.abv_pct,
    excise_product_key: intent.excise_product_key,
    nc_code: intent.nc_code,
    justification_type: "internal",
    justification_ref: req.id,
    counterparty_contact_id: null,
    counterparty_excise_number: null,
    fiscal_trigger: "operation",
    source_table: "cellar.operation",
    source_id: req.id,
    source_line_id: null,
    silicie_entry_id: null,
    reverses_move_id: null,
    reason: intent.reason,
    created_by: req.created_by,
  }));
}

export function bulkStockMove(
  req: OperationHeader,
  ids: IdSource,
  args: {
    move_type: StockMoveDraft["move_type"];
    vessel: VesselState;
    lot_id: string;
    product_state: BulkProductState;
    volume_ml: number;
    loss_kind: LossKind | null;
    owner_entity_id: string;
  },
): StockMoveDraft {
  return {
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: args.move_type,
    location_id: args.vessel.location_id,
    vessel_id: args.vessel.id,
    owner_entity_id: args.owner_entity_id,
    lot_id: args.lot_id,
    product_id: null,
    product_state: args.product_state,
    qty_units: 0,
    volume_ml: args.volume_ml,
    mass_g: 0,
    loss_kind: args.loss_kind,
    source_table: "cellar.operation",
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  };
}

export function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function kindMatchesState(kind: LotKind, state: BulkProductState): boolean {
  return (state === "wine" && kind === "wine") || (state === "must" && kind === "must");
}

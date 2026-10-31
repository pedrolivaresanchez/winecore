import {
  applyContents,
  assertHeader,
  assertInService,
  assertLot,
  assertPositiveMl,
  assertSameWarehouse,
  bulkStockMove,
  compareText,
  fail,
  kindMatchesState,
  ledgerOf,
  loadVessel,
  nonEmpty,
  realizeFiscal,
  succeed,
  warehouseId,
} from "../common";
import type { FiscalIntent } from "../common";
import type {
  CellarState,
  IdSource,
  LossRequest,
  PlanResult,
  StockMoveDraft,
  VesselState,
} from "../types";

/**
 * Merma and destruction remove wine from a vessel. Destruction and incident
 * losses need a reason and an approval id; without them nothing is planned.
 * Physical moves are always `loss`. Fiscal `loss` (A30) or `destruction` (A28)
 * is posted only for wine inside a tax warehouse. Must is not on those ledgers.
 */
export function planLoss(req: LossRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (req.op_type !== "loss" && req.op_type !== "destruction") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de operación no es válido.", { field: "op_type" });
  }
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no tiene líneas.", { field: "lines" });
  }

  if (req.op_type === "destruction") {
    if (!nonEmpty(req.reason) || !nonEmpty(req.approval_request_id)) {
      return fail("WC_VALIDATION", "WC_VALIDATION: la destrucción exige motivo y aprobación.", {
        field: "approval_request_id",
      });
    }
  }

  const slices: {
    vessel: VesselState;
    lotId: string;
    volume_ml: number;
    product_state: "must" | "wine";
    loss_kind: "authorized" | "incident";
    abv_pct: string | null;
    excise_product_key: string | null;
  }[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    if (line.role !== "loss") {
      return fail("WC020", "WC020: la merma solo admite líneas de merma.", { field });
    }
    const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
    if (volume !== null) return volume;
    const lotError = assertLot(line.lot, `${field}.lot`);
    if (lotError !== null) return lotError;
    if (line.product_state !== "must" && line.product_state !== "wine") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la merma de este motor solo admite mosto o vino en recipiente.", {
        field,
      });
    }
    if (!kindMatchesState(line.lot.kind, line.product_state)) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de lote no coincide con el estado del producto.", {
        field,
      });
    }
    if (line.loss_kind !== "authorized" && line.loss_kind !== "incident") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la merma necesita un tipo (autorizada o incidencia).", { field });
    }
    if (req.op_type === "loss" && line.loss_kind === "incident") {
      if (!nonEmpty(req.reason) || !nonEmpty(req.approval_request_id)) {
        return fail(
          "WC_VALIDATION",
          "WC_VALIDATION: la merma por incidencia exige motivo y aprobación.",
          { field: "approval_request_id" },
        );
      }
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ("ok" in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    if (vessel.lot_id !== line.lot.id || vessel.product_state !== line.product_state) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la línea no es el que contiene el recipiente.", {
        field,
        vessel_id: vessel.id,
      });
    }
    slices.push({
      vessel,
      lotId: line.lot.id,
      volume_ml: line.volume_ml,
      product_state: line.product_state,
      loss_kind: line.loss_kind,
      abv_pct: line.lot.abv_pct,
      excise_product_key: line.lot.excise_product_key ?? vessel.excise_product_key,
    });
  }

  const warehouse = assertSameWarehouse(slices.map((row) => row.vessel));
  if (warehouse !== null) return warehouse;

  const after = applyContents(
    state,
    slices.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.volume_ml })),
    [],
  );
  if (!Array.isArray(after)) return after;

  const ordered = [...slices].sort((a, b) => compareText(a.vessel.id, b.vessel.id) || compareText(a.lotId, b.lotId));
  const stockMoves: StockMoveDraft[] = ordered.map((row) =>
    bulkStockMove(req, ids, {
      move_type: "loss",
      vessel: row.vessel,
      lot_id: row.lotId,
      product_state: row.product_state,
      volume_ml: -row.volume_ml,
      loss_kind: row.loss_kind,
      owner_entity_id: row.vessel.owner_entity_id,
    }),
  );

  const wh = warehouseId(slices.map((row) => row.vessel));
  const intents: FiscalIntent[] = [];
  if (wh !== null) {
    for (const row of ordered) {
      if (row.product_state !== "wine") continue;
      intents.push({
        move_type: req.op_type === "destruction" ? "destruction" : "loss",
        product_class: ledgerOf(row.vessel),
        lot_id: row.lotId,
        product_id: null,
        volume_ml: -row.volume_ml,
        units: 0,
        abv_pct: row.abv_pct,
        excise_product_key: row.excise_product_key,
        nc_code: null,
        reason: req.reason,
      });
    }
  }
  const fiscalMoves = wh === null ? [] : realizeFiscal(req, wh, intents, ids);

  return succeed({
    stockMoves,
    fiscalMoves,
    newLots: [],
    lotEdges: [],
    vesselsAfter: after,
  });
}

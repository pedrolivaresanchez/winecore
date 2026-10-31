import {
  assertHeader,
  assertInService,
  fail,
  isLotCode,
  isSafeInt,
  loadVessel,
  nonEmpty,
  succeed,
} from "../common";
import type { IdSource, PlanResult, ReceptionRequest } from "../types";
import type { CellarState } from "../types";

/**
 * Entrada de uva: un lote nuevo y un `cellar_in` en gramos. La uva no es
 * producto objeto, así que no hay movimiento fiscal; el asiento A02 lo
 * construye `entriesFor` a partir del hecho `grape_reception`.
 */
export function planReception(req: ReceptionRequest, state: CellarState, ids: IdSource): PlanResult {
  if (req.op_type !== "reception") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de operación no es válido.", { field: "op_type" });
  }
  const headerError = assertHeader(req);
  if (headerError !== null) return headerError;
  const loaded = loadVessel(state, req.vessel_id);
  if ("ok" in loaded) return loaded;
  const serviceError = assertInService(loaded);
  if (serviceError !== null) return serviceError;
  if (!isSafeInt(req.mass_g) || req.mass_g <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la masa neta debe ser gramos enteros y positivos.", {
      field: "mass_g",
    });
  }
  if (typeof req.lot_code !== "string" || !isLotCode(req.lot_code)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el código de lote no es válido.", { field: "lot_code" });
  }
  if (!isSafeInt(req.vintage) || req.vintage < 1990 || req.vintage > 2100) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la añada no es válida.", { field: "vintage" });
  }
  if (typeof req.is_organic !== "boolean") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta si la uva es ecológica.", { field: "is_organic" });
  }
  if (req.notes !== null && typeof req.notes !== "string") {
    return fail("WC_VALIDATION", "WC_VALIDATION: las notas del lote no son válidas.", { field: "notes" });
  }
  if (req.occupying_lot_id !== null && !nonEmpty(req.occupying_lot_id)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el lote que ocupa el recipiente no es válido.", {
      field: "occupying_lot_id",
    });
  }
  if (loaded.tax_warehouse_id === null) {
    return fail(
      "WC_VALIDATION",
      "WC_VALIDATION: el recipiente está fuera del perímetro fiscal.",
      { field: "vessel_id" },
    );
  }
  if (loaded.volume_ml > 0 || req.occupying_lot_id !== null) {
    return fail(
      "WC026",
      "WC026: el recipiente ya contiene producto; hay que vaciarlo o elegir otro.",
      { vessel_id: loaded.id },
    );
  }
  const lotId = ids.newId();
  const moveId = ids.newId();
  return succeed({
    stockMoves: [
      {
        id: moveId,
        occurred_at: req.occurred_at,
        move_type: "cellar_in",
        location_id: loaded.location_id,
        vessel_id: loaded.id,
        owner_entity_id: req.legal_entity_id,
        lot_id: lotId,
        product_id: null,
        product_state: "grape",
        qty_units: 0,
        volume_ml: 0,
        mass_g: req.mass_g,
        loss_kind: null,
        source_table: "cellar.operation",
        source_id: req.id,
        source_line_id: null,
        reverses_move_id: null,
        created_by: req.created_by,
      },
    ],
    fiscalMoves: [],
    newLots: [
      {
        id: lotId,
        producer_entity_id: req.legal_entity_id,
        code: req.lot_code,
        kind: "grape",
        wine_id: null,
        vintage: req.vintage,
        is_organic: req.is_organic,
        status: "active",
        origin: "reception",
        created_by_operation_id: req.id,
        notes: req.notes,
      },
    ],
    lotEdges: [],
    vesselsAfter: [loaded],
  });
}

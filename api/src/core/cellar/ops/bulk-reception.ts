import {
  abvOk,
  applyContents,
  assertHeader,
  assertInService,
  fail,
  isLotCode,
  isSafeInt,
  ledgerOf,
  loadVessel,
  realizeFiscal,
  succeed,
} from "../common";
import type { FiscalIntent } from "../common";
import type { BulkReceptionRequest, CellarState, IdSource, LotRef, PlanResult } from "../types";

/**
 * Entrada de mosto o vino comprado: lote nuevo y `cellar_in` en un recipiente
 * vacío. El vino dentro del CAE entra al mayor con `bulk_receipt`. El mosto
 * no tiene asiento hasta que sea vino.
 */
export function planBulkReception(req: BulkReceptionRequest, state: CellarState, ids: IdSource): PlanResult {
  if (req.op_type !== "bulk_reception") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de operación no es válido.", { field: "op_type" });
  }
  const headerError = assertHeader(req);
  if (headerError !== null) return headerError;
  const loaded = loadVessel(state, req.vessel_id);
  if ("ok" in loaded) return loaded;
  const serviceError = assertInService(loaded);
  if (serviceError !== null) return serviceError;
  if (req.product_state !== "must" && req.product_state !== "wine") {
    return fail("WC_VALIDATION", "WC_VALIDATION: la entrada a granel es mosto o vino.", { field: "product_state" });
  }
  if (!isSafeInt(req.volume_ml) || req.volume_ml <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen debe ser mililitros enteros y positivos.", {
      field: "volume_ml",
    });
  }
  if (typeof req.lot_code !== "string" || !isLotCode(req.lot_code)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el código de lote no es válido.", { field: "lot_code" });
  }
  if (!isSafeInt(req.vintage) || req.vintage < 1990 || req.vintage > 2100) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la añada no es válida.", { field: "vintage" });
  }
  if (typeof req.is_organic !== "boolean") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta si el producto es ecológico.", { field: "is_organic" });
  }
  if (req.notes !== null && typeof req.notes !== "string") {
    return fail("WC_VALIDATION", "WC_VALIDATION: las notas del lote no son válidas.", { field: "notes" });
  }
  if (req.excise_product_key !== null && req.excise_product_key.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: la clave de impuesto especial no es válida.", { field: "excise_product_key" });
  }
  if (!abvOk(req.abv_pct)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el grado alcohólico no es válido.", { field: "abv_pct" });
  }
  if (loaded.owner_entity_id !== req.legal_entity_id) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente es de otra sociedad.", {
      field: "vessel_id",
      owner_entity_id: loaded.owner_entity_id,
    });
  }
  if (loaded.volume_ml > 0 || loaded.lot_id !== null) {
    return fail("WC026", "WC026: el recipiente ya contiene producto; hay que vaciarlo o elegir otro.", {
      vessel_id: loaded.id,
    });
  }
  if (req.volume_ml > loaded.capacity_ml) {
    return fail("WC025", "WC025: el volumen no cabe en el recipiente.", {
      vessel_id: loaded.id,
      capacity_ml: loaded.capacity_ml,
      volume_ml: req.volume_ml,
    });
  }

  const lotId = ids.newId();
  const lot: LotRef = {
    id: lotId,
    code: req.lot_code,
    kind: req.product_state === "must" ? "must" : "wine",
    vintage: req.vintage,
    producer_entity_id: req.legal_entity_id,
    wine_id: null,
    is_organic: req.is_organic,
    ancestor_lot_ids: [],
    excise_product_key: req.excise_product_key,
    abv_pct: req.abv_pct,
  };
  const after = applyContents(
    state,
    [],
    [{
      vesselId: loaded.id,
      volume_ml: req.volume_ml,
      lot,
      product_state: req.product_state,
      owner_entity_id: loaded.owner_entity_id,
    }],
  );
  if (!Array.isArray(after)) return after;

  const moveId = ids.newId();
  const stockMoves = [{
    id: moveId,
    occurred_at: req.occurred_at,
    move_type: "cellar_in" as const,
    location_id: loaded.location_id,
    vessel_id: loaded.id,
    owner_entity_id: loaded.owner_entity_id,
    lot_id: lotId,
    product_id: null,
    product_state: req.product_state,
    qty_units: 0,
    volume_ml: req.volume_ml,
    mass_g: 0,
    loss_kind: null,
    source_table: "cellar.operation" as const,
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  }];

  const fiscal = req.product_state === "wine" && loaded.tax_warehouse_id !== null
    ? realizeFiscal(req, loaded.tax_warehouse_id, [receipt(lot, req.volume_ml, ledgerOf(loaded))], ids)
    : [];

  return succeed({
    stockMoves,
    fiscalMoves: fiscal,
    newLots: [{
      id: lotId,
      producer_entity_id: req.legal_entity_id,
      code: req.lot_code,
      kind: lot.kind,
      wine_id: null,
      vintage: req.vintage,
      is_organic: req.is_organic,
      status: "active",
      origin: "reception",
      created_by_operation_id: req.id,
      notes: req.notes,
    }],
    lotEdges: [],
    vesselsAfter: after,
  });
}

function receipt(lot: LotRef, volumeMl: number, ledger: "bulk" | "bulk_wood"): FiscalIntent {
  return {
    move_type: "bulk_receipt",
    product_class: ledger,
    lot_id: lot.id,
    product_id: null,
    volume_ml: volumeMl,
    units: 0,
    abv_pct: lot.abv_pct,
    excise_product_key: lot.excise_product_key,
    nc_code: null,
    reason: null,
  };
}

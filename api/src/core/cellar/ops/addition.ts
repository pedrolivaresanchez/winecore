import {
  assertHeader,
  assertInService,
  assertLot,
  fail,
  kindMatchesState,
  loadVessel,
  parsePositiveDecimal3,
  succeed,
} from "../common";
import type { AdditionRequest, CellarState, IdSource, PlanResult } from "../types";

const QUANTITY_UNITS = new Set(["g", "kg", "ml", "l"]);
const DOSE_UNITS = new Set(["g/hl", "mg/l", "g/l"]);
const PURPOSES = new Set(["acidification", "sulphiting", "cleaning", "other"]);

/**
 * Adiciones do not move wine. The spec records the additive on cellar.addition
 * and leaves the vessel volume unchanged, even when the additive is measured
 * in ml or l. Those drafts are not part of this planner's result; a valid
 * request confirms that nothing in the ledgers changes.
 */
export function planAddition(req: AdditionRequest, state: CellarState, _ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  const lotError = assertLot(req.lot, "lot");
  if (lotError !== null) return lotError;
  const addition = req.addition;
  if (addition === null || typeof addition !== "object") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta la adición.", { field: "addition" });
  }
  if (typeof addition.additive_product_id !== "string" || addition.additive_product_id.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el producto enológico.", {
      field: "addition.additive_product_id",
    });
  }
  if (!QUANTITY_UNITS.has(addition.quantity_unit)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la unidad de cantidad no es válida.", {
      field: "addition.quantity_unit",
    });
  }
  if (!DOSE_UNITS.has(addition.dose_unit)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la unidad de dosis no es válida.", {
      field: "addition.dose_unit",
    });
  }
  if (!PURPOSES.has(addition.purpose)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la finalidad de la adición no es válida.", {
      field: "addition.purpose",
    });
  }
  if (parsePositiveDecimal3(addition.quantity) === null) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la cantidad debe ser un decimal positivo con hasta 3 decimales.", {
      field: "addition.quantity",
    });
  }
  if (parsePositiveDecimal3(addition.dose) === null) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la dosis debe ser un decimal positivo con hasta 3 decimales.", {
      field: "addition.dose",
    });
  }
  if (typeof addition.organic_approved !== "boolean") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta si el producto es apto en ecológico.", {
      field: "addition.organic_approved",
    });
  }
  if (addition.supplier_invoice_id !== null && addition.supplier_invoice_id.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: la factura del producto no es válida.", {
      field: "addition.supplier_invoice_id",
    });
  }

  const vessel = loadVessel(state, req.vessel_id);
  if ("ok" in vessel) return vessel;
  const service = assertInService(vessel);
  if (service !== null) return service;
  if (vessel.volume_ml === 0 || vessel.lot_id === null || vessel.product_state === null) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente está vacío.", { vessel_id: vessel.id });
  }
  if (vessel.lot_id !== req.lot.id) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la adición no es el que contiene el recipiente.", {
      vessel_id: vessel.id,
      lot_id: req.lot.id,
    });
  }
  if (!kindMatchesState(req.lot.kind, vessel.product_state)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de lote no coincide con el estado del producto.", {
      vessel_id: vessel.id,
    });
  }
  if (req.lot.is_organic && !addition.organic_approved) {
    return fail(
      "WC_VALIDATION",
      "WC_VALIDATION: el producto enológico no está autorizado en un lote ecológico.",
      { lot_id: req.lot.id, additive_product_id: addition.additive_product_id },
    );
  }

  return succeed({
    stockMoves: [],
    fiscalMoves: [],
    newLots: [],
    lotEdges: [],
    vesselsAfter: [],
  });
}

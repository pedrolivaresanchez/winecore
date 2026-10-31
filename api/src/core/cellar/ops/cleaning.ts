import { assertHeader, fail, loadVessel, parsePositiveDecimal3, succeed } from "../common";
import type { CellarState, CleaningRequest, IdSource, PlanResult } from "../types";

const QUANTITY_UNITS = new Set(["g", "kg", "ml", "l"]);

/**
 * Limpieza has no stock effect. The cleaning record itself is persisted by a
 * later task; this planner only accepts a complete request and returns no
 * ledger rows.
 */
export function planCleaning(req: CleaningRequest, state: CellarState, _ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  const cleaning = req.cleaning;
  if (cleaning === null || typeof cleaning !== "object") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el registro de limpieza.", { field: "cleaning" });
  }
  const hasVessel = typeof cleaning.vessel_id === "string" && cleaning.vessel_id.trim() !== "";
  const hasLocation = typeof cleaning.location_id === "string" && cleaning.location_id.trim() !== "";
  if (cleaning.vessel_id !== null && !hasVessel) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el recipiente de la limpieza no es válido.", {
      field: "cleaning.vessel_id",
    });
  }
  if (cleaning.location_id !== null && !hasLocation) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el lugar de la limpieza no es válido.", {
      field: "cleaning.location_id",
    });
  }
  if (!hasVessel && !hasLocation) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la limpieza necesita un recipiente o un lugar.", {
      field: "cleaning.vessel_id",
    });
  }
  if (typeof cleaning.product_id !== "string" || cleaning.product_id.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el producto de limpieza.", {
      field: "cleaning.product_id",
    });
  }
  if (typeof cleaning.active_substance !== "string" || cleaning.active_substance.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta la sustancia activa.", {
      field: "cleaning.active_substance",
    });
  }
  if (!QUANTITY_UNITS.has(cleaning.quantity_unit)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la unidad de cantidad no es válida.", {
      field: "cleaning.quantity_unit",
    });
  }
  if (parsePositiveDecimal3(cleaning.quantity) === null) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la cantidad debe ser un decimal positivo con hasta 3 decimales.", {
      field: "cleaning.quantity",
    });
  }
  if (typeof cleaning.efficacy_check !== "string" || cleaning.efficacy_check.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: la limpieza exige la comprobación de eficacia.", {
      field: "cleaning.efficacy_check",
    });
  }
  if (cleaning.supplier_invoice_id !== null && cleaning.supplier_invoice_id.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: la factura del producto no es válida.", {
      field: "cleaning.supplier_invoice_id",
    });
  }

  if (hasVessel && cleaning.vessel_id !== null) {
    const vessel = loadVessel(state, cleaning.vessel_id);
    if ("ok" in vessel) return vessel;
    if (vessel.status === "retired") {
      return fail(
        "WC_VESSEL_NOT_IN_SERVICE",
        "WC_VESSEL_NOT_IN_SERVICE: el recipiente no está en servicio.",
        { vessel_id: vessel.id, status: vessel.status },
      );
    }
  }

  return succeed({
    stockMoves: [],
    fiscalMoves: [],
    newLots: [],
    lotEdges: [],
    vesselsAfter: [],
  });
}

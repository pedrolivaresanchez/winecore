import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, header, holding, idSource, lot, stateOf, vessel } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01" });

function cleaning(partial: {
  vessel_id?: string | null;
  location_id?: string | null;
  efficacy_check?: string;
  quantity?: string;
  status?: "in_service" | "out_of_service" | "retired";
  volume_ml?: number;
}) {
  const row =
    partial.volume_ml && partial.volume_ml > 0
      ? holding("tank-a", wine, partial.volume_ml, "wine", { status: partial.status ?? "in_service" })
      : vessel({ id: "tank-a", status: partial.status ?? "in_service" });
  return {
    vessel: row,
    result: planOperation(
      {
        ...header(),
        op_type: "cleaning",
        cleaning: {
          vessel_id: partial.vessel_id === undefined ? "tank-a" : partial.vessel_id,
          location_id: partial.location_id === undefined ? null : partial.location_id,
          product_id: "prod-peracetic",
          active_substance: "acido peracetico",
          quantity: partial.quantity ?? "1.500",
          quantity_unit: "l",
          efficacy_check: partial.efficacy_check ?? "aclarado y tira de pH",
          supplier_invoice_id: null,
        },
      },
      stateOf([row]),
      idSource(),
    ),
  };
}

describe("planOperation · limpieza", () => {
  it("limpieza completa → sin efecto de stock ni cambio de volumen", () => {
    const { vessel: source, result } = cleaning({ volume_ml: 2_000_000 });
    const plan = asOk(result);
    expect(plan.stockMoves).toHaveLength(0);
    expect(plan.fiscalMoves).toHaveLength(0);
    expect(plan.newLots).toHaveLength(0);
    expect(plan.lotEdges).toHaveLength(0);
    expect(plan.vesselsAfter).toHaveLength(0);
    expect(source.volume_ml).toBe(2_000_000);
  });

  it("recipiente fuera de servicio → se puede limpiar", () => {
    const { result } = cleaning({ status: "out_of_service" });
    expect(result.ok).toBe(true);
  });

  it("solo un lugar, sin recipiente → se acepta", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "cleaning",
          cleaning: {
            vessel_id: null,
            location_id: "loc-bod",
            product_id: "prod-peracetic",
            active_substance: "acido peracetico",
            quantity: "0.500",
            quantity_unit: "l",
            efficacy_check: "inspeccion visual",
            supplier_invoice_id: null,
          },
        },
        stateOf([]),
        idSource(),
      ),
    );
    expect(result.stockMoves).toHaveLength(0);
  });

  it("sin comprobación de eficacia → WC_VALIDATION", () => {
    const { result } = cleaning({ efficacy_check: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("sin recipiente ni lugar → WC_VALIDATION", () => {
    const { result } = cleaning({ vessel_id: null, location_id: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("recipiente de baja → WC_VESSEL_NOT_IN_SERVICE", () => {
    const { result } = cleaning({ status: "retired" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VESSEL_NOT_IN_SERVICE");
  });
});

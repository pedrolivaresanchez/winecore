import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, header, holding, idSource, lot, stateOf, vessel } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01" });

function addition(partial: {
  organic_approved?: boolean;
  quantity?: string;
  dose?: string;
  lot?: typeof wine;
  vessel_id?: string;
}) {
  return planOperation(
    {
      ...header(),
      op_type: "addition",
      vessel_id: partial.vessel_id ?? "tank-a",
      lot: partial.lot ?? wine,
      addition: {
        additive_product_id: "prod-tartaric",
        quantity: partial.quantity ?? "2.000",
        quantity_unit: "g",
        dose: partial.dose ?? "2",
        dose_unit: "g/hl",
        purpose: "acidification",
        supplier_invoice_id: "inv-sintetica-1",
        organic_approved: partial.organic_approved ?? true,
      },
    },
    stateOf([holding("tank-a", partial.lot ?? wine, 5_000_000)]),
    idSource(),
  );
}

describe("planOperation · adición", () => {
  it("registra la adición sin cambiar el volumen ni los libros", () => {
    const source = holding("tank-a", wine, 5_000_000);
    const result = asOk(addition({}));
    expect(result.stockMoves).toHaveLength(0);
    expect(result.fiscalMoves).toHaveLength(0);
    expect(result.newLots).toHaveLength(0);
    expect(result.lotEdges).toHaveLength(0);
    expect(result.vesselsAfter).toHaveLength(0);
    expect(source.volume_ml).toBe(5_000_000);
  });

  it("una cantidad en ml del aditivo no aumenta el vino", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "addition",
          vessel_id: "tank-a",
          lot: wine,
          addition: {
            additive_product_id: "prod-so2",
            quantity: "100.000",
            quantity_unit: "ml",
            dose: "20",
            dose_unit: "mg/l",
            purpose: "sulphiting",
            supplier_invoice_id: null,
            organic_approved: true,
          },
        },
        stateOf([holding("tank-a", wine, 8_000_000)]),
        idSource(),
      ),
    );
    expect(result.vesselsAfter).toHaveLength(0);
    expect(result.stockMoves).toHaveLength(0);
  });

  it("lote ecológico y producto no apto → WC_VALIDATION", () => {
    const result = addition({ organic_approved: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WC_VALIDATION");
      expect(result.message).toContain("ecológico");
    }
  });

  it("lote no ecológico y producto no apto → se acepta", () => {
    const plain = lot({ id: "lot-a", code: "L25T01", is_organic: false });
    const result = asOk(addition({ lot: plain, organic_approved: false }));
    expect(result.stockMoves).toHaveLength(0);
  });

  it("dosis nula → WC_VALIDATION", () => {
    const result = addition({ dose: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("recipiente vacío → WC_VALIDATION", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "addition",
        vessel_id: "tank-a",
        lot: wine,
        addition: {
          additive_product_id: "prod-tartaric",
          quantity: "1",
          quantity_unit: "g",
          dose: "1",
          dose_unit: "g/hl",
          purpose: "acidification",
          supplier_invoice_id: null,
          organic_approved: true,
        },
      },
      stateOf([vessel({ id: "tank-a" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });
});

import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import type { BulkReceptionRequest, LabelingRequest, TransferRequest } from "../../src/core/cellar/types";
import { asOk, header, holding, idSource, lot, stateOf, vessel } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01", kind: "bottled" });
const bulk = lot({ id: "lot-bulk", code: "L25G01", kind: "wine" });

describe("planOperation · filtración, etiquetado y entrada", () => {
  it("la filtración mueve el mismo lote y respeta el volumen", () => {
    const request: TransferRequest = {
      ...header({ id: "op-filtro" }),
      op_type: "filtration",
      lines: [
        { role: "input", lot: bulk, vessel_id: "tank-a", volume_ml: 1_000, product_state: "wine" },
        { role: "output", lot: bulk, vessel_id: "tank-b", volume_ml: 980, product_state: "wine" },
        { role: "loss", lot: bulk, vessel_id: "tank-a", volume_ml: 20, loss_kind: "authorized", product_state: "wine" },
      ],
    };
    const plan = asOk(planOperation(request, stateOf([
      holding("tank-a", bulk, 5_000),
      vessel({ id: "tank-b" }),
    ]), idSource()));
    expect(plan.vesselsAfter.find((row) => row.id === "tank-a")?.volume_ml).toBe(4_000);
    expect(plan.vesselsAfter.find((row) => row.id === "tank-b")?.volume_ml).toBe(980);
    expect(plan.newLots).toEqual([]);
  });

  it("el etiquetado pasa el jaulón a etiquetado y la rotura es merma", () => {
    const request: LabelingRequest = {
      ...header({ id: "op-etiq", reason: "rotura en la línea" }),
      op_type: "labeling",
      tax_warehouse_id: "wh-1",
      lines: [
        {
          role: "input",
          lot: wine,
          location_id: "loc-bod",
          owner_entity_id: "entity-po",
          product_id: "prod-botella",
          qty_units: 100,
          volume_ml: 75_000,
          nominal_volume_ml: 750,
        },
        {
          role: "output",
          location_id: "loc-bod",
          product_id: "prod-botella",
          qty_units: 98,
          volume_ml: 73_500,
          nominal_volume_ml: 750,
        },
        {
          role: "loss",
          lot: wine,
          location_id: "loc-bod",
          product_id: "prod-botella",
          qty_units: 2,
          volume_ml: 1_500,
          nominal_volume_ml: 750,
          loss_kind: "authorized",
        },
      ],
    };
    const plan = asOk(planOperation(request, stateOf([]), idSource()));
    const unlabeled = plan.stockMoves.filter((row) => row.product_state === "packaged_unlabeled");
    const labeled = plan.stockMoves.filter((row) => row.product_state === "packaged_labeled");
    expect(unlabeled.map((row) => row.qty_units).sort((a, b) => a - b)).toEqual([-98, -2]);
    expect(labeled).toMatchObject([{ qty_units: 98, vessel_id: null }]);
    expect(plan.fiscalMoves.map((row) => [row.move_type, row.product_class, row.units])).toEqual([
      ["loss", "packaged", -2],
    ]);
    expect(plan.newLots).toEqual([]);
  });

  it("la entrada de vino llena un depósito vacío y anota la recepción fiscal", () => {
    const request: BulkReceptionRequest = {
      ...header({ id: "op-entrada" }),
      op_type: "bulk_reception",
      vessel_id: "tank-vacio",
      volume_ml: 2_000_000,
      product_state: "wine",
      lot_code: "L26COMPRA",
      vintage: 2026,
      is_organic: true,
      notes: null,
      excise_product_key: "GRANEL-TINTO",
      abv_pct: "13.50",
    };
    const plan = asOk(planOperation(request, stateOf([
      vessel({ id: "tank-vacio", capacity_ml: 8_000_000, tax_warehouse_id: "wh-1" }),
    ]), idSource()));
    expect(plan.newLots).toMatchObject([{ code: "L26COMPRA", kind: "wine", origin: "reception" }]);
    expect(plan.stockMoves).toMatchObject([{ move_type: "cellar_in", volume_ml: 2_000_000, vessel_id: "tank-vacio" }]);
    expect(plan.fiscalMoves).toMatchObject([{ move_type: "bulk_receipt", product_class: "bulk", volume_ml: 2_000_000 }]);
    expect(plan.vesselsAfter.find((row) => row.id === "tank-vacio")?.volume_ml).toBe(2_000_000);
  });

  it("la entrada no cabe en un depósito con vino", () => {
    const request: BulkReceptionRequest = {
      ...header(),
      op_type: "bulk_reception",
      vessel_id: "tank-a",
      volume_ml: 1_000,
      product_state: "must",
      lot_code: "L26MOSTO",
      vintage: 2026,
      is_organic: false,
      notes: null,
      excise_product_key: null,
      abv_pct: null,
    };
    const result = planOperation(request, stateOf([holding("tank-a", bulk, 1_000)]), idSource());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC026");
  });
});

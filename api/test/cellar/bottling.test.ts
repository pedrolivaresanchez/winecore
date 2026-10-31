import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, barrel, header, holding, idSource, lot, stateOf, volumeOf } from "./helpers";

const bulk = lot({ id: "lot-bulk", code: "ENT27A", vintage: 2024 });

function bottle(args: {
  input_ml: number;
  units: number;
  volume_ml: number;
  nominal_ml?: number;
  loss_ml?: number;
  vessels?: ReturnType<typeof holding>[];
  linesExtra?: unknown[];
}) {
  const loss = args.loss_ml ?? 0;
  const lines = [
    { role: "input" as const, lot: bulk, vessel_id: "tank-a", volume_ml: args.input_ml, product_state: "wine" as const },
    {
      role: "output" as const,
      location_id: "loc-bod",
      product_id: "sku-b075",
      product_state: "packaged_unlabeled" as const,
      qty_units: args.units,
      volume_ml: args.volume_ml,
      nominal_volume_ml: args.nominal_ml ?? 750,
      excise_product_key: "B075-ARCAL",
      nc_code: "22042100",
    },
    ...(loss > 0
      ? [
          {
            role: "loss" as const,
            lot: bulk,
            vessel_id: "tank-a",
            volume_ml: loss,
            loss_kind: "authorized" as const,
            product_state: "wine" as const,
          },
        ]
      : []),
  ];
  return planOperation(
    { ...header(), op_type: "bottling", new_lot: { code: "L27031" }, lines },
    stateOf(args.vessels ?? [holding("tank-a", bulk, args.input_ml)]),
    idSource(),
  );
}

describe("planOperation · envasado", () => {
  it("672 botellas de 750 mL a partir de 504 L → lote envasado, sin merma fiscal", () => {
    const result = asOk(bottle({ input_ml: 504_000, units: 672, volume_ml: 504_000 }));
    expect(result.newLots[0]).toMatchObject({
      code: "L27031",
      kind: "bottled",
      vintage: 2024,
      wine_id: "wine-arcal",
      is_organic: true,
      producer_entity_id: bulk.producer_entity_id,
    });
    const created = result.newLots[0];
    if (created === undefined) throw new Error("falta el lote envasado");
    expect(result.lotEdges).toEqual([
      {
        child_lot_id: created.id,
        parent_lot_id: "lot-bulk",
        operation_id: "op-1",
        volume_ml: 504_000,
        mass_g: 0,
      },
    ]);
    expect(volumeOf(result.stockMoves)).toBe(0);
    expect(result.stockMoves.find((row) => row.product_state === "packaged_unlabeled")).toMatchObject({
      move_type: "cellar_in",
      vessel_id: null,
      location_id: "loc-bod",
      product_id: "sku-b075",
      qty_units: 672,
      volume_ml: 504_000,
    });
    expect(result.fiscalMoves.map((row) => [row.move_type, row.product_class, row.volume_ml, row.units])).toEqual([
      ["packaging_out_bulk", "bulk", -504_000, 0],
      ["packaging_in_packaged", "packaged", 504_000, 672],
    ]);
    expect(result.fiscalMoves.some((row) => row.move_type === "loss")).toBe(false);
    expect(result.vesselsAfter).toEqual([
      expect.objectContaining({ id: "tank-a", volume_ml: 0, lot_id: null, product_state: null }),
    ]);
  });

  it("merma de envasado → el granel que entra sale del mayor y el envasado entra por las unidades", () => {
    const result = asOk(bottle({ input_ml: 510_000, units: 672, volume_ml: 504_000, loss_ml: 6_000 }));
    expect(volumeOf(result.stockMoves)).toBe(-6_000);
    expect(result.stockMoves.find((row) => row.move_type === "cellar_out")?.volume_ml).toBe(-504_000);
    expect(result.stockMoves.find((row) => row.move_type === "loss")?.volume_ml).toBe(-6_000);
    expect(result.fiscalMoves.map((row) => [row.move_type, row.volume_ml])).toEqual([
      ["packaging_out_bulk", -510_000],
      ["packaging_in_packaged", 504_000],
    ]);
    expect(result.lotEdges[0]?.volume_ml).toBe(510_000);
  });

  it("granel en depósito y en barrica → un packaging_out por mayor", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "bottling",
          new_lot: { id: "lot-bot", code: "L27032" },
          lines: [
            { role: "input", lot: bulk, vessel_id: "tank-a", volume_ml: 300_000, product_state: "wine" },
            { role: "input", lot: bulk, vessel_id: "bar-a", volume_ml: 210_000, product_state: "wine" },
            {
              role: "output",
              location_id: "loc-bod",
              product_id: "sku-b075",
              product_state: "packaged_labeled",
              qty_units: 672,
              volume_ml: 504_000,
              nominal_volume_ml: 750,
              excise_product_key: "B075-ARCAL",
              nc_code: null,
            },
            {
              role: "loss",
              lot: bulk,
              vessel_id: "tank-a",
              volume_ml: 6_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([
          holding("tank-a", bulk, 300_000),
          barrel({ id: "bar-a", lot_id: bulk.id, volume_ml: 210_000, product_state: "wine" }),
        ]),
        idSource(),
      ),
    );
    expect(volumeOf(result.stockMoves)).toBe(-6_000);
    expect(result.fiscalMoves.filter((row) => row.move_type === "packaging_out_bulk").map((row) => [row.product_class, row.volume_ml])).toEqual([
      ["bulk", -300_000],
      ["bulk_wood", -210_000],
    ]);
    expect(result.newLots[0]?.id).toBe("lot-bot");
  });

  it("unidades y volumen que no cuadran con el formato → WC023", () => {
    const result = bottle({ input_ml: 7_499, units: 10, volume_ml: 7_499, nominal_ml: 750 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WC023");
      expect(result.details).toMatchObject({ qty_units: 10, nominal_volume_ml: 750, volume_ml: 7_499 });
    }
  });

  it("el volumen cuadra con el formato pero no con la entrada → WC020", () => {
    const result = bottle({ input_ml: 1_000, units: 1, volume_ml: 750 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC020");
  });
});

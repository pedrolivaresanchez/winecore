import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, barrel, header, holding, idSource, lot, stateOf, vessel, volumeOf } from "./helpers";

const left = lot({ id: "lot-a", code: "L26B01", vintage: 2024, wine_id: "wine-arcal" });
const right = lot({ id: "lot-b", code: "L26B03", vintage: 2024, wine_id: "wine-arcal" });

function blendState() {
  return stateOf([
    holding("tank-a", left, 6_000_000),
    holding("tank-b", right, 4_000_000),
    vessel({ id: "tank-c" }),
  ]);
}

describe("planOperation · ensamblaje", () => {
  it("dos lotes de la misma añada → lote nuevo, aristas con el volumen aportado y añada heredada", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { code: "ENT27A" },
          lines: [
            { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 3_000_000, product_state: "wine" },
            { role: "input", lot: right, vessel_id: "tank-b", volume_ml: 2_000_000, product_state: "wine" },
            { role: "output", vessel_id: "tank-c", volume_ml: 4_800_000, product_state: "wine" },
            {
              role: "loss",
              lot: left,
              vessel_id: "tank-a",
              volume_ml: 200_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        blendState(),
        idSource(),
      ),
    );

    expect(result.newLots).toHaveLength(1);
    expect(result.newLots[0]).toMatchObject({
      code: "ENT27A",
      kind: "wine",
      vintage: 2024,
      wine_id: "wine-arcal",
      is_organic: true,
      origin: "operation",
      status: "active",
      notes: null,
      created_by_operation_id: "op-1",
    });
    expect(result.lotEdges).toEqual([
      {
        child_lot_id: result.newLots[0]?.id,
        parent_lot_id: "lot-a",
        operation_id: "op-1",
        volume_ml: 3_000_000,
        mass_g: 0,
      },
      {
        child_lot_id: result.newLots[0]?.id,
        parent_lot_id: "lot-b",
        operation_id: "op-1",
        volume_ml: 2_000_000,
        mass_g: 0,
      },
    ]);
    expect(volumeOf(result.lotEdges)).toBe(5_000_000);
    expect(volumeOf(result.stockMoves)).toBe(-200_000);
    expect(result.fiscalMoves).toEqual([
      expect.objectContaining({
        move_type: "loss",
        product_class: "bulk",
        volume_ml: -200_000,
        excise_product_key: "GRANEL-TINTO",
      }),
    ]);
    expect(result.vesselsAfter).toEqual([
      expect.objectContaining({ id: "tank-a", volume_ml: 3_000_000, lot_id: "lot-a" }),
      expect.objectContaining({ id: "tank-b", volume_ml: 2_000_000, lot_id: "lot-b" }),
      expect.objectContaining({
        id: "tank-c",
        volume_ml: 4_800_000,
        lot_id: result.newLots[0]?.id,
        product_state: "wine",
      }),
    ]);
  });

  it("añadas distintas → el lote nuevo queda sin añada y con aviso", () => {
    const older = lot({ id: "lot-b", code: "L23B03", vintage: 2023 });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { id: "lot-new", code: "ENT27B" },
          lines: [
            { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
            { role: "input", lot: older, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
            { role: "output", vessel_id: "tank-c", volume_ml: 200, product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", left, 100), holding("tank-b", older, 100), vessel({ id: "tank-c" })]),
        idSource(),
      ),
    );
    expect(result.newLots[0]).toMatchObject({
      id: "lot-new",
      vintage: null,
      notes: "La añada no se hereda: las entradas no comparten añada.",
    });
  });

  it("vaciar un origen y devolver el ensamblaje a ese recipiente → un solo lote", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { id: "lot-new", code: "ENT27C" },
          lines: [
            { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 1_000, product_state: "wine" },
            { role: "input", lot: right, vessel_id: "tank-b", volume_ml: 500, product_state: "wine" },
            { role: "output", vessel_id: "tank-a", volume_ml: 1_500, product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", left, 1_000), holding("tank-b", right, 1_000)]),
        idSource(),
      ),
    );
    expect(result.vesselsAfter).toEqual([
      expect.objectContaining({ id: "tank-a", volume_ml: 1_500, lot_id: "lot-new" }),
      expect.objectContaining({ id: "tank-b", volume_ml: 500, lot_id: "lot-b" }),
    ]);
    expect(volumeOf(result.stockMoves)).toBe(0);
  });

  it("salida a barrica de roble → cambio de mayor por el volumen que entra en madera", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { id: "lot-new", code: "ENT27D" },
          lines: [
            { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 150_000, product_state: "wine" },
            { role: "input", lot: right, vessel_id: "tank-b", volume_ml: 100_000, product_state: "wine" },
            { role: "output", vessel_id: "bar-a", volume_ml: 225_000, product_state: "wine" },
            {
              role: "loss",
              lot: left,
              vessel_id: "tank-a",
              volume_ml: 25_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([holding("tank-a", left, 150_000), holding("tank-b", right, 100_000), barrel({ id: "bar-a" })]),
        idSource(),
      ),
    );
    const ledger = result.fiscalMoves.filter((row) => row.move_type.startsWith("ledger_change"));
    expect(volumeOf(ledger)).toBe(0);
    expect(ledger).toEqual([
      expect.objectContaining({ move_type: "ledger_change_out", product_class: "bulk", volume_ml: -225_000 }),
      expect.objectContaining({
        move_type: "ledger_change_in",
        product_class: "bulk_wood",
        volume_ml: 225_000,
        excise_product_key: "CRIANZA-TINTO",
      }),
    ]);
    expect(result.fiscalMoves.find((row) => row.move_type === "loss")).toMatchObject({ volume_ml: -25_000 });
  });

  it("un solo lote → WC_VALIDATION", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "blend",
        new_lot: { code: "ENT27E" },
        lines: [
          { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "input", lot: left, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
          { role: "output", vessel_id: "tank-c", volume_ml: 200, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", left, 100), holding("tank-b", left, 100), vessel({ id: "tank-c" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("ecológico con no ecológico → WC_ECO_MIX", () => {
    const plain = lot({ id: "lot-b", code: "L26B03", is_organic: false });
    const result = planOperation(
      {
        ...header(),
        op_type: "blend",
        new_lot: { code: "ENT27F" },
        lines: [
          { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "input", lot: plain, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
          { role: "output", vessel_id: "tank-c", volume_ml: 200, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", left, 100), holding("tank-b", plain, 100), vessel({ id: "tank-c" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_ECO_MIX");
  });

  it("destino que conserva otro lote → WC026", () => {
    const third = lot({ id: "lot-c", code: "L26B09" });
    const result = planOperation(
      {
        ...header(),
        op_type: "blend",
        new_lot: { code: "ENT27G" },
        lines: [
          { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "input", lot: right, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
          { role: "output", vessel_id: "tank-c", volume_ml: 200, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", left, 100), holding("tank-b", right, 100), holding("tank-c", third, 50)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC026");
  });

  it("tinto y blanco sin clave de salida → WC_VALIDATION", () => {
    const blanco = lot({ id: "lot-w", code: "L26W01", excise_product_key: "GRANEL-BLANCO", wine_id: "wine-blanco" });
    const result = planOperation(
      {
        ...header(),
        op_type: "blend",
        new_lot: { code: "ROS27A" },
        lines: [
          { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 600, product_state: "wine" },
          { role: "input", lot: blanco, vessel_id: "tank-b", volume_ml: 400, product_state: "wine" },
          { role: "output", vessel_id: "tank-c", volume_ml: 1_000, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", left, 600), holding("tank-b", blanco, 400), vessel({ id: "tank-c" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("ensamblaje rosado → cambio de mayor equilibrado entre los colores", () => {
    const blanco = lot({ id: "lot-w", code: "L26W01", excise_product_key: "GRANEL-BLANCO", wine_id: "wine-blanco" });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { id: "lot-rose", code: "ROS27A", excise_product_key: "GRANEL-ROSADO" },
          lines: [
            { role: "input", lot: left, vessel_id: "tank-a", volume_ml: 600_000, product_state: "wine" },
            { role: "input", lot: blanco, vessel_id: "tank-b", volume_ml: 400_000, product_state: "wine" },
            { role: "output", vessel_id: "tank-c", volume_ml: 1_000_000, product_state: "wine" },
          ],
        },
        stateOf([
          holding("tank-a", left, 600_000),
          holding("tank-b", blanco, 400_000),
          vessel({ id: "tank-c" }),
        ]),
        idSource(),
      ),
    );
    const ledger = result.fiscalMoves.filter((row) => row.move_type.startsWith("ledger_change"));
    expect(volumeOf(ledger)).toBe(0);
    expect(result.fiscalMoves.map((row) => [row.move_type, row.product_class, row.volume_ml, row.excise_product_key])).toEqual([
      ["ledger_change_out", "bulk", -400_000, "GRANEL-BLANCO"],
      ["ledger_change_out", "bulk", -600_000, "GRANEL-TINTO"],
      ["ledger_change_in", "bulk", 1_000_000, "GRANEL-ROSADO"],
    ]);
    expect(result.newLots[0]?.id).toBe("lot-rose");
  });
});

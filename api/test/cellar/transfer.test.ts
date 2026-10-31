import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, barrel, header, holding, idSource, lot, stateOf, vessel, volumeOf } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01" });
const other = lot({ id: "lot-b", code: "L25T02", wine_id: "wine-entredicho" });

describe("planOperation · trasiego", () => {
  it("trasiego parcial con merma en la línea → conserva el lote y descuenta solo la merma", () => {
    const source = holding("tank-a", wine, 10_000_000, "wine", { capacity_ml: 12_000_000 });
    const dest = vessel({ id: "tank-b" });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 4_000_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 3_500_000, product_state: "wine" },
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-a",
              volume_ml: 500_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([source, dest]),
        idSource(),
      ),
    );

    expect(volumeOf(result.stockMoves)).toBe(-500_000);
    expect(result.fiscalMoves).toEqual([
      expect.objectContaining({
        move_type: "loss",
        product_class: "bulk",
        volume_ml: -500_000,
        excise_product_key: "GRANEL-TINTO",
      }),
    ]);
    expect(result.newLots).toHaveLength(0);
    expect(result.lotEdges).toHaveLength(0);
    expect(result.stockMoves.map((row) => row.move_type)).toEqual(["cellar_out", "loss", "cellar_in"]);
    expect(result.stockMoves[0]).toMatchObject({
      volume_ml: -3_500_000,
      vessel_id: "tank-a",
      lot_id: "lot-a",
      qty_units: 0,
      loss_kind: null,
      product_state: "wine",
    });
    expect(result.stockMoves[1]).toMatchObject({ volume_ml: -500_000, loss_kind: "authorized", vessel_id: "tank-a" });
    expect(result.stockMoves[2]).toMatchObject({ volume_ml: 3_500_000, vessel_id: "tank-b", lot_id: "lot-a" });
    expect(result.vesselsAfter).toEqual([
      expect.objectContaining({ id: "tank-a", volume_ml: 6_000_000, lot_id: "lot-a", product_state: "wine" }),
      expect.objectContaining({ id: "tank-b", volume_ml: 3_500_000, lot_id: "lot-a", owner_entity_id: source.owner_entity_id }),
    ]);
    expect(source.volume_ml).toBe(10_000_000);
  });

  it("varios destinos → un cellar_out por el volumen que llega y la merma aparte", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 3_000_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 1_000_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-c", volume_ml: 1_800_000, product_state: "wine" },
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-a",
              volume_ml: 200_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([holding("tank-a", wine, 5_000_000), vessel({ id: "tank-b" }), vessel({ id: "tank-c" })]),
        idSource(),
      ),
    );
    expect(volumeOf(result.stockMoves)).toBe(-200_000);
    expect(result.fiscalMoves).toEqual([
      expect.objectContaining({ move_type: "loss", product_class: "bulk", volume_ml: -200_000, excise_product_key: "GRANEL-TINTO" }),
    ]);
    expect(result.vesselsAfter.map((row) => [row.id, row.volume_ml, row.lot_id])).toEqual([
      ["tank-a", 2_000_000, "lot-a"],
      ["tank-b", 1_000_000, "lot-a"],
      ["tank-c", 1_800_000, "lot-a"],
    ]);
  });

  it("depósito de acero a depósito de acero → el trasiego no cambia de mayor y la merma sí es fiscal", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 1_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 900, product_state: "wine" },
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-a",
              volume_ml: 100,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([holding("tank-a", wine, 5_000), vessel({ id: "tank-b" })]),
        idSource(),
      ),
    );
    expect(result.fiscalMoves.map((row) => [row.move_type, row.product_class, row.volume_ml, row.excise_product_key])).toEqual([
      ["loss", "bulk", -100, "GRANEL-TINTO"],
    ]);
  });

  it("vino sin color en el almacén fiscal → WC_VALIDATION", () => {
    const bare = lot({ id: "lot-a", code: "L25T01", excise_product_key: null });
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: bare, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "output", lot: bare, vessel_id: "tank-b", volume_ml: 80, product_state: "wine" },
          { role: "loss", lot: bare, vessel_id: "tank-a", volume_ml: 20, loss_kind: "authorized", product_state: "wine" },
        ],
      },
      stateOf([
        holding("tank-a", bare, 1_000, "wine", { excise_product_key: null }),
        vessel({ id: "tank-b", excise_product_key: null }),
      ]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("depósito a barrica de roble → par de cambio de mayor que cuadra y merma A30", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 225_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "bar-a", volume_ml: 220_000, product_state: "wine" },
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-a",
              volume_ml: 5_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000_000), barrel({ id: "bar-a" })]),
        idSource(),
      ),
    );
    const ledger = result.fiscalMoves.filter(
      (row) => row.move_type === "ledger_change_out" || row.move_type === "ledger_change_in",
    );
    expect(volumeOf(ledger)).toBe(0);
    expect(result.fiscalMoves.map((row) => [row.move_type, row.product_class, row.volume_ml, row.excise_product_key])).toEqual([
      ["ledger_change_out", "bulk", -220_000, "GRANEL-TINTO"],
      ["ledger_change_in", "bulk_wood", 220_000, "CRIANZA-TINTO"],
      ["loss", "bulk", -5_000, "GRANEL-TINTO"],
    ]);
    expect(result.fiscalMoves[0]).toMatchObject({
      tax_warehouse_id: "wh-sintetico",
      fiscal_trigger: "operation",
      justification_type: "internal",
      justification_ref: "op-1",
      source_table: "cellar.operation",
      abv_pct: "13.50",
      units: 0,
    });
    expect(result.vesselsAfter).toEqual([
      expect.objectContaining({ id: "bar-a", volume_ml: 220_000, lot_id: "lot-a", product_state: "wine" }),
      expect.objectContaining({ id: "tank-a", volume_ml: 775_000, lot_id: "lot-a" }),
    ]);
  });

  it("barrica que no es de roble → sigue en el mayor de granel", () => {
    const steelBarrel = vessel({
      id: "bar-inox",
      kind: "barrel",
      material: "stainless_steel",
      capacity_ml: 225_000,
    });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "bar-inox", volume_ml: 100_000, product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 100_000), steelBarrel]),
        idSource(),
      ),
    );
    expect(result.fiscalMoves).toHaveLength(0);
    expect(result.vesselsAfter.find((row) => row.id === "tank-a")).toMatchObject({ volume_ml: 0, lot_id: null });
  });

  it("mosto de depósito a barrica → sin efecto fiscal", () => {
    const must = lot({ id: "lot-m", code: "M26A01", kind: "must", excise_product_key: null, abv_pct: null });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: must, vessel_id: "tank-a", volume_ml: 50_000, product_state: "must" },
            { role: "output", lot: must, vessel_id: "bar-a", volume_ml: 50_000, product_state: "must" },
          ],
        },
        stateOf([
          holding("tank-a", must, 50_000, "must"),
          barrel({ id: "bar-a" }),
        ]),
        idSource(),
      ),
    );
    expect(result.fiscalMoves).toHaveLength(0);
    expect(result.vesselsAfter.find((row) => row.id === "bar-a")?.product_state).toBe("must");
  });

  it("merma sin recipiente y un solo mayor → se atribuye al origen de menor id", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-b", volume_ml: 500, product_state: "wine" },
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 1_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-c", volume_ml: 1_400, product_state: "wine" },
            { role: "loss", lot: wine, vessel_id: null, volume_ml: 100, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        stateOf([
          holding("tank-a", wine, 1_000),
          holding("tank-b", wine, 500),
          vessel({ id: "tank-c" }),
        ]),
        idSource(),
      ),
    );
    expect(result.stockMoves.find((row) => row.move_type === "loss")).toMatchObject({
      vessel_id: "tank-a",
      volume_ml: -100,
    });
    expect(volumeOf(result.stockMoves)).toBe(-100);
  });

  it("orígenes en los dos mayores con merma atribuida → el cambio de mayor cuadra", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-s", volume_ml: 1_000, product_state: "wine" },
            { role: "input", lot: wine, vessel_id: "bar-s", volume_ml: 1_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-d", volume_ml: 1_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "bar-d", volume_ml: 800, product_state: "wine" },
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-s",
              volume_ml: 200,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([
          holding("tank-s", wine, 1_000),
          barrel({ id: "bar-s", lot_id: wine.id, volume_ml: 1_000, product_state: "wine" }),
          vessel({ id: "tank-d" }),
          barrel({ id: "bar-d" }),
        ]),
        idSource(),
      ),
    );
    const ledger = result.fiscalMoves.filter((row) => row.move_type.startsWith("ledger_change"));
    expect(volumeOf(ledger)).toBe(0);
    expect(volumeOf(result.stockMoves)).toBe(-200);
  });

  it("el mismo recipiente como origen y destino → WC_VALIDATION", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 1_000)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("merma por incidencia sin aprobación → no hay movimientos", () => {
    const source = holding("tank-a", wine, 1_000);
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 80, product_state: "wine" },
          { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 20, loss_kind: "incident", product_state: "wine" },
        ],
      },
      stateOf([source, vessel({ id: "tank-b" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
    expect(source.volume_ml).toBe(1_000);
  });

  it("recipiente fuera de servicio → WC_VESSEL_NOT_IN_SERVICE", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 1_000, "wine", { status: "out_of_service" }), vessel({ id: "tank-b" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VESSEL_NOT_IN_SERVICE");
  });

  it("añadir al mismo lote respeta la capacidad restante", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 2_000, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 2_000, product_state: "wine" },
        ],
      },
      stateOf([
        holding("tank-a", wine, 5_000),
        holding("tank-b", wine, 1_000, "wine", { capacity_ml: 2_500 }),
      ]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC025");
  });

  it("destino con otro lote → WC026", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 1_000), holding("tank-b", other, 100)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC026");
  });
});

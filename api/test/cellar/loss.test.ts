import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import { asOk, barrel, header, holding, idSource, lot, mustLot, stateOf, vessel, volumeOf } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01" });

describe("planOperation · merma y destrucción", () => {
  it("merma autorizada de vino → baja el recipiente y anota loss fiscal", () => {
    const result = asOk(
      planOperation(
        {
          ...header({ reason: "evaporacion" }),
          op_type: "loss",
          lines: [
            {
              role: "loss",
              lot: wine,
              vessel_id: "tank-a",
              volume_ml: 40_000,
              loss_kind: "authorized",
              product_state: "wine",
            },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000_000)]),
        idSource(),
      ),
    );
    expect(volumeOf(result.stockMoves)).toBe(-40_000);
    expect(result.stockMoves[0]).toMatchObject({
      move_type: "loss",
      volume_ml: -40_000,
      loss_kind: "authorized",
      vessel_id: "tank-a",
      lot_id: "lot-a",
    });
    expect(result.fiscalMoves[0]).toMatchObject({
      move_type: "loss",
      product_class: "bulk",
      volume_ml: -40_000,
      units: 0,
      reason: "evaporacion",
    });
    expect(result.vesselsAfter[0]).toMatchObject({ volume_ml: 960_000, lot_id: "lot-a" });
  });

  it("merma que vacía el recipiente → queda sin lote", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "loss",
          lines: [
            { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 1_000, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000)]),
        idSource(),
      ),
    );
    expect(result.vesselsAfter[0]).toMatchObject({ volume_ml: 0, lot_id: null, product_state: null });
  });

  it("merma en barrica de roble → mayor bulk_wood", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "loss",
          lines: [
            { role: "loss", lot: wine, vessel_id: "bar-a", volume_ml: 1_000, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        stateOf([barrel({ id: "bar-a", lot_id: wine.id, volume_ml: 100_000, product_state: "wine" })]),
        idSource(),
      ),
    );
    expect(result.fiscalMoves[0]).toMatchObject({ product_class: "bulk_wood", volume_ml: -1_000 });
  });

  it("merma de mosto → solo libro físico", () => {
    const must = mustLot({ id: "lot-m", code: "M26A01" });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "loss",
          lines: [
            { role: "loss", lot: must, vessel_id: "tank-a", volume_ml: 500, loss_kind: "authorized", product_state: "must" },
          ],
        },
        stateOf([holding("tank-a", must, 2_000, "must")]),
        idSource(),
      ),
    );
    expect(result.stockMoves).toHaveLength(1);
    expect(result.fiscalMoves).toHaveLength(0);
  });

  it("vino fuera del almacén fiscal → sin asiento fiscal", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "loss",
          lines: [
            { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 100, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000, "wine", { tax_warehouse_id: null })]),
        idSource(),
      ),
    );
    expect(result.fiscalMoves).toHaveLength(0);
    expect(volumeOf(result.stockMoves)).toBe(-100);
  });

  it("merma por incidencia sin aprobación → WC_VALIDATION y el recipiente no cambia", () => {
    const source = holding("tank-a", wine, 1_000);
    const result = planOperation(
      {
        ...header({ reason: "rotura" }),
        op_type: "loss",
        lines: [
          { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 100, loss_kind: "incident", product_state: "wine" },
        ],
      },
      stateOf([source]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
    expect(source.volume_ml).toBe(1_000);
  });

  it("merma por incidencia aprobada → hay movimientos", () => {
    const result = asOk(
      planOperation(
        {
          ...header({ reason: "rotura de valvula", approval_request_id: "apr-cellar-loss-1" }),
          op_type: "loss",
          lines: [
            { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 100, loss_kind: "incident", product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000)]),
        idSource(),
      ),
    );
    expect(result.stockMoves[0]?.loss_kind).toBe("incident");
    expect(result.fiscalMoves[0]?.move_type).toBe("loss");
  });

  it("destrucción sin aprobación → no hay movimientos", () => {
    const result = planOperation(
      {
        ...header({ reason: "producto defectuoso" }),
        op_type: "destruction",
        lines: [
          { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 100, loss_kind: "authorized", product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 1_000)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("destrucción aprobada → movimiento físico loss y fiscal destruction", () => {
    const result = asOk(
      planOperation(
        {
          ...header({ reason: "producto defectuoso", approval_request_id: "apr-cellar-loss-2" }),
          op_type: "destruction",
          lines: [
            { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 250, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 1_000)]),
        idSource(),
      ),
    );
    expect(result.stockMoves[0]).toMatchObject({ move_type: "loss", volume_ml: -250, loss_kind: "authorized" });
    expect(result.fiscalMoves[0]).toMatchObject({
      move_type: "destruction",
      volume_ml: -250,
      reason: "producto defectuoso",
    });
    expect(volumeOf(result.stockMoves)).toBe(-250);
  });

  it("más volumen del que hay → WC024", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "loss",
        lines: [
          { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 1_001, loss_kind: "authorized", product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 1_000)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC024");
  });

  it("el helper de recipiente vacío no se usa como origen con volumen", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "loss",
        lines: [
          { role: "loss", lot: wine, vessel_id: "tank-vacio", volume_ml: 1, loss_kind: "authorized", product_state: "wine" },
        ],
      },
      stateOf([vessel({ id: "tank-vacio" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });
});

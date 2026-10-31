import { describe, expect, it } from "bun:test";
import { planOperation } from "../../src/core/cellar/engine";
import type {
  BottlingRequest,
  CellarState,
  LossRequest,
  LotRef,
  OperationRequest,
  TransferRequest,
  VesselState,
} from "../../src/core/cellar/types";
import { asOk, barrel, header, holding, idSource, lot, stateOf, vessel, volumeOf } from "./helpers";

const wine = lot({ id: "lot-a", code: "L25T01" });
const other = lot({ id: "lot-b", code: "L25T02", ancestor_lot_ids: ["lot-root"] });

describe("planOperation · códigos de error", () => {
  it("volúmenes que no cuadran → WC020", () => {
    const result = planOperation(rack({ input: 1_000, output: 900, loss: 50 }), cellar(), idSource());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WC020");
      expect(result.message).toContain("1000");
      expect(result.details).toMatchObject({ inputs_ml: 1_000, outputs_ml: 900, losses_ml: 50 });
    }
  });

  it("sacar más volumen del que hay → WC024", () => {
    const result = planOperation(rack({ input: 1_001, output: 1_001, loss: 0 }), cellar(), idSource());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC024");
  });

  it("el destino supera la capacidad → WC025", () => {
    const result = planOperation(
      rack({ input: 500, output: 500, loss: 0 }),
      stateOf([holding("tank-a", wine, 1_000), vessel({ id: "tank-b", capacity_ml: 499 })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC025");
  });

  it("el destino contiene otro lote → WC026", () => {
    const result = planOperation(
      rack({ input: 100, output: 100, loss: 0 }),
      stateOf([holding("tank-a", wine, 1_000), holding("tank-b", other, 100)]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC026");
  });

  it("unidades y volumen de envasado distintos → WC023", () => {
    const result = planOperation(bottle({ units: 10, volume_ml: 7_499, nominal: 750, input: 7_499 }), cellar(), idSource());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC023");
  });

  it("merma sin mayor entre depósito y barrica → WC028", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "racking",
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-s", volume_ml: 1_000, product_state: "wine" },
          { role: "input", lot: wine, vessel_id: "bar-s", volume_ml: 1_000, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "tank-d", volume_ml: 1_000, product_state: "wine" },
          { role: "output", lot: wine, vessel_id: "bar-d", volume_ml: 800, product_state: "wine" },
          { role: "loss", lot: wine, vessel_id: null, volume_ml: 200, loss_kind: "authorized", product_state: "wine" },
        ],
      },
      stateOf([
        holding("tank-s", wine, 1_000),
        barrel({ id: "bar-s", lot_id: wine.id, volume_ml: 1_000, product_state: "wine" }),
        vessel({ id: "tank-d" }),
        barrel({ id: "bar-d" }),
      ]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC028");
  });

  it("el lote nuevo es antepasado de una entrada → WC030", () => {
    const result = planOperation(
      {
        ...header(),
        op_type: "blend",
        new_lot: { id: "lot-root", code: "ENT27A" },
        lines: [
          { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 100, product_state: "wine" },
          { role: "input", lot: other, vessel_id: "tank-b", volume_ml: 100, product_state: "wine" },
          { role: "output", vessel_id: "tank-c", volume_ml: 200, product_state: "wine" },
        ],
      },
      stateOf([holding("tank-a", wine, 100), holding("tank-b", other, 100), vessel({ id: "tank-c" })]),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WC030");
      expect(result.details).toMatchObject({ child_lot_id: "lot-root", parent_lot_id: "lot-b" });
    }
  });

  it("envasado cuyo id nuevo es el del granel → WC030", () => {
    const result = planOperation(
      {
        ...bottle({ units: 1, volume_ml: 750, nominal: 750, input: 750 }),
        new_lot: { id: "lot-a", code: "L27031" },
      },
      cellar(),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC030");
  });

  it("volumen no entero → WC_VALIDATION", () => {
    const result = planOperation(rack({ input: 1.5, output: 1.5, loss: 0 }), cellar(), idSource());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("fecha fiscal imposible → WC_VALIDATION", () => {
    const result = planOperation(
      { ...rack({ input: 100, output: 100, loss: 0 }), fiscal_date: "2026-02-29" },
      cellar(),
      idSource(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WC_VALIDATION");
  });

  it("merma de trasiego en el mismo mayor → loss fiscal y ningún cambio de mayor", () => {
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "racking",
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 1_000, product_state: "wine" },
            { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: 900, product_state: "wine" },
            { role: "loss", lot: wine, vessel_id: "tank-a", volume_ml: 100, loss_kind: "authorized", product_state: "wine" },
          ],
        },
        cellar(),
        idSource(),
      ),
    );
    expect(result.fiscalMoves.map((row) => row.move_type)).toEqual(["loss"]);
    expect(result.fiscalMoves[0]).toMatchObject({
      product_class: "bulk",
      volume_ml: -100,
      excise_product_key: "GRANEL-TINTO",
    });
  });

  it("ensamblaje de distinto color → cambio de mayor equilibrado", () => {
    const blanco = lot({ id: "lot-w", code: "L26W01", excise_product_key: "GRANEL-BLANCO" });
    const result = asOk(
      planOperation(
        {
          ...header(),
          op_type: "blend",
          new_lot: { code: "ROS27A", excise_product_key: "GRANEL-ROSADO" },
          lines: [
            { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: 60, product_state: "wine" },
            { role: "input", lot: blanco, vessel_id: "tank-b", volume_ml: 40, product_state: "wine" },
            { role: "output", vessel_id: "tank-c", volume_ml: 100, product_state: "wine" },
          ],
        },
        stateOf([holding("tank-a", wine, 60), holding("tank-b", blanco, 40), vessel({ id: "tank-c" })]),
        idSource(),
      ),
    );
    const ledger = result.fiscalMoves.filter((row) => row.move_type.startsWith("ledger_change"));
    expect(volumeOf(ledger)).toBe(0);
    expect(ledger.map((row) => [row.excise_product_key, row.volume_ml])).toEqual([
      ["GRANEL-BLANCO", -40],
      ["GRANEL-TINTO", -60],
      ["GRANEL-ROSADO", 100],
    ]);
  });

  it("una operación válida no muta el estado de entrada", () => {
    const source = Object.freeze(holding("tank-a", wine, 1_000));
    const dest = Object.freeze(vessel({ id: "tank-b" }));
    const before = source.volume_ml;
    const result = asOk(planOperation(rack({ input: 400, output: 400, loss: 0 }), stateOf([source, dest]), idSource()));
    expect(source.volume_ml).toBe(before);
    expect(result.vesselsAfter.find((row) => row.id === "tank-a")?.volume_ml).toBe(600);
    expect(volumeOf(result.stockMoves)).toBe(0);
  });
});

describe("planOperation · propiedades", () => {
  it("secuencias aleatorias conservan el volumen, la capacidad, un lote por recipiente y la genealogía", () => {
    const totals = { racking: 0, blend: 0, bottling: 0, loss: 0, addition: 0, cleaning: 0 };
    for (let seed = 1; seed <= 12; seed += 1) {
      const counts = runSequence(seed);
      totals.racking += counts.racking;
      totals.blend += counts.blend;
      totals.bottling += counts.bottling;
      totals.loss += counts.loss;
      totals.addition += counts.addition;
      totals.cleaning += counts.cleaning;
    }
    expect(totals.racking).toBeGreaterThan(0);
    expect(totals.blend).toBeGreaterThan(0);
    expect(totals.bottling).toBeGreaterThan(0);
    expect(totals.loss).toBeGreaterThan(0);
    expect(totals.addition).toBeGreaterThan(0);
    expect(totals.cleaning).toBeGreaterThan(0);
  });
});

function cellar(): CellarState {
  return stateOf([holding("tank-a", wine, 1_000), vessel({ id: "tank-b" })]);
}

function rack(args: { input: number; output: number; loss: number }): TransferRequest {
  const lines: TransferRequest["lines"][number][] = [
    { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: args.input, product_state: "wine" },
    { role: "output", lot: wine, vessel_id: "tank-b", volume_ml: args.output, product_state: "wine" },
  ];
  if (args.loss > 0) {
    lines.push({
      role: "loss",
      lot: wine,
      vessel_id: "tank-a",
      volume_ml: args.loss,
      loss_kind: "authorized",
      product_state: "wine",
    });
  }
  return { ...header(), op_type: "racking", lines };
}

function bottle(args: { units: number; volume_ml: number; nominal: number; input: number }): BottlingRequest {
  return {
    ...header(),
    op_type: "bottling",
    new_lot: { code: "L27031" },
    lines: [
      { role: "input", lot: wine, vessel_id: "tank-a", volume_ml: args.input, product_state: "wine" },
      {
        role: "output",
        location_id: "loc-bod",
        product_id: "sku-b075",
        product_state: "packaged_unlabeled",
        qty_units: args.units,
        volume_ml: args.volume_ml,
        nominal_volume_ml: args.nominal,
        excise_product_key: "B075-ARCAL",
        nc_code: null,
      },
    ],
  };
}

interface Counts {
  racking: number;
  blend: number;
  bottling: number;
  loss: number;
  addition: number;
  cleaning: number;
}

function runSequence(seed: number): Counts {
  const rng = mulberry32(seed);
  const lots = new Map<string, LotRef>();
  const lotA = lot({ id: "lot-a", code: "L26A01" });
  const lotB = lot({ id: "lot-b", code: "L26B01", wine_id: "wine-entredicho" });
  const lotC = lot({ id: "lot-c", code: "L23C01", vintage: 2023, wine_id: "wine-rosado", excise_product_key: "GRANEL-ROSADO" });
  const lotD = lot({ id: "lot-d", code: "L24D01", excise_product_key: "CRIANZA-TINTO" });
  for (const row of [lotA, lotB, lotC, lotD]) lots.set(row.id, row);

  const map = new Map<string, VesselState>([
    ["tank-1", holding("tank-1", lotA, 5_000_000)],
    ["tank-2", holding("tank-2", lotB, 4_000_000)],
    ["tank-3", holding("tank-3", lotC, 3_000_000)],
    ["tank-4", vessel({ id: "tank-4" })],
    ["bar-1", barrel({ id: "bar-1" })],
    ["bar-2", barrel({ id: "bar-2" })],
    ["bar-3", barrel({ id: "bar-3", lot_id: lotD.id, volume_ml: 100_000, product_state: "wine" })],
    ["bar-4", barrel({ id: "bar-4" })],
  ]);

  let expected = [...map.values()].reduce((total, row) => total + row.volume_ml, 0);
  let packaged = 0;
  const edges: { child_lot_id: string; parent_lot_id: string }[] = [];
  const counts: Counts = { racking: 0, blend: 0, bottling: 0, loss: 0, addition: 0, cleaning: 0 };
  const ids = idSource();
  let serial = 0;
  const order = ["racking", "blend", "bottling", "loss", "addition", "cleaning"] as const;

  for (let step = 0; step < 24; step += 1) {
    const preferred = order[step % order.length] ?? "cleaning";
    const queue = [preferred, ...order.filter((kind) => kind !== preferred)];
    let request: OperationRequest | null = null;
    let kind: (typeof order)[number] | null = null;
    for (const candidate of queue) {
      request = build(candidate, rng, map, lots, seed, step, () => {
        serial += 1;
        return serial;
      });
      if (request !== null) {
        kind = candidate;
        break;
      }
    }
    if (request === null || kind === null) {
      throw new Error(`seed ${seed} step ${step}: no se pudo construir una operación`);
    }

    const view = new Map<string, VesselState>();
    for (const [id, row] of map) view.set(id, Object.freeze({ ...row }));
    const result = planOperation(request, { vessels: view }, ids);
    if (!result.ok) {
      throw new Error(`seed ${seed} step ${step} ${request.op_type} → ${result.code}: ${result.message}`);
    }

    const loss = declaredLoss(request);
    expect(volumeOf(result.stockMoves) + loss).toBe(0);
    const ledger = result.fiscalMoves.filter(
      (row) => row.move_type === "ledger_change_out" || row.move_type === "ledger_change_in",
    );
    expect(volumeOf(ledger)).toBe(0);
    expect(new Set(result.vesselsAfter.map((row) => row.id)).size).toBe(result.vesselsAfter.length);

    for (const row of result.vesselsAfter) map.set(row.id, row);
    for (const draft of result.newLots) {
      const ancestors = new Set<string>();
      const parentColours: (string | null)[] = [];
      for (const edge of result.lotEdges) {
        if (edge.child_lot_id !== draft.id) continue;
        ancestors.add(edge.parent_lot_id);
        const parent = lots.get(edge.parent_lot_id);
        parentColours.push(colourOf(parent?.excise_product_key ?? null));
        if (parent !== undefined) {
          for (const id of parent.ancestor_lot_ids) ancestors.add(id);
        }
      }
      const firstColour = parentColours[0] ?? null;
      const sharedColour = firstColour !== null && parentColours.every((colour) => colour === firstColour)
        ? firstColour
        : null;
      lots.set(draft.id, {
        id: draft.id,
        code: draft.code,
        kind: draft.kind,
        vintage: draft.vintage,
        producer_entity_id: draft.producer_entity_id,
        wine_id: draft.wine_id,
        is_organic: draft.is_organic,
        ancestor_lot_ids: [...ancestors],
        excise_product_key: sharedColour === null ? null : `GRANEL-${sharedColour}`,
        abv_pct: null,
      });
      expect(result.lotEdges.some((edge) => edge.child_lot_id === draft.id && edge.volume_ml > 0)).toBe(true);
    }
    edges.push(...result.lotEdges);
    expect(hasCycle(edges)).toBe(false);

    for (const row of result.stockMoves) {
      if (row.product_state === "packaged_unlabeled" || row.product_state === "packaged_labeled") {
        packaged += row.volume_ml;
      }
    }
    expected -= loss;

    let vesselSum = 0;
    for (const row of map.values()) {
      expect(row.volume_ml).toBeGreaterThanOrEqual(0);
      expect(row.volume_ml).toBeLessThanOrEqual(row.capacity_ml);
      if (row.volume_ml === 0) expect(row.lot_id).toBeNull();
      else expect(row.lot_id).not.toBeNull();
      vesselSum += row.volume_ml;
    }
    expect(vesselSum + packaged).toBe(expected);
    counts[kind] += 1;
  }
  return counts;
}

function declaredLoss(req: OperationRequest): number {
  if (!("lines" in req)) return 0;
  let total = 0;
  for (const line of req.lines) {
    if (line.role === "loss") total += line.volume_ml;
  }
  return total;
}

type Kind = "racking" | "blend" | "bottling" | "loss" | "addition" | "cleaning";

function build(
  kind: Kind,
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  seed: number,
  step: number,
  nextSerial: () => number,
): OperationRequest | null {
  if (kind === "racking") return buildTransfer(rng, map, lots, step);
  if (kind === "blend") return buildBlend(rng, map, lots, seed, step, nextSerial);
  if (kind === "bottling") return buildBottling(rng, map, lots, seed, step, nextSerial);
  if (kind === "loss") return buildLoss(rng, map, lots, step);
  if (kind === "addition") return buildAddition(rng, map, lots, step);
  return buildCleaning(rng, map, step);
}

function filled(map: ReadonlyMap<string, VesselState>): VesselState[] {
  return [...map.values()].filter((row) => row.volume_ml > 0 && row.lot_id !== null && row.status === "in_service");
}

function pick<T>(rng: () => number, rows: readonly T[]): T | undefined {
  if (rows.length === 0) return undefined;
  const index = Math.floor(rng() * rows.length);
  return rows[index];
}

function int(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function buildTransfer(
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  step: number,
): TransferRequest | null {
  const source = pick(rng, filled(map));
  if (source?.lot_id == null) return null;
  const lotRef = lots.get(source.lot_id);
  if (lotRef === undefined || source.product_state === null) return null;
  const dest = pick(
    rng,
    [...map.values()].filter(
      (row) =>
        row.id !== source.id &&
        row.status === "in_service" &&
        row.tax_warehouse_id === source.tax_warehouse_id &&
        row.capacity_ml - row.volume_ml >= 1 &&
        (row.volume_ml === 0 || row.lot_id === source.lot_id),
    ),
  );
  if (dest === undefined) return null;
  const room = dest.capacity_ml - dest.volume_ml;
  const maxOut = Math.min(source.volume_ml, room);
  if (maxOut < 1) return null;
  const half = Math.floor(source.volume_ml / 2);
  const capOut = Math.max(1, Math.min(maxOut, half > 0 ? half : maxOut));
  const output = int(rng, 1, capOut);
  const maxLoss = source.volume_ml - output;
  const lossCap = Math.min(maxLoss, Math.floor(output / 5));
  const loss = lossCap <= 0 ? 0 : int(rng, 0, lossCap);
  const lines: TransferRequest["lines"][number][] = [
    { role: "input", lot: lotRef, vessel_id: source.id, volume_ml: output + loss, product_state: source.product_state },
    { role: "output", lot: lotRef, vessel_id: dest.id, volume_ml: output, product_state: source.product_state },
  ];
  if (loss > 0) {
    lines.push({
      role: "loss",
      lot: lotRef,
      vessel_id: source.id,
      volume_ml: loss,
      loss_kind: "authorized",
      product_state: source.product_state,
    });
  }
  return { ...header({ id: `op-s${step}` }), op_type: "racking", lines };
}

function buildBlend(
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  seed: number,
  step: number,
  nextSerial: () => number,
): OperationRequest | null {
  const sources = filled(map).filter((row) => row.product_state === "wine" || row.product_state === "must");
  const first = pick(rng, sources);
  if (first?.lot_id == null || first.product_state === null) return null;
  const second = pick(
    rng,
    sources.filter((row) => row.id !== first.id && row.lot_id !== first.lot_id && row.product_state === first.product_state),
  );
  if (second?.lot_id == null) return null;
  const lotA = lots.get(first.lot_id);
  const lotB = lots.get(second.lot_id);
  if (lotA === undefined || lotB === undefined || lotA.is_organic !== lotB.is_organic) return null;
  if (first.product_state === "wine" && (colourOf(lotA.excise_product_key) === null || colourOf(lotA.excise_product_key) !== colourOf(lotB.excise_product_key))) {
    return null;
  }
  const dest = pick(
    rng,
    [...map.values()].filter(
      (row) =>
        row.volume_ml === 0 &&
        row.status === "in_service" &&
        row.tax_warehouse_id === first.tax_warehouse_id &&
        row.id !== first.id &&
        row.id !== second.id,
    ),
  );
  if (dest === undefined) return null;
  const half = Math.max(1, Math.floor(dest.capacity_ml / 2));
  const takeA = Math.min(first.volume_ml, half);
  const takeB = Math.min(second.volume_ml, dest.capacity_ml - takeA);
  if (takeA < 1 || takeB < 1 || takeA + takeB > dest.capacity_ml) return null;
  const serial = nextSerial();
  return {
    ...header({ id: `op-b${step}` }),
    op_type: "blend",
    new_lot: { code: `B${seed}N${serial}` },
    lines: [
      { role: "input", lot: lotA, vessel_id: first.id, volume_ml: takeA, product_state: first.product_state },
      { role: "input", lot: lotB, vessel_id: second.id, volume_ml: takeB, product_state: first.product_state },
      { role: "output", vessel_id: dest.id, volume_ml: takeA + takeB, product_state: first.product_state },
    ],
  };
}

function buildBottling(
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  seed: number,
  step: number,
  nextSerial: () => number,
): BottlingRequest | null {
  const source = pick(
    rng,
    filled(map).filter((row) => row.product_state === "wine" && row.volume_ml >= 750),
  );
  if (source?.lot_id == null) return null;
  const lotRef = lots.get(source.lot_id);
  if (lotRef === undefined || lotRef.kind !== "wine") return null;
  const unitsMax = Math.min(20, Math.floor(source.volume_ml / 750));
  if (unitsMax < 1) return null;
  const units = int(rng, 1, unitsMax);
  const volume = units * 750;
  const serial = nextSerial();
  return {
    ...header({ id: `op-e${step}` }),
    op_type: "bottling",
    new_lot: { code: `P${seed}N${serial}` },
    lines: [
      { role: "input", lot: lotRef, vessel_id: source.id, volume_ml: volume, product_state: "wine" },
      {
        role: "output",
        location_id: "loc-bod",
        product_id: "sku-b075",
        product_state: "packaged_unlabeled",
        qty_units: units,
        volume_ml: volume,
        nominal_volume_ml: 750,
        excise_product_key: "B075-ARCAL",
        nc_code: null,
      },
    ],
  };
}

function buildLoss(
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  step: number,
): LossRequest | null {
  const source = pick(rng, filled(map));
  if (source?.lot_id == null || source.product_state === null) return null;
  const lotRef = lots.get(source.lot_id);
  if (lotRef === undefined) return null;
  const cap = Math.max(1, Math.min(source.volume_ml, Math.floor(source.volume_ml / 10) || 1));
  const amount = int(rng, 1, cap);
  return {
    ...header({ id: `op-m${step}` }),
    op_type: "loss",
    lines: [
      {
        role: "loss",
        lot: lotRef,
        vessel_id: source.id,
        volume_ml: amount,
        loss_kind: "authorized",
        product_state: source.product_state,
      },
    ],
  };
}

function buildAddition(
  rng: () => number,
  map: ReadonlyMap<string, VesselState>,
  lots: ReadonlyMap<string, LotRef>,
  step: number,
): OperationRequest | null {
  const source = pick(rng, filled(map));
  if (source?.lot_id == null) return null;
  const lotRef = lots.get(source.lot_id);
  if (lotRef === undefined) return null;
  return {
    ...header({ id: `op-a${step}` }),
    op_type: "addition",
    vessel_id: source.id,
    lot: lotRef,
    addition: {
      additive_product_id: "prod-so2",
      quantity: "2.000",
      quantity_unit: "g",
      dose: "2",
      dose_unit: "g/hl",
      purpose: "sulphiting",
      supplier_invoice_id: null,
      organic_approved: true,
    },
  };
}

function buildCleaning(rng: () => number, map: ReadonlyMap<string, VesselState>, step: number): OperationRequest | null {
  const rows = [...map.values()].filter((row) => row.status !== "retired");
  const target = pick(rng, rows);
  if (target === undefined) return null;
  return {
    ...header({ id: `op-l${step}` }),
    op_type: "cleaning",
    cleaning: {
      vessel_id: target.id,
      location_id: null,
      product_id: "prod-peracetic",
      active_substance: "acido peracetico",
      quantity: "1.000",
      quantity_unit: "l",
      efficacy_check: "aclarado",
      supplier_invoice_id: null,
    },
  };
}

function hasCycle(edges: readonly { child_lot_id: string; parent_lot_id: string }[]): boolean {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.child_lot_id) ?? [];
    list.push(edge.parent_lot_id);
    parents.set(edge.child_lot_id, list);
  }
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(id, 1);
    for (const parent of parents.get(id) ?? []) {
      if (visit(parent)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of parents.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

function colourOf(key: string | null): string | null {
  if (key === null) return null;
  const match = /^(?:GRANEL|CRIANZA)-(TINTO|BLANCO|ROSADO)$/.exec(key);
  return match?.[1] ?? null;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

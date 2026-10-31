import { describe, expect, it } from "bun:test";
import { entriesFor, signedVolumeMl } from "../../src/core/regulatory/silicie/entries";
import type { EntriesContext, FiscalMoveInput, MoveHint } from "../../src/core/regulatory/silicie/types";
import { bottles, ctx, move, opening, PARTY_ID } from "./support";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function scenario(seed: number): { moves: FiscalMoveInput[]; context: EntriesContext } {
  const rng = mulberry32(seed);
  const moves: FiscalMoveInput[] = [
    opening("open-granel", "bulk", "GRANEL-TINTO", 5_000_000, `AF-G-${seed}`),
    opening("open-crianza", "bulk_wood", "CRIANZA-TINTO", 1_000_000, `AF-C-${seed}`),
    opening("open-pack", "packaged", "B075-SINTE", 20 * 750, `AF-P-${seed}`, bottles(20)),
  ];
  const hints: Record<string, MoveHint> = {};
  const day = () => `2027-03-${String(integer(rng, 1, 27)).padStart(2, "0")}`;
  const push = (row: FiscalMoveInput, hint?: MoveHint) => {
    moves.push(row);
    if (hint !== undefined) {
      hints[row.id] = hint;
    }
  };
  const bottlesN = integer(rng, 1, 4);
  const merma = integer(rng, 1, 200);
  const packed = bottles(bottlesN);
  push(
    move({
      id: `pack-out-${seed}`,
      moveType: "packaging_out_bulk",
      productClass: "bulk",
      exciseProductKey: "GRANEL-TINTO",
      fiscalDate: day(),
      volumeMl: -(packed.volumeMl + merma),
      justificationRef: `ENV-${seed}`,
      sourceId: `env-${seed}`,
    }),
  );
  push(
    move({
      id: `pack-in-${seed}`,
      moveType: "packaging_in_packaged",
      productClass: "packaged",
      exciseProductKey: "B075-SINTE",
      fiscalDate: moves[moves.length - 1]?.fiscalDate ?? "2027-03-01",
      volumeMl: packed.volumeMl,
      units: packed.units,
      justificationRef: `ENV-${seed}`,
      sourceId: `env-${seed}`,
    }),
  );
  for (let step = 0; step < 6; step += 1) {
    const id = `s${seed}-n${step}`;
    const roll = integer(rng, 0, 5);
    const date = day();
    if (roll === 0) {
      push(
        move({
          id,
          moveType: "production",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: date,
          volumeMl: integer(rng, 1_000, 9_000),
          justificationRef: id,
          sourceId: id,
        }),
      );
    } else if (roll === 1) {
      push(
        move({
          id,
          moveType: "loss",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: date,
          volumeMl: -integer(rng, 1, 500),
          justificationRef: id,
          sourceId: id,
        }),
      );
    } else if (roll === 2) {
      const sold = bottles(integer(rng, 1, 3), -1);
      push(
        move({
          id,
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: date,
          volumeMl: sold.volumeMl,
          units: sold.units,
          justificationType: "invoice",
          justificationRef: id,
          counterpartyContactId: PARTY_ID,
          fiscalTrigger: "invoice",
          sourceTable: "billing.invoice",
          sourceId: id,
        }),
      );
    } else if (roll === 3) {
      push(
        move({
          id,
          moveType: "exit_export",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: date,
          volumeMl: -integer(rng, 100, 2_000),
          justificationType: "e_ad",
          justificationRef: `ARC-${id}`,
          counterpartyContactId: PARTY_ID,
          sourceId: id,
        }),
      );
    } else if (roll === 4) {
      const volume = integer(rng, 100, 2_000);
      push(
        move({
          id: `${id}-out`,
          moveType: "ledger_change_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: date,
          volumeMl: -volume,
          justificationRef: id,
          sourceId: id,
        }),
      );
      push(
        move({
          id: `${id}-in`,
          moveType: "ledger_change_in",
          productClass: "bulk_wood",
          exciseProductKey: "CRIANZA-TINTO",
          fiscalDate: date,
          volumeMl: volume,
          justificationRef: id,
          sourceId: id,
        }),
      );
    } else {
      push(
        move({
          id,
          moveType: "destruction",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: date,
          volumeMl: -integer(rng, 10, 400),
          justificationRef: id,
          reason: "partida no apta",
          sourceId: id,
        }),
        { destructionDocument: "authorization" },
      );
    }
  }
  return {
    moves,
    context: ctx({
      hints,
      facts: [
        {
          kind: "grape_reception",
          id: `uva-${seed}`,
          date: "2027-09-12",
          massG: integer(rng, 1_000, 5_000),
          justificationRef: `VD-${seed}`,
        },
      ],
    }),
  };
}

describe("propiedad de saldo", () => {
  it("por mayor, la suma con signo de los asientos iguala el cambio de saldo fiscal", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const built = scenario(seed);
      const entries = entriesFor(built.moves, built.context);
      const moveSum = new Map<string, number>();
      for (const row of built.moves) {
        const key = row.exciseProductKey ?? "";
        moveSum.set(key, (moveSum.get(key) ?? 0) + row.volumeMl);
      }
      const entrySum = new Map<string, number>();
      for (const entry of entries) {
        const key = entry.fields.referenciaProducto;
        entrySum.set(key, (entrySum.get(key) ?? 0) + signedVolumeMl(entry));
      }
      const keys = new Set<string>([...moveSum.keys(), ...entrySum.keys()]);
      for (const key of keys) {
        expect(entrySum.get(key) ?? 0, `semilla ${seed} mayor ${key}`).toBe(moveSum.get(key) ?? 0);
      }
      const informative = entries.filter((entry) => entry.entryKind === "A32");
      expect(informative.length, `semilla ${seed}`).toBeGreaterThan(0);
      for (const entry of informative) {
        expect(signedVolumeMl(entry)).toBe(0);
      }
      for (const entry of entries) {
        expect(entry.fields.tipoJustificante).not.toBe("");
        expect(entry.fields.numeroJustificante).not.toBe("");
      }
    }
  });
});

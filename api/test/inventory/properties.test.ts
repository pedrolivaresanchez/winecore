import { describe, expect, it } from "bun:test";
import { findNegativeBalances, fiscalBalanceAt, stockAt } from "../../src/core/inventory/balances";
import { planCountAdjustments, planOpeningCount } from "../../src/core/inventory/count";
import { assertPeriodOpen, businessDate, periodOf } from "../../src/core/inventory/periods";
import { FISCAL_LEDGER_KEYS, STOCK_GROUP_KEYS, isStockMove, type StockMove } from "../../src/core/inventory/types";
import {
  CVPO,
  PO,
  WH,
  countLine,
  fiscalCtx,
  fiscalDrafts,
  fiscalMove,
  id,
  lock,
  openingCtx,
  physicalCtx,
  stockDrafts,
  stockMove,
} from "./fixtures";

/** mulberry32, seeded. No library. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (Math.imul(t ^ (t >>> 7), t | 61) + t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function formatOffset(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  const iso = shifted.toISOString().slice(0, 19);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${iso}${sign}${hh}:${mm}`;
}

function shiftDate(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(iso);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function stockKey(move: StockMove): string {
  return JSON.stringify([
    move.location_id,
    move.vessel_id,
    move.owner_entity_id,
    move.lot_id,
    move.product_id,
    move.product_state,
  ]);
}

describe("propiedades", () => {
  it("el saldo a un instante es la suma de los movimientos hasta ese instante", () => {
    const rng = mulberry32(20270101);
    for (let trial = 0; trial < 120; trial += 1) {
      const keyCount = randInt(rng, 1, 4);
      const keys = Array.from({ length: keyCount }, (_, index) => ({
        location_id: id(0x1000 + index),
        vessel_id: rng() < 0.25 ? null : id(0x1100 + index),
        owner_entity_id: rng() < 0.5 ? PO : CVPO,
        lot_id: rng() < 0.25 ? null : id(0x1200 + index),
        product_id: rng() < 0.5 ? null : id(0x1300 + index),
        product_state: rng() < 0.5 ? ("wine" as const) : ("must" as const),
      }));
      const count = randInt(rng, 1, 12);
      const moves: StockMove[] = [];
      for (let index = 0; index < count; index += 1) {
        const key = keys[randInt(rng, 0, keyCount - 1)];
        if (!key) throw new Error("clave");
        const ms = Date.UTC(2027, 0, 1 + randInt(rng, 0, 40), randInt(rng, 0, 23), randInt(rng, 0, 59), randInt(rng, 0, 59));
        const offset = rng() < 0.5 ? 0 : rng() < 0.5 ? 60 : 120;
        moves.push(
          stockMove({
            ...key,
            occurred_at: offset === 0 ? new Date(ms).toISOString() : formatOffset(ms, offset),
            move_type: "cellar_in",
            volume_ml: randInt(rng, -400_000, 700_000),
            qty_units: randInt(rng, -5, 8),
            mass_g: randInt(rng, -15, 15),
            source_id: id(0x1400 + trial * 20 + index),
          }),
        );
      }
      const times = moves.map((move) => Date.parse(move.occurred_at)).sort((left, right) => left - right);
      const pick = randInt(rng, 0, times.length);
      const first = times[0];
      const last = times[times.length - 1];
      if (first === undefined || last === undefined) throw new Error("tiempos");
      const atMs = pick === 0 ? first - 1_000 : pick === times.length ? last + 1_000 : times[pick - 1];
      if (atMs === undefined) throw new Error("corte");
      const at = new Date(atMs).toISOString();
      const rows = stockAt(moves, at, STOCK_GROUP_KEYS);
      const oracle = new Map<string, { qty: number; volume: number; mass: number }>();
      for (const move of moves) {
        if (Date.parse(move.occurred_at) > Date.parse(at)) continue;
        const key = stockKey(move);
        const current = oracle.get(key) ?? { qty: 0, volume: 0, mass: 0 };
        current.qty += move.qty_units;
        current.volume += move.volume_ml;
        current.mass += move.mass_g;
        oracle.set(key, current);
      }
      let expectedVolume = 0;
      let expectedQty = 0;
      let expectedMass = 0;
      for (const [key, total] of oracle) {
        expectedVolume += total.volume;
        expectedQty += total.qty;
        expectedMass += total.mass;
        const row = rows.find(
          (item) =>
            JSON.stringify([
              item.location_id,
              item.vessel_id,
              item.owner_entity_id,
              item.lot_id,
              item.product_id,
              item.product_state,
            ]) === key,
        );
        if (total.qty === 0 && total.volume === 0 && total.mass === 0) {
          expect(row).toBeUndefined();
        } else {
          expect(row?.qty_units).toBe(total.qty);
          expect(row?.volume_ml).toBe(total.volume);
          expect(row?.mass_g).toBe(total.mass);
        }
      }
      expect(rows.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(expectedVolume);
      expect(rows.reduce((sum, row) => sum + row.qty_units, 0)).toBe(expectedQty);
      expect(rows.reduce((sum, row) => sum + row.mass_g, 0)).toBe(expectedMass);

      const byLocation = stockAt(moves, at, ["location"]);
      expect(byLocation.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(expectedVolume);
      const shuffled = moves.slice();
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = randInt(rng, 0, index);
        const current = shuffled[index];
        const other = shuffled[swap];
        if (current === undefined || other === undefined) throw new Error("baraja");
        shuffled[index] = other;
        shuffled[swap] = current;
      }
      expect(stockAt(shuffled, at, STOCK_GROUP_KEYS)).toEqual(rows);
    }
  });

  it("el saldo fiscal a una fecha es la suma de los movimientos fiscales hasta ese día", () => {
    const rng = mulberry32(20270601);
    for (let trial = 0; trial < 80; trial += 1) {
      const moves = Array.from({ length: randInt(rng, 1, 8) }, (_, index) => {
        const day = randInt(rng, 1, 28);
        const month = randInt(rng, 1, 6);
        const fiscalDate = new Date(Date.UTC(2027, month - 1, day)).toISOString().slice(0, 10);
        const productClass = rng() < 0.7 ? ("bulk" as const) : ("bulk_wood" as const);
        const excise = rng() < 0.3 ? null : rng() < 0.5 ? "GRANEL-TINTO" : "CRIANZA-TINTO";
        return fiscalMove({
          fiscal_date: fiscalDate,
          product_class: productClass,
          excise_product_key: excise,
          volume_ml: randInt(rng, -4_000, 8_000) || 1,
          units: randInt(rng, -3, 4),
          source_id: id(0x1500 + trial * 10 + index),
        });
      });
      const at = new Date(Date.UTC(2027, randInt(rng, 0, 5), randInt(rng, 1, 28))).toISOString().slice(0, 10);
      const rows = fiscalBalanceAt(moves, at, FISCAL_LEDGER_KEYS);
      const oracle = new Map<string, { volume: number; units: number }>();
      for (const move of moves) {
        if (move.fiscal_date > at) continue;
        const key = JSON.stringify([move.tax_warehouse_id, move.product_class, move.excise_product_key]);
        const current = oracle.get(key) ?? { volume: 0, units: 0 };
        current.volume += move.volume_ml;
        current.units += move.units;
        oracle.set(key, current);
      }
      let volume = 0;
      let units = 0;
      for (const [key, total] of oracle) {
        volume += total.volume;
        units += total.units;
        const row = rows.find(
          (item) => JSON.stringify([item.tax_warehouse_id, item.product_class, item.excise_product_key]) === key,
        );
        if (total.volume === 0 && total.units === 0) expect(row).toBeUndefined();
        else {
          expect(row?.volume_ml).toBe(total.volume);
          expect(row?.units).toBe(total.units);
        }
      }
      expect(rows.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(volume);
      expect(rows.reduce((sum, row) => sum + row.units, 0)).toBe(units);
    }
  });

  it("los ajustes planificados dejan el libro igual al contado y no ajustan si ya coincide", () => {
    const rng = mulberry32(20271031);
    const countedAt = "2027-06-20T12:00:00Z";
    for (let trial = 0; trial < 60; trial += 1) {
      const book = [0, 1, 2].map((index) =>
        stockMove({
          occurred_at: "2027-06-01T08:00:00Z",
          move_type: "opening",
          vessel_id: id(0x1600 + index),
          lot_id: id(0x1700 + index),
          volume_ml: randInt(rng, 1_000, 40_000),
          source_id: id(0x1800 + trial * 10 + index),
        }),
      );
      book.push(
        stockMove({
          occurred_at: "2027-06-01T08:00:00Z",
          move_type: "opening",
          vessel_id: id(0x16ff),
          lot_id: id(0x17ff),
          volume_ml: 7_777,
          source_id: id(0x18ff),
        }),
      );
      const lines = book.slice(0, 3).map((move, index) => {
        const forceEqual = trial === 0;
        const counted = forceEqual || rng() < 0.25 ? move.volume_ml : randInt(rng, 0, move.volume_ml * 2);
        return countLine({
          id: id(0x1900 + trial * 10 + index),
          vessel_id: move.vessel_id,
          lot_id: move.lot_id,
          counted_qty_units: 0,
          counted_volume_ml: counted,
          difference_reason: counted === move.volume_ml ? null : "Diferencia de aforo",
        });
      });
      const drafts = planCountAdjustments(book, lines, physicalCtx({ counted_at: countedAt }));
      if (lines.every((line, index) => line.counted_volume_ml === book[index]?.volume_ml)) {
        expect(drafts).toHaveLength(0);
      }
      const after = stockAt([...book, ...stockDrafts(drafts)], countedAt, STOCK_GROUP_KEYS);
      for (const line of lines) {
        const row = after.find((item) => item.vessel_id === line.vessel_id && item.lot_id === line.lot_id);
        expect(row?.volume_ml ?? 0).toBe(line.counted_volume_ml ?? 0);
        expect(row?.qty_units ?? 0).toBe(0);
      }
      expect(after.find((row) => row.vessel_id === id(0x16ff))?.volume_ml).toBe(7_777);
      for (const draft of drafts) {
        expect(draft.approval_required).toBe(true);
        if (!isStockMove(draft.move)) throw new Error("físico");
        expect(draft.move.move_type).toBe(draft.move.volume_ml > 0 ? "count_adjust_in" : "count_adjust_out");
      }
    }
  });

  it("la regularización fiscal deja el mayor contado y no toca otra clave", () => {
    const rng = mulberry32(20270328);
    for (let trial = 0; trial < 40; trial += 1) {
      const bookVolume = randInt(rng, 0, 9_000);
      const countedVolume = trial === 0 ? bookVolume : randInt(rng, 0, 9_000);
      const book = [
        fiscalMove({
          fiscal_date: "2027-06-01",
          volume_ml: 1_234,
          excise_product_key: "GRANEL-BLANCO",
          source_id: id(0x1a00),
        }),
      ];
      if (bookVolume > 0) {
        book.push(
          fiscalMove({
            fiscal_date: "2027-06-01",
            volume_ml: bookVolume,
            excise_product_key: "GRANEL-TINTO",
            source_id: id(0x1a01 + trial),
          }),
        );
      }
      const drafts = planCountAdjustments(
        book,
        [
          countLine({
            id: id(0x1b00 + trial),
            counted_qty_units: 0,
            counted_volume_ml: countedVolume,
            tax_warehouse_id: WH,
            product_class: "bulk",
            excise_product_key: "GRANEL-TINTO",
            difference_reason: countedVolume === bookVolume ? null : "Regularización de aforo",
          }),
        ],
        fiscalCtx(),
      );
      if (countedVolume === bookVolume) expect(drafts).toHaveLength(0);
      const after = fiscalBalanceAt([...book, ...fiscalDrafts(drafts)], "2027-06-20", FISCAL_LEDGER_KEYS);
      expect(after.find((row) => row.excise_product_key === "GRANEL-TINTO")?.volume_ml ?? 0).toBe(countedVolume);
      expect(after.find((row) => row.excise_product_key === "GRANEL-BLANCO")?.volume_ml).toBe(1_234);
    }
  });

  it("la apertura física respeta al propietario y la fiscal solo suma el perímetro", () => {
    const rng = mulberry32(20271231);
    for (let trial = 0; trial < 40; trial += 1) {
      const lines = Array.from({ length: randInt(rng, 2, 5) }, (_, index) => {
        const inPerimeter = rng() < 0.65;
        const volume = randInt(rng, 1, 20_000);
        return countLine({
          id: id(0x1c00 + trial * 8 + index),
          owner_entity_id: rng() < 0.5 ? PO : CVPO,
          vessel_id: id(0x1d00 + trial * 8 + index),
          lot_id: id(0x1e00 + trial * 8 + index),
          counted_qty_units: 0,
          counted_volume_ml: volume,
          tax_warehouse_id: inPerimeter ? WH : null,
          product_class: inPerimeter ? "bulk" : undefined,
          excise_product_key: inPerimeter ? (rng() < 0.5 ? "GRANEL-TINTO" : "GRANEL-BLANCO") : undefined,
        });
      });
      const plan = planOpeningCount(lines, openingCtx());
      expect(plan.approval_required).toBe(true);
      for (const line of lines) {
        const move = plan.physical.find((item) => item.vessel_id === line.vessel_id);
        expect(move?.move_type).toBe("opening");
        expect(move?.volume_ml).toBe(line.counted_volume_ml ?? undefined);
        expect(move?.owner_entity_id).toBe(line.owner_entity_id);
      }
      const perimeter = lines.filter((line) => line.tax_warehouse_id !== null && line.tax_warehouse_id !== undefined);
      expect(plan.fiscal.reduce((sum, move) => sum + move.volume_ml, 0)).toBe(
        perimeter.reduce((sum, line) => sum + (line.counted_volume_ml ?? 0), 0),
      );
      expect(plan.fiscal.every((move) => move.move_type === "opening" && move.volume_ml > 0)).toBe(true);
      for (const excise of ["GRANEL-TINTO", "GRANEL-BLANCO"]) {
        const expected = perimeter
          .filter((line) => line.excise_product_key === excise)
          .reduce((sum, line) => sum + (line.counted_volume_ml ?? 0), 0);
        const got = plan.fiscal
          .filter((move) => move.excise_product_key === excise)
          .reduce((sum, move) => sum + move.volume_ml, 0);
        expect(got).toBe(expected);
      }
    }
  });

  it("la detección de negativos encuentra exactamente el hueco inyectado", () => {
    const rng = mulberry32(20270301);
    for (let trial = 0; trial < 50; trial += 1) {
      const keys = Array.from({ length: randInt(rng, 2, 4) }, (_, index) => ({
        location_id: id(0x1f00 + index),
        vessel_id: id(0x1f10 + index),
        owner_entity_id: index % 2 === 0 ? PO : CVPO,
        lot_id: id(0x1f20 + index),
        product_id: id(0x1f30 + index),
        product_state: "wine" as const,
      }));
      const moves: StockMove[] = [];
      const sums: number[] = [];
      let minute = 1;
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex];
        if (!key) throw new Error("clave");
        let sum = 0;
        const chunks = randInt(rng, 1, 3);
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          minute += randInt(rng, 1, 4);
          const volume = randInt(rng, 100, 4_000);
          sum += volume;
          moves.push(
            stockMove({
              ...key,
              occurred_at: new Date(Date.UTC(2027, 5, 1, 0, minute, 0)).toISOString(),
              move_type: "opening",
              volume_ml: volume,
              source_id: id(0x2000 + trial * 30 + moves.length),
            }),
          );
        }
        sums.push(sum);
      }
      expect(findNegativeBalances(moves)).toHaveLength(0);
      const chosen = randInt(rng, 0, keys.length - 1);
      const key = keys[chosen];
      const sum = sums[chosen];
      if (!key || sum === undefined) throw new Error("suma");
      const extra = randInt(rng, 1, 25);
      minute += 5;
      const injected = stockMove({
        ...key,
        occurred_at: new Date(Date.UTC(2027, 5, 1, 0, minute, 0)).toISOString(),
        move_type: "cellar_out",
        volume_ml: -(sum + extra),
        source_id: id(0x2100 + trial),
      });
      const insertAt = rng() < 0.5 ? 0 : moves.length;
      const withNegative = moves.slice();
      withNegative.splice(insertAt, 0, injected);
      const findings = findNegativeBalances(withNegative);
      expect(findings.map((item) => item.move_index)).toEqual([insertAt]);
      expect(findings[0]?.code).toBe("WC024");
      expect(findings[0]?.volume_ml).toBe(-extra);
      expect(findings[0]?.vessel_id).toBe(key.vessel_id);
      expect(findings[0]?.owner_entity_id).toBe(key.owner_entity_id);

      minute += 5;
      const restored = withNegative.concat(
        stockMove({
          ...key,
          occurred_at: new Date(Date.UTC(2027, 5, 1, 0, minute, 0)).toISOString(),
          move_type: "cellar_in",
          volume_ml: sum + extra,
          source_id: id(0x2200 + trial),
        }),
      );
      expect(findNegativeBalances(restored).map((item) => item.move_index)).toEqual([insertAt]);
    }
  });

  it("el negativo fiscal inyectado es el único hallazgo, aunque el array venga desordenado", () => {
    const rng = mulberry32(20270401);
    for (let trial = 0; trial < 40; trial += 1) {
      const positive = randInt(rng, 100, 5_000);
      const extra = randInt(rng, 1, 40);
      const opening = fiscalMove({
        fiscal_date: "2027-04-01",
        volume_ml: positive,
        excise_product_key: "GRANEL-TINTO",
        source_id: id(0x2300 + trial),
      });
      const other = fiscalMove({
        fiscal_date: "2027-04-02",
        volume_ml: positive,
        excise_product_key: "GRANEL-BLANCO",
        source_id: id(0x2400 + trial),
      });
      expect(findNegativeBalances([opening, other])).toHaveLength(0);
      const injected = fiscalMove({
        fiscal_date: "2027-04-03",
        move_type: "loss",
        volume_ml: -(positive + extra),
        excise_product_key: "GRANEL-TINTO",
        source_id: id(0x2500 + trial),
      });
      const findings = findNegativeBalances([injected, opening, other]);
      expect(findings.map((item) => item.move_index)).toEqual([0]);
      expect(findings[0]?.code).toBe("WC027");
      expect(findings[0]?.volume_ml).toBe(-extra);
      const restore = fiscalMove({
        fiscal_date: "2027-04-04",
        volume_ml: positive + extra,
        excise_product_key: "GRANEL-TINTO",
        source_id: id(0x2600 + trial),
      });
      expect(findNegativeBalances([injected, opening, other, restore]).map((item) => item.move_index)).toEqual([0]);
    }
  });

  it("el periodo de Madrid cruza el mes y los días de cambio de hora, y el cierre es inclusivo", () => {
    const fixed = [
      "2027-03-28T00:30:00Z",
      "2027-03-28T01:30:00Z",
      "2027-03-31T21:30:00Z",
      "2027-03-31T22:30:00Z",
      "2027-10-31T00:30:00Z",
      "2027-10-31T01:30:00Z",
      "2027-10-31T22:30:00Z",
      "2027-10-31T23:30:00Z",
    ];
    const rng = mulberry32(20270328);
    const instants = fixed.slice();
    for (let index = 0; index < 200; index += 1) {
      const month = randInt(rng, 1, 12);
      const day = randInt(rng, 1, 28);
      const hour = randInt(rng, 0, 23);
      const minute = randInt(rng, 0, 59);
      instants.push(new Date(Date.UTC(2027, month - 1, day, hour, minute, randInt(rng, 0, 59))).toISOString());
    }
    for (const instant of instants) {
      const date = businessDate(instant);
      const period = periodOf(instant);
      expect(period.key).toBe(date.slice(0, 7));
      expect(date >= period.start && date <= period.end).toBe(true);
      expect(period.start).toBe(`${period.key}-01`);
      expect(period.end).toBe(new Date(Date.UTC(period.year, period.month, 0)).toISOString().slice(0, 10));
      const locks = [lock(date)];
      expect(() => assertPeriodOpen(instant, locks)).toThrow();
      expect(() => assertPeriodOpen(shiftDate(date, 1), locks)).not.toThrow();
      expect(() => assertPeriodOpen(shiftDate(date, -1), locks)).toThrow();
    }
    expect(businessDate("2027-03-28T00:30:00Z")).toBe("2027-03-28");
    expect(businessDate("2027-03-28T01:30:00Z")).toBe("2027-03-28");
    expect(periodOf("2027-03-31T22:30:00Z").key).toBe("2027-04");
    expect(periodOf("2027-10-31T01:30:00Z").key).toBe("2027-10");
    expect(periodOf("2027-10-31T23:30:00Z").key).toBe("2027-11");
  });
});

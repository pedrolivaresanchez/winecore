import { describe, expect, it } from "bun:test";
import { findNegativeBalances, fiscalBalanceAt, stockAt } from "../../src/core/inventory/balances";
import { FISCAL_LEDGER_KEYS, STOCK_GROUP_KEYS } from "../../src/core/inventory/types";
import {
  BOD,
  CVPO,
  LOT1,
  LOT2,
  PO,
  PROD,
  V1,
  V2,
  VLC,
  WH,
  catchDomain,
  fiscalMove,
  id,
  stockMove,
} from "./fixtures";

const AT = "2027-06-15T12:00:00Z";

describe("stockAt", () => {
  it("suma entradas y salidas hasta el instante, con el signo guardado", () => {
    const moves = [
      stockMove({ occurred_at: "2027-06-01T10:00:00Z", move_type: "opening", volume_ml: 3_000_000 }),
      stockMove({
        occurred_at: "2027-06-10T10:00:00Z",
        move_type: "cellar_out",
        volume_ml: -200_000,
        source_id: id(0x71),
      }),
      stockMove({
        occurred_at: "2027-06-20T10:00:00Z",
        move_type: "cellar_in",
        volume_ml: 50_000,
        source_id: id(0x72),
      }),
    ];
    const rows = stockAt(moves, AT, STOCK_GROUP_KEYS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.volume_ml).toBe(2_800_000);
    expect(rows[0]?.qty_units).toBe(0);
    expect(rows[0]?.location_id).toBe(BOD);
    expect(rows[0]?.vessel_id).toBe(V1);
    expect(rows[0]?.owner_entity_id).toBe(PO);
    expect(rows[0]?.lot_id).toBe(LOT1);
    expect(rows[0]?.product_state).toBe("wine");
  });

  it("incluye el movimiento que cae exactamente en el instante y equivale offset y Z", () => {
    const moves = [
      stockMove({ occurred_at: "2027-06-01T00:30:00+02:00", volume_ml: 1_000 }),
      stockMove({ occurred_at: "2027-06-01T12:00:00.000Z", volume_ml: 5, source_id: id(0x73) }),
    ];
    // 00:30+02:00 es el mismo instante que 2027-05-31T22:30:00Z.
    expect(stockAt(moves, "2027-05-31T22:30:00Z", STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(1_000);
    expect(stockAt(moves, "2027-05-31T22:29:59Z", STOCK_GROUP_KEYS)).toHaveLength(0);
    expect(stockAt(moves, "2027-06-01T12:00:00Z", STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(1_005);
  });

  it("un día civil de Madrid incluye toda esa fecha y excluye el día siguiente", () => {
    const moves = [
      stockMove({ occurred_at: "2027-06-15T21:00:00Z", volume_ml: 100 }),
      stockMove({ occurred_at: "2027-06-15T22:30:00Z", volume_ml: 40, source_id: id(0x74) }),
    ];
    // 21:00Z es 23:00 en Madrid (CEST); 22:30Z ya es el 16.
    expect(stockAt(moves, "2027-06-15", STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(100);
    expect(stockAt(moves, "2027-06-16", STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(140);
  });

  it("agrupa por las claves pedidas y separa granel (mL) de envasado (unidades)", () => {
    const moves = [
      stockMove({ volume_ml: 4_800_000, product_state: "wine" }),
      stockMove({
        vessel_id: null,
        lot_id: LOT2,
        product_id: PROD,
        product_state: "packaged_labeled",
        qty_units: 120,
        volume_ml: 90_000,
        source_id: id(0x75),
      }),
      stockMove({
        owner_entity_id: CVPO,
        volume_ml: 225_000,
        source_id: id(0x76),
      }),
    ];
    const byState = stockAt(moves, AT, ["product_state"]);
    const wine = byState.find((row) => row.product_state === "wine");
    const packed = byState.find((row) => row.product_state === "packaged_labeled");
    expect(wine?.volume_ml).toBe(5_025_000);
    expect(wine?.qty_units).toBe(0);
    expect(wine?.location_id).toBeNull();
    expect(packed?.qty_units).toBe(120);
    expect(packed?.volume_ml).toBe(90_000);

    const byOwner = stockAt(moves, AT, ["owner_entity"]);
    expect(byOwner.find((row) => row.owner_entity_id === PO)?.volume_ml).toBe(4_890_000);
    expect(byOwner.find((row) => row.owner_entity_id === CVPO)?.volume_ml).toBe(225_000);
  });

  it("omite el saldo cero y conserva el negativo", () => {
    const zero = [
      stockMove({ volume_ml: 1_000 }),
      stockMove({ move_type: "cellar_out", volume_ml: -1_000, source_id: id(0x77) }),
    ];
    expect(stockAt(zero, AT, STOCK_GROUP_KEYS)).toHaveLength(0);
    const negative = [
      stockMove({ volume_ml: 1_000 }),
      stockMove({ move_type: "cellar_out", volume_ml: -1_500, source_id: id(0x78) }),
    ];
    expect(stockAt(negative, AT, STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(-500);
  });

  it("un groupBy vacío devuelve el total y un volumen no entero se rechaza", () => {
    const rows = stockAt(
      [stockMove({ volume_ml: 10 }), stockMove({ location_id: VLC, volume_ml: 5, source_id: id(0x79) })],
      AT,
      [],
    );
    expect(rows).toEqual([
      {
        location_id: null,
        vessel_id: null,
        owner_entity_id: null,
        lot_id: null,
        product_id: null,
        product_state: null,
        qty_units: 0,
        volume_ml: 15,
        mass_g: 0,
      },
    ]);
    const error = catchDomain(() => stockAt([stockMove({ volume_ml: 1.5 })], AT, STOCK_GROUP_KEYS));
    expect(error.code).toBe("WC_VALIDATION");
  });
});

describe("fiscalBalanceAt", () => {
  it("suma por establecimiento, clase y clave de producto hasta la fecha", () => {
    const moves = [
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 2_000_000, excise_product_key: "GRANEL-TINTO" }),
      fiscalMove({
        fiscal_date: "2027-06-10",
        move_type: "exit_domestic",
        volume_ml: -100_000,
        excise_product_key: "GRANEL-TINTO",
      }),
      fiscalMove({
        fiscal_date: "2027-06-20",
        volume_ml: 50_000,
        excise_product_key: "GRANEL-TINTO",
      }),
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 30_000, excise_product_key: "GRANEL-BLANCO" }),
    ];
    const rows = fiscalBalanceAt(moves, "2027-06-15", FISCAL_LEDGER_KEYS);
    expect(rows.find((row) => row.excise_product_key === "GRANEL-TINTO")?.volume_ml).toBe(1_900_000);
    expect(rows.find((row) => row.excise_product_key === "GRANEL-BLANCO")?.volume_ml).toBe(30_000);
    expect(fiscalBalanceAt(moves, "2027-06-20", FISCAL_LEDGER_KEYS).find((row) => row.excise_product_key === "GRANEL-TINTO")?.volume_ml).toBe(
      1_950_000,
    );
  });

  it("un instante se corta por el día de Madrid y una clave nula no se mezcla", () => {
    const moves = [
      fiscalMove({ fiscal_date: "2027-03-31", volume_ml: 10, excise_product_key: null }),
      fiscalMove({ fiscal_date: "2027-04-01", volume_ml: 7, excise_product_key: null }),
      fiscalMove({ fiscal_date: "2027-04-01", volume_ml: 3, excise_product_key: "GRANEL-TINTO" }),
    ];
    const march = fiscalBalanceAt(moves, "2027-03-31T21:30:00Z", FISCAL_LEDGER_KEYS);
    expect(march).toHaveLength(1);
    expect(march[0]?.volume_ml).toBe(10);
    expect(march[0]?.excise_product_key).toBeNull();
    const april = fiscalBalanceAt(moves, "2027-03-31T22:30:00Z", FISCAL_LEDGER_KEYS);
    expect(april.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(20);
    expect(april.find((row) => row.excise_product_key === null)?.volume_ml).toBe(17);
  });

  it("agrupa solo por la clase pedida y omite el neto cero", () => {
    const moves = [
      fiscalMove({ volume_ml: 100, product_class: "bulk", excise_product_key: "GRANEL-TINTO" }),
      fiscalMove({ volume_ml: 40, product_class: "bulk_wood", excise_product_key: "CRIANZA-TINTO" }),
      fiscalMove({ volume_ml: -100, move_type: "loss", product_class: "bulk", excise_product_key: "GRANEL-TINTO" }),
    ];
    const byClass = fiscalBalanceAt(moves, "2027-06-01", ["product_class"]);
    expect(byClass).toEqual([
      {
        tax_warehouse_id: null,
        product_class: "bulk_wood",
        excise_product_key: null,
        volume_ml: 40,
        units: 0,
      },
    ]);
  });

  it("suma unidades de envasado junto al volumen", () => {
    const rows = fiscalBalanceAt(
      [
        fiscalMove({
          product_class: "packaged",
          product_id: PROD,
          excise_product_key: "B075-TINTO",
          volume_ml: 7_500,
          units: 10,
        }),
        fiscalMove({
          product_class: "packaged",
          product_id: PROD,
          excise_product_key: "B075-TINTO",
          move_type: "exit_domestic",
          volume_ml: -1_500,
          units: -2,
        }),
      ],
      "2027-06-01",
      FISCAL_LEDGER_KEYS,
    );
    expect(rows[0]?.volume_ml).toBe(6_000);
    expect(rows[0]?.units).toBe(8);
  });
});

describe("findNegativeBalances", () => {
  it("encuentra el saldo físico negativo y no marca un cero", () => {
    const moves = [
      stockMove({ occurred_at: "2027-06-01T10:00:00Z", volume_ml: 1_000 }),
      stockMove({ occurred_at: "2027-06-02T10:00:00Z", move_type: "cellar_out", volume_ml: -1_000, source_id: id(0x81) }),
      stockMove({ occurred_at: "2027-06-03T10:00:00Z", move_type: "cellar_out", volume_ml: -1, source_id: id(0x82) }),
    ];
    const findings = findNegativeBalances(moves);
    expect(findings.map((item) => item.move_index)).toEqual([2]);
    expect(findings[0]?.code).toBe("WC024");
    expect(findings[0]?.volume_ml).toBe(-1);
    expect(findings[0]?.message).toContain("saldo negativo");
  });

  it("detecta el hueco intermedio aunque el saldo final sea positivo", () => {
    const moves = [
      stockMove({ occurred_at: "2027-06-30T10:00:00Z", volume_ml: 80, source_id: id(0x83) }),
      stockMove({ occurred_at: "2027-06-10T10:00:00Z", volume_ml: 100, source_id: id(0x84) }),
      stockMove({ occurred_at: "2027-06-20T10:00:00Z", move_type: "cellar_out", volume_ml: -120, source_id: id(0x85) }),
    ];
    const findings = findNegativeBalances(moves);
    expect(findings.map((item) => item.move_index)).toEqual([2]);
    expect(findings[0]?.volume_ml).toBe(-20);
    expect(stockAt(moves, "2027-07-01T00:00:00Z", STOCK_GROUP_KEYS)[0]?.volume_ml).toBe(60);
  });

  it("separa cada clave del saldo: solo la clave inyectada queda en negativo", () => {
    const base = {
      location_id: BOD,
      vessel_id: V1,
      owner_entity_id: PO,
      lot_id: LOT1,
      product_id: PROD,
      product_state: "wine" as const,
    };
    const variants = [
      { location_id: VLC },
      { vessel_id: V2 },
      { owner_entity_id: CVPO },
      { lot_id: LOT2 },
      { product_id: id(0x52) },
      { product_state: "must" as const },
    ];
    for (const variant of variants) {
      const moves = [
        stockMove({ ...base, occurred_at: "2027-06-01T10:00:00Z", volume_ml: 1_000, source_id: id(0x90) }),
        stockMove({ ...base, ...variant, occurred_at: "2027-06-01T11:00:00Z", volume_ml: 1_000, source_id: id(0x91) }),
        stockMove({
          ...base,
          occurred_at: "2027-06-02T10:00:00Z",
          move_type: "cellar_out",
          volume_ml: -1_500,
          source_id: id(0x92),
        }),
      ];
      const findings = findNegativeBalances(moves);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.move_index).toBe(2);
      expect(findings[0]?.volume_ml).toBe(-500);
      expect(findings[0]?.owner_entity_id).toBe(PO);
      expect(findings[0]?.vessel_id).toBe(V1);
    }
  });

  it("marca unidades o masa negativas aunque el volumen siga positivo", () => {
    const units = [
      stockMove({
        vessel_id: null,
        product_id: PROD,
        product_state: "packaged_labeled",
        qty_units: 10,
        volume_ml: 7_500,
      }),
      stockMove({
        vessel_id: null,
        product_id: PROD,
        product_state: "packaged_labeled",
        move_type: "delivery_out",
        qty_units: -15,
        volume_ml: -1_000,
        source_id: id(0x93),
      }),
    ];
    const unitFindings = findNegativeBalances(units);
    expect(unitFindings).toHaveLength(1);
    expect(unitFindings[0]?.qty_units).toBe(-5);
    expect(unitFindings[0]?.volume_ml).toBe(6_500);

    const mass = [
      stockMove({ product_state: "grape", vessel_id: null, mass_g: 1_000, volume_ml: 0 }),
      stockMove({
        product_state: "grape",
        vessel_id: null,
        move_type: "cellar_out",
        mass_g: -1_500,
        volume_ml: 0,
        source_id: id(0x94),
      }),
    ];
    const massFindings = findNegativeBalances(mass);
    expect(massFindings).toHaveLength(1);
    expect(massFindings[0]?.mass_g).toBe(-500);
    expect(massFindings[0]?.volume_ml).toBe(0);
  });

  it("un mismo día fiscal respeta el orden de entrada y WC027 solo mira mililitros", () => {
    const unitsOnly = [
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 100, units: 10 }),
      fiscalMove({ fiscal_date: "2027-06-01", move_type: "exit_domestic", volume_ml: -40, units: -20 }),
    ];
    expect(findNegativeBalances(unitsOnly)).toHaveLength(0);

    const sameDay = [
      fiscalMove({ fiscal_date: "2027-06-01", move_type: "exit_domestic", volume_ml: -50 }),
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 100 }),
    ];
    const sameDayFindings = findNegativeBalances(sameDay);
    expect(sameDayFindings.map((item) => item.move_index)).toEqual([0]);
    expect(sameDayFindings[0]?.volume_ml).toBe(-50);

    const dipped = [
      fiscalMove({ fiscal_date: "2027-06-03", move_type: "loss", volume_ml: -10 }),
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 20 }),
      fiscalMove({ fiscal_date: "2027-06-02", move_type: "exit_domestic", volume_ml: -50 }),
    ];
    const findings = findNegativeBalances(dipped);
    expect(findings.map((item) => item.move_index)).toEqual([2, 0]);
    expect(findings[0]?.code).toBe("WC027");
    expect(findings[0]?.volume_ml).toBe(-30);
    expect(findings[1]?.volume_ml).toBe(-40);
    expect(findings[0]?.message).toContain("saldo fiscal negativo");
  });

  it("separa la clave fiscal y no señala otra clave sana", () => {
    const moves = [
      fiscalMove({ volume_ml: 1_000, excise_product_key: "GRANEL-TINTO", product_class: "bulk" }),
      fiscalMove({ volume_ml: 1_000, excise_product_key: "GRANEL-BLANCO", product_class: "bulk" }),
      fiscalMove({
        move_type: "loss",
        volume_ml: -1_500,
        excise_product_key: "GRANEL-TINTO",
        product_class: "bulk",
        fiscal_date: "2027-06-02",
      }),
      fiscalMove({ volume_ml: 800, product_class: "bulk_wood", excise_product_key: "GRANEL-TINTO" }),
    ];
    const findings = findNegativeBalances(moves);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.move_index).toBe(2);
    expect(findings[0]?.excise_product_key).toBe("GRANEL-TINTO");
    expect(findings[0]?.product_class).toBe("bulk");
    expect(findings[0]?.volume_ml).toBe(-500);
  });

  it("un libro vacío no tiene hallazgos", () => {
    expect(findNegativeBalances([])).toEqual([]);
  });
});

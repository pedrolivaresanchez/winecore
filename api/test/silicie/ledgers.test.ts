import { describe, expect, it } from "bun:test";
import {
  assertCanUpdate,
  identityChanged,
  ledgerClassForVessel,
  ledgerFromSituation,
  ledgerKeyFor,
  planIdentificationChange,
  rackingCrossesLedger,
} from "../../src/core/regulatory/silicie/ledgers";
import { SilicieLedgerIdentityError } from "../../src/core/regulatory/silicie/types";
import { entriesFor } from "../../src/core/regulatory/silicie/entries";
import { bottled, ctx, expectUnspecified, granel, move, WH } from "./support";

const CREATED_AT = "2027-01-01T00:00:00.000Z";

describe("ledgers §6", () => {
  it("depósito y barrica de roble son mayores distintos, por color", () => {
    expect(ledgerClassForVessel({ kind: "tank_storage", material: "stainless_steel" })).toBe("bulk");
    expect(ledgerClassForVessel({ kind: "tank_fermenter", material: "stainless_steel" })).toBe("bulk");
    expect(ledgerClassForVessel({ kind: "tank_storage", material: "oak" })).toBe("bulk");
    expect(ledgerClassForVessel({ kind: "barrel", material: "oak" })).toBe("bulk_wood");
    const tinto = granel("tinto");
    const blanco = granel("blanco");
    const rosado = granel("rosado");
    const barrica = ledgerFromSituation({
      id: "led-crianza-tinto",
      taxWarehouseId: WH,
      createdAt: CREATED_AT,
      ncCode: "220429",
      situation: { productClass: "bulk_wood", color: "tinto" },
    });
    expect(tinto.reference).toBe("GRANEL-TINTO");
    expect(blanco.reference).toBe("GRANEL-BLANCO");
    expect(rosado.reference).toBe("GRANEL-ROSADO");
    expect(tinto.description).toBe("Vino tinto a granel en depósito");
    expect(blanco.description).toBe("Vino blanco a granel en depósito");
    expect(rosado.description).toBe("Vino rosado a granel en depósito");
    expect(barrica.reference).toBe("CRIANZA-TINTO");
    expect(barrica.description).toBe("Vino tinto en crianza en barrica");
    expect(barrica.productClass).toBe("bulk_wood");
    expect(tinto.epigrafe).toBe("1");
    expect(tinto.epigrafeCode).toBe("V0");
    expect(tinto.ncCode).toBe("220429");
    expect(tinto.productKey).toBeNull();
    expect(tinto.reference).not.toBe(barrica.reference);
  });

  it("la uva tiene la identificación de §6 y el mosto no elige NC", () => {
    const grape = ledgerFromSituation({
      id: "led-uva",
      taxWarehouseId: WH,
      createdAt: CREATED_AT,
      situation: { productClass: "raw_grape" },
    });
    expect(grape.reference).toBe("UVA");
    expect(grape.description).toBe("Uva fresca de vinificación");
    expect(grape.ncCode).toBe("0806");
    expect(grape.productKey).toBe("V01");
    expect(grape.epigrafe).toBeNull();
    expectUnspecified(
      () =>
        ledgerFromSituation({
          id: "led-mosto",
          taxWarehouseId: WH,
          createdAt: CREATED_AT,
          situation: { productClass: "raw_must" },
        }),
      "2204 o 2009",
    );
    expectUnspecified(
      () =>
        ledgerFromSituation({
          id: "led-lias",
          taxWarehouseId: WH,
          createdAt: CREATED_AT,
          situation: { productClass: "byproduct" },
        }),
      "2307",
    );
  });

  it("el envasado de 0,75 L usa B075 y VF03; otro formato no está especificado", () => {
    const bottle = bottled();
    expect(bottle.reference).toBe("B075-SINTE");
    expect(bottle.description).toBe("Vino tinto SINTE botella 0,75 L");
    expect(bottle.ncCode).toBe("220421");
    expect(bottle.containerType).toBe("VF03");
    expect(bottle.containerCapacityMl).toBe(750);
    const unlabeled = { productClass: "packaged" as const, color: "tinto" as const, wineCode: "SINTE", brand: "SINTE", containerKind: "bottle" as const, containerCapacityMl: 750, labeled: false };
    const labeled = { ...unlabeled, labeled: true };
    expect(ledgerKeyFor({ productClass: "packaged", exciseProductKey: null }, unlabeled)).toBe("B075-SINTE");
    expect(ledgerKeyFor({ productClass: "packaged", exciseProductKey: null }, labeled)).toBe("B075-SINTE");
    expectUnspecified(
      () =>
        ledgerFromSituation({
          id: "led-magnum",
          taxWarehouseId: WH,
          createdAt: CREATED_AT,
          ncCode: "220421",
          situation: {
            productClass: "packaged",
            color: "tinto",
            wineCode: "SINTE",
            brand: "SINTE",
            containerKind: "bottle",
            containerCapacityMl: 1500,
          },
        }),
      "0,75",
    );
    expectUnspecified(
      () =>
        ledgerFromSituation({
          id: "led-bib",
          taxWarehouseId: WH,
          createdAt: CREATED_AT,
          ncCode: "220422",
          situation: {
            productClass: "packaged",
            color: "tinto",
            wineCode: "SINTE",
            brand: "SINTE",
            containerKind: "bib",
            containerCapacityMl: 3000,
          },
        }),
      "BIB",
    );
  });

  it("sin encabezado NC el vino no se inventa a 8 dígitos", () => {
    expectUnspecified(
      () =>
        ledgerFromSituation({
          id: "led-x",
          taxWarehouseId: WH,
          createdAt: CREATED_AT,
          situation: { productClass: "bulk", color: "tinto" },
        }),
      "8 dígitos",
    );
  });

  it("ledgerKeyFor devuelve la referencia y WC122 si el movimiento apunta a otra", () => {
    expect(
      ledgerKeyFor(
        { productClass: "bulk", exciseProductKey: "GRANEL-TINTO" },
        { productClass: "bulk", color: "tinto" },
      ),
    ).toBe("GRANEL-TINTO");
    expect(() =>
      ledgerKeyFor(
        { productClass: "bulk", exciseProductKey: "GRANEL-BLANCO" },
        { productClass: "bulk", color: "tinto" },
      ),
    ).toThrow(SilicieLedgerIdentityError);
  });

  it("un recipiente que no es depósito ni barrica de roble no tiene mayor", () => {
    expectUnspecified(() => ledgerClassForVessel({ kind: "demijohn", material: "glass" }), "demijohn");
    expectUnspecified(() => ledgerClassForVessel({ kind: "barrel", material: "stainless_steel" }), "barrel");
    expect(rackingCrossesLedger(
      { kind: "tank_storage", material: "stainless_steel" },
      { kind: "tank_fermenter", material: "stainless_steel" },
    )).toBe(false);
    expect(rackingCrossesLedger(
      { kind: "tank_storage", material: "stainless_steel" },
      { kind: "barrel", material: "oak" },
    )).toBe(true);
    expect(rackingCrossesLedger(
      { kind: "barrel", material: "oak" },
      { kind: "barrel", material: "oak" },
    )).toBe(false);
  });
});

describe("WC122", () => {
  it("cambiar la identificación lanza WC122 y no toca el mayor", () => {
    const current = granel("tinto");
    const snapshot = JSON.stringify(current);
    const edited = { ...current, description: "Otro nombre" };
    expect(identityChanged(current, edited)).toBe(true);
    expect(() => assertCanUpdate(current, edited)).toThrow(/WC122/);
    expect(JSON.stringify(current)).toBe(snapshot);
    assertCanUpdate(current, { ...current, isActive: false, validatedBy: "asesor" });
  });

  it("el cambio de depósito a barrica crea otro mayor y el traspaso A17/A16", () => {
    const current = granel("tinto");
    const snapshot = JSON.stringify(current);
    const plan = planIdentificationChange(current, {
      newId: "led-crianza-nueva",
      createdAt: CREATED_AT,
      situation: { productClass: "bulk_wood", color: "tinto" },
      balanceMl: 200_000,
    });
    expect(JSON.stringify(current)).toBe(snapshot);
    expect(plan.changed).toBe(true);
    if (!plan.changed) {
      return;
    }
    expect(plan.next.reference).toBe("CRIANZA-TINTO");
    expect(plan.next.id).toBe("led-crianza-nueva");
    expect(plan.previous.reference).toBe("GRANEL-TINTO");
    expect(plan.setPreviousInactive).toBe(true);
    expect(plan.transfer).toEqual({
      volumeMl: 200_000,
      outMoveType: "ledger_change_out",
      inMoveType: "ledger_change_in",
      outEntryKind: "A17",
      inEntryKind: "A16",
      fromProductClass: "bulk",
      toProductClass: "bulk_wood",
      fromReference: "GRANEL-TINTO",
      toReference: "CRIANZA-TINTO",
    });
    const entries = entriesFor(
      [
        move({
          id: "out",
          moveType: "ledger_change_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -200_000,
          justificationRef: "TR-1",
        }),
        move({
          id: "inn",
          moveType: "ledger_change_in",
          productClass: "bulk_wood",
          exciseProductKey: "CRIANZA-TINTO",
          volumeMl: 200_000,
          justificationRef: "TR-1",
        }),
      ],
      ctx({ ledgers: [current, plan.next] }),
    );
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A17", "A16"]);
    expect(entries[0]?.fields.referenciaProducto).toBe("GRANEL-TINTO");
    expect(entries[1]?.fields.referenciaProducto).toBe("CRIANZA-TINTO");
  });

  it("la misma identificación no genera traspaso", () => {
    const current = granel("tinto");
    const plan = planIdentificationChange(current, {
      newId: "otro",
      createdAt: CREATED_AT,
      situation: { productClass: "bulk", color: "tinto" },
      ncCode: "220429",
      balanceMl: 0,
    });
    expect(plan).toEqual({ changed: false });
  });
});

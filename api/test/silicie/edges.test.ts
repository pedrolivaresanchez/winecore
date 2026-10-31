import { describe, expect, it } from "bun:test";
import { entriesFor, signedVolumeMl } from "../../src/core/regulatory/silicie/entries";
import { ledgerFromSituation } from "../../src/core/regulatory/silicie/ledgers";
import { SILICIE_OPEN_QUESTIONS } from "../../src/core/regulatory/silicie/types";
import { bottles, ctx, expectUnspecified, move, opening, PARTY_ID, WH } from "./support";

describe("casos límite §11", () => {
  it("§11.1 el aforo de cierre alimenta el A01 con la fecha fiscal del 1 de enero", () => {
    const entries = entriesFor(
      [
        opening("m1", "bulk", "GRANEL-TINTO", 2_500_000, "AF-2026-1231", {
          fiscalDate: "2027-01-01",
          physicalDate: "2026-12-31",
        }),
      ],
      ctx(),
    );
    expect(entries[0]?.entryKind).toBe("A01");
    expect(entries[0]?.movementDate).toBe("2027-01-01");
    expect(entries[0]?.fields.numeroJustificante).toBe("AF-2026-1231");
    expect(entries[0]?.movementDate).not.toBe("2026-12-31");
  });

  it("§11.2 la devolución de un cliente no tiene asiento especificado", () => {
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "dev",
              moveType: "return_in",
              productClass: "packaged",
              exciseProductKey: "B075-SINTE",
              volumeMl: 750,
              units: 1,
              justificationType: "invoice",
              justificationRef: "FAC-R-1",
              counterpartyContactId: PARTY_ID,
            }),
          ],
          ctx(),
        ),
      "devolución",
    );
  });

  it("§11.3 con la regla factura el asiento cae en la fecha fiscal, no en la salida física", () => {
    const sold = bottles(2, -1);
    const entries = entriesFor(
      [
        move({
          id: "late",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: "2027-01-15",
          physicalDate: "2026-12-20",
          volumeMl: sold.volumeMl,
          units: sold.units,
          justificationType: "invoice",
          justificationRef: "FAC-2027-001",
          counterpartyContactId: PARTY_ID,
          fiscalTrigger: "invoice",
          sourceTable: "billing.invoice",
        }),
      ],
      ctx(),
    );
    expect(entries[0]?.movementDate).toBe("2027-01-15");
    expect(entries[0]?.fields.tipoJustificante).toBe("J11");
  });

  it("§11.4 el etiquetado no cambia el mayor", () => {
    const base = {
      productClass: "packaged" as const,
      color: "tinto" as const,
      wineCode: "SINTE",
      brand: "SINTE",
      containerKind: "bottle" as const,
      containerCapacityMl: 750,
    };
    const plain = ledgerFromSituation({
      id: "a",
      taxWarehouseId: WH,
      createdAt: "2027-01-01T00:00:00.000Z",
      ncCode: "220421",
      situation: { ...base, labeled: false },
    });
    const labeled = ledgerFromSituation({
      id: "b",
      taxWarehouseId: WH,
      createdAt: "2027-01-01T00:00:00.000Z",
      ncCode: "220421",
      situation: { ...base, labeled: true },
    });
    expect(plain.reference).toBe(labeled.reference);
    expect(plain.description).toBe(labeled.description);
  });

  it("§11.5 el ensamblaje de distinto color es A17/A16 entre mayores de granel", () => {
    const entries = entriesFor(
      [
        move({
          id: "out",
          moveType: "ledger_change_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -40_000,
          justificationRef: "ENS-1",
          sourceId: "ens-1",
        }),
        move({
          id: "inn",
          moveType: "ledger_change_in",
          productClass: "bulk",
          exciseProductKey: "GRANEL-ROSADO",
          volumeMl: 40_000,
          justificationRef: "ENS-1",
          sourceId: "ens-1",
        }),
      ],
      ctx(),
    );
    expect(entries.map((entry) => [entry.entryKind, entry.fields.referenciaProducto])).toEqual([
      ["A17", "GRANEL-TINTO"],
      ["A16", "GRANEL-ROSADO"],
    ]);
    expect(signedVolumeMl(entries[0]!) + signedVolumeMl(entries[1]!)).toBe(0);
  });

  it("§11.6 el vino en fermentación no entra en un mayor hasta el A15", () => {
    const pending = entriesFor(
      [],
      ctx({
        facts: [
          {
            kind: "crushing",
            id: "c",
            date: "2027-09-30",
            massG: 100_000,
            justificationRef: "OB-1",
            operationNumber: "OB-1",
            sourceId: "op-ferm",
          },
        ],
      }),
    );
    expect(pending.map((entry) => entry.fields.referenciaProducto)).toEqual(["UVA"]);
    expect(pending.some((entry) => entry.entryKind === "A15")).toBe(false);
    const finished = entriesFor(
      [
        move({
          id: "prod",
          moveType: "production",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: "2027-10-20",
          volumeMl: 70_000,
          justificationRef: "OB-1",
          sourceId: "op-ferm",
        }),
      ],
      ctx({
        facts: [
          {
            kind: "crushing",
            id: "c",
            date: "2027-09-30",
            massG: 100_000,
            justificationRef: "OB-1",
            operationNumber: "OB-1",
            sourceId: "op-ferm",
          },
        ],
      }),
    );
    expect(finished.map((entry) => entry.entryKind).sort()).toEqual(["A14", "A15"]);
  });

  it("§11.7 el error de un ejercicio cerrado es A42/A43 con observaciones", () => {
    const entries = entriesFor(
      [
        move({
          id: "old",
          moveType: "regularization_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -80,
          fiscalTrigger: "manual",
          justificationRef: "CORR-1",
          reason: "error descubierto tras el cierre del ejercicio",
        }),
      ],
      ctx({ hints: { old: { regularizationCause: "prior_exercise" } } }),
    );
    expect(entries[0]?.entryKind).toBe("A42");
    expect(entries[0]?.fields.tipoJustificante).toBe("J11");
    expect(entries[0]?.fields.observaciones).toBe("error descubierto tras el cierre del ejercicio");
    const inbound = entriesFor(
      [
        move({
          id: "old-in",
          moveType: "regularization_in",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: 80,
          fiscalTrigger: "manual",
          justificationRef: "CORR-2",
          reason: "ajuste del ejercicio cerrado",
        }),
      ],
      ctx({ hints: { "old-in": { regularizationCause: "prior_exercise" } } }),
    );
    expect(inbound[0]?.entryKind).toBe("A43");
  });

  it("el cierre del ejercicio, Canarias, la muestra y el reverso no están especificados", () => {
    expectUnspecified(() => entriesFor([], ctx({ closeExercise: true })), "cierre");
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "can",
              moveType: "exit_canary",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              volumeMl: -1_000,
            }),
          ],
          ctx(),
        ),
      "Canarias",
    );
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "sample",
              moveType: "loss",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              volumeMl: -200,
            }),
          ],
          ctx({ hints: { sample: { sampling: true } } }),
        ),
      "muestras",
    );
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "rev",
              moveType: "reversal",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              volumeMl: -1_000,
              reversesMoveId: "m-original",
            }),
          ],
          ctx(),
        ),
      "reversal",
    );
  });

  it("la apertura de mosto y la destrucción sin documento quedan abiertas", () => {
    expectUnspecified(
      () =>
        entriesFor([], ctx({
          facts: [
            {
              kind: "opening",
              id: "mosto",
              date: "2027-01-01",
              ledgerReference: "MOSTO",
              justificationRef: "AF-MOSTO",
              volumeMl: 1_000,
            },
          ],
        })),
      "mosto",
    );
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "dest",
              moveType: "destruction",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              volumeMl: -1_000,
              reason: "no apto",
            }),
          ],
          ctx(),
        ),
      "J07",
    );
    const diligence = entriesFor(
      [
        move({
          id: "dest",
          moveType: "destruction",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -1_000,
          justificationRef: "DIL-1",
          reason: "no apto",
        }),
      ],
      ctx({ hints: { dest: { destructionDocument: "diligence" } } }),
    );
    expect(diligence[0]?.entryKind).toBe("A28");
    expect(diligence[0]?.fields.tipoJustificante).toBe("J08");
    expect(diligence[0]?.fields.regimenFiscal).toBe("2");
  });

  it("las preguntas abiertas cubren IESX4, el NC de 8 dígitos y VB05", () => {
    const text = SILICIE_OPEN_QUESTIONS.join("\n");
    expect(text).toContain("IESX4");
    expect(text).toContain("8 dígitos");
    expect(text).toContain("VB05");
    expect(text).toContain("Q-019");
    expect(text).toContain("Q-030");
    expect(text).toContain("Q-010");
  });
});

import { describe, expect, it } from "bun:test";
import { entriesFor, formatLocalReference, signedVolumeMl } from "../../src/core/regulatory/silicie/entries";
import { renderAltaAsientosCsv } from "../../src/core/regulatory/silicie/csv";
import type { FiscalMoveInput } from "../../src/core/regulatory/silicie/types";
import { envasado600, trasiegoBarrica, ventaNacional } from "./scenarios";
import {
  bottles,
  CAE,
  ctx,
  defaultLedgers,
  expectUnspecified,
  HEADER,
  latin1,
  move,
  opening,
  PARTY_ID,
} from "./support";

function kinds(moves: readonly FiscalMoveInput[], context = ctx()): string[] {
  return entriesFor(moves, context).map((entry) => entry.entryKind);
}

describe("entriesFor §5", () => {
  it("la apertura de vino es A01, régimen 2, J12, una por mayor", () => {
    const entries = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 1_000_000, "AF-2027-1")],
      ctx(),
    );
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.entryKind).toBe("A01");
    expect(entry?.movementDate).toBe("2027-01-01");
    expect(entry?.fields.regimenFiscal).toBe("2");
    expect(entry?.fields.tipoJustificante).toBe("J12");
    expect(entry?.fields.numeroJustificante).toBe("AF-2027-1");
    expect(entry?.fields.referenciaProducto).toBe("GRANEL-TINTO");
    expect(entry?.fields.cantidad).toBe(1_000_000);
    expect(entry?.fields.numeroReferenciaInterno).toBe("2027-000001");
    expect(signedVolumeMl(entry!)).toBe(1_000_000);
    expect(() =>
      entriesFor(
        [
          opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-A"),
          opening("m2", "bulk", "GRANEL-TINTO", 2_000, "AF-B"),
        ],
        ctx(),
      ),
    ).toThrow(/una por mayor/);
  });

  it("la apertura de uva es A01, régimen 1, clave V01, en kilogramos", () => {
    const entries = entriesFor(
      [],
      ctx({
        facts: [
          {
            kind: "opening",
            id: "f-uva",
            date: "2027-01-01",
            ledgerReference: "UVA",
            justificationRef: "AF-UVA",
            massG: 500_000,
          },
        ],
      }),
    );
    expect(entries[0]?.fields.regimenFiscal).toBe("1");
    expect(entries[0]?.fields.clave).toBe("V01");
    expect(entries[0]?.fields.unidadMedida).toBe("KGM");
    expect(entries[0]?.fields.codigoNc).toBe("0806");
    expect(entries[0]?.fields.cantidad).toBe(500_000);
    expect(entries[0]?.fields.epigrafe).toBe("");
    expect(signedVolumeMl(entries[0]!)).toBe(0);
  });

  it("la recepción de uva es A02 J11 y la compra a granel es A02 J01 sin agregar", () => {
    const entries = entriesFor(
      [
        move({
          id: "bulk-a",
          moveType: "bulk_receipt",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: "2027-09-04",
          volumeMl: 10_000,
          justificationType: "e_ad",
          justificationRef: "ARC-A",
          counterpartyContactId: PARTY_ID,
          sourceId: "eda-a",
        }),
        move({
          id: "bulk-b",
          moveType: "bulk_receipt",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: "2027-09-20",
          volumeMl: 20_000,
          justificationType: "e_ad",
          justificationRef: "ARC-B",
          counterpartyContactId: PARTY_ID,
          sourceId: "eda-b",
        }),
      ],
      ctx({
        aggregation: "monthly",
        facts: [
          {
            kind: "grape_reception",
            id: "g1",
            date: "2027-09-03",
            massG: 100_000,
            justificationRef: "VENDIMIA-09",
          },
          {
            kind: "grape_reception",
            id: "g2",
            date: "2027-09-21",
            massG: 50_000,
            justificationRef: "VENDIMIA-09",
          },
        ],
      }),
    );
    const grape = entries.filter((entry) => entry.fields.referenciaProducto === "UVA");
    const bulk = entries.filter((entry) => entry.entryKind === "A02" && entry.fields.referenciaProducto === "GRANEL-TINTO");
    expect(grape).toHaveLength(1);
    expect(grape[0]?.movementDate).toBe("2027-09-30");
    expect(grape[0]?.fields.tipoJustificante).toBe("J11");
    expect(grape[0]?.fields.regimenFiscal).toBe("1");
    expect(grape[0]?.fields.cantidad).toBe(150_000);
    expect(bulk).toHaveLength(2);
    expect(bulk.map((entry) => entry.fields.tipoJustificante)).toEqual(["J01", "J01"]);
    expect(bulk.map((entry) => entry.movementDate)).toEqual(["2027-09-04", "2027-09-20"]);
  });

  it("elaborar agrega A14, A15 y A32 con el mismo número ELAB y el último día del mes", () => {
    const entries = entriesFor(
      [
        move({
          id: "prod",
          moveType: "production",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          fiscalDate: "2027-09-10",
          volumeMl: 800_000,
          justificationRef: "PARTE-1",
          sourceId: "op-1",
        }),
      ],
      ctx({
        aggregation: "monthly",
        hints: { prod: { operationNumber: "OB-1" } },
        facts: [
          {
            kind: "crushing",
            id: "crush",
            date: "2027-09-02",
            massG: 1_000_000,
            justificationRef: "PARTE-1",
            operationNumber: "OB-1",
            sourceId: "op-1",
          },
          {
            kind: "elaboration_loss",
            id: "loss",
            date: "2027-09-10",
            volumeMl: 20_000,
            ledgerReference: "GRANEL-TINTO",
            justificationRef: "PARTE-1",
            operationNumber: "OB-1",
            sourceId: "op-1",
            abvCenti: 1250,
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A14", "A15", "A32"]);
    expect(entries.map((entry) => entry.movementDate)).toEqual(["2027-09-30", "2027-09-30", "2027-09-30"]);
    expect(entries.map((entry) => entry.fields.numeroOperacion)).toEqual(["ELAB-2027-09", "ELAB-2027-09", "ELAB-2027-09"]);
    expect(entries.map((entry) => entry.fields.numeroJustificante)).toEqual(["ELAB-2027-09", "ELAB-2027-09", "ELAB-2027-09"]);
    expect(entries[0]?.fields.regimenFiscal).toBe("1");
    expect(entries[0]?.fields.unidadMedida).toBe("KGM");
    expect(entries[0]?.fields.tipoOperacion).toBe("V01");
    expect(entries[1]?.fields.regimenFiscal).toBe("2");
    expect(entries[1]?.fields.tipoOperacion).toBe("V01");
    expect(entries[1]?.fields.cantidad).toBe(800_000);
    expect(entries[2]?.fields.diferenciaMenos).toBe("VB01");
    expect(entries[2]?.fields.cantidad).toBe(20_000);
    expect(signedVolumeMl(entries[2]!)).toBe(0);
    expect(entries[0]?.fields.tipoJustificante).toBe("J09");
  });

  it("sin el hecho de merma no se inventa el A32 de elaboración cruzando kg y litros", () => {
    const entries = entriesFor(
      [
        move({
          id: "prod",
          moveType: "production",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: 800_000,
          sourceId: "op-1",
        }),
      ],
      ctx({
        facts: [
          {
            kind: "crushing",
            id: "crush",
            date: "2027-06-15",
            massG: 1_000_000,
            justificationRef: "OP-1",
            operationNumber: "OP-1",
            sourceId: "op-1",
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A14", "A15"]);
  });

  it("el A14 y el A15 de la elaboración comparten número de operación", () => {
    expect(() =>
      entriesFor(
        [
          move({
            id: "prod",
            moveType: "production",
            productClass: "bulk",
            exciseProductKey: "GRANEL-TINTO",
            volumeMl: 1_000,
            justificationRef: "OTRO",
            sourceId: "op-1",
          }),
        ],
        ctx({
          facts: [
            {
              kind: "crushing",
              id: "crush",
              date: "2027-06-15",
              massG: 1_000,
              justificationRef: "OP-1",
              operationNumber: "OP-1",
              sourceId: "op-1",
            },
          ],
        }),
      ),
    ).toThrow(/mismo número de operación/);
  });

  it("trasiego depósito ↔ barrica: A17 + A16 + A30, y no se agrega", () => {
    const built = trasiegoBarrica();
    const entries = entriesFor(built.moves, built.context);
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A17", "A16", "A30"]);
    expect(entries.map((entry) => entry.movementDate)).toEqual(["2027-02-10", "2027-02-10", "2027-02-10"]);
    expect(entries[0]?.fields.referenciaProducto).toBe("GRANEL-TINTO");
    expect(entries[1]?.fields.referenciaProducto).toBe("CRIANZA-TINTO");
    expect(entries[2]?.fields.diferenciaMenos).toBe("VB02");
    expect(entries[2]?.fields.tipoJustificante).toBe("J09");
    expect(entries[2]?.fields.cantidad).toBe(2_000);
    expect(entries.every((entry) => entry.fields.tipoJustificante === "J09")).toBe(true);
    expect(entries.every((entry) => entry.fields.regimenFiscal === "2")).toBe(true);
  });

  it("la merma en madera es VB03 y la rotura de envasado es A30 VB04", () => {
    const wood = entriesFor(
      [
        move({
          id: "w",
          moveType: "loss",
          productClass: "bulk_wood",
          exciseProductKey: "CRIANZA-TINTO",
          volumeMl: -1_500,
          justificationRef: "MERMA-1",
        }),
      ],
      ctx(),
    );
    expect(wood[0]?.fields.diferenciaMenos).toBe("VB03");
    const broken = bottles(2, -1);
    const packaged = entriesFor(
      [
        move({
          id: "b",
          moveType: "loss",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          volumeMl: broken.volumeMl,
          units: broken.units,
          justificationRef: "ROTURA-1",
        }),
      ],
      ctx(),
    );
    expect(packaged[0]?.entryKind).toBe("A30");
    expect(packaged[0]?.fields.diferenciaMenos).toBe("VB04");
    expect(packaged[0]?.fields.numeroEnvases).toBe(2);
    expect(packaged[0]?.fields.tipoEnvase).toBe("VF03");
  });

  it("envasado de 600 botellas: A14 + A15 con envases + A32 VB06, sin agregar", () => {
    const built = envasado600();
    const entries = entriesFor(built.moves, built.context);
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A14", "A15", "A32"]);
    expect(entries.map((entry) => entry.movementDate)).toEqual(["2027-03-15", "2027-03-15", "2027-03-15"]);
    expect(entries[0]?.fields.tipoOperacion).toBe("V05");
    expect(entries[0]?.fields.cantidad).toBe(455_000);
    expect(entries[1]?.fields.numeroEnvases).toBe(600);
    expect(entries[1]?.fields.capacidadEnvaseMl).toBe(750);
    expect(entries[1]?.fields.tipoEnvase).toBe("VF03");
    expect(entries[1]?.fields.referenciaProducto).toBe("B075-SINTE");
    expect(entries[1]?.fields.cantidad).toBe(450_000);
    expect(entries[2]?.fields.diferenciaMenos).toBe("VB06");
    expect(entries[2]?.fields.tipoOperacion).toBe("V05");
    expect(entries[2]?.fields.cantidad).toBe(5_000);
    expect(entries[2]?.fields.referenciaProducto).toBe("GRANEL-TINTO");
    expect(entries[2]?.fiscalMoveIds).toEqual([]);
    expect(signedVolumeMl(entries[2]!)).toBe(0);
    expect(signedVolumeMl(entries[0]!) + signedVolumeMl(entries[1]!)).toBe(-455_000 + 450_000);
  });

  it("si el envasado no tiene merma no hay A32", () => {
    const one = bottles(1);
    const entries = entriesFor(
      [
        move({
          id: "out",
          moveType: "packaging_out_bulk",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -one.volumeMl,
          sourceId: "env",
        }),
        move({
          id: "inn",
          moveType: "packaging_in_packaged",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          volumeMl: one.volumeMl,
          units: one.units,
          sourceId: "env",
        }),
      ],
      ctx(),
    );
    expect(entries.map((entry) => entry.entryKind)).toEqual(["A14", "A15"]);
  });

  it("la venta nacional con factura es A08 régimen 4 J11 y con albarán es J03", () => {
    const sold = bottles(4, -1);
    const invoice = entriesFor(ventaNacional().moves, ventaNacional().context);
    expect(invoice[0]?.entryKind).toBe("A08");
    expect(invoice[0]?.fields.regimenFiscal).toBe("4");
    expect(invoice[0]?.fields.tipoJustificante).toBe("J11");
    expect(invoice[0]?.fields.numeroJustificante).toBe("FAC-2027-014");
    expect(invoice[0]?.fields.numeroDocumentoIdentificativo).toBe("SYNTH-CLIENTE");
    expect(invoice[0]?.fields.tipoDocumentoIdentificativo).toBe("3");
    const note = entriesFor(
      [
        move({
          id: "alb",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          volumeMl: sold.volumeMl,
          units: sold.units,
          justificationType: "delivery_note",
          justificationRef: "ALB-2027-014",
          counterpartyContactId: PARTY_ID,
          fiscalTrigger: "delivery_note",
          sourceTable: "sales.delivery_note",
        }),
      ],
      ctx(),
    );
    expect(note[0]?.fields.tipoJustificante).toBe("J03");
    expect(note[0]?.fields.regimenFiscal).toBe("4");
  });

  it("la intercompañía con factura es el mismo A08 J11", () => {
    const sold = bottles(2, -1);
    const entries = entriesFor(
      [
        move({
          id: "ic",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          volumeMl: sold.volumeMl,
          units: sold.units,
          justificationType: "invoice",
          justificationRef: "FAC-IC-2027-01",
          counterpartyContactId: PARTY_ID,
          fiscalTrigger: "invoice",
          sourceTable: "billing.invoice",
        }),
      ],
      ctx(),
    );
    expect(entries[0]?.entryKind).toBe("A08");
    expect(entries[0]?.fields.tipoJustificante).toBe("J11");
    expect(entries[0]?.fields.regimenFiscal).toBe("4");
  });

  it("la venta al por menor se agrega en un A08 J13 del último día", () => {
    const a = bottles(10, -1);
    const b = bottles(6, -1);
    const entries = entriesFor(
      [
        move({
          id: "a",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: "2027-08-03",
          volumeMl: a.volumeMl,
          units: a.units,
          abvCenti: 1300,
          justificationRef: "T-03",
          sourceId: "a",
        }),
        move({
          id: "b",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: "2027-08-19",
          volumeMl: b.volumeMl,
          units: b.units,
          abvCenti: 1300,
          justificationRef: "T-19",
          sourceId: "b",
        }),
      ],
      ctx({
        aggregation: "monthly",
        hints: { a: { retail: true }, b: { retail: true } },
        retailJustificationByMonth: { "2027-08": "VM-2027-08" },
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.movementDate).toBe("2027-08-31");
    expect(entries[0]?.fields.tipoJustificante).toBe("J13");
    expect(entries[0]?.fields.numeroJustificante).toBe("VM-2027-08");
    expect(entries[0]?.fields.regimenFiscal).toBe("4");
    expect(entries[0]?.fields.cantidad).toBe(12_000);
    expect(entries[0]?.fields.numeroEnvases).toBe(16);
    expect(entries[0]?.fields.numeroDocumentoIdentificativo).toBe("");
    expect(signedVolumeMl(entries[0]!)).toBe(-12_000);
  });

  it("febrero agrega al 28 y, en bisiesto, al 29", () => {
    const one = bottles(1, -1);
    const ordinary = entriesFor(
      [
        move({
          id: "f",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: "2027-02-10",
          volumeMl: one.volumeMl,
          units: one.units,
          sourceId: "f",
        }),
      ],
      ctx({
        aggregation: "monthly",
        hints: { f: { retail: true } },
        retailJustificationByMonth: { "2027-02": "VM-2027-02" },
      }),
    );
    expect(ordinary[0]?.movementDate).toBe("2027-02-28");
    const leap = entriesFor(
      [
        move({
          id: "f",
          moveType: "exit_domestic",
          productClass: "packaged",
          exciseProductKey: "B075-SINTE",
          fiscalDate: "2028-02-10",
          volumeMl: one.volumeMl,
          units: one.units,
          sourceId: "f",
        }),
      ],
      ctx({
        exerciseYear: 2028,
        exerciseId: "ej-2028",
        aggregation: "monthly",
        hints: { f: { retail: true } },
        retailJustificationByMonth: { "2028-02": "VM-2028-02" },
      }),
    );
    expect(leap[0]?.movementDate).toBe("2028-02-29");
    expect(leap[0]?.fields.numeroReferenciaInterno).toBe("2028-000001");
  });

  it("exportación A11 e intra-UE A10 van con J01 y régimen 2", () => {
    const exported = entriesFor(
      [
        move({
          id: "exp",
          moveType: "exit_export",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -10_000,
          justificationType: "e_ad",
          justificationRef: "ARC-SINT-1",
          counterpartyContactId: PARTY_ID,
        }),
      ],
      ctx(),
    );
    expect(exported[0]?.entryKind).toBe("A11");
    expect(exported[0]?.fields.tipoJustificante).toBe("J01");
    expect(exported[0]?.fields.numeroJustificante).toBe("ARC-SINT-1");
    expect(exported[0]?.fields.regimenFiscal).toBe("2");
    const intra = entriesFor(
      [
        move({
          id: "ue",
          moveType: "exit_intra_eu",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -8_000,
          justificationType: "e_ad",
          justificationRef: "ARC-UE-1",
          counterpartyContactId: PARTY_ID,
          counterpartyExciseNumber: "ES00000V0000T",
        }),
      ],
      ctx(),
    );
    expect(intra[0]?.entryKind).toBe("A10");
    expect(intra[0]?.fields.caeSeed).toBe("ES00000V0000T");
  });

  it("el aforo es A30/A31 J12 y la medición o el ejercicio anterior exigen observaciones", () => {
    const count = entriesFor(
      [
        move({
          id: "less",
          moveType: "regularization_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -300,
          justificationType: "count_record",
          justificationRef: "AF-9",
          fiscalTrigger: "count",
          reason: "aforo",
          sourceTable: "inventory.inventory_count",
        }),
        move({
          id: "more",
          moveType: "regularization_in",
          productClass: "bulk_wood",
          exciseProductKey: "CRIANZA-TINTO",
          volumeMl: 100,
          fiscalDate: "2027-06-16",
          justificationType: "count_record",
          justificationRef: "AF-9",
          fiscalTrigger: "count",
          reason: "aforo",
          sourceTable: "inventory.inventory_count",
          sourceId: "af-9b",
        }),
      ],
      ctx(),
    );
    expect(count.map((entry) => entry.entryKind)).toEqual(["A30", "A31"]);
    expect(count[0]?.fields.diferenciaMenos).toBe("VB02");
    expect(count[1]?.fields.diferenciaMenos).toBe("VB03");
    expect(count[0]?.fields.tipoJustificante).toBe("J12");
    expect(count[0]?.fields.observaciones).toBe("");
    const measure = entriesFor(
      [
        move({
          id: "cal",
          moveType: "regularization_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -50,
          fiscalTrigger: "manual",
          justificationRef: "CAL-1",
          reason: "calibracion del caudalimetro",
        }),
      ],
      ctx({ hints: { cal: { regularizationCause: "measurement" } } }),
    );
    expect(measure[0]?.entryKind).toBe("A35");
    expect(measure[0]?.fields.tipoJustificante).toBe("J11");
    expect(measure[0]?.fields.observaciones).toBe("calibracion del caudalimetro");
    expect(measure[0]?.fields.diferenciaMenos).toBe("");
  });

  it("grados distintos en el mismo mes no se agregan", () => {
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "a",
              moveType: "production",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              fiscalDate: "2027-09-01",
              volumeMl: 1_000,
              abvCenti: 1200,
              sourceId: "a",
            }),
            move({
              id: "b",
              moveType: "production",
              productClass: "bulk",
              exciseProductKey: "GRANEL-TINTO",
              fiscalDate: "2027-09-02",
              volumeMl: 1_000,
              abvCenti: 1300,
              sourceId: "b",
            }),
          ],
          ctx({ aggregation: "monthly" }),
        ),
      "grado alcohólico distinto",
    );
  });

  it("la referencia interna rellena seis dígitos y el orden no depende del de entrada", () => {
    expect(formatLocalReference(2027, 123)).toBe("2027-000123");
    const first = opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-B", { fiscalDate: "2027-01-02" });
    const second = opening("m2", "packaged", "B075-SINTE", 750, "AF-A", { ...bottles(1), fiscalDate: "2027-01-01" });
    const forward = entriesFor([first, second], ctx());
    const backward = entriesFor([second, first], ctx());
    expect(forward.map((entry) => entry.fields.numeroReferenciaInterno)).toEqual(
      backward.map((entry) => entry.fields.numeroReferenciaInterno),
    );
    expect(forward[0]?.movementDate).toBe("2027-01-01");
    const renderedA = renderAltaAsientosCsv(forward, { exerciseYear: 2027, cae: CAE });
    const renderedB = renderAltaAsientosCsv(backward, HEADER);
    expect(latin1(renderedA.bytes)).toBe(latin1(renderedB.bytes));
  });

  it("todo asiento lleva justificante", () => {
    const entries = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-1")],
      ctx({
        facts: [
          {
            kind: "grape_reception",
            id: "g",
            date: "2027-09-01",
            massG: 10,
            justificationRef: "VD-1",
          },
        ],
      }),
    );
    for (const entry of entries) {
      expect(entry.fields.tipoJustificante).not.toBe("");
      expect(entry.fields.numeroJustificante).not.toBe("");
    }
  });

  it("dos documentos de uva en el mismo mes no se saben componer", () => {
    expectUnspecified(
      () =>
        entriesFor([], ctx({
          aggregation: "monthly",
          facts: [
            { kind: "grape_reception", id: "a", date: "2027-09-01", massG: 10, justificationRef: "VD-A" },
            { kind: "grape_reception", id: "b", date: "2027-09-02", massG: 10, justificationRef: "VD-B" },
          ],
        })),
      "distintos documentos",
    );
  });

  it("la venta al por menor mensual sin número J13 no se cierra", () => {
    const sold = bottles(1, -1);
    expectUnspecified(
      () =>
        entriesFor(
          [
            move({
              id: "a",
              moveType: "exit_domestic",
              productClass: "packaged",
              exciseProductKey: "B075-SINTE",
              volumeMl: sold.volumeMl,
              units: sold.units,
              sourceId: "a",
            }),
          ],
          ctx({ aggregation: "monthly", hints: { a: { retail: true } } }),
        ),
      "J13",
    );
  });

  it("un movimiento que ya tiene asiento no se vuelve a generar", () => {
    expect(() =>
      entriesFor(
        [opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-1", { silicieEntryId: "ya" })],
        ctx(),
      ),
    ).toThrow(/ya tiene asiento/);
  });

  it("los mayores de prueba cubren depósito, barrica y botella", () => {
    expect(defaultLedgers().map((ledger) => ledger.reference)).toContain("CRIANZA-BLANCO");
  });
});

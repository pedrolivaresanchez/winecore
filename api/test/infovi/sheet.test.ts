import { describe, expect, it } from "bun:test";
import { calendarFor } from "../../src/core/regulatory/calendar";
import { buildInfoviObligations, infoviDueDate } from "../../src/core/regulatory/infovi/deadlines";
import { renderInfoviCsv } from "../../src/core/regulatory/infovi/csv";
import { buildInfoviSheet, BLOCKED_NOTE, type BuildSheetInput, type InfoviMove, type InfoviOperation } from "../../src/core/regulatory/infovi/sheet";

const INSTALLATION = "wh-sint";

function move(partial: Partial<InfoviMove> & Pick<InfoviMove, "id" | "day" | "volumeMl">): InfoviMove {
  return {
    inInstallation: true,
    lotId: "lot-tinto",
    productState: "wine",
    massG: 0,
    qtyUnits: 0,
    moveType: "cellar_in",
    sourceTable: "cellar.operation",
    sourceId: "op",
    ...partial,
  };
}

function base(overrides: Partial<BuildSheetInput> = {}): BuildSheetInput {
  return {
    installationId: INSTALLATION,
    installationName: "Bodega sintetica",
    periodStart: "2027-06-01",
    periodEnd: "2027-06-30",
    dueDate: "2027-07-20",
    moves: [],
    lots: [{ id: "lot-tinto", wineId: "wine-dop", code: "LOTE-SINT" }],
    wines: [{ id: "wine-dop", code: "SINTDOP", name: "Vino sintetico", color: "red", category: "pdo_wine" }],
    operations: [],
    edges: [],
    gauges: [],
    ...overrides,
  };
}

describe("ficha INFOVI", () => {
  it("cuadra apertura + entradas − salidas = cierre, agrupado por color y categoría", () => {
    const sheet = buildInfoviSheet(base({
      moves: [
        move({ id: "m1", day: "2027-05-01", volumeMl: 100_000, moveType: "opening", sourceTable: "inventory.inventory_count" }),
        move({ id: "m2", day: "2027-06-03", volumeMl: 20_000, moveType: "cellar_in" }),
        move({ id: "m3", day: "2027-06-10", volumeMl: -5_000, moveType: "cellar_out", productState: "wine" }),
        move({ id: "m4", day: "2027-06-10", volumeMl: 4_800, moveType: "cellar_in", productState: "packaged_labeled" }),
        move({ id: "m5", day: "2027-06-18", volumeMl: -1_500, moveType: "delivery_out", productState: "packaged_labeled", sourceTable: "sales.delivery_note" }),
      ],
      operations: [bottling()],
    }));
    expect(sheet.lines).toHaveLength(1);
    const line = sheet.lines[0];
    if (!line) throw new Error("falta el grupo");
    expect(line.family).toBe("vino");
    expect(line.color).toBe("red");
    expect(line.category).toBe("con_dop");
    expect(line.openingMl).toBe(100_000);
    expect(line.entriesMl).toBe(24_800);
    expect(line.exitsMl).toBe(6_500);
    expect(line.closingMl).toBe(118_300);
    expect(line.openingMl + line.entriesMl - line.exitsMl).toBe(line.closingMl);
    expect(sheet.reconciliation.ok).toBe(true);
    expect(sheet.bottlingMl).toBe(4_800);
    expect(sheet.salesMl).toBe(1_500);
  });

  it("marca varietal cuando hay una sola variedad y con DOP cuando el vino la tiene", () => {
    const sheet = buildInfoviSheet(base({
      lots: [
        { id: "lot-uva", wineId: null, code: "UVA-SINT" },
        { id: "lot-blanco", wineId: "wine-var", code: "BLANCO-SINT" },
        { id: "lot-tinto", wineId: "wine-dop", code: "LOTE-SINT" },
      ],
      wines: [
        { id: "wine-dop", code: "SINTDOP", name: "Vino sintetico", color: "red", category: "pdo_wine" },
        { id: "wine-var", code: "SINTVAR", name: "Blanco sintetico", color: "white", category: "wine" },
      ],
      edges: [{ childLotId: "lot-blanco", parentLotId: "lot-uva" }],
      operations: [{
        id: "rec",
        opType: "reception",
        status: "confirmed",
        day: "2026-09-01",
        varietyCode: "BOBAL",
        netG: 1000,
        parcelCodes: ["PAR-SINT"],
        sourceKind: "parcels",
        hasIntake: true,
        lotIds: ["lot-uva"],
        inputMl: 0,
        outputMl: 0,
      }],
      moves: [
        move({ id: "b", day: "2027-06-02", volumeMl: 8_000, lotId: "lot-blanco" }),
        move({ id: "t", day: "2027-06-02", volumeMl: 1_000, lotId: "lot-tinto" }),
      ],
    }));
    const categories = sheet.lines.map((line) => `${line.color}:${line.category}`).sort();
    expect(categories).toEqual(["red:con_dop", "white:varietal"]);
  });

  it("señala el dato que falta y no deja el cuadre en verde", () => {
    const sheet = buildInfoviSheet(base({
      lots: [{ id: "lot-hueco", wineId: null, code: "HUECO" }],
      moves: [move({ id: "m", day: "2027-06-04", volumeMl: 3_000, lotId: "lot-hueco" })],
      operations: [{
        id: "rec",
        opType: "reception",
        status: "confirmed",
        day: "2027-06-02",
        varietyCode: null,
        netG: null,
        parcelCodes: [],
        sourceKind: null,
        hasIntake: false,
        lotIds: [],
        inputMl: 0,
        outputMl: 0,
      }, {
        id: "bot",
        opType: "bottling",
        status: "confirmed",
        day: "2027-06-11",
        varietyCode: null,
        netG: null,
        parcelCodes: [],
        sourceKind: null,
        hasIntake: false,
        lotIds: [],
        inputMl: 1_000,
        outputMl: 900,
      }],
    }));
    const codes = sheet.issues.map((issue) => issue.code);
    expect(codes).toContain("dato_ausente");
    expect(codes).toContain("entrada_uva_sin_ficha");
    expect(codes).toContain("variedad_ausente");
    expect(codes).toContain("parcela_ausente");
    expect(codes).toContain("operacion_sin_movimiento");
    expect(codes).toContain("modelo_oficial");
    expect(sheet.reconciliation.ok).toBe(false);
    expect(sheet.issues.find((issue) => issue.code === "modelo_oficial")?.message).toContain("BLOCKED");
  });

  it("exporta CSV con la nota BLOCKED", () => {
    const sheet = buildInfoviSheet(base({
      moves: [move({ id: "m", day: "2027-06-01", volumeMl: 1_000 })],
    }));
    const text = new TextDecoder().decode(renderInfoviCsv(sheet));
    expect(text.startsWith(`# ${BLOCKED_NOTE}`)).toBe(true);
    expect(text).toContain("seccion;instalacion;familia;color;categoria;apertura_l;entradas_l;salidas_l;cierre_l;cuadra");
    expect(text).toContain("existencias;Bodega sintetica;vino;red;con_dop;0.000;1.000;0.000;1.000;si");
    expect(text).toContain("BLOCKED");
  });
});

describe("plazo INFOVI", () => {
  it("vence el día 20 del mes siguiente, o el siguiente hábil", () => {
    const calendar = calendarFor([2026, 2027, 2028]);
    const due = infoviDueDate("2027-01-31", calendar);
    expect(due.startsWith("2027-02-")).toBe(true);
    expect(due >= "2027-02-20").toBe(true);
    const items = buildInfoviObligations(2027, "entidad", calendar);
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.flow === "infovi")).toBe(true);
    expect(items.every((item) => item.dueDate.endsWith("-20") || item.dueDate > item.dueDate.slice(0, 8) + "20")).toBe(true);
    expect(items[0]?.legalBasis).toContain("día 20");
  });
});

function bottling(): InfoviOperation {
  return {
    id: "bot",
    opType: "bottling",
    status: "confirmed",
    day: "2027-06-10",
    varietyCode: null,
    netG: null,
    parcelCodes: [],
    sourceKind: null,
    hasIntake: false,
    lotIds: ["lot-tinto"],
    inputMl: 5_000,
    outputMl: 4_800,
  };
}

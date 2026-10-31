import { describe, expect, it } from "bun:test";
import {
  CSV_LINE_ENDING,
  IESA1_V2_COLUMNS,
  formatGrado,
  formatMilli,
  pureAlcoholMl,
  renderAltaAsientosCsv,
} from "../../src/core/regulatory/silicie/csv";
import { entriesFor } from "../../src/core/regulatory/silicie/entries";
import { CAE, ctx, HEADER, latin1, move, opening } from "./support";

describe("CSV IESA1 V2 §7", () => {
  it("tiene 42 columnas con los nombres de la tabla, punto decimal y CR LF", () => {
    expect(IESA1_V2_COLUMNS).toHaveLength(42);
    expect(IESA1_V2_COLUMNS[0]).toBe("Número Referencia Interno");
    expect(IESA1_V2_COLUMNS[6]).toBe("Información adicional Diferencia en Menos");
    expect(IESA1_V2_COLUMNS[32]).toBe("Cantidad de Alcohol Puro");
    expect(IESA1_V2_COLUMNS[41]).toBe("Observaciones");
    const entries = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 1_000_000, "AF-1", { abvCenti: 1250 })],
      ctx(),
    );
    const rendered = renderAltaAsientosCsv(entries, HEADER);
    expect(rendered.filename).toBe(`IESA1V2-${CAE}-2027.csv`);
    const text = latin1(rendered.bytes);
    expect(text.startsWith("Número Referencia Interno;")).toBe(true);
    expect(text.includes("\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "").includes("\n")).toBe(false);
    expect(rendered.bytes[0]).toBe("N".charCodeAt(0));
    expect(rendered.bytes.includes(0xc3)).toBe(false);
    expect(rendered.bytes.includes(0xfa)).toBe(true);
    const lines = text.split(CSV_LINE_ENDING);
    expect(lines[lines.length - 1]).toBe("");
    for (const line of lines.slice(0, -1)) {
      expect(line.split(";")).toHaveLength(42);
    }
    expect(text).toContain("1000.000");
    expect(text).toContain("12.500");
    expect(text).toContain("125.000");
    expect(text).toContain("01-01-2027");
    expect(text).toContain("01-10-2027");
    expect(text).toContain("Fábrica sintética");
  });

  it("el alcohol puro redondea HALF_UP a 3 decimales", () => {
    expect(pureAlcoholMl(4, 1250)).toBe(1);
    expect(pureAlcoholMl(4, 1249)).toBe(0);
    expect(formatMilli(pureAlcoholMl(4, 1250), 13)).toBe("0.001");
    expect(formatMilli(4, 13)).toBe("0.004");
    expect(formatGrado(1250)).toBe("12.500");
    expect(formatGrado(1300)).toBe("13.000");
    const up = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 4, "AF-1", { abvCenti: 1250 })],
      ctx(),
    );
    const down = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 4, "AF-1", { abvCenti: 1249 })],
      ctx(),
    );
    expect(latin1(renderAltaAsientosCsv(up, HEADER).bytes)).toContain("0.004;LTR;");
    expect(latin1(renderAltaAsientosCsv(up, HEADER).bytes)).toContain("12.500;0.001;");
    expect(latin1(renderAltaAsientosCsv(down, HEADER).bytes)).toContain("12.490;0.000;");
  });

  it("la densidad N(8,6) sale con seis decimales", () => {
    const entries = entriesFor(
      [opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-1")],
      ctx({ hints: { m1: { densityE6: 995_000 } } }),
    );
    expect(latin1(renderAltaAsientosCsv(entries, HEADER).bytes)).toContain("0.995000");
  });

  it("rechaza un valor con separador y una observación de más de 350 caracteres", () => {
    expect(() =>
      entriesFor(
        [
          move({
            id: "cal",
            moveType: "regularization_out",
            productClass: "bulk",
            exciseProductKey: "GRANEL-TINTO",
            volumeMl: -10,
            fiscalTrigger: "manual",
            justificationRef: "CAL-1",
            reason: "tiene;separador",
          }),
        ],
        ctx({ hints: { cal: { regularizationCause: "measurement" } } }),
      ),
    ).toThrow(/entrecomillar/);
    const reason = "a".repeat(351);
    expect(() =>
      entriesFor(
        [
          move({
            id: "cal",
            moveType: "regularization_out",
            productClass: "bulk",
            exciseProductKey: "GRANEL-TINTO",
            volumeMl: -10,
            fiscalTrigger: "manual",
            justificationRef: "CAL-1",
            reason,
          }),
        ],
        ctx({ hints: { cal: { regularizationCause: "measurement" } } }),
      ),
    ).toThrow(/AN 350/);
    const ok = entriesFor(
      [
        move({
          id: "cal",
          moveType: "regularization_out",
          productClass: "bulk",
          exciseProductKey: "GRANEL-TINTO",
          volumeMl: -10,
          fiscalTrigger: "manual",
          justificationRef: "CAL-1",
          reason: "a".repeat(350),
        }),
      ],
      ctx({ hints: { cal: { regularizationCause: "measurement" } } }),
    );
    expect(ok[0]?.fields.observaciones).toHaveLength(350);
    expect(renderAltaAsientosCsv(ok, HEADER).bytes.byteLength).toBeGreaterThan(0);
  });

  it("el ejercicio de la cabecera tiene que ser el de la referencia interna", () => {
    const entries = entriesFor([opening("m1", "bulk", "GRANEL-TINTO", 1_000, "AF-1")], ctx());
    expect(() => renderAltaAsientosCsv(entries, { exerciseYear: 2028, cae: CAE })).toThrow(/no coincide/);
  });

  it("un fichero sin asientos lleva solo la cabecera", () => {
    const rendered = renderAltaAsientosCsv([], HEADER);
    const text = latin1(rendered.bytes);
    expect(text).toBe(`${IESA1_V2_COLUMNS.join(";")}${CSV_LINE_ENDING}`);
  });
});

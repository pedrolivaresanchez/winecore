import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { CSV_LINE_ENDING, IESA1_V2_COLUMNS, renderAltaAsientosCsv } from "../../src/core/regulatory/silicie/csv";
import { entriesFor } from "../../src/core/regulatory/silicie/entries";
import {
  apertura,
  destruccion,
  elaboracionMensual,
  envasado600,
  exportacion,
  realta,
  trasiegoBarrica,
  ventaMenor,
  ventaNacional,
  type Scenario,
} from "./scenarios";
import { expectUnspecified, HEADER, latin1 } from "./support";
import { ctx } from "./support";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/synthetic/silicie");

function lock(name: string, scenario: Scenario, markers: readonly string[]): void {
  const entries = entriesFor(scenario.moves, scenario.context);
  const rendered = renderAltaAsientosCsv(entries, HEADER);
  const expected = new Uint8Array(readFileSync(join(fixtureDir, `${name}.csv`)));
  expect(rendered.bytes).toEqual(expected);
  expect(rendered.filename).toBe("IESA1V2-ES00000V0000T-2027.csv");
  const text = latin1(rendered.bytes);
  const lines = text.split(CSV_LINE_ENDING);
  expect(lines[0]).toBe(IESA1_V2_COLUMNS.join(";"));
  expect(lines[lines.length - 1]).toBe("");
  for (const line of lines.slice(0, -1)) {
    expect(line.split(";")).toHaveLength(42);
  }
  for (const marker of markers) {
    expect(text).toContain(marker);
  }
}

describe("golden §12", () => {
  it("apertura de uva, granel, crianza y envasado", () => {
    lock("apertura", apertura(), ["A01", "UVA", "0806", "V01", "GRANEL-TINTO", "CRIANZA-TINTO", "B075-SINTE", "VF03", "0.750", "0.995000"]);
    const text = latin1(renderAltaAsientosCsv(entriesFor(apertura().moves, apertura().context), HEADER).bytes);
    expect(text).not.toContain("MOSTO");
  });

  it("la apertura de mosto no tiene fichero: el NC 2204 o 2009 sigue abierto", () => {
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
  });

  it("elaboración mensual agregada A14 + A15 + A32", () => {
    lock("elaboracion-mensual", elaboracionMensual(), ["A14", "A15", "A32", "VB01", "ELAB-2027-09", "30-09-2027", "1500.000", "1200.000", "30.000"]);
  });

  it("trasiego depósito a barrica con merma A17 + A16 + A30", () => {
    lock("trasiego-barrica", trasiegoBarrica(), ["A17", "A16", "A30", "VB02", "TR-2027-01", "10-02-2027"]);
  });

  it("envasado de 600 botellas con merma", () => {
    lock("envasado-600", envasado600(), ["A14", "A15", "A32", "VB06", "V05", "VF03", "0.750", "600", "455.000", "450.000", "5.000"]);
  });

  it("venta nacional A08", () => {
    lock("venta-nacional", ventaNacional(), ["A08", "J11", "4;", "FAC-2027-014", "SYNTH-CLIENTE", "18.000"]);
  });

  it("exportación con ARC A11", () => {
    lock("exportacion-arc", exportacion(), ["A11", "J01", "ARC-SINT-2027-001", "100.000"]);
  });

  it("venta al por menor mensual A08 J13", () => {
    lock("venta-menor-mensual", ventaMenor(), ["A08", "J13", "VM-2027-08", "31-08-2027", "12.000", "16"]);
  });

  it("destrucción A28 con autorización J07", () => {
    lock("destruccion", destruccion(), ["A28", "J07", "AUT-SINT-01", "25.000"]);
  });

  it("realta A08 con asiento previo; IESX4 no tiene columnas en §7", () => {
    const scenario = realta();
    lock("realta-a08", scenario, ["A08", "AS-PREVIO-SINT-001", "J11", "FAC-2027-099"]);
    const entries = entriesFor(scenario.moves, scenario.context);
    expect(entries[0]?.fields.numeroAsientoPrevio).toBe("AS-PREVIO-SINT-001");
    expect(entries[0]?.annulsEntryId).toBe("asiento-previo-1");
    expect(entries[0]?.fields.numeroReferenciaInterno).toBe("2027-000001");
  });
});

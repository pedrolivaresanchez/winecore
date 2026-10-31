import { describe, expect, it } from "bun:test";
import {
  buildObligations,
  calendarFor,
  exerciseCloseDue,
  lastWorkingDay,
  rollForward,
} from "../../src/core/regulatory/calendar";
import { renderAnulaciones } from "../../src/core/regulatory/silicie/iesx4";
import { validateCsv } from "../../src/core/regulatory/silicie/validate-csv";
import { IESA1_V2_COLUMNS, CSV_LINE_ENDING, encodeLatin1 } from "../../src/core/regulatory/silicie/csv";
import { manualSilicieConnector } from "../../src/core/regulatory/connector";
import { DomainError } from "../../src/core/errors";

const calendar = calendarFor([2026, 2027, 2028]);

describe("calendario SILICIE", () => {
  it("usa el último día hábil de agosto y diciembre", () => {
    expect(lastWorkingDay(8, 2027, calendar)).toBe("2027-08-31");
    expect(lastWorkingDay(12, 2026, calendar)).toBe("2026-12-31");
    expect(lastWorkingDay(12, 2027, calendar)).toBe("2027-12-31");
    expect(lastWorkingDay(10, 2027, calendar)).toBe("2027-10-29");
  });

  it("traslada el cierre de 2026 al 02-11-2027", () => {
    expect(rollForward("2027-10-31", calendar)).toBe("2027-11-02");
    expect(exerciseCloseDue(2026, calendar)).toBe("2027-11-02");
    const items = buildObligations(2027, "entidad", calendar);
    const close = items.find((item) => item.kind === "silicie.cierre");
    expect(close?.dueDate).toBe("2027-11-02");
    expect(close?.legalBasis).toContain("artículo 4 bis");
    expect(close?.legalBasis).toContain("Ley 39/2015");
    const august = items.find((item) => item.periodEnd === "2027-07-31");
    expect(august?.dueDate).toBe("2027-08-31");
    expect(august?.periodStart).toBe("2026-12-01");
  });
});

describe("IESX4 y validación del CSV", () => {
  it("escribe número de asiento y motivo en ISO-8859-1", () => {
    const rendered = renderAnulaciones(
      [{ aeatEntryNumber: "AS-SINT-000001", reason: "1" }],
      { exerciseYear: 2027, cae: "ES00000V0000T" },
    );
    const text = latin1(rendered.bytes);
    expect(rendered.filename).toBe("IESX4-ES00000V0000T-2027.csv");
    expect(text).toBe(`Número Asiento;Motivo Anulación${CSV_LINE_ENDING}AS-SINT-000001;1${CSV_LINE_ENDING}`);
  });

  it("rechaza una cabecera que no es la de IESA1 V2", () => {
    const issues = validateCsv(encodeLatin1(`otra${CSV_LINE_ENDING}`));
    expect(issues.some((issue) => issue.code === "csv_cabecera")).toBe(true);
    expect(issues[0]?.message).toContain("IESA1");
  });

  it("exige 42 columnas y cantidad con punto", () => {
    const cells = IESA1_V2_COLUMNS.map(() => "");
    cells[0] = "2027-000001";
    cells[3] = "01-01-2027";
    cells[5] = "A01";
    cells[7] = "2";
    cells[13] = "J12";
    cells[14] = "AF-1";
    cells[24] = "220429";
    cells[26] = "1,000";
    cells[27] = "LTR";
    cells[28] = "Vino";
    cells[29] = "GRANEL-TINTO";
    const line = cells.join(";");
    const bytes = encodeLatin1(`${IESA1_V2_COLUMNS.join(";")}${CSV_LINE_ENDING}${line}${CSV_LINE_ENDING}`);
    const issues = validateCsv(bytes);
    expect(issues.some((issue) => issue.code === "csv_cantidad")).toBe(true);
  });
});

describe("conector manual", () => {
  it("no envía nada a la AEAT", async () => {
    expect(manualSilicieConnector.mode).toBe("manual");
    await expect(manualSilicieConnector.submit({
      submissionId: "00000000-0000-4000-8000-000000000001",
      attempt: 1,
      action: "submit",
    })).rejects.toBeInstanceOf(DomainError);
  });
});

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

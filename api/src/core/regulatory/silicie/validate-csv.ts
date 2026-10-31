// Validación del CSV de alta ya generado (§7). No presenta nada.
import { IESA1_V2_COLUMNS, CSV_LINE_ENDING } from "./csv";
import spec from "./spec/IESA1V2.json" with { type: "json" };
import type { Issue } from "../issue";

const LIMITS: ReadonlyArray<readonly [number, number]> = [
  [0, 20],
  [1, 35],
  [2, 35],
  [9, 30],
  [10, 35],
  [11, 20],
  [12, 30],
  [14, 30],
  [16, 15],
  [17, 125],
  [18, 13],
  [24, 8],
  [28, 100],
  [29, 20],
  [40, 1],
  [41, 350],
];

const REQUIRED = [0, 3, 5, 7, 13, 14, 24, 26, 27, 28, 29];

export function specColumnNames(): readonly string[] {
  return spec.fields.map((field) => field.name);
}

/** Comprueba cabecera, ancho, obligatoriedad y longitudes del CSV de alta. */
export function validateCsv(bytes: Uint8Array): Issue[] {
  const issues: Issue[] = [];
  const text = decodeLatin1(bytes);
  if (!text.endsWith(CSV_LINE_ENDING)) {
    issues.push({
      severity: "error",
      code: "csv_fin",
      message: "El fichero de alta no termina en CR LF, el fin de línea que usa WineCore para IESA1 V2.",
    });
  }
  const lines = text.split(CSV_LINE_ENDING);
  if (lines[lines.length - 1] === "") lines.pop();
  const header = lines[0] ?? "";
  const expected = IESA1_V2_COLUMNS.join(";");
  if (header !== expected) {
    issues.push({
      severity: "error",
      code: "csv_cabecera",
      message: "La cabecera del CSV de alta no coincide con las 42 columnas de IESA1 V2.",
    });
    return issues;
  }
  if (specColumnNames().join(";") !== expected) {
    issues.push({
      severity: "error",
      code: "csv_spec",
      message: "La definición IESA1V2.json no coincide con las columnas del generador.",
    });
  }
  const data = lines.slice(1);
  if (data.length === 0) {
    issues.push({
      severity: "error",
      code: "csv_vacio",
      message: "El fichero de alta no tiene asientos.",
    });
  }
  data.forEach((line, index) => {
    const cells = line.split(";");
    const row = index + 2;
    if (cells.length !== IESA1_V2_COLUMNS.length) {
      issues.push({
        severity: "error",
        code: "csv_ancho",
        message: `La fila ${row} no tiene 42 columnas.`,
        item_id: String(row),
      });
      return;
    }
    for (const column of REQUIRED) {
      if ((cells[column] ?? "") === "") {
        issues.push({
          severity: "error",
          code: "csv_obligatorio",
          message: `Falta ${IESA1_V2_COLUMNS[column] ?? "un campo"} en la fila ${row}.`,
          item_id: String(row),
        });
      }
    }
    for (const pair of LIMITS) {
      const column = pair[0];
      const max = pair[1];
      const value = cells[column] ?? "";
      if (column === undefined || max === undefined) continue;
      if (value.length > max) {
        issues.push({
          severity: "error",
          code: "csv_longitud",
          message: `${IESA1_V2_COLUMNS[column] ?? "Un campo"} supera ${max} caracteres en la fila ${row}.`,
          item_id: String(row),
        });
      }
    }
    const date = cells[3] ?? "";
    if (date !== "" && !/^\d{2}-\d{2}-\d{4}$/.test(date)) {
      issues.push({
        severity: "error",
        code: "csv_fecha",
        message: `La fecha de movimiento de la fila ${row} no está en formato DD-MM-YYYY.`,
        item_id: String(row),
      });
    }
    const quantity = cells[26] ?? "";
    if (quantity !== "" && !/^\d+\.\d{3}$/.test(quantity)) {
      issues.push({
        severity: "error",
        code: "csv_cantidad",
        message: `La cantidad de la fila ${row} no es N(16,3) con punto decimal.`,
        item_id: String(row),
      });
    }
  });
  return issues;
}

function decodeLatin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

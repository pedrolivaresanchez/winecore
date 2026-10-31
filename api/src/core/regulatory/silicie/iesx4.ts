// Fichero de anulación IESX4. §4 dice «número de asiento y motivo»; la cabecera no está en la spec.
import { encodeLatin1, CSV_LINE_ENDING } from "./csv";
import { silicieInvalid, type AltaAsientosCsv, type AltaAsientosHeader } from "./types";

/** SUPUESTO: dos columnas, en este orden, con los nombres de §4. */
export const IESX4_COLUMNS = ["Número Asiento", "Motivo Anulación"] as const;

export const ANNULMENT_REASONS = ["1", "2", "3"] as const;

export type AnnulmentReason = (typeof ANNULMENT_REASONS)[number];

export interface AnnulmentRow {
  /** Número de asiento que asignó la AEAT. AN 35. */
  aeatEntryNumber: string;
  /** Tabla MOAN: 1 error numérico, 2 duplicado, 3 otro. */
  reason: AnnulmentReason;
}

const CAE = /^ES[0-9A-Z]{11}$/;

export function iesx4Filename(header: AltaAsientosHeader): string {
  if (!Number.isInteger(header.exerciseYear) || header.exerciseYear < 2020 || header.exerciseYear > 2100) {
    throw silicieInvalid("el ejercicio del fichero de anulación está fuera de 2020 a 2100");
  }
  if (!CAE.test(header.cae)) {
    throw silicieInvalid("el CAE del fichero de anulación no tiene la forma ES y 11 caracteres");
  }
  return `IESX4-${header.cae}-${header.exerciseYear}.csv`;
}

export function isAnnulmentReason(value: string): value is AnnulmentReason {
  return value === "1" || value === "2" || value === "3";
}

/** CSV de anulaciones. No llama a la AEAT. */
export function renderAnulaciones(
  rows: readonly AnnulmentRow[],
  header: AltaAsientosHeader,
): AltaAsientosCsv {
  const lines = [IESX4_COLUMNS.join(";")];
  const seen = new Set<string>();
  for (const row of rows) {
    const number = row.aeatEntryNumber.trim();
    if (number === "" || number.length > 35 || /[;"\r\n]/.test(number)) {
      throw silicieInvalid("el número de asiento de la anulación no cabe en AN 35");
    }
    if (!isAnnulmentReason(row.reason)) {
      throw silicieInvalid("el motivo de anulación tiene que ser 1, 2 o 3 (tabla MOAN)");
    }
    if (seen.has(number)) {
      throw silicieInvalid(`el asiento ${number} está repetido en la anulación`);
    }
    seen.add(number);
    lines.push(`${number};${row.reason}`);
  }
  return {
    bytes: encodeLatin1(lines.join(CSV_LINE_ENDING) + CSV_LINE_ENDING),
    filename: iesx4Filename(header),
  };
}

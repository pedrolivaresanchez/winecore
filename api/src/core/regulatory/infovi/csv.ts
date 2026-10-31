import { createHash } from "node:crypto";
import { mlToLitres } from "./measure";
import type { InfoviSheet } from "./sheet";

const HEADER = [
  "seccion",
  "instalacion",
  "familia",
  "color",
  "categoria",
  "apertura_l",
  "entradas_l",
  "salidas_l",
  "cierre_l",
  "cuadra",
  "variedad",
  "parcela",
  "kg",
].join(";");

export function renderInfoviCsv(sheet: InfoviSheet): Uint8Array {
  const rows = [`# ${sheet.blockedNote}`, HEADER];
  for (const line of sheet.lines) {
    rows.push([
      "existencias",
      cell(sheet.installationName),
      line.family,
      line.color,
      line.category,
      mlToLitres(line.openingMl),
      mlToLitres(line.entriesMl),
      mlToLitres(line.exitsMl),
      mlToLitres(line.closingMl),
      line.reconciles ? "si" : "no",
      "",
      "",
      "",
    ].join(";"));
  }
  for (const grape of sheet.grape) {
    rows.push([
      "cosecha",
      cell(sheet.installationName),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      cell(grape.variety ?? ""),
      cell(grape.parcelCodes.join("|")),
      grape.kg ?? "",
    ].join(";"));
  }
  return new TextEncoder().encode(`${rows.join("\n")}\n`);
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function infoviFilename(periodStart: string): string {
  return `INFOVI-${periodStart.slice(0, 7)}.csv`;
}

function cell(value: string): string {
  return value.replaceAll(/[\r\n;]/g, " ").trim();
}

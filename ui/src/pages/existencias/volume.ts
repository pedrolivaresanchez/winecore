import { formatInteger, formatLitres, formatPercent } from "@/lib/format";

/** Litros con 3 decimales a partir de mililitros enteros. */
export function formatMl(ml: number): string {
  if (!Number.isFinite(ml)) return "—";
  return formatLitres(ml / 1000);
}

export function formatSignedMl(ml: number): string {
  if (!Number.isFinite(ml)) return "—";
  if (ml > 0) return `+${formatMl(ml)}`;
  return formatMl(ml);
}

export function formatUnits(units: number): string {
  if (!Number.isFinite(units)) return "—";
  return formatInteger(units);
}

export function formatSignedUnits(units: number): string {
  if (!Number.isFinite(units)) return "—";
  if (units > 0) return `+${formatUnits(units)}`;
  return formatUnits(units);
}

/** Volumen nominal de un formato: `0,75 L`, `5 L`. */
export function formatNominal(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) return "—";
  if (ml % 1000 === 0) return `${formatInteger(ml / 1000)} L`;
  const text = (ml / 1000).toFixed(2).replace(".", ",");
  return `${text} L`;
}

export function formatPercentCapacity(volumeMl: number, capacityMl: number): string {
  if (!Number.isFinite(volumeMl) || !Number.isFinite(capacityMl) || capacityMl <= 0) return "—";
  return formatPercent((volumeMl / capacityMl) * 100);
}

export function formatFormatLabel(nominalMl: number): string {
  const nominal = formatNominal(nominalMl);
  if (nominalMl >= 3000) return `BIB ${nominal}`;
  return `Botellas ${nominal}`;
}

function parseSpanish(text: string): number | null | undefined {
  const raw = text.trim().replace(/\s/g, "");
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return undefined;
  return value;
}

/** `null` vacío, `undefined` no numérico, mililitros enteros si vale. */
export function parseLitres(text: string): number | null | undefined {
  const value = parseSpanish(text);
  if (value == null) return value;
  if (value < 0) return undefined;
  return Math.round(value * 1000);
}

export function parseUnits(text: string): number | null | undefined {
  const value = parseSpanish(text);
  if (value == null) return value;
  if (value < 0 || !Number.isInteger(value)) return undefined;
  return value;
}

export function litresText(ml: number): string {
  const negative = ml < 0;
  const [whole, frac] = Math.abs(ml / 1000).toFixed(3).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac ?? "000"}`;
}

export function unitsText(units: number): string {
  return formatInteger(units);
}

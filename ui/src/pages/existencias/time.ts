/** Instantáneo a partir del cual hay existencias (01/01/2027 00:00, Europe/Madrid). */
export const STOCK_EPOCH_ISO = "2026-12-31T23:00:00.000Z";

/** Aforo de arranque: 31/12/2026 23:59 en Europe/Madrid. */
export const OPENING_COUNT_ISO = "2026-12-31T22:59:00.000Z";

export function isBeforeStockEpoch(iso: string): boolean {
  const time = new Date(iso).getTime();
  return !Number.isFinite(time) || time < new Date(STOCK_EPOCH_ISO).getTime();
}

function partsInMadrid(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** `YYYY-MM-DDTHH:mm` en Europe/Madrid, para `datetime-local`. */
export function isoToMadridInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const part = partsInMadrid(date);
  const hour = part.hour === "24" ? "00" : part.hour;
  return `${part.year}-${part.month}-${part.day}T${hour}:${part.minute}`;
}

/** Interpreta `datetime-local` como hora de Madrid y devuelve un ISO UTC. */
export function madridInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date().toISOString();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const part = partsInMadrid(utcGuess);
  const asZoned = Date.UTC(
    Number(part.year),
    Number(part.month) - 1,
    Number(part.day),
    Number(part.hour === "24" ? "0" : part.hour),
    Number(part.minute),
  );
  const offset = asZoned - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset).toISOString();
}

export function spanishDate(iso: string): string {
  const local = isoToMadridInput(iso);
  const [year, month, day] = local.slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

export function spanishTime(iso: string): string {
  return isoToMadridInput(iso).slice(11, 16);
}

/** `dd/mm/aaaa` → `YYYY-MM-DD`, o null si no es una fecha real. */
export function parseSpanishDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Fecha de negocio `YYYY-MM-DD` en Europe/Madrid. */
export function madridDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const part = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return part;
}

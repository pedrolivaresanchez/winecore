/**
 * Fechas del cuaderno.
 *
 * HECHO (ecologico.md, RD 1311/2012 art. 16 y RD 1039/2025): desde el 01-01-2027
 * el tratamiento fitosanitario se anota en el CUE en el plazo de un mes, y WineCore
 * avisa a los 20 días si falta `cue_recorded_at`. WineCore no lo envía.
 *
 * SUPUESTO: «un mes» se cuenta de fecha a fecha (mismo día del mes siguiente, o el
 * último si no existe). El aviso empieza el día `aplicado + 20`, inclusive.
 * SUPUESTO: el parámetro `campaign=AAAA` es el año natural. `campaign=AAAA/AAAA+1`
 * es la campaña vitivinícola del 1 de agosto al 31 de julio (el MAPA fija el 1 de
 * agosto; la forma de pedirlo en la query no está en la spec).
 * SUPUESTO: el plazo de seguridad es el intervalo [fecha, fecha + N días). El día N
 * ya se puede vendimiar.
 */

export const CUE_ELECTRONIC_FROM = '2027-01-01';

export type CueStatus = 'not_required' | 'pending' | 'warn' | 'overdue' | 'recorded';

export interface CueClock {
  required: boolean;
  status: CueStatus;
  warn_on: string | null;
  due_on: string | null;
}

export interface CampaignWindow {
  label: string;
  start: string;
  end: string;
}

const YEAR = /^(\d{4})$/;
const SPAN = /^(\d{4})\/(\d{4})$/;

export function addDays(iso: string, days: number): string {
  const parts = splitDate(iso);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const parts = splitDate(iso);
  const first = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(parts.day, lastDay);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)).toISOString().slice(0, 10);
}

export function calendarYear(iso: string): number {
  return splitDate(iso).year;
}

export function parseCampaign(raw: string): CampaignWindow | null {
  const yearMatch = YEAR.exec(raw.trim());
  const yearText = yearMatch?.[1];
  if (yearText) {
    const year = Number(yearText);
    if (year < 1990 || year > 2100) return null;
    return { label: String(year), start: `${yearText}-01-01`, end: `${yearText}-12-31` };
  }
  const span = SPAN.exec(raw.trim());
  const startText = span?.[1];
  const endText = span?.[2];
  if (!startText || !endText) return null;
  const startYear = Number(startText);
  const endYear = Number(endText);
  if (endYear !== startYear + 1 || startYear < 1990 || endYear > 2100) return null;
  return { label: `${startText}/${endText}`, start: `${startText}-08-01`, end: `${endText}-07-31` };
}

export function cueClock(input: {
  kind: string;
  appliedOn: string;
  recorded: boolean;
  asOf: string;
}): CueClock {
  if (input.kind !== 'phytosanitary' || input.appliedOn < CUE_ELECTRONIC_FROM) {
    return { required: false, status: 'not_required', warn_on: null, due_on: null };
  }
  const warnOn = addDays(input.appliedOn, 20);
  const dueOn = addMonths(input.appliedOn, 1);
  if (input.recorded) return { required: true, status: 'recorded', warn_on: warnOn, due_on: dueOn };
  if (input.asOf > dueOn) return { required: true, status: 'overdue', warn_on: warnOn, due_on: dueOn };
  if (input.asOf >= warnOn) return { required: true, status: 'warn', warn_on: warnOn, due_on: dueOn };
  return { required: true, status: 'pending', warn_on: warnOn, due_on: dueOn };
}

/** Vendimia dentro del plazo: desde el tratamiento, inclusive, hasta el día N, exclusive. */
export function insideSafetyInterval(eventOn: string, appliedOn: string, days: number): boolean {
  if (days <= 0) return false;
  const end = addDays(appliedOn, days);
  return eventOn >= appliedOn && eventOn < end;
}

export function safetyEndsOn(appliedOn: string, days: number): string {
  return addDays(appliedOn, days);
}

function splitDate(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || !Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Fecha no válida');
  }
  return { year, month, day };
}

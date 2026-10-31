// Calendario de plazos SILICIE. Días civiles de Europe/Madrid.
// HECHO: Orden HAC/998/2019 DA 1.ª.3 (último día hábil de agosto y de diciembre)
// y art. 4 bis (cierre a los dos meses del mes en que vence el plazo de diciembre).
// HECHO: Ley 39/2015 art. 30.5 traslada un vencimiento que cae en inhábil al siguiente hábil.
// SUPUESTO: sábado y domingo son inhábiles; las fiestas son las nacionales de fecha fija
// más las que se pasen en `holidays`. No se calculan el Viernes Santo ni las fiestas autonómicas.
import { TZDate } from "@date-fns/tz";
import { isMadridCivilDate, madridMonthEnd } from "../time";

const MADRID = "Europe/Madrid";

/** Fiestas nacionales de fecha fija (mes-día). Sin Semana Santa ni fiestas autonómicas. */
export const NATIONAL_FIXED_HOLIDAYS = [
  "01-01",
  "01-06",
  "05-01",
  "08-15",
  "10-12",
  "11-01",
  "12-06",
  "12-08",
  "12-25",
] as const;

export interface HolidayCalendar {
  /** Fechas YYYY-MM-DD inhábiles además del fin de semana. */
  holidays: ReadonlySet<string>;
}

export interface ObligationDraft {
  flow: "silicie";
  title: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  legalBasis: string;
  kind: "silicie.asientos" | "silicie.cierre";
}

const SUPPLY_BASIS = "Orden HAC/998/2019, disposición adicional primera, apartado 3";
const CLOSE_BASIS = "Orden HAC/998/2019, artículo 4 bis; Ley 39/2015, artículo 30.5";

export function nationalHolidaySet(years: readonly number[]): Set<string> {
  const holidays = new Set<string>();
  for (const year of years) {
    for (const monthDay of NATIONAL_FIXED_HOLIDAYS) holidays.add(`${year}-${monthDay}`);
  }
  return holidays;
}

export function calendarFor(years: readonly number[], extra: readonly string[] = []): HolidayCalendar {
  const holidays = nationalHolidaySet(years);
  for (const day of extra) {
    if (!isMadridCivilDate(day)) continue;
    holidays.add(day);
  }
  return { holidays };
}

export function addCivilDays(iso: string, days: number): string {
  assertDay(iso);
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const text = shifted.toISOString().slice(0, 10);
  assertDay(text);
  return text;
}

export function civilDaysBetween(from: string, to: string): number {
  assertDay(from);
  assertDay(to);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** 0 domingo … 6 sábado, en Europe/Madrid. */
export function madridWeekday(iso: string): number {
  assertDay(iso);
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new TZDate(year, month - 1, day, MADRID).getDay();
}

export function isWorkingDay(iso: string, calendar: HolidayCalendar): boolean {
  assertDay(iso);
  const weekday = madridWeekday(iso);
  if (weekday === 0 || weekday === 6) return false;
  return !calendar.holidays.has(iso);
}

/** Último día hábil del mes (si el último civil es inhábil, se retrocede dentro del mes). */
export function lastWorkingDay(month: number, year: number, calendar: HolidayCalendar): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("mes fuera de 1 a 12");
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error("año fuera de 2020 a 2100");
  }
  const end = madridMonthEnd(`${year}-${String(month).padStart(2, "0")}`);
  let cursor = end;
  for (let guard = 0; guard < 28; guard += 1) {
    if (cursor.slice(0, 7) !== end.slice(0, 7)) break;
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor = addCivilDays(cursor, -1);
  }
  throw new Error(`no hay día hábil en ${year}-${String(month).padStart(2, "0")}`);
}

/** Ley 39/2015 art. 30.5: si la fecha es inhábil, el siguiente día hábil. */
export function rollForward(iso: string, calendar: HolidayCalendar): string {
  let cursor = iso;
  for (let guard = 0; guard < 21; guard += 1) {
    assertDay(cursor);
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor = addCivilDays(cursor, 1);
  }
  throw new Error(`no hay día hábil a partir de ${iso}`);
}

/**
 * Cierre del ejercicio `exerciseYear`.
 * El plazo de los asientos de diciembre vence el último día hábil de agosto del año siguiente;
 * el cierre vence el 31 de octubre de ese año siguiente, trasladado si es inhábil.
 * HECHO de silicie.md §2: el cierre de 2026 vence el 02-11-2027.
 */
export function exerciseCloseDue(exerciseYear: number, calendar: HolidayCalendar): string {
  if (!Number.isInteger(exerciseYear) || exerciseYear < 2020 || exerciseYear > 2090) {
    throw new Error("ejercicio fuera de rango");
  }
  return rollForward(`${exerciseYear + 1}-10-31`, calendar);
}

/**
 * Obligaciones SILICIE cuyo vencimiento cae en `year`.
 * `year` es el año del vencimiento, no el del ejercicio cerrado.
 */
export function buildObligations(year: number, entityId: string, calendar: HolidayCalendar): ObligationDraft[] {
  if (!entityId) throw new Error("falta la entidad");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("año fuera de rango");
  const august = lastWorkingDay(8, year, calendar);
  const december = lastWorkingDay(12, year, calendar);
  const closeExercise = year - 1;
  const closeDue = exerciseCloseDue(closeExercise, calendar);
  const items: ObligationDraft[] = [
    {
      flow: "silicie",
      kind: "silicie.asientos",
      title: `SILICIE · asientos dic ${year - 1} – jul ${year}`,
      periodStart: `${year - 1}-12-01`,
      periodEnd: `${year}-07-31`,
      dueDate: august,
      legalBasis: SUPPLY_BASIS,
    },
    {
      flow: "silicie",
      kind: "silicie.asientos",
      title: `SILICIE · asientos ago–nov ${year}`,
      periodStart: `${year}-08-01`,
      periodEnd: `${year}-11-30`,
      dueDate: december,
      legalBasis: SUPPLY_BASIS,
    },
  ];
  if (closeDue.startsWith(String(year))) {
    items.push({
      flow: "silicie",
      kind: "silicie.cierre",
      title: `SILICIE · cierre del ejercicio ${closeExercise}`,
      periodStart: `${closeExercise}-01-01`,
      periodEnd: `${closeExercise}-12-31`,
      dueDate: closeDue,
      legalBasis: CLOSE_BASIS,
    });
  }
  return items;
}

export type DeadlineBand = "d30" | "d7" | "d1" | "overdue";

/**
 * Banda de aviso que toca hoy.
 * SUPUESTO: si el job no corre el día exacto, avisa una vez en la banda en curso
 * (≤30, ≤7, ≤1 o vencida). El día del vencimiento sigue siendo el aviso de 1 día.
 */
export function deadlineBand(today: string, dueDate: string): DeadlineBand | null {
  const days = civilDaysBetween(today, dueDate);
  if (days < 0) return "overdue";
  if (days <= 1) return "d1";
  if (days <= 7) return "d7";
  if (days <= 30) return "d30";
  return null;
}

function assertDay(iso: string): void {
  if (!isMadridCivilDate(iso)) throw new Error(`fecha no válida: ${iso}`);
}

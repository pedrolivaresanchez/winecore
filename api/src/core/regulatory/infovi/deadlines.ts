// Plazo INFOVI: día 20 del mes siguiente al periodo (RD 739/2015, art. 5).
// Si el 20 es inhábil, Ley 39/2015 art. 30.5 lo pasa al siguiente hábil.
import {
  calendarFor,
  rollForward,
  type HolidayCalendar,
  type ObligationDraft,
} from "../calendar";

export const INFOVI_BASIS = "RD 739/2015, art. 5 (día 20 del mes siguiente); Ley 39/2015, art. 30.5";

const MONTH = /^(\d{4})-(\d{2})$/;

export function assertMonth(month: string): void {
  const match = MONTH.exec(month);
  const year = Number(match?.[1]);
  const value = Number(match?.[2]);
  if (!match || value < 1 || value > 12 || year < 2020 || year > 2100) {
    throw new Error(`mes no válido: ${month}`);
  }
}

export function monthBounds(month: string): { start: string; end: string } {
  assertMonth(month);
  const [yearText, monthText] = month.split("-") as [string, string];
  const year = Number(yearText);
  const value = Number(monthText);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  assertMonth(month);
  const [yearText, monthText] = month.split("-") as [string, string];
  const shifted = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  const year = shifted.getUTCFullYear();
  const value = shifted.getUTCMonth() + 1;
  return `${year}-${String(value).padStart(2, "0")}`;
}

/** Día 20 del mes siguiente al cierre del periodo, trasladado si es inhábil. */
export function infoviDueDate(periodEnd: string, calendar: HolidayCalendar): string {
  const month = periodEnd.slice(0, 7);
  assertMonth(month);
  const next = shiftMonth(month, 1);
  return rollForward(`${next}-20`, calendar);
}

/**
 * Obligaciones cuyo vencimiento cae en `year`.
 * El periodo es el mes anterior y el plazo es el día 20 (hábil) de `year`.
 */
export function buildInfoviObligations(year: number, entityId: string, calendar: HolidayCalendar): ObligationDraft[] {
  if (!entityId) throw new Error("falta la entidad");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("año fuera de rango");
  const items: ObligationDraft[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const dueMonth = `${year}-${String(month).padStart(2, "0")}`;
    const nominal = `${dueMonth}-20`;
    const dueDate = rollForward(nominal, calendar);
    if (!dueDate.startsWith(String(year))) continue;
    const periodMonth = shiftMonth(dueMonth, -1);
    const bounds = monthBounds(periodMonth);
    items.push({
      flow: "infovi",
      kind: "infovi.mensual",
      title: `INFOVI · ${periodMonth}`,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      dueDate,
      legalBasis: INFOVI_BASIS,
    });
  }
  return items;
}

export function holidayCalendar(aroundYear: number, extra: readonly string[] = []): HolidayCalendar {
  return calendarFor([aroundYear - 1, aroundYear, aroundYear + 1], extra);
}

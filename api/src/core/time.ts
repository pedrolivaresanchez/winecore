import { TZDate } from '@date-fns/tz';
import { format, lastDayOfMonth } from 'date-fns';

const MADRID = 'Europe/Madrid';
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function madridNow(): TZDate {
  return new TZDate(new Date(), MADRID);
}

export function toMadridOffsetString(instant: Date): string {
  return format(new TZDate(instant, MADRID), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Calendar date of an instant in Europe/Madrid (`YYYY-MM-DD`). */
export function businessDate(instant: Date): string {
  return format(new TZDate(instant, MADRID), 'yyyy-MM-dd');
}

/** True when `YYYY-MM-DD` is a real civil day in Europe/Madrid. */
export function isMadridCivilDate(iso: string): boolean {
  const match = CIVIL_DATE.exec(iso);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new TZDate(year, month - 1, day, MADRID);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** `YYYY-MM` of a Madrid civil date. */
export function madridMonthKey(iso: string): string {
  if (!isMadridCivilDate(iso)) throw new Error(`fecha no válida: ${iso}`);
  return iso.slice(0, 7);
}

/** Last civil day of `YYYY-MM` in Europe/Madrid. */
export function madridMonthEnd(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const yearText = match?.[1];
  const monthText = match?.[2];
  if (yearText === undefined || monthText === undefined) throw new Error(`mes no válido: ${monthKey}`);
  const year = Number(yearText);
  const month = Number(monthText);
  if (month < 1 || month > 12) throw new Error(`mes no válido: ${monthKey}`);
  return format(lastDayOfMonth(new TZDate(year, month - 1, 1, MADRID)), 'yyyy-MM-dd');
}

/** `DD-MM-YYYY` of a Madrid civil date. */
export function formatMadridDmy(iso: string): string {
  if (!isMadridCivilDate(iso)) throw new Error(`fecha no válida: ${iso}`);
  const match = CIVIL_DATE.exec(iso);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw new Error(`fecha no válida: ${iso}`);
  }
  return format(
    new TZDate(Number(yearText), Number(monthText) - 1, Number(dayText), MADRID),
    'dd-MM-yyyy',
  );
}

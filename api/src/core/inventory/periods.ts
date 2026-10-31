import { DomainError } from '../errors';
import { businessDate as madridBusinessDate, toMadridOffsetString } from '../time';
import type { IsoDate, PeriodLock } from './types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

export interface MadridDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Calendar date in Europe/Madrid, `YYYY-MM-DD`. */
  date: IsoDate;
}

export interface MadridPeriod {
  year: number;
  /** Month 1–12 in Europe/Madrid. */
  month: number;
  /** `YYYY-MM`. */
  key: string;
  /** First civil day of the month, inclusive. */
  start: IsoDate;
  /** Last civil day of the month, inclusive. */
  end: IsoDate;
}

function invalid(message: string, fields?: Record<string, string>): never {
  throw new DomainError('WC_VALIDATION', 422, message, fields);
}

export function isBusinessDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isInstant(value: string): boolean {
  const match = INSTANT_RE.exec(value);
  if (!match) return false;
  const date = match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (date === undefined || !isBusinessDate(date)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Milliseconds since the epoch. The instant must carry an explicit zone. */
export function instantMs(value: string): number {
  if (!isInstant(value)) {
    invalid('El instante debe ser ISO-8601 con zona horaria (por ejemplo 2027-01-01T00:00:00+01:00).', {
      value,
    });
  }
  return Date.parse(value);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Wall-clock parts in Europe/Madrid. The conversion is `toMadridOffsetString`
 * from `core/time` (date-fns, zone Europe/Madrid). The input is an absolute
 * instant, so the overlap on the October change is unambiguous.
 */
export function madridDateTime(instant: string): MadridDateTime {
  const date = new Date(instantMs(instant));
  const formatted = toMadridOffsetString(date);
  const match = CLOCK_RE.exec(formatted);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  if (!match || [year, month, day, hour, minute, second].some((part) => Number.isNaN(part))) {
    invalid('No se pudo convertir la fecha a Europe/Madrid.', { value: instant });
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: madridBusinessDate(date),
  };
}

/** Business date `YYYY-MM-DD` of an instant in Europe/Madrid (`core/time`). */
export function businessDate(instant: string): IsoDate {
  return madridBusinessDate(new Date(instantMs(instant)));
}

/**
 * Business date of a fiscal date or of an instant. A bare date is already a
 * business date and is not reinterpreted as UTC midnight.
 */
export function resolveBusinessDate(input: string): IsoDate {
  if (isBusinessDate(input)) return input;
  if (isInstant(input)) return businessDate(input);
  invalid('La fecha debe ser un día (YYYY-MM-DD) o un instante ISO-8601 con zona horaria.', {
    value: input,
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar month in Europe/Madrid that contains the business date or instant. */
export function periodOf(input: string): MadridPeriod {
  const date = resolveBusinessDate(input);
  const match = DATE_RE.exec(date);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || Number.isNaN(year) || Number.isNaN(month)) {
    invalid('La fecha de negocio no es válida.', { value: date });
  }
  const key = `${pad(year, 4)}-${pad(month, 2)}`;
  return {
    year,
    month,
    key,
    start: formatIsoDate(year, month, 1),
    end: formatIsoDate(year, month, daysInMonth(year, month)),
  };
}

/**
 * Throws WC021 when the business date is on or before any supplied lock.
 * Pass the locks of the ledger being posted. If several are passed, the date
 * is closed when any of them covers it (conservative). The message quotes the
 * furthest `locked_until` among the locks that reject the date.
 * An instant is judged by its Europe/Madrid calendar date, matching
 * `(occurred_at AT TIME ZONE 'Europe/Madrid')::date`.
 */
export function assertPeriodOpen(date: string, locks: readonly PeriodLock[]): void {
  const business = resolveBusinessDate(date);
  let closing: PeriodLock | null = null;
  for (const lock of locks) {
    if (!isBusinessDate(lock.locked_until)) {
      invalid('El cierre de periodo no tiene una fecha válida.', { locked_until: lock.locked_until });
    }
    if (business <= lock.locked_until) {
      if (!closing || lock.locked_until > closing.locked_until) closing = lock;
    }
  }
  if (closing) {
    throw new DomainError(
      'WC021',
      409,
      `WC021: el periodo está cerrado hasta ${closing.locked_until} (movimiento con fecha ${business})`,
      { ledger: closing.ledger, locked_until: closing.locked_until, date: business },
    );
  }
}

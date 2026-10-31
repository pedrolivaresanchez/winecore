import type { Decimal } from 'decimal.js';
import { money } from '../money';
import { businessDate } from '../time';
import { domainError } from '../errors';

/** Half-open validity [from, to). A null end stays open. ISO dates compare in order. */
export function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom < bEnd && bFrom < aEnd;
}

/** Inclusive period [start, end], as stored on the settlement. */
export function inclusiveOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function coversDate(from: string, to: string | null, day: string): boolean {
  return day >= from && (to === null || day < to);
}

/**
 * D4. WineCore does not debate the price: it applies the adviser's tariff.
 * unit = round_half_up(base × (1 − discount/100), 6).
 */
export function intercompanyUnitPrice(baseUnitPrice: Decimal, discountPct: Decimal): Decimal {
  const hundredth = money.fromString('0.01');
  const factor = money.sub(money.fromString('1'), money.mul(discountPct, hundredth));
  return money.round6(money.mul(baseUnitPrice, factor));
}

export interface MonthPeriod {
  readonly period: string;
  readonly year: number;
  readonly month: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Last civil day the invoice may be issued (the 15th; before day 16). */
  readonly issueDeadline: string;
  /** Watcher starts warning on this day (the 12th of the following month). */
  readonly warnFrom: string;
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

export function monthPeriod(period: string): MonthPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw domainError('WC_IC_PERIOD', { period: 'Usa un mes AAAA-MM' });
  }
  const start = `${match[1]}-${match[2]}-01`;
  const end = `${match[1]}-${match[2]}-${String(lastDay(year, month)).padStart(2, '0')}`;
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const nextKey = `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}`;
  return {
    period,
    year,
    month,
    periodStart: start,
    periodEnd: end,
    issueDeadline: `${nextKey}-15`,
    warnFrom: `${nextKey}-12`,
  };
}

export function periodLabel(period: MonthPeriod): string {
  const name = MONTHS_ES[period.month - 1] ?? period.period;
  return `${name} ${period.year}`;
}

export function inMadridPeriod(instant: Date, periodStart: string, periodEnd: string): boolean {
  const day = businessDate(instant);
  return day >= periodStart && day <= periodEnd;
}

export type WatcherStatus = 'open' | 'no_movements' | 'draft' | 'pending_issue' | 'overdue' | 'issued';

export function settlementWatcher(input: {
  period: MonthPeriod;
  lineCount: number;
  invoiceIssued: boolean;
  closed: boolean;
  today: string;
}): { status: WatcherStatus; pendingIssue: boolean; message: string } {
  const label = periodLabel(input.period);
  if (input.invoiceIssued) {
    return { status: 'issued', pendingIssue: false, message: 'Factura emitida' };
  }
  if (input.lineCount === 0 && input.closed) {
    return {
      status: 'no_movements',
      pendingIssue: false,
      message: `Sin movimientos en ${label}; no hace falta factura`,
    };
  }
  const needsIssue = input.lineCount > 0;
  if (needsIssue && input.today > input.period.issueDeadline) {
    return {
      status: 'overdue',
      pendingIssue: true,
      message: 'Plazo de emisión vencido: debía expedirse antes del día 16',
    };
  }
  if (needsIssue && input.today >= input.period.warnFrom) {
    return {
      status: 'pending_issue',
      pendingIssue: true,
      message: 'Pendiente de emitir (aviso desde el día 12)',
    };
  }
  if (input.closed) {
    return {
      status: 'draft',
      pendingIssue: false,
      message: 'Borrador listo; expedir antes del día 16',
    };
  }
  return { status: 'open', pendingIssue: false, message: 'Periodo abierto' };
}

export function addCivilDays(day: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match?.[1] || !match[2] || !match[3] || !Number.isInteger(days)) {
    throw new TypeError('Fecha no válida');
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function lastDay(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

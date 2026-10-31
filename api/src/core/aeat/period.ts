export const MODELS = ['303', '390', '347', '349', '115', '130'] as const;

export type ModelCode = (typeof MODELS)[number];

export type PeriodKind = 'quarter' | 'year' | 'month';

export interface Period {
  kind: PeriodKind;
  token: string;
  year: number;
  quarter: number | null;
  month: number | null;
  from: string;
  to: string;
  label: string;
  ejercicio: string;
}

const QUARTER_END = ['03-31', '06-30', '09-30', '12-31'] as const;

export function isModel(value: string): value is ModelCode {
  return (MODELS as readonly string[]).includes(value);
}

export function parsePeriod(raw: string): Period | null {
  const value = raw.trim();
  const quarter = /^(\d{4})-Q([1-4])$/i.exec(value);
  if (quarter?.[1] && quarter[2]) {
    const year = Number(quarter[1]);
    const q = Number(quarter[2]);
    const end = QUARTER_END[q - 1];
    if (!end) return null;
    const startMonth = (q - 1) * 3 + 1;
    return {
      kind: 'quarter',
      token: `${year}-Q${q}`,
      year,
      quarter: q,
      month: null,
      from: `${year}-${pad(startMonth)}-01`,
      to: `${year}-${end}`,
      label: `${q}T`,
      ejercicio: String(year),
    };
  }
  const yearOnly = /^(\d{4})$/.exec(value);
  if (yearOnly?.[1]) {
    const year = Number(yearOnly[1]);
    return {
      kind: 'year',
      token: String(year),
      year,
      quarter: null,
      month: null,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: String(year),
      ejercicio: String(year),
    };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month?.[1] && month[2]) {
    const year = Number(month[1]);
    const valueMonth = Number(month[2]);
    if (valueMonth < 1 || valueMonth > 12) return null;
    return {
      kind: 'month',
      token: `${month[1]}-${month[2]}`,
      year,
      quarter: Math.ceil(valueMonth / 3),
      month: valueMonth,
      from: `${month[1]}-${month[2]}-01`,
      to: `${month[1]}-${month[2]}-${daysInMonth(year, valueMonth)}`,
      label: month[2],
      ejercicio: month[1],
    };
  }
  return null;
}

/** El 303, el 115 y el 130 son trimestrales; el 390 y el 347, anuales; el 349 admite los tres. */
export function periodError(model: ModelCode, period: Period): string | null {
  if ((model === '303' || model === '115' || model === '130') && period.kind !== 'quarter') {
    return 'Este modelo es trimestral. Indica el periodo como AAAA-T1…T4, por ejemplo 2026-Q1.';
  }
  if ((model === '390' || model === '347') && period.kind !== 'year') {
    return 'Este modelo es anual. Indica el ejercicio, por ejemplo 2026.';
  }
  return null;
}

/** El 130 acumula desde el 1 de enero. El resto usa el periodo pedido. */
export function dataWindow(model: ModelCode, period: Period): { from: string; to: string } {
  if (model === '130') return { from: `${period.year}-01-01`, to: period.to };
  return { from: period.from, to: period.to };
}

export function quarterOfDate(iso: string): 1 | 2 | 3 | 4 {
  const month = Number(iso.slice(5, 7));
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

export function periodLabelOf(iso: string): string {
  return `${quarterOfDate(iso)}T`;
}

export function modelKind(model: ModelCode): string {
  return `aeat_${model}`;
}

function pad(month: number): string {
  return String(month).padStart(2, '0');
}

function daysInMonth(year: number, month: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return String(days[month - 1] ?? 30);
}

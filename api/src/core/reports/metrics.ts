import { Decimal } from 'decimal.js';
import { money } from '../money';
import type { GroupBy, ReportBody, ReportMetrics, ReportName, ReportScope } from './types';

const WINE_CATEGORY: Record<string, string> = {
  wine: 'Vino',
  pgi_wine: 'IGP',
  pdo_wine: 'DOP',
  fortified: 'Generoso',
  other: 'Otros',
};

export interface Bucket {
  key: string;
  label: string;
  asOf?: string;
  amount: Decimal;
  base: Decimal;
  tax: Decimal;
  units: Decimal;
  volume: Decimal;
}

export interface DocLine {
  docId: string;
  issueDate: string;
  customerId: string | null;
  customerLabel: string | null;
  productId: string | null;
  productLabel: string | null;
  wineId: string | null;
  wineLabel: string | null;
  lotId: string | null;
  lotLabel: string | null;
  category: string | null;
  categoryLabel: string | null;
  quantity: string;
  nominalMl: string;
  lineBase: string;
  docAmount: string;
  docBase: string;
  docTax: string;
  lineNo: number;
}

export function emptyBucket(key: string, label: string, asOf?: string): Bucket {
  return {
    key,
    label,
    asOf,
    amount: new Decimal(0),
    base: new Decimal(0),
    tax: new Decimal(0),
    units: new Decimal(0),
    volume: new Decimal(0),
  };
}

export function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return String(value);
}

export function dateText(value: unknown): string {
  const raw = text(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? raw;
}

export function idText(value: unknown): string | null {
  const raw = text(value).trim().toLowerCase();
  return raw === '' ? null : raw;
}

export function decimalText(value: unknown, fallback = '0'): string {
  const raw = text(value).trim();
  return raw === '' ? fallback : raw;
}

/** Splits a money total across weights. The parts sum to the rounded total. */
export function allocate(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  if (weights.length === 0) return [];
  const target = money.round2(total);
  const sum = weights.reduce((acc, weight) => acc.plus(weight), new Decimal(0));
  const parts = sum.isZero()
    ? weights.map(() => money.round2(target.div(weights.length)))
    : weights.map((weight) => money.round2(target.times(weight).div(sum)));
  const assigned = parts.reduce((acc, part) => money.add(acc, part), new Decimal(0));
  const last = parts.length - 1;
  const current = parts[last];
  if (current === undefined) return parts;
  parts[last] = money.add(current, money.sub(target, assigned));
  return parts;
}

export function addYears(iso: string, years: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return iso;
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

export function shiftKey(groupBy: GroupBy, key: string, years: number): string {
  if (groupBy === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    return `${Number(key.slice(0, 4)) + years}${key.slice(4)}`;
  }
  if (groupBy === 'year' && /^\d{4}$/.test(key)) return String(Number(key) + years);
  return key;
}

export interface PeriodCut {
  key: string;
  label: string;
  asOf: string;
}

export function periodCuts(from: string, to: string, grain: 'month' | 'year'): PeriodCut[] {
  if (grain === 'year') {
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    const cuts: PeriodCut[] = [];
    for (let year = fromYear; year <= toYear; year += 1) {
      const yearEnd = `${year}-12-31`;
      const asOf = yearEnd < from ? from : yearEnd > to ? to : yearEnd;
      if (asOf >= from && asOf <= to) cuts.push({ key: String(year), label: String(year), asOf });
    }
    return cuts;
  }
  const cuts: PeriodCut[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const endMonth = to.slice(0, 7);
  while (cursor.slice(0, 7) <= endMonth) {
    const monthEnd = endOfMonth(cursor);
    const asOf = monthEnd < from ? from : monthEnd > to ? to : monthEnd;
    if (asOf >= from && asOf <= to) {
      const key = cursor.slice(0, 7);
      cuts.push({ key, label: key, asOf });
    }
    cursor = addMonths(cursor, 1);
  }
  return cuts;
}

function endOfMonth(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  if (year === undefined || month === undefined) return iso;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function addMonths(iso: string, count: number): string {
  const [year, month] = iso.split('-').map(Number);
  if (year === undefined || month === undefined) return iso;
  const absolute = year * 12 + (month - 1) + count;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
}

export function formatQty(value: Decimal): string {
  const rounded = value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) return '0';
  return rounded.toFixed(3).replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
}

export function formatMl(value: Decimal): string {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

export function metricsOf(bucket: Pick<Bucket, 'amount' | 'base' | 'tax' | 'units' | 'volume'>): ReportMetrics {
  return {
    amount: money.toString(bucket.amount),
    base: money.toString(bucket.base),
    tax: money.toString(bucket.tax),
    units: formatQty(bucket.units),
    volume_ml: formatMl(bucket.volume),
  };
}

export function zeroMetrics(): ReportMetrics {
  return { amount: '0.00', base: '0.00', tax: '0.00', units: '0', volume_ml: '0' };
}

function lineVolume(line: DocLine): Decimal {
  const quantity = new Decimal(decimalText(line.quantity));
  const nominal = new Decimal(decimalText(line.nominalMl));
  return quantity.times(nominal).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

export function readLine(row: Record<string, unknown>): DocLine {
  return {
    docId: text(row.doc_id),
    issueDate: dateText(row.issue_date),
    customerId: idText(row.customer_id),
    customerLabel: text(row.customer_label) || null,
    productId: idText(row.product_id),
    productLabel: text(row.product_label) || null,
    wineId: idText(row.wine_id),
    wineLabel: text(row.wine_label) || null,
    lotId: idText(row.lot_id),
    lotLabel: text(row.lot_label) || null,
    category: text(row.category) || null,
    categoryLabel: text(row.category_label) || null,
    quantity: decimalText(row.quantity),
    nominalMl: decimalText(row.nominal_ml),
    lineBase: decimalText(row.line_base),
    docAmount: decimalText(row.doc_amount),
    docBase: decimalText(row.doc_base),
    docTax: decimalText(row.doc_tax),
    lineNo: Number(decimalText(row.line_no)),
  };
}

export function dimension(
  groupBy: GroupBy,
  line: Pick<DocLine, 'issueDate' | 'customerId' | 'customerLabel' | 'productId' | 'productLabel' | 'wineId' | 'wineLabel' | 'lotId' | 'lotLabel' | 'category' | 'categoryLabel'>,
  categoryKind: 'wine' | 'expense',
): { key: string; label: string } {
  if (groupBy === 'product') {
    return line.productId
      ? { key: line.productId, label: line.productLabel || 'Producto' }
      : { key: 'none', label: 'Sin producto' };
  }
  if (groupBy === 'wine') {
    return line.wineId
      ? { key: line.wineId, label: line.wineLabel || 'Vino' }
      : { key: 'none', label: 'Sin vino' };
  }
  if (groupBy === 'lot') {
    return line.lotId
      ? { key: line.lotId, label: line.lotLabel || 'Lote' }
      : { key: 'none', label: 'Sin lote' };
  }
  if (groupBy === 'year') {
    const year = line.issueDate.slice(0, 4);
    return { key: year, label: year };
  }
  if (groupBy === 'month') {
    const month = line.issueDate.slice(0, 7);
    return { key: month, label: month };
  }
  if (groupBy === 'customer') {
    if (line.customerId) return { key: line.customerId, label: line.customerLabel || 'Cliente' };
    if (line.customerLabel) return { key: `name:${normalizeName(line.customerLabel)}`, label: line.customerLabel };
    return { key: 'none', label: 'Sin cliente' };
  }
  if (categoryKind === 'expense') {
    return line.category
      ? { key: line.category, label: line.categoryLabel || line.category }
      : { key: 'none', label: 'Sin categoría' };
  }
  return line.category
    ? { key: line.category, label: WINE_CATEGORY[line.category] ?? line.categoryLabel ?? line.category }
    : { key: 'none', label: 'Sin categoría' };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function foldDocuments(lines: readonly DocLine[], groupBy: GroupBy, categoryKind: 'wine' | 'expense'): Map<string, Bucket> {
  const byDoc = new Map<string, DocLine[]>();
  for (const line of lines) {
    const group = byDoc.get(line.docId) ?? [];
    group.push(line);
    byDoc.set(line.docId, group);
  }
  const buckets = new Map<string, Bucket>();
  for (const docLines of byDoc.values()) {
    docLines.sort((left, right) => left.lineNo - right.lineNo || left.docId.localeCompare(right.docId));
    const weights = docLines.map((line) => new Decimal(decimalText(line.lineBase)));
    const first = docLines[0];
    if (!first) continue;
    const amounts = allocate(new Decimal(decimalText(first.docAmount)), weights);
    const bases = allocate(new Decimal(decimalText(first.docBase)), weights);
    const taxes = allocate(new Decimal(decimalText(first.docTax)), weights);
    docLines.forEach((line, index) => {
      const dim = dimension(groupBy, line, categoryKind);
      const bucket = buckets.get(dim.key) ?? emptyBucket(dim.key, dim.label);
      bucket.amount = money.add(bucket.amount, amounts[index] ?? new Decimal(0));
      bucket.base = money.add(bucket.base, bases[index] ?? new Decimal(0));
      bucket.tax = money.add(bucket.tax, taxes[index] ?? new Decimal(0));
      bucket.units = bucket.units.plus(new Decimal(decimalText(line.quantity)));
      bucket.volume = bucket.volume.plus(lineVolume(line));
      buckets.set(dim.key, bucket);
    });
  }
  return buckets;
}

export function fillPeriods(
  buckets: Map<string, Bucket>,
  from: string,
  to: string,
  groupBy: GroupBy,
  withAsOf = false,
): void {
  if (groupBy !== 'month' && groupBy !== 'year') return;
  for (const cut of periodCuts(from, to, groupBy)) {
    const existing = buckets.get(cut.key);
    if (!existing) buckets.set(cut.key, emptyBucket(cut.key, cut.label, withAsOf ? cut.asOf : undefined));
    else if (withAsOf && existing.asOf === undefined) existing.asOf = cut.asOf;
  }
}

function sumBuckets(buckets: Iterable<Bucket>): Bucket {
  const total = emptyBucket('total', 'Total');
  for (const bucket of buckets) {
    total.amount = money.add(total.amount, bucket.amount);
    total.base = money.add(total.base, bucket.base);
    total.tax = money.add(total.tax, bucket.tax);
    total.units = total.units.plus(bucket.units);
    total.volume = total.volume.plus(bucket.volume);
  }
  return total;
}

function isZero(bucket: Bucket): boolean {
  return bucket.amount.isZero() && bucket.base.isZero() && bucket.tax.isZero() && bucket.units.isZero() && bucket.volume.isZero();
}

export function buildReport(
  report: ReportName,
  scope: ReportScope,
  current: Map<string, Bucket>,
  previous: Map<string, Bucket> | null,
  closingKey: string | null,
): ReportBody {
  const axis = new Map(current);
  if (scope.groupBy === 'month' || scope.groupBy === 'year') {
    fillPeriods(axis, scope.from, scope.to, scope.groupBy, report === 'stock');
  } else if (previous) {
    for (const [key, bucket] of previous) {
      if (!axis.has(key) && !isZero(bucket)) axis.set(key, emptyBucket(key, bucket.label, bucket.asOf));
    }
    for (const [key, bucket] of [...axis]) {
      const prior = previous.get(key);
      if (isZero(bucket) && (!prior || isZero(prior))) axis.delete(key);
    }
  } else {
    for (const [key, bucket] of [...axis]) {
      if (isZero(bucket)) axis.delete(key);
    }
  }

  const keys = [...axis.keys()].sort((left, right) => left.localeCompare(right, 'es'));
  const series = keys.map((key) => {
    const bucket = axis.get(key) ?? emptyBucket(key, key);
    const point = {
      key: bucket.key,
      label: bucket.label,
      ...metricsOf(bucket),
      ...(bucket.asOf ? { as_of: bucket.asOf } : {}),
      previous: null as ReportBody['series'][number]['previous'],
    };
    if (previous) {
      const priorKey = shiftKey(scope.groupBy, key, -1);
      const prior = previous.get(scope.groupBy === 'month' || scope.groupBy === 'year' ? priorKey : key);
      point.previous = {
        key: priorKey,
        ...(prior ? metricsOf(prior) : zeroMetrics()),
      };
    }
    return point;
  });

  const flow = report !== 'stock' || (scope.groupBy !== 'month' && scope.groupBy !== 'year');
  const totals = flow
    ? metricsOf(sumBuckets(axis.values()))
    : metricsOf(axis.get(closingKey ?? '') ?? emptyBucket('total', 'Total'));
  let previousTotals: ReportMetrics | null = null;
  if (previous) {
    if (flow) previousTotals = metricsOf(sumBuckets(previous.values()));
    else {
      const priorKey = shiftKey(scope.groupBy, closingKey ?? '', -1);
      previousTotals = metricsOf(previous.get(priorKey) ?? emptyBucket(priorKey, priorKey));
    }
  }

  return {
    report,
    from: scope.from,
    to: scope.to,
    entity: scope.entity,
    entities: scope.entities,
    group_by: scope.groupBy,
    compare: scope.compare,
    currency: 'EUR',
    totals,
    previous_totals: previousTotals,
    series,
  };
}

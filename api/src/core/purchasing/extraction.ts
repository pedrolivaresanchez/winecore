import { Decimal } from 'decimal.js';
import { domainError } from '../errors';
import { normalizeTaxId } from '../party/taxId';
import { add, dec, isoDate, money2, near, parseAmount, price6, qty3, rate2 } from './amounts';

export const FIELD_KEYS = [
  'supplier_name',
  'supplier_tax_id',
  'number',
  'issue_date',
  'due_date',
  'lines',
  'vat',
  'totals',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export type ConfidenceMap = Record<FieldKey, number>;

export type ExtractedLine = {
  description: string;
  quantity: string;
  unit_price: string;
  line_base: string;
  vat_rate: string;
  vat_quota: string;
  withholding_rate: string;
};

export type ExtractedVat = {
  rate: string;
  base: string;
  quota: string;
};

export type Extraction = {
  extractor: 'facturae' | 'ubl' | 'timbal-ocr';
  model: string | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  supplier_tax_valid: boolean;
  buyer_tax_id: string | null;
  buyer_tax_valid: boolean;
  number: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  payment_method: string | null;
  lines: ExtractedLine[];
  vat_by_rate: ExtractedVat[];
  subtotal: string;
  tax_total: string;
  withholding_total: string;
  total: string;
  confidence: ConfidenceMap;
  overall: number;
  totals_ok: boolean;
};

const PAYMENTS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'other']);
const MAX_LINES = 200;
const TOO_BIG = new Decimal('1000000000');

export type RawLine = {
  description?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
  line_base?: string | null;
  vat_rate?: string | null;
  vat_quota?: string | null;
  withholding_rate?: string | null;
};

export type RawExtraction = {
  extractor: Extraction['extractor'];
  model?: string | null;
  supplier_name?: string | null;
  supplier_tax_id?: string | null;
  buyer_tax_id?: string | null;
  number?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  payment_method?: string | null;
  lines?: RawLine[] | null;
  vat_by_rate?: { rate?: string | null; base?: string | null; quota?: string | null }[] | null;
  subtotal?: string | null;
  tax_total?: string | null;
  withholding_total?: string | null;
  total?: string | null;
  confidence?: Partial<Record<FieldKey, number>> | null;
};

function invalid(fields: Record<string, string>): never {
  throw domainError('WC_VALIDATION', fields);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, max);
}

function taxOf(raw: string | null): { id: string | null; valid: boolean } {
  if (!raw) return { id: null, valid: false };
  const parsed = normalizeTaxId(raw, 'ES');
  if (!parsed.normalized) return { id: null, valid: false };
  return { id: parsed.normalized, valid: parsed.valid };
}

function bounded(value: Decimal, field: string): Decimal {
  if (value.abs().gte(TOO_BIG)) invalid({ [field]: 'El importe se sale del rango' });
  return value;
}

function lineOf(raw: RawLine, index: number): ExtractedLine {
  const description = clip(raw.description, 500) ?? 'Sin descripción';
  const quantity = parseAmount(raw.quantity) ?? new Decimal(1);
  const rate = parseAmount(raw.vat_rate) ?? new Decimal(0);
  const withholdingRate = parseAmount(raw.withholding_rate) ?? new Decimal(0);
  let base = parseAmount(raw.line_base);
  const priceRaw = parseAmount(raw.unit_price);
  if (!base) {
    if (!priceRaw) invalid({ lines: `La línea ${index + 1} no tiene base` });
    base = bounded(quantity.times(priceRaw), 'lines').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  base = bounded(base, 'lines');
  const unit = priceRaw ?? (quantity.eq(0) ? base : base.div(quantity));
  let quota = parseAmount(raw.vat_quota);
  if (!quota) quota = base.times(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rate.lt(0) || rate.gt(100) || withholdingRate.lt(0) || withholdingRate.gt(100)) {
    invalid({ lines: `El tipo de la línea ${index + 1} no es válido` });
  }
  return {
    description,
    quantity: qty3(bounded(quantity, 'lines')),
    unit_price: price6(bounded(unit, 'lines')),
    line_base: money2(base),
    vat_rate: rate2(rate),
    vat_quota: money2(bounded(quota, 'lines')),
    withholding_rate: rate2(withholdingRate),
  };
}

function withholdingOf(line: ExtractedLine): Decimal {
  return dec(line.line_base).times(dec(line.withholding_rate)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function groupVat(lines: readonly ExtractedLine[]): ExtractedVat[] {
  const groups = new Map<string, { base: Decimal; quota: Decimal }>();
  for (const line of lines) {
    const current = groups.get(line.vat_rate) ?? { base: new Decimal(0), quota: new Decimal(0) };
    current.base = current.base.plus(dec(line.line_base));
    current.quota = current.quota.plus(dec(line.vat_quota));
    groups.set(line.vat_rate, current);
  }
  return [...groups.entries()]
    .sort((left, right) => dec(left[0]).comparedTo(dec(right[0])))
    .map(([rate, amounts]) => ({ rate, base: money2(amounts.base), quota: money2(amounts.quota) }));
}

export function buildExtraction(raw: RawExtraction): Extraction {
  const linesIn = raw.lines ?? [];
  if (linesIn.length > MAX_LINES) invalid({ lines: 'Demasiadas líneas' });
  const lines = linesIn.map((line, index) => lineOf(line, index));
  const base = add(lines.map((line) => dec(line.line_base)));
  const vat = add(lines.map((line) => dec(line.vat_quota)));
  const withholding = add(lines.map(withholdingOf));
  const declaredSubtotal = parseAmount(raw.subtotal);
  const declaredTax = parseAmount(raw.tax_total);
  const declaredWithholding = parseAmount(raw.withholding_total);
  const declaredTotal = parseAmount(raw.total);
  const subtotal = declaredSubtotal ?? base;
  const taxTotal = declaredTax ?? vat;
  const withholdingTotal = declaredWithholding ?? withholding;
  const computed = base.plus(vat).minus(withholding);
  const total = declaredTotal ?? computed;
  const totalsOk = declaredTotal != null
    && near(declaredTotal, computed)
    && (declaredSubtotal == null || near(declaredSubtotal, base))
    && (declaredTax == null || near(declaredTax, vat))
    && (declaredWithholding == null || near(declaredWithholding, withholding));

  const supplier = taxOf(clip(raw.supplier_tax_id, 20));
  const buyer = taxOf(clip(raw.buyer_tax_id, 20));
  const number = clip(raw.number, 60);
  const issue = isoDate(raw.issue_date);
  const due = isoDate(raw.due_date);
  const name = clip(raw.supplier_name, 120);
  const currencyRaw = clip(raw.currency, 3)?.toUpperCase() ?? 'EUR';
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'EUR';
  const payment = raw.payment_method && PAYMENTS.has(raw.payment_method) ? raw.payment_method : null;

  const given = raw.confidence ?? {};
  const confidence: ConfidenceMap = {
    supplier_name: clamp01(given.supplier_name ?? (name ? 1 : 0)),
    supplier_tax_id: clamp01(given.supplier_tax_id ?? (supplier.id ? 1 : 0)),
    number: clamp01(given.number ?? (number ? 1 : 0)),
    issue_date: clamp01(given.issue_date ?? (issue ? 1 : 0)),
    due_date: clamp01(given.due_date ?? (due ? 1 : 0)),
    lines: clamp01(given.lines ?? (lines.length > 0 ? 1 : 0)),
    vat: clamp01(given.vat ?? (lines.length > 0 ? 1 : 0)),
    totals: clamp01(given.totals ?? (declaredTotal ? 1 : 0)),
  };
  if (!supplier.valid && supplier.id) confidence.supplier_tax_id = Math.min(confidence.supplier_tax_id, 0.5);
  if (!totalsOk) confidence.totals = Math.min(confidence.totals, 0.5);
  const overall = Math.min(
    confidence.supplier_tax_id,
    confidence.number,
    confidence.issue_date,
    confidence.totals,
  );

  const vatByRate = raw.vat_by_rate && raw.vat_by_rate.length > 0
    ? raw.vat_by_rate.flatMap((entry) => {
        const rate = parseAmount(entry.rate);
        const entryBase = parseAmount(entry.base);
        const quota = parseAmount(entry.quota);
        if (!rate || !entryBase || !quota) return [];
        return [{ rate: rate2(rate), base: money2(entryBase), quota: money2(quota) }];
      })
    : groupVat(lines);

  return {
    extractor: raw.extractor,
    model: clip(raw.model, 80),
    supplier_name: name,
    supplier_tax_id: supplier.id,
    supplier_tax_valid: supplier.valid,
    buyer_tax_id: buyer.id,
    buyer_tax_valid: buyer.valid,
    number,
    issue_date: issue,
    due_date: due,
    currency,
    payment_method: payment,
    lines,
    vat_by_rate: vatByRate.length > 0 ? vatByRate : groupVat(lines),
    subtotal: money2(bounded(subtotal, 'subtotal')),
    tax_total: money2(bounded(taxTotal, 'tax_total')),
    withholding_total: money2(bounded(withholdingTotal, 'withholding_total')),
    total: money2(bounded(total, 'total')),
    confidence,
    overall: clamp01(overall),
    totals_ok: totalsOk,
  };
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** La extracción que llega del miembro (o de un cliente) no puede fijar el estado ni otros campos. */
export function parseSuppliedExtraction(value: unknown, model: string | null): Extraction {
  const body = asRecord(value);
  if (!body) invalid({ extraction: 'La extracción no es un objeto' });
  const confidence = asRecord(body.confidence);
  const confidenceMap: Partial<Record<FieldKey, number>> = {};
  if (confidence) {
    for (const key of FIELD_KEYS) {
      const item = confidence[key];
      if (typeof item === 'number') confidenceMap[key] = item;
    }
  }
  const lines = Array.isArray(body.lines) ? body.lines.flatMap((line) => {
    const record = asRecord(line);
    if (!record) return [];
    return [{
      description: asString(record.description),
      quantity: asString(record.quantity),
      unit_price: asString(record.unit_price),
      line_base: asString(record.line_base),
      vat_rate: asString(record.vat_rate),
      vat_quota: asString(record.vat_quota),
      withholding_rate: asString(record.withholding_rate),
    }];
  }) : [];
  const vat = Array.isArray(body.vat_by_rate) ? body.vat_by_rate.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [{ rate: asString(record.rate), base: asString(record.base), quota: asString(record.quota) }];
  }) : [];
  const payment = typeof body.payment_method === 'string' ? body.payment_method : null;
  return buildExtraction({
    extractor: 'timbal-ocr',
    model,
    supplier_name: asString(body.supplier_name),
    supplier_tax_id: asString(body.supplier_tax_id),
    buyer_tax_id: asString(body.buyer_tax_id),
    number: asString(body.number),
    issue_date: asString(body.issue_date),
    due_date: asString(body.due_date),
    currency: asString(body.currency),
    payment_method: payment,
    lines,
    vat_by_rate: vat,
    subtotal: asString(body.subtotal),
    tax_total: asString(body.tax_total),
    withholding_total: asString(body.withholding_total),
    total: asString(body.total),
    confidence: confidenceMap,
  });
}

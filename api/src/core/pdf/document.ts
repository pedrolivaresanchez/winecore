import { Decimal } from 'decimal.js';
import {
  HoldedSheet,
  formatAmount,
  formatNumber,
  formatPercent,
  formatUnitPrice,
  type NoteLine,
  type PdfLang,
  type TableColumn,
  type TableRow,
  type TotalRow,
} from './holded-layout';
import { customerSpec, issuerSpec, type PartyLike } from './parties';
import { EMPTY_DOCUMENT_PROFILE, type DocumentProfileView, type DocumentVariant } from './profile';
import { shipToLines, type ShipToView } from './ship-to';

export type DocumentPdfLang = PdfLang;

interface Labels {
  date: string;
  status: string;
  notes: string;
  draft: string;
  ref: string;
  lot: string;
  discount: string;
  taxable: string;
  vat: string;
  withholding: string;
  total: string;
  paid: string;
  pending: string;
  shipTo: string;
  noLines: string;
  discountShort: string;
  columns: Record<'concept' | 'price' | 'units' | 'discount' | 'vat' | 'total' | 'subtotal', string>;
}

const LABELS: Record<DocumentPdfLang, Labels> = {
  es: {
    date: 'Fecha',
    status: 'Estado',
    notes: 'Notas',
    draft: 'BORRADOR',
    ref: 'Ref.',
    lot: 'LOTE',
    discount: 'DESCUENTO POR ITEM',
    taxable: 'BASE IMPONIBLE',
    vat: 'IVA',
    withholding: 'RETENCIÓN',
    total: 'TOTAL',
    paid: 'PAGADO',
    pending: 'PENDIENTE',
    shipTo: 'Dirección de envío',
    noLines: 'Sin líneas.',
    discountShort: 'Dto.',
    columns: {
      concept: 'CONCEPTO',
      price: 'PRECIO',
      units: 'UNIDADES',
      discount: 'DTO.',
      vat: 'IVA',
      total: 'TOTAL',
      subtotal: 'SUBTOTAL',
    },
  },
  en: {
    date: 'Date',
    status: 'Status',
    notes: 'Notes',
    draft: 'DRAFT',
    ref: 'Ref.',
    lot: 'LOT',
    discount: 'DISCOUNT PER ITEM',
    taxable: 'TAXABLE AMOUNT',
    vat: 'VAT',
    withholding: 'WITHHOLDING',
    total: 'TOTAL',
    paid: 'PAID',
    pending: 'PENDING',
    shipTo: 'Shipping address',
    noLines: 'No lines.',
    discountShort: 'Disc.',
    columns: {
      concept: 'DESCRIPTION',
      price: 'PRICE',
      units: 'QUANTITY',
      discount: 'DISC.',
      vat: 'VAT',
      total: 'TOTAL',
      subtotal: 'SUBTOTAL',
    },
  },
};

/** Mismos anchos que las plantillas de Holded; la maqueta los amplía si un importe no cabe. */
const PRICED_WIDTHS: Record<DocumentVariant, readonly number[]> = {
  po: [265.4, 56.1, 56.1, 51, 40.8, 40.6],
  cvpo: [132.7, 89.7, 77.1, 82.5, 57.3, 70.6],
};
const UNPRICED_WIDTHS: readonly number[] = [409.4, 100.6];

export interface DocumentPdfSeller {
  legalName: string;
  taxId: string;
  addressLine: string;
  postalCode: string;
  city: string;
  province: string;
  tradeName?: string | null;
  addressLine2?: string | null;
  /** Sin país se entiende España y no se imprime. */
  countryCode?: string | null;
}

export interface DocumentPdfLine {
  description: string | null;
  sku?: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_base: string | null;
  /** Etiqueta del impuesto; si no hay `tax_rate`, se intenta leer el porcentaje de aquí («21%»). */
  tax_code: string | null;
  unit?: string | null;
  discount_pct?: string | null;
  /** Porcentaje numérico del impuesto (21 para el IVA general). */
  tax_rate?: string | null;
  lot?: string | null;
}

export interface DocumentPdfInput {
  lang?: DocumentPdfLang;
  /** «Presupuesto», «Albarán»…; se imprime en mayúsculas junto al número. */
  title: string;
  /** Sin número el documento es un borrador y el título lo dice. */
  number: string | null;
  issueDate: string | null;
  /** Sin etiqueta, la cabecera no lleva segunda fecha (el albarán no vence). */
  dueLabel: string | null;
  dueDate: string | null;
  status: string;
  /** Líneas de datos ya traducidas (incoterm, origen, destino); van juntas en las notas del pie. */
  meta?: string[];
  partyLabel: string;
  seller: DocumentPdfSeller;
  customerName: string;
  /** Domicilio y contacto del cliente cuando se conocen; sin ellos, solo el nombre. */
  customer?: PartyLike | null;
  description: string | null;
  lines: DocumentPdfLine[];
  /** Sin precios, la tabla solo lleva descripción y unidades. */
  priced?: boolean;
  /** Sin totales, el documento no lleva bloque de importes (albarán sin valorar). */
  totals: { subtotal: string; vat: string; withholding: string | null; total: string } | null;
  /** Solo las facturas llevan cobrado y pendiente. */
  settlement: { paid: string | null; pending: string | null } | null;
  note: string;
  currency?: string;
  profile?: DocumentProfileView | null;
  shipTo?: ShipToView | null;
  customerReferences?: string | null;
}

/**
 * Documento A4 con la maqueta de Holded (la misma que la factura): cabecera con logotipo,
 * emisor, caja del cliente, tabla de líneas y totales. No emite ni altera Verifactu.
 */
export async function renderDocumentPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  const lang: DocumentPdfLang = input.lang === 'en' ? 'en' : 'es';
  const labels = LABELS[lang];
  const profile = input.profile ?? EMPTY_DOCUMENT_PROFILE;
  const variant = profile.variant;
  const currency = input.currency ?? 'EUR';
  const priced = input.priced ?? true;
  const sheet = await HoldedSheet.create({ lang, logo: profile.logo });

  const number = input.number?.trim() ?? '';
  const shownTitle = input.title.toLocaleUpperCase(lang === 'es' ? 'es' : 'en');
  const title = number === '' ? `${shownTitle} (${labels.draft})` : `${shownTitle} #${number}`;
  const dateLines: string[] = [];
  if (input.issueDate) dateLines.push(`${labels.date}: ${civilDate(input.issueDate, lang)}`);
  if (input.dueLabel && input.dueDate) dateLines.push(`${input.dueLabel}: ${civilDate(input.dueDate, lang)}`);
  if (input.status.trim() !== '') dateLines.push(`${labels.status}: ${input.status.trim()}`);
  const brand = input.seller.tradeName?.trim() ?? '';
  sheet.header({
    title,
    dateLines,
    brandText: brand !== '' && brand !== input.seller.legalName ? brand : null,
  });

  const ship = input.shipTo ? shipToLines(input.shipTo, lang) : [];
  const customer = customerSpec(input.customer ?? bareParty(input.customerName), lang);
  sheet.parties({
    issuer: issuerSpec(sellerParty(input.seller), profile, lang),
    ship: ship.length > 0 ? { heading: labels.shipTo, lines: ship } : null,
    customer: { ...customer, name: input.customerName.trim() === '' ? customer.name : input.customerName, label: `${input.partyLabel}:` },
  });
  sheet.references(textLines(input.customerReferences));

  const columns = columnsFor(variant, priced, labels);
  const rows = input.lines.length === 0
    ? [{ concept: { title: labels.noLines, detail: [] }, cells: columns.slice(1).map(() => '') }]
    : input.lines.map((line) => rowFor(line, variant, priced, labels, lang, currency));
  sheet.table(columns, rows);

  if (input.totals) sheet.totals(totalRows(input, labels, lang, currency));
  sheet.notes(noteLines(input, profile, labels));

  const issued = utcMidnight(input.issueDate);
  return sheet.finish({
    title: `${input.title} ${number}`.trim(),
    author: input.seller.legalName,
    subject: number === '' ? undefined : number,
    createdAt: issued,
    fingerprint: { variant, priced },
  });
}

function sellerParty(seller: DocumentPdfSeller): PartyLike {
  return {
    legalName: seller.legalName,
    taxId: seller.taxId,
    address: {
      line1: seller.addressLine,
      line2: seller.addressLine2 ?? null,
      postalCode: seller.postalCode,
      city: seller.city,
      province: seller.province.trim() === '' ? null : seller.province,
      countryCode: (seller.countryCode ?? 'ES').toUpperCase(),
    },
  };
}

function bareParty(name: string): PartyLike {
  return {
    legalName: name,
    taxId: '',
    address: { line1: '', line2: null, postalCode: '', city: '', province: null, countryCode: '' },
  };
}

function columnsFor(variant: DocumentVariant, priced: boolean, labels: Labels): TableColumn[] {
  const c = labels.columns;
  if (!priced) {
    return [c.concept, c.units].map((header, index) => ({
      header,
      width: UNPRICED_WIDTHS[index] ?? 100,
      align: index === 0 ? 'left' : 'right',
    }));
  }
  const names = variant === 'po'
    ? [c.concept, c.price, c.units, c.discount, c.vat, c.total]
    : [c.concept, c.units, c.price, c.subtotal, c.vat, c.total];
  return names.map((header, index) => ({
    header,
    width: PRICED_WIDTHS[variant][index] ?? 60,
    align: index === 0 ? 'left' : 'right',
  }));
}

function decimal(value: string | null | undefined): Decimal | null {
  if (value == null || value.trim() === '') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Porcentaje del impuesto de la línea: el numérico si viene; si no, el «21%» de la etiqueta. */
function rateOf(line: DocumentPdfLine): Decimal | null {
  const direct = decimal(line.tax_rate);
  if (direct) return direct;
  const match = /(\d+(?:[.,]\d+)?)\s*%/u.exec(line.tax_code ?? '');
  return match?.[1] ? decimal(match[1].replace(',', '.')) : null;
}

function baseOf(line: DocumentPdfLine): Decimal | null {
  const given = decimal(line.line_base);
  if (given) return given;
  const quantity = decimal(line.quantity);
  const price = decimal(line.unit_price);
  if (!quantity || !price) return null;
  const discount = decimal(line.discount_pct) ?? new Decimal(0);
  return round2(quantity.mul(price).mul(new Decimal(100).sub(discount)).div(100));
}

function unitLabel(unit: string | null | undefined, lang: DocumentPdfLang): string {
  const value = unit?.trim() ?? '';
  if (value === 'ud' && lang === 'en') return 'pcs';
  return value;
}

function rowFor(
  line: DocumentPdfLine,
  variant: DocumentVariant,
  priced: boolean,
  labels: Labels,
  lang: DocumentPdfLang,
  currency: string,
): TableRow {
  const title = (line.description ?? line.sku ?? '—').trim() || '—';
  const detail: string[] = [];
  if (line.sku && line.sku !== title) detail.push(`${labels.ref} ${line.sku}`);
  if (line.lot) detail.push(`${labels.lot}: ${line.lot}`);
  const quantity = formatNumber(line.quantity, lang, 3);
  const unit = unitLabel(line.unit, lang);
  const withUnit = `${quantity} ${unit}`.trim();
  if (!priced) return { concept: { title, detail }, cells: [withUnit] };

  const base = baseOf(line);
  const rate = rateOf(line);
  const total = base ? (rate ? base.add(round2(base.mul(rate).div(100))) : base) : null;
  const discount = decimal(line.discount_pct);
  const discountText = discount && !discount.isZero() ? formatPercent(discount, lang) : '';
  const price = formatUnitPrice(line.unit_price, lang, currency);
  const vat = rate ? formatPercent(rate, lang) : (line.tax_code ?? '');
  const totalText = total ? formatAmount(total, lang, currency) : '';
  if (variant === 'po') {
    return { concept: { title, detail }, cells: [price, quantity, discountText, vat, totalText] };
  }
  if (discountText !== '') detail.push(`${labels.discountShort} ${discountText}`);
  return {
    concept: { title, detail },
    cells: [withUnit, price, base ? formatAmount(base, lang, currency) : '', vat, totalText],
  };
}

function nonZero(value: string | null | undefined): boolean {
  const parsed = decimal(value);
  return parsed !== null && !parsed.isZero();
}

function totalRows(input: DocumentPdfInput, labels: Labels, lang: DocumentPdfLang, currency: string): TotalRow[] {
  const totals = input.totals;
  if (!totals) return [];
  const rows: TotalRow[] = [];

  let discount = new Decimal(0);
  let complete = input.lines.length > 0;
  for (const line of input.lines) {
    const quantity = decimal(line.quantity);
    const price = decimal(line.unit_price);
    const base = baseOf(line);
    if (!quantity || !price || !base) {
      complete = false;
      break;
    }
    discount = discount.add(round2(quantity.mul(price)).sub(base));
  }
  if (complete && discount.gt(0)) rows.push({ label: labels.discount, value: formatAmount(discount, lang, currency) });

  rows.push({ label: labels.taxable, value: formatAmount(totals.subtotal, lang, currency) });
  const breakdown = vatBreakdown(input.lines, totals.vat);
  if (breakdown) {
    for (const item of breakdown) {
      rows.push({
        label: `${labels.vat} ${formatPercent(item.rate, lang)}`,
        value: formatAmount(item.quota, lang, currency),
      });
    }
  } else {
    rows.push({ label: labels.vat, value: formatAmount(totals.vat, lang, currency) });
  }
  if (nonZero(totals.withholding)) {
    const held = decimal(totals.withholding)?.abs();
    if (held) rows.push({ label: labels.withholding, value: formatAmount(held.neg(), lang, currency) });
  }
  rows.push({ label: labels.total, value: formatAmount(totals.total, lang, currency) });
  if (input.settlement) {
    if (input.settlement.paid != null) rows.push({ label: labels.paid, value: formatAmount(input.settlement.paid, lang, currency) });
    if (input.settlement.pending != null) {
      rows.push({ label: labels.pending, value: formatAmount(input.settlement.pending, lang, currency) });
    }
  }
  return rows;
}

/** Cuota por tipo solo si todas las líneas traen su porcentaje y la suma cuadra con el IVA del documento. */
function vatBreakdown(lines: readonly DocumentPdfLine[], documentVat: string): { rate: Decimal; quota: Decimal }[] | null {
  if (lines.length === 0) return null;
  const bases = new Map<string, { rate: Decimal; base: Decimal }>();
  for (const line of lines) {
    const rate = rateOf(line);
    const base = baseOf(line);
    if (!rate || !base) return null;
    const key = rate.toFixed();
    const current = bases.get(key);
    bases.set(key, { rate, base: (current?.base ?? new Decimal(0)).add(base) });
  }
  const groups = [...bases.values()]
    .sort((left, right) => left.rate.comparedTo(right.rate))
    .map(({ rate, base }) => ({ rate, quota: round2(base.mul(rate).div(100)) }));
  const sum = groups.reduce((total, group) => total.add(group.quota), new Decimal(0));
  const expected = decimal(documentVat);
  if (!expected || !round2(expected).equals(sum)) return null;
  return groups;
}

function noteLines(input: DocumentPdfInput, profile: DocumentProfileView, labels: Labels): NoteLine[] {
  const out: NoteLine[] = [];
  const group = (items: readonly NoteLine[]): void => {
    if (items.length === 0) return;
    if (out.length > 0) out.push('');
    out.push(...items);
  };
  group(profile.footerLines.map((line) => line.trim()));

  const extra: string[] = [];
  const meta = (input.meta ?? []).map((line) => line.trim()).filter((line) => line !== '');
  if (meta.length > 0) extra.push(meta.join(' · '));
  textLines(input.description).forEach((line, index) => extra.push(index === 0 ? `${labels.notes}: ${line}` : line));
  group(extra);

  const note = input.note.trim();
  if (note !== '') group([note]);
  return out;
}

function textLines(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '');
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function civilDate(value: string, lang: DocumentPdfLang): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return value;
  if (lang === 'en') return `${Number(match[3])} ${MONTHS_EN[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function utcMidnight(iso: string | null): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso ?? '');
  if (!match) return new Date(Date.UTC(2020, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

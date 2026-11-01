import { Decimal } from 'decimal.js';
import { domainError } from '../../errors';
import { money } from '../../money';
import {
  HoldedSheet,
  formatAmount,
  formatNumber,
  formatPercent,
  formatUnitPrice,
  type NoteLine,
  type TableColumn,
  type TableRow,
  type TotalRow,
} from '../../pdf/holded-layout';
import { customerSpec, issuerSpec } from '../../pdf/parties';
import { isDocumentVariant, type DocumentVariant } from '../../pdf/profile';
import { shipToLines } from '../../pdf/ship-to';
import {
  addAmounts,
  assertLang,
  formatDate,
  isZeroAmount,
  paymentLabel,
  sameAmount,
  subAmounts,
  utcMidnight,
} from './format';
import { QR_LABEL, QR_LEGEND } from './qr';
import type {
  InvoiceLang,
  InvoiceLineView,
  InvoiceTaxView,
  IssuedInvoice,
  VerifactuSlot,
} from './types';

const SIMPLIFIED = new Set(['F2', 'R5']);
const DEFAULT_DESCRIPTION = 'Venta de vino';

interface Labels {
  invoice: string;
  corrective: string;
  simplified: string;
  date: string;
  operationDate: string;
  shipTo: string;
  lot: string;
  ref: string;
  discount: string;
  taxable: string;
  vat: string;
  surcharge: string;
  withholding: string;
  total: string;
  amountDue: string;
  dueOne: string;
  dueMany: string;
  payment: string;
  incoterm: string;
  notes: string;
  operation: string;
  registry: string;
  deliveryNote: string;
  deliveryNotes: string;
  reason: string;
  columns: Record<'concept' | 'price' | 'units' | 'discount' | 'vat' | 'total' | 'subtotal', string>;
  discountShort: string;
}

const LABELS: Record<InvoiceLang, Labels> = {
  es: {
    invoice: 'FACTURA',
    corrective: 'FACTURA RECTIFICATIVA',
    simplified: 'FACTURA SIMPLIFICADA',
    date: 'Fecha',
    operationDate: 'Fecha de operación',
    shipTo: 'Dirección de envío',
    lot: 'LOTE',
    ref: 'Ref.',
    discount: 'DESCUENTO POR ITEM',
    taxable: 'BASE IMPONIBLE',
    vat: 'IVA',
    surcharge: 'RECARGO DE EQUIVALENCIA',
    withholding: 'RETENCIÓN IRPF',
    total: 'TOTAL',
    amountDue: 'TOTAL A PAGAR',
    dueOne: 'Vencimiento',
    dueMany: 'Vencimientos',
    payment: 'Forma de pago',
    incoterm: 'Incoterm',
    notes: 'Notas',
    operation: 'Operación',
    registry: 'Datos registrales',
    deliveryNote: 'Albarán:',
    deliveryNotes: 'Albaranes:',
    reason: 'Motivo',
    columns: {
      concept: 'CONCEPTO',
      price: 'PRECIO',
      units: 'UNIDADES',
      discount: 'DTO.',
      vat: 'IVA',
      total: 'TOTAL',
      subtotal: 'SUBTOTAL',
    },
    discountShort: 'Dto.',
  },
  en: {
    invoice: 'INVOICE',
    corrective: 'CORRECTIVE INVOICE',
    simplified: 'SIMPLIFIED INVOICE',
    date: 'Date',
    operationDate: 'Operation date',
    shipTo: 'Shipping address',
    lot: 'LOT',
    ref: 'Ref.',
    discount: 'DISCOUNT PER ITEM',
    taxable: 'TAXABLE AMOUNT',
    vat: 'VAT',
    surcharge: 'EQUIVALENCE SURCHARGE',
    withholding: 'INCOME TAX WITHHOLDING',
    total: 'TOTAL',
    amountDue: 'AMOUNT DUE',
    dueOne: 'Due date',
    dueMany: 'Due dates',
    payment: 'Payment method',
    incoterm: 'Incoterm',
    notes: 'Notes',
    operation: 'Operation',
    registry: 'Registry',
    deliveryNote: 'Delivery note:',
    deliveryNotes: 'Delivery notes:',
    reason: 'Reason',
    columns: {
      concept: 'DESCRIPTION',
      price: 'PRICE',
      units: 'QUANTITY',
      discount: 'DISC.',
      vat: 'VAT',
      total: 'TOTAL',
      subtotal: 'SUBTOTAL',
    },
    discountShort: 'Disc.',
  },
};

/** Anchos de las dos plantillas de Holded (PO y CVPO). */
const COLUMN_WIDTHS: Record<DocumentVariant, readonly number[]> = {
  po: [265.4, 56.1, 56.1, 51, 40.8, 40.6],
  cvpo: [132.7, 89.7, 77.1, 82.5, 57.3, 70.6],
};

/**
 * PDF inmutable de la factura emitida. La misma factura y el mismo idioma dan siempre los
 * mismos bytes. El QR y las leyendas de Verifactu solo se pintan con la instalación activa.
 */
export async function renderInvoicePdf(
  invoice: IssuedInvoice,
  lang: InvoiceLang,
): Promise<Uint8Array> {
  assertLang(lang);
  const qr = requireQr(invoice.verifactu);
  assertInvoice(invoice);

  const labels = LABELS[lang];
  const profile = invoice.profile;
  const variant = profile.variant;
  const sheet = await HoldedSheet.create({ lang, logo: profile.logo });
  const currency = invoice.currency;
  const taxes = sortTaxes(invoice.taxes);
  const lines = sortLines(invoice.lines);

  const brand = invoice.issuer.tradeName?.trim() ?? '';
  const dateLines = [`${labels.date}: ${formatDate(invoice.issueDate, lang)}`];
  if (invoice.operationDate && invoice.operationDate !== invoice.issueDate) {
    dateLines.push(`${labels.operationDate}: ${formatDate(invoice.operationDate, lang)}`);
  }
  sheet.header({
    title: `${titleFor(invoice.invoiceType, labels)} #${invoice.number}`,
    dateLines,
    brandText: brand !== '' && brand !== invoice.issuer.legalName ? brand : null,
  });
  if (qr) sheet.qr({ url: qr.url, modules: qr.modules, label: QR_LABEL, legend: QR_LEGEND });

  const ship = invoice.shipTo ? shipToLines(invoice.shipTo, lang) : [];
  sheet.parties({
    issuer: issuerSpec(invoice.issuer, profile, lang),
    ship: ship.length > 0 ? { heading: labels.shipTo, lines: ship } : null,
    customer: customerSpec(invoice.customer, lang),
  });

  const references: string[] = [];
  for (const rectification of sortRectifications(invoice.rectifications)) {
    references.push(rectificationLine(rectification, lang), `${labels.reason}: ${rectification.reason}`);
  }
  references.push(...textLines(invoice.customerReferences));
  sheet.references(references);

  const rates = new Map(taxes.map((tax) => [tax.taxCode, tax.rate]));
  const discounted = lines.some((line) => !isZeroAmount(line.discountPct));
  sheet.table(columnsFor(variant, labels), lines.map((line) => rowFor(line, variant, rates, labels, lang, currency)));
  sheet.totals(totalRows(invoice, taxes, lines, labels, lang, discounted));

  sheet.legal(mentionsFor(invoice, taxes, lang));
  sheet.notes(noteLines(invoice, labels, lang));

  return sheet.finish({
    title: lang === 'es' ? `Factura ${invoice.number}` : `Invoice ${invoice.number}`,
    author: invoice.issuer.legalName,
    subject: invoice.number,
    createdAt: utcMidnight(invoice.issueDate),
    fingerprint: { variant },
  });
}

function requireQr(slot: VerifactuSlot): { url: string; modules: readonly (readonly boolean[])[] } | null {
  if (!slot.active) return null;
  if (!slot.qrUrl || slot.qrUrl.length > 2000 || !slot.qrModules || slot.qrModules.length === 0) {
    throw domainError('WC_VALIDATION', {
      verifactu: 'La instalación Verifactu está activa y el QR todavía no se dibuja (M4)',
    });
  }
  const size = slot.qrModules.length;
  for (const row of slot.qrModules) {
    if (row.length !== size) {
      throw domainError('WC_VALIDATION', { verifactu: 'La matriz del QR no es cuadrada' });
    }
  }
  return { url: slot.qrUrl, modules: slot.qrModules };
}

function assertInvoice(invoice: IssuedInvoice): void {
  if (!/^[A-Z]{3}$/.test(invoice.currency)) {
    throw domainError('WC_VALIDATION', { currency: 'Moneda no válida' });
  }
  if (invoice.number.trim() === '' || invoice.number.length > 60) {
    throw domainError('WC_VALIDATION', { number: 'La factura necesita número y serie' });
  }
  if (invoice.seriesCode.trim() === '') {
    throw domainError('WC_VALIDATION', { series: 'La factura necesita número y serie' });
  }
  if (invoice.description.trim() === '' || invoice.description.length > 500) {
    throw domainError('WC_VALIDATION', { description: 'Falta la descripción de la operación' });
  }
  if (invoice.lines.length === 0) {
    throw domainError('WC_VALIDATION', { lines: 'La factura necesita al menos una línea' });
  }
  if (invoice.taxes.length === 0) {
    throw domainError('WC_VALIDATION', { taxes: 'Falta el desglose de impuestos' });
  }
  if (!isDocumentVariant(invoice.profile.variant)) {
    throw domainError('WC_VALIDATION', { variant: 'La variante de plantilla no es válida' });
  }
  assertParty(invoice.issuer, 'issuer', true);
  assertParty(invoice.customer, 'customer', !SIMPLIFIED.has(invoice.invoiceType));
  for (const line of invoice.lines) {
    if (line.description.trim() === '' || line.description.length > 250) {
      throw domainError('WC_VALIDATION', { lines: 'La descripción de la línea no es válida' });
    }
  }

  const subtotal = addAmounts(invoice.lines.map((line) => line.lineBase));
  if (!sameAmount(subtotal, invoice.subtotal)) {
    throw domainError('WC_VALIDATION', { subtotal: 'La base no cuadra con las líneas' });
  }
  const taxBase = addAmounts(invoice.taxes.map((tax) => tax.base));
  if (!sameAmount(taxBase, invoice.subtotal)) {
    throw domainError('WC_VALIDATION', { subtotal: 'La base del desglose no cuadra' });
  }
  if (!sameAmount(addAmounts(invoice.taxes.map((tax) => tax.quota)), invoice.taxTotal)) {
    throw domainError('WC_VALIDATION', { tax_total: 'La cuota de IVA no cuadra' });
  }
  if (!sameAmount(addAmounts(invoice.taxes.map((tax) => tax.surchargeQuota)), invoice.surchargeTotal)) {
    throw domainError('WC_VALIDATION', { surcharge_total: 'El recargo no cuadra' });
  }
  if (!sameAmount(addAmounts(invoice.taxes.map((tax) => tax.withholding)), invoice.withholdingTotal)) {
    throw domainError('WC_VALIDATION', { withholding_total: 'La retención no cuadra' });
  }
  const importe = addAmounts([invoice.subtotal, invoice.taxTotal, invoice.surchargeTotal]);
  if (!sameAmount(importe, invoice.importeTotal)) {
    throw domainError('WC_VALIDATION', { importe_total: 'El importe total no cuadra con la base, el IVA y el recargo' });
  }
  if (!sameAmount(subAmounts(invoice.importeTotal, invoice.withholdingTotal), invoice.totalToPay)) {
    throw domainError('WC_VALIDATION', { total: 'El total a pagar no cuadra' });
  }
}

function assertParty(
  party: IssuedInvoice['issuer'],
  field: string,
  requireTaxId: boolean,
): void {
  if (party.legalName.trim() === '' || party.legalName.length > 120) {
    throw domainError('WC_VALIDATION', { [field]: 'Falta el nombre o la razón social' });
  }
  if (requireTaxId && party.taxId.trim() === '') {
    throw domainError('WC_VALIDATION', { [field]: 'Falta el NIF' });
  }
  if (party.address.line1.trim() === '' || party.address.city.trim() === '' || party.address.postalCode.trim() === '') {
    throw domainError('WC_VALIDATION', { [field]: 'Falta el domicilio' });
  }
  if (!/^[A-Z]{2}$/.test(party.address.countryCode)) {
    throw domainError('WC_VALIDATION', { [field]: 'Falta el país' });
  }
}

function titleFor(invoiceType: string, labels: Labels): string {
  if (invoiceType.startsWith('R')) return labels.corrective;
  if (invoiceType === 'F2') return labels.simplified;
  return labels.invoice;
}

function columnsFor(variant: DocumentVariant, labels: Labels): TableColumn[] {
  const widths = COLUMN_WIDTHS[variant];
  const names = variant === 'po'
    ? [labels.columns.concept, labels.columns.price, labels.columns.units, labels.columns.discount, labels.columns.vat, labels.columns.total]
    : [labels.columns.concept, labels.columns.units, labels.columns.price, labels.columns.subtotal, labels.columns.vat, labels.columns.total];
  return names.map((header, index) => ({
    header,
    width: widths[index] ?? 60,
    align: index === 0 ? 'left' : 'right',
  }));
}

function rowFor(
  line: InvoiceLineView,
  variant: DocumentVariant,
  rates: ReadonlyMap<string, string>,
  labels: Labels,
  lang: InvoiceLang,
  currency: string,
): TableRow {
  const rate = rates.get(line.taxCode) ?? '0';
  const total = money.toString(
    money.add(money.fromString(line.lineBase), money.round2(money.mul(money.fromString(line.lineBase), new Decimal(rate).div(100)))),
  );
  const discount = isZeroAmount(line.discountPct) ? '' : formatPercent(line.discountPct, lang);
  const detail: string[] = [];
  if (line.sku) detail.push(`${labels.ref} ${line.sku}`);
  if (line.lotCode) detail.push(`${labels.lot}: ${line.lotCode}`);
  const quantity = formatNumber(line.quantity, lang, 3);
  const price = formatUnitPrice(line.unitPrice, lang, currency);
  const vat = formatPercent(rate, lang);
  if (variant === 'po') {
    return {
      concept: { title: line.description, detail },
      cells: [price, quantity, discount, vat, formatAmount(total, lang, currency)],
    };
  }
  if (discount !== '') detail.push(`${labels.discountShort} ${discount}`);
  return {
    concept: { title: line.description, detail },
    cells: [
      `${quantity} ${unitLabel(line.unit, lang)}`.trim(),
      price,
      formatAmount(line.lineBase, lang, currency),
      vat,
      formatAmount(total, lang, currency),
    ],
  };
}

function unitLabel(unit: string, lang: InvoiceLang): string {
  const value = unit.trim();
  if (value === 'ud' && lang === 'en') return 'pcs';
  return value;
}

function totalRows(
  invoice: IssuedInvoice,
  taxes: readonly InvoiceTaxView[],
  lines: readonly InvoiceLineView[],
  labels: Labels,
  lang: InvoiceLang,
  discounted: boolean,
): TotalRow[] {
  const currency = invoice.currency;
  const rows: TotalRow[] = [];
  if (discounted) {
    const discount = lines.reduce((sum, line) => {
      const gross = money.round2(money.mul(money.fromString(line.quantity), money.fromString(line.unitPrice)));
      return money.add(sum, money.sub(gross, money.fromString(line.lineBase)));
    }, money.fromString('0'));
    if (discount.gt(0)) rows.push({ label: labels.discount, value: formatAmount(money.toString(discount), lang, currency) });
  }
  rows.push({ label: labels.taxable, value: formatAmount(invoice.subtotal, lang, currency) });

  const byRate = (pick: (tax: InvoiceTaxView) => { rate: string; amount: string }): { rate: string; amount: string }[] => {
    const grouped = new Map<string, string>();
    for (const tax of taxes) {
      const { rate, amount } = pick(tax);
      const key = new Decimal(rate).toFixed();
      grouped.set(key, addAmounts([grouped.get(key) ?? '0', amount]));
    }
    return [...grouped.entries()]
      .sort((left, right) => new Decimal(left[0]).comparedTo(new Decimal(right[0])))
      .map(([rate, amount]) => ({ rate, amount }));
  };
  for (const { rate, amount } of byRate((tax) => ({ rate: tax.rate, amount: tax.quota }))) {
    rows.push({ label: `${labels.vat} ${formatPercent(rate, lang)}`, value: formatAmount(amount, lang, currency) });
  }
  if (!isZeroAmount(invoice.surchargeTotal)) {
    for (const { rate, amount } of byRate((tax) => ({ rate: tax.surchargeRate, amount: tax.surchargeQuota }))) {
      if (isZeroAmount(amount)) continue;
      rows.push({ label: `${labels.surcharge} ${formatPercent(rate, lang)}`, value: formatAmount(amount, lang, currency) });
    }
  }
  rows.push({ label: labels.total, value: formatAmount(invoice.importeTotal, lang, currency) });
  if (!isZeroAmount(invoice.withholdingTotal)) {
    for (const { rate, amount } of byRate((tax) => ({ rate: tax.withholdingRate, amount: tax.withholding }))) {
      if (isZeroAmount(amount)) continue;
      rows.push({
        label: `${labels.withholding} ${formatPercent(rate, lang)}`,
        value: formatAmount(subAmounts('0', amount), lang, currency),
      });
    }
    rows.push({ label: labels.amountDue, value: formatAmount(invoice.totalToPay, lang, currency) });
  }
  return rows;
}

function noteLines(invoice: IssuedInvoice, labels: Labels, lang: InvoiceLang): NoteLine[] {
  const currency = invoice.currency;
  const out: NoteLine[] = [];
  const group = (items: readonly NoteLine[]): void => {
    if (items.length === 0) return;
    if (out.length > 0) out.push('');
    out.push(...items);
  };

  const payment: string[] = [];
  const dues = [...invoice.dues].sort((left, right) => left.seq - right.seq);
  if (dues.length > 0) {
    const shown = dues.map((due) => `${formatDate(due.dueDate, lang)} ${formatAmount(due.amount, lang, currency)}`);
    payment.push(`${dues.length === 1 ? labels.dueOne : labels.dueMany}: ${shown.join(' · ')}`);
  }
  if (invoice.paymentMethod) payment.push(`${labels.payment}: ${paymentLabel(invoice.paymentMethod, lang)}`);
  group(payment);

  group(invoice.profile.footerLines.map((line) => line.trim()));

  const extra: string[] = [];
  if (invoice.incoterm) extra.push(`${labels.incoterm}: ${invoice.incoterm}`);
  if (invoice.description.trim() !== '' && invoice.description.trim() !== DEFAULT_DESCRIPTION) {
    extra.push(`${labels.operation}: ${invoice.description.trim()}`);
  }
  const notes = textLines(invoice.notes);
  notes.forEach((line, index) => extra.push(index === 0 ? `${labels.notes}: ${line}` : line));
  if (invoice.issuer.registryData) extra.push(`${labels.registry}: ${invoice.issuer.registryData}`);
  group(extra);

  const delivery = [...new Set(invoice.deliveryNoteNumbers.map((number) => number.trim()).filter((number) => number !== ''))].sort();
  if (delivery.length > 0) {
    group([{ label: delivery.length === 1 ? labels.deliveryNote : labels.deliveryNotes, text: delivery.join(', ') }]);
  }
  return out;
}

function textLines(value: string | null): string[] {
  if (!value) return [];
  return value.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '');
}

function mentionsFor(invoice: IssuedInvoice, taxes: readonly InvoiceTaxView[], lang: InvoiceLang): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  const push = (value: string | null | undefined): void => {
    const text = value?.trim() ?? '';
    if (text === '' || seen.has(text)) return;
    seen.add(text);
    mentions.push(text);
  };
  for (const tax of taxes) {
    push(lang === 'es' ? tax.legalMentionEs : tax.legalMentionEn);
    if ((lang === 'es' ? tax.legalMentionEs : tax.legalMentionEn)?.trim()) continue;
    if (tax.exemption) {
      push(lang === 'es' ? `Operación exenta de IVA (${tax.exemption}).` : `VAT exempt operation (${tax.exemption}).`);
    } else if (tax.qualification === 'N1' || tax.qualification === 'N2') {
      push(lang === 'es' ? 'Operación no sujeta al IVA.' : 'Operation not subject to VAT.');
    }
  }
  for (const extra of invoice.legalMentions) push(extra);
  return mentions;
}

function rectificationLine(rectification: IssuedInvoice['rectifications'][number], lang: InvoiceLang): string {
  const date = formatDate(rectification.rectifiedIssueDate, lang);
  if (lang === 'es') {
    const verb = rectification.relation === 'substituted' ? 'Sustituye' : 'Rectifica';
    return `${verb} la factura ${rectification.rectifiedNumber} del ${date}, NIF ${rectification.rectifiedIssuerTaxId}`;
  }
  const verb = rectification.relation === 'substituted' ? 'Replaces' : 'Corrects';
  return `${verb} invoice ${rectification.rectifiedNumber} of ${date}, NIF ${rectification.rectifiedIssuerTaxId}`;
}

function sortLines(lines: readonly InvoiceLineView[]): InvoiceLineView[] {
  return [...lines].sort((left, right) => left.lineNo - right.lineNo || cmp(left.description, right.description));
}

function sortTaxes(taxes: readonly InvoiceTaxView[]): InvoiceTaxView[] {
  return [...taxes].sort((left, right) => cmp(left.taxCode, right.taxCode));
}

function sortRectifications(rows: readonly IssuedInvoice['rectifications'][number][]): IssuedInvoice['rectifications'][number][] {
  return [...rows].sort((left, right) =>
    cmp(left.rectifiedIssueDate, right.rectifiedIssueDate) || cmp(left.rectifiedNumber, right.rectifiedNumber));
}

function cmp(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

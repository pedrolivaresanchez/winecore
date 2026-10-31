import { createHash } from 'node:crypto';
import {
  PDFDocument,
  PDFHexString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { canonicalJson } from '../../db/audit';
import { domainError } from '../../errors';
import {
  addAmounts,
  assertLang,
  countryName,
  formatDate,
  formatMoney,
  formatPlain,
  formatPrice,
  isZeroAmount,
  paymentLabel,
  sameAmount,
  subAmounts,
  taxIdLabel,
  utcMidnight,
} from './format';
import {
  QR_LABEL,
  QR_LEGEND,
  QR_TEXT_SIZE,
  qrSlot,
  type QrSlot,
} from './qr';
import type {
  InvoiceLang,
  InvoiceLineView,
  InvoiceTaxView,
  IssuedInvoice,
  VerifactuSlot,
} from './types';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_X = 40;
const BOTTOM = 48;
const BODY = 9;
const TITLE = 11;
const INK = rgb(0.12, 0.12, 0.12);
const DEFAULT_ACCENT: readonly [number, number, number] = [0.45, 0.12, 0.16];

const SIMPLIFIED = new Set(['F2', 'R5']);

/**
 * Immutable invoice PDF. Same invoice and language always produce the same bytes.
 * The QR and the Verifactu legends are drawn only when the installation is active.
 */
export async function renderInvoicePdf(
  invoice: IssuedInvoice,
  lang: InvoiceLang,
): Promise<Uint8Array> {
  assertLang(lang);
  const activeQr = requireQr(invoice.verifactu);
  assertInvoice(invoice, lang);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = invoice.branding.logo ? new Uint8Array(invoice.branding.logo) : null;
  const logo = logoBytes ? await embedLogo(pdf, logoBytes) : null;
  const accent = accentOf(invoice.branding.accentRgb);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const slot = qrSlot(PAGE_HEIGHT);
  const recorded: string[] = [];

  const state = { page, y: paintQr(page, slot, activeQr, bold, recorded) };
  const width = PAGE_WIDTH - CONTENT_X * 2;

  const draw = (value: string, font: PDFFont, size: number, gap = 3): void => {
    const text = clean(value);
    if (text === '') return;
    for (const line of wrap(font, text, size, width)) {
      if (state.y < BOTTOM + size) {
        state.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        state.y = PAGE_HEIGHT - CONTENT_X;
        const continued = lang === 'es'
          ? `Factura ${invoice.number} (continuación)`
          : `Invoice ${invoice.number} (continued)`;
        state.page.drawText(continued, { x: CONTENT_X, y: state.y, size: BODY, font: regular, color: INK });
        recorded.push(continued);
        state.y -= BODY + 6;
      }
      state.page.drawText(line, { x: CONTENT_X, y: state.y, size, font, color: INK });
      recorded.push(line);
      state.y -= size + gap;
    }
  };

  const gap = (points: number): void => {
    state.y -= points;
  };

  page.drawRectangle({
    x: CONTENT_X,
    y: state.y - 3,
    width: 72,
    height: 3,
    color: rgb(accent[0], accent[1], accent[2]),
    borderWidth: 0,
  });
  state.y -= 14;

  const brand = invoice.issuer.tradeName?.trim() || '';
  if (logo) {
    const height = 28;
    const ratio = logo.height === 0 ? 1 : logo.width / logo.height;
    const imageWidth = Math.min(160, height * ratio);
    state.page.drawImage(logo, {
      x: CONTENT_X,
      y: state.y - height,
      width: imageWidth,
      height,
    });
    state.y -= height + 8;
  } else if (brand !== '' && brand !== invoice.issuer.legalName) {
    draw(brand, bold, TITLE, 4);
  }

  draw(titleFor(invoice.invoiceType, lang), bold, TITLE, 4);
  draw(lang === 'es' ? `Serie: ${invoice.seriesCode}` : `Series: ${invoice.seriesCode}`, regular, BODY);
  draw(lang === 'es' ? `Número: ${invoice.number}` : `Number: ${invoice.number}`, regular, BODY);
  for (const rectification of sortRectifications(invoice.rectifications)) {
    draw(rectificationLine(rectification, lang), regular, BODY);
    draw(lang === 'es' ? `Motivo: ${rectification.reason}` : `Reason: ${rectification.reason}`, regular, BODY);
  }
  draw(
    lang === 'es'
      ? `Fecha de expedición: ${formatDate(invoice.issueDate, lang)}`
      : `Issue date: ${formatDate(invoice.issueDate, lang)}`,
    regular,
    BODY,
  );
  if (invoice.operationDate && invoice.operationDate !== invoice.issueDate) {
    draw(
      lang === 'es'
        ? `Fecha de operación: ${formatDate(invoice.operationDate, lang)}`
        : `Operation date: ${formatDate(invoice.operationDate, lang)}`,
      regular,
      BODY,
    );
  }
  gap(6);
  draw(lang === 'es' ? 'Emisor' : 'Issuer', bold, BODY, 2);
  drawPartyLines(draw, regular, invoice.issuer, lang, true);
  gap(6);
  draw(lang === 'es' ? 'Cliente' : 'Customer', bold, BODY, 2);
  drawPartyLines(draw, regular, invoice.customer, lang, !SIMPLIFIED.has(invoice.invoiceType));
  gap(6);
  draw(lang === 'es' ? 'Descripción de la operación' : 'Description of the operation', bold, BODY, 2);
  draw(invoice.description, regular, BODY);
  gap(6);
  draw(lineHeader(lang), bold, BODY, 2);
  for (const line of sortLines(invoice.lines)) draw(lineText(line, lang, invoice.currency), regular, BODY, 2);
  gap(6);

  const taxes = sortTaxes(invoice.taxes);
  const showSurcharge = taxes.some((tax) => !isZeroAmount(tax.surchargeQuota) || !isZeroAmount(tax.surchargeRate));
  const showWithholding = taxes.some((tax) => !isZeroAmount(tax.withholding) || !isZeroAmount(tax.withholdingRate));
  draw(taxHeader(lang, showSurcharge, showWithholding), bold, BODY, 2);
  for (const tax of taxes) draw(taxText(tax, lang, invoice.currency, showSurcharge, showWithholding), regular, BODY, 2);

  const mentions = mentionsFor(invoice, taxes, lang);
  if (mentions.length > 0) {
    gap(4);
    for (const mention of mentions) draw(mention, regular, BODY, 2);
  }
  gap(6);
  draw(
    lang === 'es'
      ? `Base imponible: ${formatMoney(invoice.subtotal, lang, invoice.currency)}`
      : `Taxable amount: ${formatMoney(invoice.subtotal, lang, invoice.currency)}`,
    regular,
    BODY,
  );
  draw(
    lang === 'es'
      ? `IVA: ${formatMoney(invoice.taxTotal, lang, invoice.currency)}`
      : `VAT: ${formatMoney(invoice.taxTotal, lang, invoice.currency)}`,
    regular,
    BODY,
  );
  if (!isZeroAmount(invoice.surchargeTotal)) {
    draw(
      lang === 'es'
        ? `Recargo de equivalencia: ${formatMoney(invoice.surchargeTotal, lang, invoice.currency)}`
        : `Equivalence surcharge: ${formatMoney(invoice.surchargeTotal, lang, invoice.currency)}`,
      regular,
      BODY,
    );
  }
  if (!isZeroAmount(invoice.withholdingTotal)) {
    draw(
      lang === 'es'
        ? `Retención IRPF: ${formatMoney(invoice.withholdingTotal, lang, invoice.currency)}`
        : `Income tax withholding: ${formatMoney(invoice.withholdingTotal, lang, invoice.currency)}`,
      regular,
      BODY,
    );
  }
  draw(
    lang === 'es'
      ? `Importe total de la factura: ${formatMoney(invoice.importeTotal, lang, invoice.currency)}`
      : `Invoice total amount: ${formatMoney(invoice.importeTotal, lang, invoice.currency)}`,
    bold,
    TITLE,
    4,
  );
  if (!isZeroAmount(invoice.withholdingTotal)) {
    draw(
      lang === 'es'
        ? `Total a pagar: ${formatMoney(invoice.totalToPay, lang, invoice.currency)}`
        : `Amount due: ${formatMoney(invoice.totalToPay, lang, invoice.currency)}`,
      bold,
      TITLE,
      4,
    );
  }
  gap(4);
  for (const due of [...invoice.dues].sort((left, right) => left.seq - right.seq)) {
    draw(
      lang === 'es'
        ? `Vencimiento: ${formatDate(due.dueDate, lang)} ${formatMoney(due.amount, lang, invoice.currency)}`
        : `Due date: ${formatDate(due.dueDate, lang)} ${formatMoney(due.amount, lang, invoice.currency)}`,
      regular,
      BODY,
    );
  }
  if (invoice.paymentMethod) {
    draw(
      lang === 'es'
        ? `Forma de pago: ${paymentLabel(invoice.paymentMethod, lang)}`
        : `Payment method: ${paymentLabel(invoice.paymentMethod, lang)}`,
      regular,
      BODY,
    );
  }
  if (invoice.incoterm) draw(`Incoterm: ${invoice.incoterm}`, regular, BODY);
  if (invoice.notes) draw(lang === 'es' ? `Notas: ${invoice.notes}` : `Notes: ${invoice.notes}`, regular, BODY);

  const issuedAt = utcMidnight(invoice.issueDate);
  pdf.setTitle(lang === 'es' ? `Factura ${invoice.number}` : `Invoice ${invoice.number}`);
  pdf.setAuthor(invoice.issuer.legalName);
  pdf.setSubject(invoice.number);
  pdf.setCreator('WineCore');
  pdf.setProducer('WineCore');
  pdf.setLanguage(lang === 'es' ? 'es-ES' : 'en-GB');
  pdf.setCreationDate(issuedAt);
  pdf.setModificationDate(issuedAt);

  const material = canonicalJson({
    lang,
    lines: recorded,
    logo: logoBytes ? sha256(logoBytes) : null,
    accent: [accent[0], accent[1], accent[2]],
    qr: activeQr ? { url: activeQr.url, modules: moduleKey(activeQr.modules) } : null,
  });
  const id = sha256(new TextEncoder().encode(material));
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
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

function paintQr(
  page: PDFPage,
  slot: QrSlot,
  active: { url: string; modules: readonly (readonly boolean[])[] } | null,
  font: PDFFont,
  recorded: string[],
): number {
  page.drawRectangle({
    x: slot.x,
    y: slot.y,
    width: slot.size,
    height: slot.size,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
  if (!active) return slot.contentTop;
  const n = active.modules.length;
  const cell = slot.size / n;
  for (let row = 0; row < n; row += 1) {
    const moduleRow = active.modules[row];
    if (!moduleRow) continue;
    for (let col = 0; col < n; col += 1) {
      if (!moduleRow[col]) continue;
      page.drawRectangle({
        x: slot.x + col * cell,
        y: slot.y + (n - 1 - row) * cell,
        width: cell,
        height: cell,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      });
    }
  }
  page.drawText(QR_LABEL, { x: slot.x, y: slot.labelBaseline, size: QR_TEXT_SIZE, font, color: INK });
  recorded.push(QR_LABEL);
  let legendY = slot.legendBaseline;
  for (const line of wrap(font, QR_LEGEND, QR_TEXT_SIZE, PAGE_WIDTH - slot.x * 2)) {
    page.drawText(line, { x: slot.x, y: legendY, size: QR_TEXT_SIZE, font, color: INK });
    recorded.push(line);
    legendY -= QR_TEXT_SIZE + 2;
  }
  return Math.min(slot.contentTop, legendY - 4);
}

function assertInvoice(invoice: IssuedInvoice, lang: InvoiceLang): void {
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
  // Touch lang so a caller cannot skip the labels that carry the amounts.
  formatMoney(invoice.importeTotal, lang, invoice.currency);
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

function titleFor(invoiceType: string, lang: InvoiceLang): string {
  if (invoiceType.startsWith('R')) return lang === 'es' ? 'FACTURA RECTIFICATIVA' : 'CORRECTIVE INVOICE';
  if (invoiceType === 'F2') return lang === 'es' ? 'FACTURA SIMPLIFICADA' : 'SIMPLIFIED INVOICE';
  return lang === 'es' ? 'FACTURA' : 'INVOICE';
}

function lineHeader(lang: InvoiceLang): string {
  return lang === 'es'
    ? 'Descripción | Cantidad | Unidad | Precio | Descuento | Impuesto | Base'
    : 'Description | Quantity | Unit | Price | Discount | Tax | Base';
}

function lineText(line: InvoiceLineView, lang: InvoiceLang, currency: string): string {
  const lot = line.lotCode ? (lang === 'es' ? `Lote ${line.lotCode}` : `Lot ${line.lotCode}`) : null;
  const description = [line.sku, line.description, lot].filter((part) => part && part.trim() !== '').join(' | ');
  return [
    description,
    formatPlain(line.quantity, lang),
    line.unit,
    formatPrice(line.unitPrice, lang, currency),
    `${formatPlain(line.discountPct, lang)} %`,
    line.taxCode,
    formatMoney(line.lineBase, lang, currency),
  ].join(' | ');
}

function taxHeader(lang: InvoiceLang, surcharge: boolean, withholding: boolean): string {
  const base = lang === 'es'
    ? ['Impuesto', 'Base', 'Tipo', 'Cuota']
    : ['Tax', 'Base', 'Rate', 'VAT'];
  if (surcharge) base.push(lang === 'es' ? 'Recargo' : 'Surcharge', lang === 'es' ? 'Cuota recargo' : 'Surcharge quota');
  if (withholding) base.push(lang === 'es' ? 'Retención' : 'Withholding', lang === 'es' ? 'Cuota retención' : 'Withholding quota');
  return base.join(' | ');
}

function taxText(
  tax: InvoiceTaxView,
  lang: InvoiceLang,
  currency: string,
  surcharge: boolean,
  withholding: boolean,
): string {
  const cells = [
    tax.taxCode,
    formatMoney(tax.base, lang, currency),
    `${formatPlain(tax.rate, lang)} %`,
    formatMoney(tax.quota, lang, currency),
  ];
  if (surcharge) {
    cells.push(`${formatPlain(tax.surchargeRate, lang)} %`, formatMoney(tax.surchargeQuota, lang, currency));
  }
  if (withholding) {
    cells.push(`${formatPlain(tax.withholdingRate, lang)} %`, formatMoney(tax.withholding, lang, currency));
  }
  return cells.join(' | ');
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

function drawPartyLines(
  draw: (value: string, font: PDFFont, size: number, gap?: number) => void,
  regular: PDFFont,
  party: IssuedInvoice['issuer'],
  lang: InvoiceLang,
  requireTaxId: boolean,
): void {
  draw(party.legalName, regular, BODY, 2);
  if (requireTaxId || party.taxId.trim() !== '') {
    draw(`${taxIdLabel(party.taxIdType, lang)} ${party.taxId}`, regular, BODY, 2);
  }
  draw(party.address.line1, regular, BODY, 2);
  if (party.address.line2) draw(party.address.line2, regular, BODY, 2);
  draw(`${party.address.postalCode} ${party.address.city}`, regular, BODY, 2);
  if (party.address.province) draw(party.address.province, regular, BODY, 2);
  draw(countryName(party.address.countryCode, lang), regular, BODY, 2);
  if (party.registryData) {
    draw(lang === 'es' ? `Datos registrales: ${party.registryData}` : `Registry: ${party.registryData}`, regular, BODY, 2);
  }
}

async function embedLogo(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  try {
    return await pdf.embedPng(bytes);
  } catch {
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      throw domainError('WC_VALIDATION', { logo: 'El logotipo debe ser PNG o JPEG' });
    }
  }
}

function accentOf(value: readonly [number, number, number] | null): readonly [number, number, number] {
  if (!value) return DEFAULT_ACCENT;
  for (const component of value) {
    if (!Number.isFinite(component) || component < 0 || component > 1) {
      throw domainError('WC_VALIDATION', { branding: 'El color de la entidad no es válido' });
    }
  }
  return value;
}

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim();
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (word === '') continue;
    const next = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [text] : lines;
}

function moduleKey(modules: readonly (readonly boolean[])[]): string {
  return modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

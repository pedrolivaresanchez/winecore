import Decimal from 'decimal.js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { HoldedDocumentLoaded, HoldedInvoiceLoaded, LegacyLine } from './detail';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_W - MARGIN;
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.38, 0.36, 0.34);
const RULE = rgb(0.78, 0.75, 0.72);
const BAND = rgb(0.95, 0.93, 0.9);
const ACCENT = rgb(0.45, 0.12, 0.16);
const INVOICE_NOTE = 'Copia generada desde el histórico de Holded. No es un registro Verifactu.';
const DOCUMENT_NOTE = 'Copia generada desde el histórico de Holded.';

const COL = {
  units: 360,
  price: 432,
  base: 498,
  tax: RIGHT,
};

export type HoldedPdfTitle = 'Factura' | 'Factura rectificativa' | 'Presupuesto' | 'Albarán';

export interface HoldedPdfInput {
  title: HoldedPdfTitle;
  number: string;
  issueDate: string;
  /** Sin etiqueta, la cabecera no lleva segunda fecha (el albarán no vence). */
  dueLabel: 'Vencimiento' | 'Válido hasta' | null;
  dueDate: string | null;
  status: string;
  partyLabel: 'Cliente' | 'Proveedor' | 'Destino';
  seller: HoldedInvoiceLoaded['seller'];
  customerName: string;
  description: string | null;
  lines: LegacyLine[];
  subtotal: string;
  vat: string;
  withholding: string | null;
  total: string;
  /** Solo las facturas llevan cobrado y pendiente. */
  settlement: { paid: string | null; pending: string | null } | null;
  note: string;
}

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  pages: PDFPage[];
  y: number;
  bottom: number;
  regular: PDFFont;
  bold: PDFFont;
  title: string;
  number: string;
  footer: string[];
}

/** Copia A4, en español, de un documento histórico. No emite ni altera Verifactu. */
export async function renderHoldedPdf(input: HoldedPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const footer = footerLines(input, regular);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    pdf,
    page,
    pages: [page],
    y: PAGE_H - MARGIN - 16,
    bottom: 28 + footer.length * 11 + 10,
    regular,
    bold,
    title: input.title,
    number: input.number,
    footer,
  };
  paintHeader(ctx, input);
  paintParties(ctx, input);
  paintTable(ctx, input.lines);
  paintTotals(ctx, input);
  for (const page of ctx.pages) paintFooter(page, ctx);
  const issued = utcMidnight(input.issueDate);
  pdf.setTitle(`${input.title} ${input.number}`.slice(0, 120));
  pdf.setCreator('WineCore');
  pdf.setProducer('WineCore');
  pdf.setLanguage('es-ES');
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export function holdedPdfInput(loaded: HoldedInvoiceLoaded): HoldedPdfInput {
  const detail = loaded.detail;
  return {
    title: holdedInvoiceTitle(detail.number, detail.total),
    number: detail.number,
    issueDate: detail.issue_date,
    dueLabel: 'Vencimiento',
    dueDate: detail.due_date,
    status: detail.status_holded,
    partyLabel: detail.kind === 'purchase' ? 'Proveedor' : 'Cliente',
    seller: loaded.seller,
    customerName: detail.counterparty_name,
    description: detail.description,
    lines: detail.lines,
    subtotal: detail.subtotal,
    vat: detail.vat,
    withholding: detail.withholding,
    total: detail.total,
    settlement: { paid: detail.paid, pending: detail.pending },
    note: INVOICE_NOTE,
  };
}

export function holdedDocumentPdfInput(loaded: HoldedDocumentLoaded): HoldedPdfInput {
  const detail = loaded.detail;
  const quote = detail.kind === 'quote';
  return {
    title: quote ? 'Presupuesto' : 'Albarán',
    number: detail.number,
    issueDate: detail.issue_date,
    dueLabel: quote ? 'Válido hasta' : null,
    dueDate: detail.due_date,
    status: detail.status_holded,
    partyLabel: quote ? 'Cliente' : 'Destino',
    seller: loaded.seller,
    customerName: detail.counterparty_name,
    description: detail.description,
    lines: detail.lines,
    subtotal: detail.subtotal,
    vat: detail.vat,
    withholding: detail.withholding,
    total: detail.total,
    settlement: null,
    note: DOCUMENT_NOTE,
  };
}

export function holdedInvoiceTitle(number: string, total: string): 'Factura' | 'Factura rectificativa' {
  if (/^CN/i.test(number.trim())) return 'Factura rectificativa';
  try {
    if (new Decimal(total).isNeg()) return 'Factura rectificativa';
  } catch {
    // Un total ilegible no convierte el documento en rectificativa.
  }
  return 'Factura';
}

export function holdedPdfFilename(number: string, prefix: 'factura' | 'presupuesto' | 'albaran' = 'factura'): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 80);
  return `${prefix}-${safe === '' ? 'sin-numero' : safe}.pdf`;
}

function paintHeader(ctx: Ctx, input: HoldedPdfInput): void {
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y + 14,
    width: 72,
    height: 3,
    color: ACCENT,
    borderWidth: 0,
  });
  const title = encode(ctx.bold, input.title);
  ctx.page.drawText(title, { x: MARGIN, y: ctx.y, size: 18, font: ctx.bold, color: INK });
  const meta = [
    `Número ${blank(input.number)}`,
    `Fecha ${spanishDate(input.issueDate)}`,
    ...(input.dueLabel ? [`${input.dueLabel} ${spanishDate(input.dueDate)}`] : []),
    `Estado ${blank(input.status)}`,
  ];
  let metaY = ctx.y + 4;
  for (const line of meta) {
    const shown = encode(ctx.regular, line);
    ctx.page.drawText(shown, { x: 360, y: metaY, size: 9, font: ctx.regular, color: INK });
    metaY -= 13;
  }
  ctx.y = Math.min(ctx.y - 28, metaY - 8);
}

function paintParties(ctx: Ctx, input: HoldedPdfInput): void {
  const seller = input.seller;
  const place = [seller.postalCode, seller.city].filter((part) => part.trim() !== '').join(' ');
  const locality = [place, seller.province.trim() !== '' ? `(${seller.province.trim()})` : ''].filter((part) => part !== '').join(' ');
  drawBlock(ctx, 'Emisor', [
    seller.legalName,
    seller.taxId.trim() === '' ? '' : `NIF ${seller.taxId.trim()}`,
    seller.addressLine,
    locality,
  ]);
  drawBlock(ctx, input.partyLabel, [input.customerName], true);
  if (input.description) drawBlock(ctx, 'Descripción', [input.description]);
}

function paintTable(ctx: Ctx, lines: LegacyLine[]): void {
  ctx.y -= 8;
  drawTableHeader(ctx);
  if (lines.length === 0) {
    drawRow(ctx, ['Sin líneas en el histórico.'], '—', '—', '—', '—');
  }
  for (const line of lines) {
    const description = line.description ?? line.sku ?? '—';
    const wrapped = wrap(ctx.regular, description, 8, COL.units - MARGIN - 72);
    drawRow(
      ctx,
      wrapped.length > 0 ? wrapped : ['—'],
      line.quantity ?? '—',
      line.unit_price == null ? '—' : euros(line.unit_price),
      line.line_base == null ? '—' : euros(line.line_base),
      line.tax_code ?? '—',
    );
  }
  ctx.y -= 6;
}

function paintTotals(ctx: Ctx, input: HoldedPdfInput): void {
  ensure(ctx, 96);
  ctx.page.drawLine({
    start: { x: RIGHT - 220, y: ctx.y + 12 },
    end: { x: RIGHT, y: ctx.y + 12 },
    thickness: 0.6,
    color: RULE,
  });
  pair(ctx, 'Base imponible', euros(input.subtotal), false);
  pair(ctx, 'IVA', euros(input.vat), false);
  if (nonZero(input.withholding)) pair(ctx, 'Retención', euros(input.withholding), false);
  pair(ctx, 'Total', euros(input.total), true);
  if (!input.settlement) return;
  pair(ctx, 'Pagado', input.settlement.paid == null ? '—' : euros(input.settlement.paid), false);
  pair(ctx, 'Pendiente', input.settlement.pending == null ? '—' : euros(input.settlement.pending), false);
}

function drawBlock(ctx: Ctx, label: string, lines: string[], always = false): void {
  const body = lines.flatMap((line) => wrap(ctx.regular, line, 9, RIGHT - MARGIN)).filter((line) => line !== '');
  if (body.length === 0 && !always) return;
  ensure(ctx, 14 + body.length * 12);
  const heading = encode(ctx.bold, label);
  ctx.page.drawText(heading, { x: MARGIN, y: ctx.y, size: 9, font: ctx.bold, color: INK });
  ctx.y -= 13;
  for (const line of body) {
    ensure(ctx, 12);
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 9, font: ctx.regular, color: INK });
    ctx.y -= 12;
  }
  ctx.y -= 6;
}

function drawTableHeader(ctx: Ctx): void {
  ensure(ctx, 22);
  const top = ctx.y + 12;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 6,
    width: RIGHT - MARGIN,
    height: 18,
    color: BAND,
    borderWidth: 0,
  });
  const size = 8;
  ctx.page.drawText(encode(ctx.bold, 'Descripción'), { x: MARGIN + 4, y: ctx.y, size, font: ctx.bold, color: INK });
  drawRight(ctx, ctx.bold, 'Unidades', COL.units, ctx.y, size);
  drawRight(ctx, ctx.bold, 'Precio', COL.price, ctx.y, size);
  drawRight(ctx, ctx.bold, 'Base', COL.base, ctx.y, size);
  drawRight(ctx, ctx.bold, 'Impuesto', COL.tax, ctx.y, size);
  ctx.y = top - 24;
}

function drawRow(ctx: Ctx, description: string[], units: string, price: string, base: string, tax: string): void {
  const size = 8;
  const leading = 11;
  let index = 0;
  let first = true;
  while (index < description.length) {
    const room = ctx.y - ctx.bottom;
    const fit = Math.max(1, Math.floor(room / leading));
    const slice = description.slice(index, index + fit);
    const height = slice.length * leading + 4;
    if (ctx.y - height < ctx.bottom) {
      freshPage(ctx, true);
      drawTableHeader(ctx);
      continue;
    }
    const baseline = ctx.y;
    for (let line = 0; line < slice.length; line += 1) {
      const shown = encode(ctx.regular, slice[line] ?? '');
      ctx.page.drawText(shown, {
        x: MARGIN + 4,
        y: baseline - line * leading,
        size,
        font: ctx.regular,
        color: INK,
      });
    }
    if (first) {
      drawRight(ctx, ctx.regular, units, COL.units, baseline, size);
      drawRight(ctx, ctx.regular, price, COL.price, baseline, size);
      drawRight(ctx, ctx.regular, base, COL.base, baseline, size);
      drawRight(ctx, ctx.regular, tax, COL.tax, baseline, size);
      first = false;
    }
    ctx.y = baseline - slice.length * leading - 3;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 2 },
      end: { x: RIGHT, y: ctx.y + 2 },
      thickness: 0.3,
      color: RULE,
    });
    index += slice.length;
  }
}

function pair(ctx: Ctx, label: string, value: string, strong: boolean): void {
  const font = strong ? ctx.bold : ctx.regular;
  const size = strong ? 11 : 9;
  ensure(ctx, size + 6);
  ctx.page.drawText(encode(font, label), { x: RIGHT - 220, y: ctx.y, size, font, color: INK });
  drawRight(ctx, font, value, RIGHT, ctx.y, size);
  ctx.y -= size + 5;
}

function paintFooter(page: PDFPage, ctx: Ctx): void {
  let y = 22 + (ctx.footer.length - 1) * 11;
  page.drawLine({
    start: { x: MARGIN, y: y + 14 },
    end: { x: RIGHT, y: y + 14 },
    thickness: 0.4,
    color: RULE,
  });
  for (const line of ctx.footer) {
    page.drawText(line, { x: MARGIN, y, size: 8, font: ctx.regular, color: MUTED });
    y -= 11;
  }
}

function footerLines(input: HoldedPdfInput, font: PDFFont): string[] {
  const seller = input.seller;
  const place = [seller.postalCode, seller.city].filter((part) => part.trim() !== '').join(' ');
  const locality = [place, seller.province.trim()].filter((part) => part !== '').join(' ');
  const address = [seller.addressLine.trim(), locality].filter((part) => part !== '').join(' · ');
  const lines = address === '' ? [] : wrap(font, address, 8, RIGHT - MARGIN);
  lines.push(...wrap(font, input.note, 8, RIGHT - MARGIN));
  return lines;
}

function freshPage(ctx: Ctx, continued: boolean): void {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(ctx.page);
  ctx.y = PAGE_H - MARGIN - 16;
  if (!continued) return;
  const note = encode(ctx.regular, `${ctx.title} ${ctx.number} (continuación)`);
  ctx.page.drawText(note, { x: MARGIN, y: ctx.y, size: 9, font: ctx.regular, color: MUTED });
  ctx.y -= 18;
}

function ensure(ctx: Ctx, height: number): void {
  if (ctx.y - height >= ctx.bottom) return;
  freshPage(ctx, true);
}

function drawRight(ctx: Ctx, font: PDFFont, value: string, right: number, y: number, size: number): void {
  const shown = encode(font, value);
  const width = font.widthOfTextAtSize(shown, size);
  ctx.page.drawText(shown, { x: right - width, y, size, font, color: INK });
}

function wrap(font: PDFFont, value: string, size: number, width: number): string[] {
  const text = encode(font, value).replace(/\s+/gu, ' ').trim();
  if (text === '') return [];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current === '') {
      current = breakWord(font, word, size, width, lines);
      continue;
    }
    const next = `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    lines.push(current);
    current = breakWord(font, word, size, width, lines);
  }
  if (current !== '') lines.push(current);
  return lines;
}

function breakWord(font: PDFFont, word: string, size: number, width: number, lines: string[]): string {
  if (font.widthOfTextAtSize(word, size) <= width) return word;
  let chunk = '';
  for (const char of word) {
    const next = chunk + char;
    if (chunk !== '' && font.widthOfTextAtSize(next, size) > width) {
      lines.push(chunk);
      chunk = char;
    } else {
      chunk = next;
    }
  }
  return chunk;
}

function encode(font: PDFFont, value: string): string {
  let out = '';
  for (const char of value) {
    if (char === '\n' || char === '\r' || char === '\t') {
      out += ' ';
      continue;
    }
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += '?';
    }
  }
  return out;
}

function euros(value: string | null): string {
  if (value == null || value.trim() === '') return '—';
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return '—';
    const sign = decimal.isNeg() ? '-' : '';
    const [whole, frac] = decimal.abs().toFixed(2).split('.');
    const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
    return `${sign}${grouped},${frac ?? '00'} EUR`;
  } catch {
    return '—';
  }
}

function nonZero(value: string | null): value is string {
  if (value == null || value.trim() === '') return false;
  try {
    return !new Decimal(value).isZero();
  } catch {
    return false;
  }
}

function spanishDate(value: string | null): string {
  if (value == null || value.trim() === '') return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function blank(value: string): string {
  const text = value.trim();
  return text === '' ? '—' : text;
}

function utcMidnight(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso);
  if (!match) return new Date(Date.UTC(2020, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

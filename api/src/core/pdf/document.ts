import Decimal from 'decimal.js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_W - MARGIN;
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.38, 0.36, 0.34);
const RULE = rgb(0.78, 0.75, 0.72);
const BAND = rgb(0.95, 0.93, 0.9);
const ACCENT = rgb(0.45, 0.12, 0.16);

const COL = {
  units: 360,
  price: 432,
  base: 498,
  tax: RIGHT,
};

export type DocumentPdfLang = 'es' | 'en';

const LABELS = {
  es: {
    number: 'Número',
    date: 'Fecha',
    status: 'Estado',
    seller: 'Emisor',
    taxId: 'NIF',
    description: 'Descripción',
    units: 'Unidades',
    price: 'Precio',
    base: 'Base',
    tax: 'Impuesto',
    noLines: 'Sin líneas.',
    subtotal: 'Base imponible',
    vat: 'IVA',
    withholding: 'Retención',
    total: 'Total',
    paid: 'Pagado',
    pending: 'Pendiente',
    continued: 'continuación',
  },
  en: {
    number: 'Number',
    date: 'Date',
    status: 'Status',
    seller: 'From',
    taxId: 'Tax ID',
    description: 'Description',
    units: 'Units',
    price: 'Price',
    base: 'Net',
    tax: 'Tax',
    noLines: 'No lines.',
    subtotal: 'Subtotal',
    vat: 'VAT',
    withholding: 'Withholding',
    total: 'Total',
    paid: 'Paid',
    pending: 'Pending',
    continued: 'continued',
  },
} as const;

type Labels = (typeof LABELS)[DocumentPdfLang];

export interface DocumentPdfSeller {
  legalName: string;
  taxId: string;
  addressLine: string;
  postalCode: string;
  city: string;
  province: string;
}

export interface DocumentPdfLine {
  description: string | null;
  sku?: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_base: string | null;
  tax_code: string | null;
}

export interface DocumentPdfInput {
  lang?: DocumentPdfLang;
  title: string;
  number: string;
  issueDate: string | null;
  /** Sin etiqueta, la cabecera no lleva segunda fecha (el albarán no vence). */
  dueLabel: string | null;
  dueDate: string | null;
  status: string;
  /** Líneas de cabecera después del estado, ya traducidas (incoterm, origen, destino). */
  meta?: string[];
  partyLabel: string;
  seller: DocumentPdfSeller;
  customerName: string;
  description: string | null;
  lines: DocumentPdfLine[];
  /** Sin precios, la tabla solo lleva descripción y unidades. */
  priced?: boolean;
  /** Sin totales, el documento no lleva bloque de importes (albarán sin valorar). */
  totals: { subtotal: string; vat: string; withholding: string | null; total: string } | null;
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
  lang: DocumentPdfLang;
  labels: Labels;
  priced: boolean;
  footer: string[];
}

/** Documento A4 con cabecera, partes, tabla de líneas y totales. No emite ni altera Verifactu. */
export async function renderDocumentPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  const lang = input.lang ?? 'es';
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
    lang,
    labels: LABELS[lang],
    priced: input.priced ?? true,
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
  pdf.setLanguage(lang === 'en' ? 'en-GB' : 'es-ES');
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

function paintHeader(ctx: Ctx, input: DocumentPdfInput): void {
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y + 22,
    width: 72,
    height: 3,
    color: ACCENT,
    borderWidth: 0,
  });
  const title = encode(ctx.bold, input.title);
  ctx.page.drawText(title, { x: MARGIN, y: ctx.y, size: 18, font: ctx.bold, color: INK });
  const meta = [
    `${ctx.labels.number} ${blank(input.number)}`,
    `${ctx.labels.date} ${civilDate(input.issueDate, ctx.lang)}`,
    ...(input.dueLabel ? [`${input.dueLabel} ${civilDate(input.dueDate, ctx.lang)}`] : []),
    `${ctx.labels.status} ${blank(input.status)}`,
    ...(input.meta ?? []).filter((line) => line.trim() !== ''),
  ];
  let metaY = ctx.y + 4;
  for (const line of meta) {
    const shown = encode(ctx.regular, line);
    ctx.page.drawText(shown, { x: 360, y: metaY, size: 9, font: ctx.regular, color: INK });
    metaY -= 13;
  }
  ctx.y = Math.min(ctx.y - 28, metaY - 8);
}

function paintParties(ctx: Ctx, input: DocumentPdfInput): void {
  const seller = input.seller;
  const place = [seller.postalCode, seller.city].filter((part) => part.trim() !== '').join(' ');
  const locality = [place, seller.province.trim() !== '' ? `(${seller.province.trim()})` : ''].filter((part) => part !== '').join(' ');
  drawBlock(ctx, ctx.labels.seller, [
    seller.legalName,
    seller.taxId.trim() === '' ? '' : `${ctx.labels.taxId} ${seller.taxId.trim()}`,
    seller.addressLine,
    locality,
  ]);
  drawBlock(ctx, input.partyLabel, [input.customerName], true);
  if (input.description) drawBlock(ctx, ctx.labels.description, [input.description]);
}

function paintTable(ctx: Ctx, lines: DocumentPdfLine[]): void {
  ctx.y -= 8;
  drawTableHeader(ctx);
  if (lines.length === 0) {
    drawRow(ctx, [ctx.labels.noLines], '—', '—', '—', '—');
  }
  const width = (ctx.priced ? COL.units : COL.tax) - MARGIN - 72;
  for (const line of lines) {
    const description = line.description ?? line.sku ?? '—';
    const wrapped = wrap(ctx.regular, description, 8, width);
    drawRow(
      ctx,
      wrapped.length > 0 ? wrapped : ['—'],
      line.quantity == null ? '—' : plain(line.quantity, ctx.lang),
      line.unit_price == null ? '—' : money(line.unit_price, ctx.lang),
      line.line_base == null ? '—' : money(line.line_base, ctx.lang),
      line.tax_code ?? '—',
    );
  }
  ctx.y -= 6;
}

function paintTotals(ctx: Ctx, input: DocumentPdfInput): void {
  const totals = input.totals;
  if (!totals) return;
  ensure(ctx, 96);
  ctx.page.drawLine({
    start: { x: RIGHT - 220, y: ctx.y + 12 },
    end: { x: RIGHT, y: ctx.y + 12 },
    thickness: 0.6,
    color: RULE,
  });
  pair(ctx, ctx.labels.subtotal, money(totals.subtotal, ctx.lang), false);
  pair(ctx, ctx.labels.vat, money(totals.vat, ctx.lang), false);
  if (nonZero(totals.withholding)) pair(ctx, ctx.labels.withholding, money(totals.withholding, ctx.lang), false);
  pair(ctx, ctx.labels.total, money(totals.total, ctx.lang), true);
  if (!input.settlement) return;
  pair(ctx, ctx.labels.paid, input.settlement.paid == null ? '—' : money(input.settlement.paid, ctx.lang), false);
  pair(ctx, ctx.labels.pending, input.settlement.pending == null ? '—' : money(input.settlement.pending, ctx.lang), false);
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
  ctx.page.drawText(encode(ctx.bold, ctx.labels.description), { x: MARGIN + 4, y: ctx.y, size, font: ctx.bold, color: INK });
  if (ctx.priced) {
    drawRight(ctx, ctx.bold, ctx.labels.units, COL.units, ctx.y, size);
    drawRight(ctx, ctx.bold, ctx.labels.price, COL.price, ctx.y, size);
    drawRight(ctx, ctx.bold, ctx.labels.base, COL.base, ctx.y, size);
    drawRight(ctx, ctx.bold, ctx.labels.tax, COL.tax, ctx.y, size);
  } else {
    drawRight(ctx, ctx.bold, ctx.labels.units, COL.tax, ctx.y, size);
  }
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
      if (ctx.priced) {
        drawRight(ctx, ctx.regular, units, COL.units, baseline, size);
        drawRight(ctx, ctx.regular, price, COL.price, baseline, size);
        drawRight(ctx, ctx.regular, base, COL.base, baseline, size);
        drawRight(ctx, ctx.regular, tax, COL.tax, baseline, size);
      } else {
        drawRight(ctx, ctx.regular, units, COL.tax, baseline, size);
      }
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

function footerLines(input: DocumentPdfInput, font: PDFFont): string[] {
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
  const note = encode(ctx.regular, `${ctx.title} ${ctx.number} (${ctx.labels.continued})`);
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

function grouped(whole: string, lang: DocumentPdfLang): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, lang === 'en' ? ',' : '.');
}

function money(value: string | null, lang: DocumentPdfLang): string {
  if (value == null || value.trim() === '') return '—';
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return '—';
    const sign = decimal.isNeg() ? '-' : '';
    const [whole, frac] = decimal.abs().toFixed(2).split('.');
    return `${sign}${grouped(whole ?? '0', lang)}${lang === 'en' ? '.' : ','}${frac ?? '00'} EUR`;
  } catch {
    return '—';
  }
}

/** Cantidades sin ceros de relleno: 12.000 se ve como 12. */
function plain(value: string, lang: DocumentPdfLang): string {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return value;
    const sign = decimal.isNeg() ? '-' : '';
    const [whole, frac] = decimal.abs().toFixed().split('.');
    const shown = grouped(whole ?? '0', lang);
    return frac ? `${sign}${shown}${lang === 'en' ? '.' : ','}${frac}` : `${sign}${shown}`;
  } catch {
    return value;
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

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function civilDate(value: string | null, lang: DocumentPdfLang): string {
  if (value == null || value.trim() === '') return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return value;
  if (lang === 'en') return `${Number(match[3])} ${MONTHS_EN[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function blank(value: string): string {
  const text = value.trim();
  return text === '' ? '—' : text;
}

function utcMidnight(iso: string | null): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso ?? '');
  if (!match) return new Date(Date.UTC(2020, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

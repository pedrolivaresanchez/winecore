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
import { Decimal } from 'decimal.js';
import { canonicalJson } from '../db/audit';
import { domainError } from '../errors';

/**
 * Maqueta A4 compartida por todos los PDF de WineCore (facturas, presupuestos,
 * proformas, albaranes y copias del histórico). Las medidas salen de las dos
 * plantillas reales de Holded (PO y CVPO) con el origen arriba a la izquierda,
 * como las leyó PyMuPDF, y se convierten a coordenadas PDF al dibujar.
 */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN_X = 42.52;

const TABLE_LEFT = 42.66;
const TABLE_RIGHT = 552.62;
const LOGO_X = 45.02;
const LOGO_TOP = 30.85;
const LOGO_HEIGHT = 37.5;
const LOGO_MAX_WIDTH = 170;
const TITLE_RIGHT = 550.26;
const TITLE_BASELINE = 42.2;
const DATE_BASELINE = 54.71;
const HEADER_STEP = 12;

const PARTY_X = 45.02;
const SHIP_X = 44.02;
const PARTY_WIDTH = 250;
const ISSUER_NAME_BASELINE = 98.39;
const ISSUER_NAME_STEP = 16.8;
const ISSUER_DETAIL_AFTER_NAME = 13.02;
const PARTY_STEP = 12;
const SHIP_HEADING_AFTER_ISSUER = 23.5;
const BOX_TOP_BEFORE_HEADING = 16.82;
const BOX_LEFT = 298.53;
const BOX_RIGHT = 551.12;
const BOX_PAD = 7.64;
const BOX_LABEL_BASELINE = 14.26;
const BOX_NAME_BASELINE = 25.5;
const BOX_BOTTOM_AFTER_LAST = 10.18;

const REFS_AFTER_BOX = 82.57;
const REFS_STEP = 13.27;
const TABLE_AFTER_REFS = 29.86;
const TABLE_AFTER_BOX = 19.8;

const CELL_PAD = 6.14;
const HEADER_HEIGHT = 23.08;
const HEADER_BASELINE = 14.65;
const ROW_BASE = 13.2;
const ROW_STEP = 10.8;
const ROW_FIRST_BASELINE = 14.66;
const THIN = 0.283;
const THICK = 0.75;

const TOTALS_LABEL_RIGHT = 471.76;
const TOTALS_VALUE_RIGHT = 546.76;
const TOTALS_AFTER_TABLE = 27.92;
const TOTALS_STEP = 22.8;
const NOTES_AFTER_TOTALS = 40.89;
const NOTES_STEP = 13.27;
const LEGAL_AFTER_TOTALS = 26;
const LEGAL_STEP = 12;

const PAGE_NUMBER_BASELINE = 824.86;
const CONTENT_BOTTOM = 798;
const CONTINUATION_TOP = 84;
const MIN_CONCEPT_WIDTH = 120;

export const INK = rgb(0, 0, 0);
const MUTED = rgb(0.333, 0.333, 0.333);
const BOX_BORDER = rgb(0.533, 0.533, 0.533);
const BAND = rgb(0.933, 0.933, 0.933);

export type PdfLang = 'es' | 'en';
export type FontKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface HeaderSpec {
  title: string;
  dateLines: readonly string[];
  /** Sin logotipo, el nombre comercial ocupa su hueco. */
  brandText?: string | null;
}

export interface IssuerSpec {
  name: string;
  lines: readonly string[];
}

export interface ShipSpec {
  heading: string;
  lines: readonly string[];
}

export interface CustomerSpec {
  label: string;
  name: string;
  lines: readonly string[];
  /** Teléfono y correo: van tras una línea en blanco. */
  contact: readonly string[];
}

export interface TableColumn {
  header: string;
  width: number;
  align: 'left' | 'right';
}

export interface TableRow {
  /** Primera línea en negrita; el resto, detalle. */
  concept: { title: string; detail: readonly string[] };
  /** Celdas del resto de columnas, en el mismo orden que las cabeceras. */
  cells: readonly string[];
}

export interface TotalRow {
  label: string;
  value: string;
}

export type NoteLine = string | { label: string; text: string };

export interface QrBand {
  url: string;
  modules: readonly (readonly boolean[])[];
  label: string;
  legend: string;
}

const PAGE_LABELS: Record<PdfLang, { page: (index: number, total: number) => string; continued: string }> = {
  es: { page: (index, total) => `Pág. ${index} de ${total}`, continued: 'continuación' },
  en: { page: (index, total) => `Page ${index} of ${total}`, continued: 'continued' },
};

export const QR_TEXT_SIZE = 11;
const MM_TO_PT = 72 / 25.4;
/** Orden HAC/1177/2024 arts. 20–21: el QR mide entre 30 y 40 mm. */
export const QR_SIZE_MM = 35;
export const QR_SIZE_PT = QR_SIZE_MM * MM_TO_PT;

export interface SheetOptions {
  lang: PdfLang;
  logo: Uint8Array | null;
}

/**
 * Hoja que va dibujando de arriba abajo. `y` es la distancia desde el borde
 * superior (como en las plantillas) y todo el texto dibujado queda anotado
 * para la huella determinista del documento.
 */
export class HoldedSheet {
  readonly pdf: PDFDocument;
  readonly lang: PdfLang;
  readonly recorded: string[] = [];
  y = 0;
  private readonly fonts: Record<FontKey, PDFFont>;
  private readonly logoBytes: Uint8Array | null;
  private readonly logoImage: PDFImage | null;
  private pages: PDFPage[] = [];
  private current: PDFPage;
  private continuationTitle = '';
  private gapBeforeNotes = NOTES_AFTER_TOTALS;
  private tableColumns: readonly TableColumn[] = [];
  private tableWidths: number[] = [];

  private constructor(
    pdf: PDFDocument,
    fonts: Record<FontKey, PDFFont>,
    options: SheetOptions,
    logo: PDFImage | null,
  ) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.lang = options.lang;
    this.logoBytes = options.logo;
    this.logoImage = logo;
    this.current = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.current);
  }

  static async create(options: SheetOptions): Promise<HoldedSheet> {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const fonts: Record<FontKey, PDFFont> = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    };
    const logo = options.logo && options.logo.byteLength > 0 ? await embedLogo(pdf, options.logo) : null;
    return new HoldedSheet(pdf, fonts, options, logo);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get hasLogo(): boolean {
    return this.logoImage !== null;
  }

  measure(value: string, size: number, font: FontKey = 'regular'): number {
    return this.fonts[font].widthOfTextAtSize(printable(this.fonts[font], value), size);
  }

  wrap(value: string, size: number, width: number, font: FontKey = 'regular'): string[] {
    return wrapText(this.fonts[font], value, size, width);
  }

  /** Dibuja una línea y devuelve su ancho. `y` es la línea base desde arriba. */
  text(
    value: string,
    x: number,
    y: number,
    options: { size: number; font?: FontKey; align?: 'left' | 'right' | 'center'; color?: ReturnType<typeof rgb> },
  ): number {
    const font = this.fonts[options.font ?? 'regular'];
    const shown = printable(font, value);
    if (shown === '') return 0;
    const width = font.widthOfTextAtSize(shown, options.size);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    this.current.drawText(shown, {
      x: left,
      y: PAGE_HEIGHT - y,
      size: options.size,
      font,
      color: options.color ?? INK,
    });
    this.recorded.push(shown);
    return width;
  }

  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color = INK): void {
    this.current.drawLine({
      start: { x: x1, y: PAGE_HEIGHT - y1 },
      end: { x: x2, y: PAGE_HEIGHT - y2 },
      thickness,
      color,
    });
  }

  header(spec: HeaderSpec): void {
    this.continuationTitle = spec.title;
    this.paintHeader(spec);
    this.y = ISSUER_NAME_BASELINE - 14;
  }

  /** Banda del QR tributario bajo la cabecera. Solo se llama con Verifactu activo. */
  qr(band: QrBand): void {
    const size = QR_SIZE_PT;
    const top = LOGO_TOP + LOGO_HEIGHT + 6;
    const labelBaseline = top + QR_TEXT_SIZE;
    const qrTop = labelBaseline + 4;
    const qrBottom = qrTop + size;
    const legendBaseline = qrBottom + 4 + QR_TEXT_SIZE;
    const n = band.modules.length;
    const cell = size / n;
    this.current.drawRectangle({
      x: MARGIN_X,
      y: PAGE_HEIGHT - qrBottom,
      width: size,
      height: size,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    for (let row = 0; row < n; row += 1) {
      const moduleRow = band.modules[row];
      if (!moduleRow) continue;
      for (let col = 0; col < n; col += 1) {
        if (!moduleRow[col]) continue;
        this.current.drawRectangle({
          x: MARGIN_X + col * cell,
          y: PAGE_HEIGHT - qrTop - (row + 1) * cell,
          width: cell,
          height: cell,
          color: rgb(0, 0, 0),
          borderWidth: 0,
        });
      }
    }
    this.text(band.label, MARGIN_X, labelBaseline, { size: QR_TEXT_SIZE });
    let baseline = legendBaseline;
    for (const line of this.wrap(band.legend, QR_TEXT_SIZE, PAGE_WIDTH - MARGIN_X * 2)) {
      this.text(line, MARGIN_X, baseline, { size: QR_TEXT_SIZE });
      baseline += QR_TEXT_SIZE + 2;
    }
    this.recorded.push(`qr:${band.url}:${moduleKey(band.modules)}`);
    this.y = baseline - (QR_TEXT_SIZE + 2) + 10;
  }

  /** Emisor, dirección de envío y caja del cliente. Deja `y` en el borde inferior del bloque. */
  parties(spec: { issuer: IssuerSpec; ship: ShipSpec | null; customer: CustomerSpec }): void {
    let baseline = this.y + 14;
    const nameLines = this.wrap(spec.issuer.name, 14, PARTY_WIDTH, 'bold');
    nameLines.forEach((line, index) => {
      if (index > 0) baseline += ISSUER_NAME_STEP;
      this.text(line, PARTY_X, baseline, { size: 14, font: 'bold' });
    });
    baseline += ISSUER_DETAIL_AFTER_NAME;
    let first = true;
    for (const source of spec.issuer.lines) {
      for (const line of this.wrap(source, 10, PARTY_WIDTH)) {
        if (!first) baseline += PARTY_STEP;
        first = false;
        this.text(line, PARTY_X, baseline, { size: 10 });
      }
    }
    if (first) baseline -= ISSUER_DETAIL_AFTER_NAME;
    const headingBaseline = baseline + SHIP_HEADING_AFTER_ISSUER;
    const boxTop = headingBaseline - BOX_TOP_BEFORE_HEADING;

    let leftBottom = baseline;
    if (spec.ship) {
      this.text(spec.ship.heading, SHIP_X, headingBaseline, { size: 10, font: 'bold' });
      let shipBaseline = headingBaseline;
      for (const source of spec.ship.lines) {
        for (const line of this.wrap(source, 10, PARTY_WIDTH)) {
          shipBaseline += PARTY_STEP;
          this.text(line, SHIP_X, shipBaseline, { size: 10 });
        }
      }
      leftBottom = shipBaseline;
    }

    const boxBottom = this.customerBox(boxTop, spec.customer);
    this.y = Math.max(boxBottom, leftBottom + 4);
  }

  /** Referencias del cliente y de la rectificación: líneas sueltas, la primera en negrita. */
  references(lines: readonly string[]): void {
    const wrapped = lines.flatMap((line) => this.wrap(line, 10, TABLE_RIGHT - MARGIN_X));
    if (wrapped.length === 0) {
      this.y += TABLE_AFTER_BOX;
      return;
    }
    let baseline = this.y + REFS_AFTER_BOX;
    wrapped.forEach((line, index) => {
      if (index > 0) baseline += REFS_STEP;
      this.text(line, MARGIN_X, baseline, { size: 10, font: index === 0 ? 'bold' : 'regular' });
    });
    this.y = baseline + TABLE_AFTER_REFS;
  }

  table(columns: readonly TableColumn[], rows: readonly TableRow[]): void {
    this.tableColumns = columns;
    this.tableWidths = this.fitColumns(columns, rows);
    const first = rows[0];
    const firstHeight = first ? this.rowHeight(first) : 0;
    this.ensure(HEADER_HEIGHT + firstHeight);
    this.tableHeader();
    for (const row of rows) {
      const height = this.rowHeight(row);
      if (this.y + height > CONTENT_BOTTOM) {
        this.continuation();
        this.tableHeader();
      }
      this.tableRow(row, height);
    }
  }

  /** Totales en negrita alineados a la derecha. */
  totals(rows: readonly TotalRow[]): void {
    if (rows.length === 0) return;
    const height = TOTALS_AFTER_TABLE + TOTALS_STEP * (rows.length - 1);
    if (this.y + height > CONTENT_BOTTOM) {
      this.continuation();
      this.y -= 12;
    }
    let baseline = this.y + TOTALS_AFTER_TABLE;
    rows.forEach((row, index) => {
      if (index > 0) baseline += TOTALS_STEP;
      this.text(row.label, TOTALS_LABEL_RIGHT, baseline, { size: 9, font: 'bold', align: 'right' });
      this.text(row.value, TOTALS_VALUE_RIGHT, baseline, { size: 9, font: 'bold', align: 'right' });
    });
    this.y = baseline;
    this.gapBeforeNotes = NOTES_AFTER_TOTALS;
  }

  /** Menciones legales de una sola vez bajo los totales. */
  legal(lines: readonly string[]): void {
    const wrapped = lines.flatMap((line) => this.wrap(line, 9, TABLE_RIGHT - MARGIN_X));
    if (wrapped.length === 0) return;
    let baseline = this.y + LEGAL_AFTER_TOTALS;
    wrapped.forEach((line, index) => {
      if (index > 0) baseline += LEGAL_STEP;
      if (baseline > CONTENT_BOTTOM) {
        this.continuation();
        baseline = this.y + 10;
      }
      this.text(line, MARGIN_X, baseline, { size: 9 });
    });
    this.y = baseline;
    this.gapBeforeNotes = 30;
  }

  /** Notas del pie en cursiva. Una línea vacía deja un hueco. */
  notes(lines: readonly NoteLine[]): void {
    const items: { label: string | null; text: string }[] = [];
    for (const line of lines) {
      if (typeof line === 'string') {
        if (line.trim() === '') items.push({ label: null, text: '' });
        else for (const part of this.wrap(line, 10, TABLE_RIGHT - MARGIN_X, 'italic')) items.push({ label: null, text: part });
      } else {
        items.push({ label: line.label, text: line.text });
      }
    }
    while (items.length > 0 && items[items.length - 1]?.text === '' && items[items.length - 1]?.label === null) items.pop();
    if (items.length === 0) return;
    let baseline = this.y + this.gapBeforeNotes;
    items.forEach((item, index) => {
      if (index > 0) baseline += NOTES_STEP;
      if (baseline > CONTENT_BOTTOM) {
        this.continuation();
        baseline = this.y + 10;
      }
      if (item.label !== null) {
        const width = this.text(item.label, MARGIN_X, baseline, { size: 10, font: 'bold' });
        this.text(item.text, MARGIN_X + width + 3, baseline, { size: 10, font: 'italic' });
      } else if (item.text !== '') {
        this.text(item.text, MARGIN_X, baseline, { size: 10, font: 'italic' });
      }
    });
    this.y = baseline;
  }

  /** Números de página, metadatos y huella. El mismo contenido da los mismos bytes. */
  async finish(meta: {
    title: string;
    author?: string;
    subject?: string;
    createdAt: Date;
    fingerprint?: unknown;
  }): Promise<Uint8Array> {
    const total = this.pages.length;
    const labels = PAGE_LABELS[this.lang];
    this.pages.forEach((page, index) => {
      this.current = page;
      this.text(labels.page(index + 1, total), PAGE_WIDTH / 2, PAGE_NUMBER_BASELINE, { size: 9, align: 'center' });
    });
    this.pdf.setTitle(meta.title.slice(0, 120));
    if (meta.author) this.pdf.setAuthor(meta.author);
    if (meta.subject) this.pdf.setSubject(meta.subject);
    this.pdf.setCreator('WineCore');
    this.pdf.setProducer('WineCore');
    this.pdf.setLanguage(this.lang === 'es' ? 'es-ES' : 'en-GB');
    this.pdf.setCreationDate(meta.createdAt);
    this.pdf.setModificationDate(meta.createdAt);
    const material = canonicalJson({
      lang: this.lang,
      text: this.recorded,
      logo: this.logoBytes ? sha256(this.logoBytes) : null,
      extra: meta.fingerprint ?? null,
    });
    const id = sha256(new TextEncoder().encode(material));
    this.pdf.context.trailerInfo.ID = this.pdf.context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
    return this.pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  }

  private paintHeader(spec: HeaderSpec): void {
    if (this.logoImage) {
      const ratio = this.logoImage.height === 0 ? 1 : this.logoImage.width / this.logoImage.height;
      let width = LOGO_HEIGHT * ratio;
      let height = LOGO_HEIGHT;
      if (width > LOGO_MAX_WIDTH) {
        width = LOGO_MAX_WIDTH;
        height = width / ratio;
      }
      this.current.drawImage(this.logoImage, {
        x: LOGO_X,
        y: PAGE_HEIGHT - LOGO_TOP - height,
        width,
        height,
      });
    } else if (spec.brandText && spec.brandText.trim() !== '') {
      this.text(spec.brandText, LOGO_X, LOGO_TOP + 24, { size: 18, font: 'bold' });
    }
    this.text(spec.title, TITLE_RIGHT, TITLE_BASELINE, { size: 12, font: 'bold', align: 'right' });
    spec.dateLines.forEach((line, index) => {
      this.text(line, TITLE_RIGHT, DATE_BASELINE + index * HEADER_STEP, { size: 10, align: 'right' });
    });
  }

  private customerBox(top: number, spec: CustomerSpec): number {
    const inner = BOX_RIGHT - BOX_LEFT - BOX_PAD * 2;
    const x = BOX_LEFT + BOX_PAD;
    this.text(spec.label, x, top + BOX_LABEL_BASELINE, { size: 7, color: MUTED });
    let baseline = top + BOX_NAME_BASELINE;
    this.wrap(spec.name, 10, inner, 'bold').forEach((line, index) => {
      if (index > 0) baseline += PARTY_STEP;
      this.text(line, x, baseline, { size: 10, font: 'bold' });
    });
    for (const source of spec.lines) {
      for (const line of this.wrap(source, 10, inner)) {
        baseline += PARTY_STEP;
        this.text(line, x, baseline, { size: 10 });
      }
    }
    const contact = spec.contact.flatMap((line) => this.wrap(line, 10, inner));
    if (contact.length > 0) {
      baseline += PARTY_STEP;
      for (const line of contact) {
        baseline += PARTY_STEP;
        this.text(line, x, baseline, { size: 10 });
      }
    }
    const bottom = baseline + BOX_BOTTOM_AFTER_LAST;
    const page = this.current;
    const stroke = { thickness: THIN, color: BOX_BORDER };
    const edges: [number, number, number, number][] = [
      [BOX_LEFT, top, BOX_LEFT, bottom],
      [BOX_LEFT, top, BOX_RIGHT, top],
      [BOX_RIGHT, top, BOX_RIGHT, bottom],
      [BOX_LEFT, bottom, BOX_RIGHT, bottom],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      page.drawLine({
        start: { x: x1, y: PAGE_HEIGHT - y1 },
        end: { x: x2, y: PAGE_HEIGHT - y2 },
        ...stroke,
      });
    }
    return bottom;
  }

  private columnEdges(): number[] {
    const edges = [TABLE_LEFT];
    for (const width of this.tableWidths) edges.push((edges[edges.length - 1] ?? TABLE_LEFT) + width);
    return edges;
  }

  /**
   * Anchos de la plantilla, ampliados lo justo para que quepa el importe más largo de cada
   * columna numérica; lo que sobra o falta lo absorbe la primera columna (el concepto).
   */
  private fitColumns(columns: readonly TableColumn[], rows: readonly TableRow[]): number[] {
    const total = TABLE_RIGHT - TABLE_LEFT;
    const preferred = columns.reduce((sum, column) => sum + column.width, 0) || total;
    const widths = columns.map((column) => (column.width * total) / preferred);
    for (let index = 1; index < columns.length; index += 1) {
      const header = columns[index]?.header ?? '';
      let needed = this.measure(header, 9);
      for (const row of rows) needed = Math.max(needed, this.measure(row.cells[index - 1] ?? '', 9));
      widths[index] = Math.max(widths[index] ?? 0, Math.ceil((needed + CELL_PAD * 2) * 10) / 10);
    }
    const others = widths.slice(1).reduce((sum, width) => sum + width, 0);
    if (total - others >= MIN_CONCEPT_WIDTH) {
      widths[0] = total - others;
      return widths;
    }
    const room = total - MIN_CONCEPT_WIDTH;
    const scale = others === 0 ? 1 : room / others;
    for (let index = 1; index < widths.length; index += 1) widths[index] = (widths[index] ?? 0) * scale;
    widths[0] = MIN_CONCEPT_WIDTH;
    return widths;
  }

  private rowHeight(row: TableRow): number {
    return ROW_BASE + ROW_STEP * this.conceptLines(row).length;
  }

  private conceptLines(row: TableRow): { text: string; bold: boolean }[] {
    const width = (this.tableWidths[0] ?? 200) - CELL_PAD * 2;
    const lines = this.wrap(row.concept.title, 9, width, 'bold').map((text) => ({ text, bold: true }));
    for (const detail of row.concept.detail) {
      for (const text of this.wrap(detail, 9, width)) lines.push({ text, bold: false });
    }
    return lines.length > 0 ? lines : [{ text: '', bold: false }];
  }

  private tableHeader(): void {
    const edges = this.columnEdges();
    const top = this.y;
    const bottom = top + HEADER_HEIGHT;
    this.current.drawRectangle({
      x: TABLE_LEFT,
      y: PAGE_HEIGHT - bottom,
      width: TABLE_RIGHT - TABLE_LEFT,
      height: HEADER_HEIGHT,
      color: BAND,
      borderWidth: 0,
    });
    this.line(TABLE_LEFT, top, TABLE_RIGHT, top, THIN);
    this.line(TABLE_LEFT, bottom, TABLE_RIGHT, bottom, THIN);
    for (const edge of edges) this.line(edge, top, edge, bottom, THIN);
    this.tableColumns.forEach((column, index) => {
      const left = edges[index] ?? TABLE_LEFT;
      const right = edges[index + 1] ?? TABLE_RIGHT;
      if (column.align === 'right') {
        this.text(column.header, right - CELL_PAD, top + HEADER_BASELINE, { size: 9, align: 'right' });
      } else {
        this.text(column.header, left + CELL_PAD, top + HEADER_BASELINE, { size: 9 });
      }
    });
    this.y = bottom;
  }

  private tableRow(row: TableRow, height: number): void {
    const edges = this.columnEdges();
    const top = this.y;
    const bottom = top + height;
    for (const edge of edges) this.line(edge, top, edge, bottom, THIN);
    this.line(TABLE_LEFT, bottom, TABLE_RIGHT, bottom, THICK);
    const lines = this.conceptLines(row);
    lines.forEach((line, index) => {
      this.text(line.text, (edges[0] ?? TABLE_LEFT) + CELL_PAD, top + ROW_FIRST_BASELINE + index * ROW_STEP, {
        size: 9,
        font: line.bold ? 'bold' : 'regular',
      });
    });
    this.tableColumns.forEach((column, index) => {
      if (index === 0) return;
      const value = row.cells[index - 1] ?? '';
      const left = edges[index] ?? TABLE_LEFT;
      const right = edges[index + 1] ?? TABLE_RIGHT;
      if (column.align === 'right') {
        this.text(value, right - CELL_PAD, top + ROW_FIRST_BASELINE, { size: 9, align: 'right' });
      } else {
        this.text(value, left + CELL_PAD, top + ROW_FIRST_BASELINE, { size: 9 });
      }
    });
    this.y = bottom;
  }

  private ensure(height: number): void {
    if (this.y + height > CONTENT_BOTTOM) this.continuation();
  }

  /** Página nueva con el título repetido arriba a la derecha. */
  private continuation(): void {
    this.current = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.current);
    if (this.continuationTitle !== '') {
      this.text(this.continuationTitle, TITLE_RIGHT, TITLE_BASELINE, { size: 12, font: 'bold', align: 'right' });
      this.text(`(${PAGE_LABELS[this.lang].continued})`, TITLE_RIGHT, DATE_BASELINE, { size: 10, align: 'right' });
    }
    this.y = CONTINUATION_TOP;
  }
}

/** Comprueba que los bytes son un PNG o JPEG que se puede incrustar y devuelve su tamaño. */
export async function inspectLogo(bytes: Uint8Array): Promise<{ width: number; height: number; mime: 'image/png' | 'image/jpeg' }> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const image = await embedLogo(pdf, bytes);
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
  return { width: image.width, height: image.height, mime: isPng ? 'image/png' : 'image/jpeg' };
}

async function embedLogo(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const copy = new Uint8Array(bytes);
  try {
    return await pdf.embedPng(copy);
  } catch {
    try {
      return await pdf.embedJpg(copy);
    } catch {
      throw domainError('WC_VALIDATION', { logo: 'El logotipo debe ser PNG o JPEG' });
    }
  }
}

function encodable(font: PDFFont, char: string): string {
  try {
    font.encodeText(char);
    return char;
  } catch {
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    if (base !== '' && base !== char) {
      try {
        font.encodeText(base);
        return base;
      } catch {
        return '?';
      }
    }
    return '?';
  }
}

/** Texto en una sola línea con solo caracteres que la fuente estándar sabe pintar. */
export function printable(font: PDFFont, value: string): string {
  let out = '';
  for (const char of value.normalize('NFC')) {
    if (char === '\t' || char === '\n' || char === '\r') {
      out += ' ';
      continue;
    }
    if (/[\u0000-\u001f\u007f]/u.test(char)) continue;
    out += encodable(font, char);
  }
  return out.replace(/ {2,}/gu, ' ').trim();
}

export function wrapText(font: PDFFont, value: string, size: number, width: number): string[] {
  const text = printable(font, value);
  if (text === '') return [];
  if (font.widthOfTextAtSize(text, size) <= width) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (word === '') continue;
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

function moduleKey(modules: readonly (readonly boolean[])[]): string {
  return modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

function groupDigits(whole: string, lang: PdfLang): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, lang === 'en' ? ',' : '.');
}

function decimalOf(value: string | number | Decimal | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** Número sin ceros de relleno: 12.000 se ve como 12; el separador sigue el idioma. */
export function formatNumber(value: string | number | Decimal | null | undefined, lang: PdfLang, maxDecimals = 6): string {
  const parsed = decimalOf(value);
  if (!parsed) return '';
  const fixed = parsed.abs().toFixed(maxDecimals, Decimal.ROUND_HALF_UP);
  const [whole = '0', frac = ''] = fixed.split('.');
  const trimmed = frac.replace(/0+$/u, '');
  const sign = parsed.isNeg() && (whole !== '0' || trimmed !== '') ? '-' : '';
  const body = groupDigits(whole, lang);
  return trimmed === '' ? `${sign}${body}` : `${sign}${body}${lang === 'en' ? '.' : ','}${trimmed}`;
}

function withCurrency(amount: string, lang: PdfLang, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency];
  if (!symbol) return `${amount} ${currency}`;
  if (lang === 'en') return amount.startsWith('-') ? `-${symbol}${amount.slice(1)}` : `${symbol}${amount}`;
  return `${amount}${symbol}`;
}

/** Importe con dos decimales y el símbolo de la moneda: 1.234,56€. */
export function formatAmount(value: string | number | Decimal | null | undefined, lang: PdfLang, currency = 'EUR'): string {
  const parsed = decimalOf(value);
  if (!parsed) return '';
  const fixed = parsed.abs().toFixed(2, Decimal.ROUND_HALF_UP);
  const [whole = '0', frac = '00'] = fixed.split('.');
  const sign = parsed.isNeg() && fixed !== '0.00' ? '-' : '';
  const body = `${sign}${groupDigits(whole, lang)}${lang === 'en' ? '.' : ','}${frac}`;
  return withCurrency(body, lang, currency);
}

/** Precio unitario: al menos dos decimales y hasta seis sin ceros de más. */
export function formatUnitPrice(value: string | number | Decimal | null | undefined, lang: PdfLang, currency = 'EUR'): string {
  const parsed = decimalOf(value);
  if (!parsed) return '';
  const fixed = parsed.abs().toFixed(6, Decimal.ROUND_HALF_UP);
  const [whole = '0', frac = ''] = fixed.split('.');
  const trimmed = frac.replace(/0+$/u, '');
  const decimals = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed;
  const sign = parsed.isNeg() ? '-' : '';
  const body = `${sign}${groupDigits(whole, lang)}${lang === 'en' ? '.' : ','}${decimals}`;
  return withCurrency(body, lang, currency);
}

export function formatPercent(value: string | number | Decimal | null | undefined, lang: PdfLang): string {
  const shown = formatNumber(value, lang, 2);
  return shown === '' ? '' : `${shown}%`;
}

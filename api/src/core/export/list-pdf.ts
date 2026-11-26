import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { printable } from '../pdf/holded-layout';

const PAGE: [number, number] = [841.89, 595.28];
const MARGIN = 32;
const SIZE = 8;
const LEADING = 14;

export interface ListPdfColumn {
  header: string;
  align: 'left' | 'right';
  width: number;
}

export interface ListPdf {
  title: string;
  columns: ListPdfColumn[];
  rows: string[][];
  totals: string[];
  note: string;
}

/** Tabla apaisada del listado filtrado, con la fila de totales al final. */
export async function renderListPdf(table: ListPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(table.title);
  doc.setCreator('WineCore');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const widths = fitWidths(table.columns.map((column) => column.width));
  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  page.drawText(printable(bold, table.title), { x: MARGIN, y: y - 14, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 22;
  page.drawText(printable(regular, table.note), { x: MARGIN, y: y - 9, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
  y -= 18;
  const header = () => {
    y = drawRow(page, bold, table.columns.map((column) => column.header), table.columns, widths, y, true);
  };
  header();
  for (const row of table.rows) {
    if (y - LEADING < MARGIN) {
      page = doc.addPage(PAGE);
      y = PAGE[1] - MARGIN;
      header();
    }
    y = drawRow(page, regular, row, table.columns, widths, y, false);
  }
  if (y - LEADING < MARGIN) {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    header();
  }
  y = drawRow(page, bold, table.totals, table.columns, widths, y, true);
  return doc.save({ useObjectStreams: false });
}

function fitWidths(widths: number[]): number[] {
  const usable = PAGE[0] - MARGIN * 2;
  const sum = widths.reduce((total, width) => total + width, 0);
  if (sum <= usable || sum === 0) return widths;
  const scale = usable / sum;
  return widths.map((width) => width * scale);
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  cells: string[],
  columns: ListPdfColumn[],
  widths: number[],
  y: number,
  emphasis: boolean,
): number {
  const top = y;
  let x = MARGIN;
  if (emphasis) {
    page.drawRectangle({ x: MARGIN, y: top - LEADING + 3, width: widths.reduce((sum, width) => sum + width, 0), height: LEADING, color: rgb(0.95, 0.95, 0.95) });
  }
  for (let index = 0; index < columns.length; index += 1) {
    const width = widths[index] ?? 40;
    const text = clip(font, cells[index] ?? '', SIZE, width - 8);
    const textWidth = font.widthOfTextAtSize(text, SIZE);
    const left = columns[index]?.align === 'right' ? x + width - 4 - textWidth : x + 4;
    page.drawText(text, { x: left, y: top - SIZE - 2, size: SIZE, font, color: rgb(0.1, 0.1, 0.1) });
    x += width;
  }
  page.drawLine({
    start: { x: MARGIN, y: top - LEADING + 3 },
    end: { x: MARGIN + widths.reduce((sum, width) => sum + width, 0), y: top - LEADING + 3 },
    thickness: 0.4,
    color: rgb(0.8, 0.8, 0.8),
  });
  return top - LEADING;
}

function clip(font: PDFFont, value: string, size: number, width: number): string {
  const text = printable(font, value);
  if (text === '' || font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

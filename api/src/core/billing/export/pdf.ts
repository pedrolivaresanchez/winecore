import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

export async function renderPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lines = text.split('\n');
  doc.setTitle(lines[0] ?? 'WineCore');
  doc.setCreator('WineCore');
  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  for (let index = 0; index < lines.length; index += 1) {
    const size = index === 0 ? 14 : 10;
    const leading = size + 4;
    if (y - leading < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
    const font = index === 0 ? bold : regular;
    drawLine(page, font, lines[index] ?? '', MARGIN, y - size, size);
    y -= leading;
  }
  return doc.save({ useObjectStreams: false });
}

function drawLine(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number): void {
  page.drawText(encode(font, text), { x, y, size, font, color: rgb(0, 0, 0) });
}

function encode(font: PDFFont, text: string): string {
  let out = '';
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += '?';
    }
  }
  return out;
}

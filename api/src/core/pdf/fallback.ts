import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { DocumentPdfInput } from './document';
import { printable } from './holded-layout';

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 56;

/** Un fallo de PDF queda en el registro del servidor sin datos del documento. */
export function logPdfFallback(stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ level: 'warn', component: 'pdf', event: 'fallback', stage, message: message.slice(0, 300) }));
}

/**
 * Último recurso cuando ni la maqueta completa ni la maqueta sin logotipo ni cliente pintan:
 * una hoja sencilla con lo que el documento sabe de sí mismo. No lanza nunca, porque abrir un
 * PDF no puede acabar en un error 500.
 */
export async function renderFallbackPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  try {
    return await drawFallback(input);
  } catch (error) {
    logPdfFallback('fallback', error);
    return drawNotice(input.title, input.number);
  }
}

async function drawFallback(input: DocumentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const line = (text: string, font: PDFFont, size: number, gap = 4) => {
    if (y < MARGIN) {
      page = pdf.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    const shown = printable(font, text);
    let cut = shown;
    while (cut.length > 1 && font.widthOfTextAtSize(cut, size) > PAGE[0] - MARGIN * 2) cut = cut.slice(0, -1);
    page.drawText(cut, { x: MARGIN, y, size, font });
    y -= size + gap;
  };

  const number = input.number?.trim() ?? '';
  line(number === '' ? input.title : `${input.title} ${number}`, bold, 16, 10);
  line(input.seller.legalName, bold, 11);
  if (input.seller.taxId.trim() !== '') line(input.seller.taxId, regular, 10);
  y -= 8;
  if (input.issueDate) line(`Fecha: ${input.issueDate}`, regular, 10);
  if (input.dueLabel && input.dueDate) line(`${input.dueLabel}: ${input.dueDate}`, regular, 10);
  if (input.status.trim() !== '') line(`Estado: ${input.status}`, regular, 10);
  line(`${input.partyLabel}: ${input.customerName}`, bold, 10, 10);
  if (input.description?.trim()) line(input.description.trim().split('\n')[0] ?? '', regular, 10, 8);

  for (const item of input.lines.slice(0, 200)) {
    const quantity = (item.quantity ?? '').trim() === '' ? '' : ` x ${item.quantity}`;
    const amount = item.line_base ? `  ${item.line_base} EUR` : '';
    line(`${item.description}${quantity}${amount}`, regular, 10);
  }
  y -= 8;
  if (input.totals) {
    line(`Base imponible: ${input.totals.subtotal} EUR`, regular, 10);
    line(`IVA: ${input.totals.vat} EUR`, regular, 10);
    line(`Total: ${input.totals.total} EUR`, bold, 11, 10);
  }
  if (input.note.trim() !== '') line(input.note, regular, 9);
  return pdf.save({ useObjectStreams: false });
}

async function drawNotice(title: string, number: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE);
  const heading = [title, number ?? ''].join(' ').replace(/[^\x20-\x7e]/gu, '?').trim();
  page.drawText(heading === '' ? 'Documento' : heading, { x: MARGIN, y: PAGE[1] - MARGIN, size: 16, font });
  page.drawText('Vista del documento no disponible en este momento.', { x: MARGIN, y: PAGE[1] - MARGIN - 28, size: 11, font });
  return pdf.save({ useObjectStreams: false });
}

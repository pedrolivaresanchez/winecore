import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildCommercialInvoice, buildPackingList } from '../../src/core/billing/export/documents';
import { renderPdf } from '../../src/core/billing/export/pdf';
import { exampleExportDocuments } from '../../src/core/billing/export/setting';
import { confirmedGb, sampleInvoice } from './fixture';
import { pdfLines } from './pdfText';

function golden(name: string): string {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8').replace(/\n$/u, '');
}

describe('documentos de exportación', () => {
  it('la factura comercial en español coincide con el texto golden y con el PDF', async () => {
    const built = buildCommercialInvoice(sampleInvoice(), confirmedGb().countries.GB!);
    expect(built.text).toBe(golden('commercial-invoice-es.txt'));
    expect(built.text).not.toContain('%');
    expect(built.document.tax).toEqual({
      code: 'EXP_E2',
      tax: '01',
      regime_key: '02',
      exemption: 'E2',
      rate: null,
      quota: null,
      mention: 'Operación exenta de IVA por exportación (art. 21 Ley 37/1992).',
    });
    expect(built.document.subtotal).toBe('120.00');
    expect(built.document.total).toBe('120.00');
    const pdf = await renderPdf(built.text);
    expect(Buffer.from(pdf).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdfLines(pdf).join('\n')).toBe(built.text);
  });

  it('la factura comercial en inglés no informa tipo ni cuota', async () => {
    const built = buildCommercialInvoice(sampleInvoice({ language: 'en' }), confirmedGb().countries.GB!);
    expect(built.text).toBe(golden('commercial-invoice-en.txt'));
    expect(built.text).toContain('VAT rate: not reported');
    expect(built.text).toContain('VAT amount: not reported');
    expect(built.text).not.toContain('%');
    expect(built.document.tax?.rate).toBeNull();
    expect(built.document.tax?.quota).toBeNull();
    expect(pdfLines(await renderPdf(built.text)).join('\n')).toBe(built.text);
  });

  it('la lista de bultos en español e inglés no lleva precios', async () => {
    const country = confirmedGb().countries.GB!;
    const spanish = buildPackingList(sampleInvoice(), country);
    const english = buildPackingList(sampleInvoice({ language: 'en' }), country);
    expect(spanish.text).toBe(golden('packing-list-es.txt'));
    expect(english.text).toBe(golden('packing-list-en.txt'));
    expect(spanish.text).not.toContain('120.00');
    expect(english.text).not.toContain('10.00');
    expect(pdfLines(await renderPdf(spanish.text)).join('\n')).toBe(spanish.text);
    expect(pdfLines(await renderPdf(english.text)).join('\n')).toBe(english.text);
  });

  it('un país de ejemplo añade el aviso y no lo presenta como confirmado', () => {
    const country = exampleExportDocuments().countries.GB!;
    const built = buildCommercialInvoice(sampleInvoice(), country);
    const lines = built.text.split('\n');
    expect(lines[1]).toBe('EJEMPLO sin confirmar. Pedro y el asesor deben confirmar los requisitos de este país.');
    expect(lines.filter((_, index) => index !== 1).join('\n')).toBe(golden('commercial-invoice-es.txt'));
    const english = buildPackingList(sampleInvoice({ language: 'en' }), country);
    expect(english.text.split('\n')[1]).toContain('UNCONFIRMED EXAMPLE');
  });

  it('respeta la base ya redondeada y redondea el precio a 2 decimales', () => {
    const country = confirmedGb().countries.GB!;
    const given = sampleInvoice({
      lines: [{ ...sampleInvoice().lines[0]!, unit_price: '99.00', line_base: '10.00' }],
    });
    expect(buildCommercialInvoice(given, country).document.lines[0]?.amount).toBe('10.00');
    const rounded = sampleInvoice({
      lines: [{ ...sampleInvoice().lines[0]!, quantity: '3', unit_price: '0.335', line_base: null }],
    });
    expect(buildCommercialInvoice(rounded, country).document.lines[0]?.amount).toBe('1.01');
  });

  it('el PDF de muchas líneas conserva el texto, también con eñe', async () => {
    const country = confirmedGb().countries.GB!;
    const lines = Array.from({ length: 40 }, (_, index) => ({
      ...sampleInvoice().lines[0]!,
      line_no: index + 1,
      description: `Viña ${index + 1}`,
      quantity: '1',
      unit_price: '1.00',
    }));
    const built = buildPackingList(sampleInvoice({ lines }), country);
    expect(pdfLines(await renderPdf(built.text)).join('\n')).toBe(built.text);
    expect(built.text).toContain('Viña 40');
  });
});

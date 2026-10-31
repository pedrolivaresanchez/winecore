import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../src/core/errors';
import { timbalOcrWorkforce } from '../../src/core/purchasing/timbal';
import { TimbalOcrExtractor } from '../../src/core/purchasing/extract';

const extraction = {
  supplier_name: 'Suministros Sintéticos SL',
  supplier_tax_id: 'B11111119',
  number: 'F-1',
  issue_date: '2027-02-03',
  subtotal: '10.00',
  tax_total: '0.00',
  withholding_total: '0.00',
  total: '10.00',
  lines: [{ description: 'Servicio', line_base: '10.00', vat_rate: '0', vat_quota: '0.00' }],
  confidence: {
    supplier_name: 0.9,
    supplier_tax_id: 0.9,
    number: 0.9,
    issue_date: 0.4,
    due_date: 0,
    lines: 0.9,
    vat: 0.9,
    totals: 0.9,
  },
};

describe('borde Timbal', () => {
  it('pide solo la extracción y registra el modelo enrutado', async () => {
    let body = '';
    let authorization = '';
    const workforce = timbalOcrWorkforce({
      url: 'https://ocr.test/run',
      token: 'sekreto-no-sale',
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        body = String(init?.body ?? '');
        return new Response(JSON.stringify({ extraction }), {
          status: 200,
          headers: { 'x-timbal-routed-model': 'anthropic/claude-haiku-5-5' },
        });
      },
    });
    const parsed = await new TimbalOcrExtractor(workforce).extract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mime: 'application/pdf',
      filename: 'factura.pdf',
    });
    expect(authorization).toBe('Bearer sekreto-no-sale');
    expect(body).toContain('"api_base_url":""');
    expect(body).not.toContain('sekreto-no-sale');
    expect(parsed.model).toBe('anthropic/claude-haiku-5-5');
    expect(parsed.extractor).toBe('timbal-ocr');
    expect(parsed.overall).toBe(0.4);
    expect(parsed.total).toBe('10.00');
  });

  it('no filtra el cuerpo del fallo', async () => {
    const workforce = timbalOcrWorkforce({
      url: 'https://ocr.test/run',
      token: 'sekreto-no-sale',
      fetchImpl: async () => new Response('sekreto-no-sale', { status: 500 }),
    });
    const error = await workforce.extract({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
      filename: 'factura.pdf',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('WC_OCR_UNAVAILABLE');
    expect((error as DomainError).message).not.toContain('sekreto');
  });
});

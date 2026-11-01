import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { pdfLines } from '../export/pdfText';
import { createTestApp } from '../helpers';
import { buildSalesFixture, json, req, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('IVA reducido 10 %', () => {
  it('existe como código de impuesto con los campos Verifactu del IVA general', async () => {
    const rows = await ctx.writer.read<Record<string, unknown>>(sql`
      SELECT tax, regime_key, qualification, exemption, rate::VARCHAR AS rate, surcharge_rate::VARCHAR AS surcharge, withholding_rate::VARCHAR AS withholding
      FROM billing.tax_code WHERE code = 'IVA10'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tax: '01', regime_key: '01', qualification: 'S1', exemption: null, rate: '10.00', surcharge: '0.00', withholding: '0.00' });
  });

  it('presupuesta una cata a 90 € por persona: base 1.350,00, IVA 135,00 y total 1.485,00', async () => {
    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'direct',
      legal_entity_id: fx.cvpo,
      lines: [{
        product_id: fx.product,
        quantity: '15',
        unit_price: '90',
        price_reason: 'Cata de vinos en la bodega, precio por persona',
        tax_code: 'IVA10',
        description: 'Cata de vinos a celebrar el 12 de noviembre de 2026 en la bodega Vinos Bio Pedro Olivares',
        unit: 'persona',
      }],
    });
    expect(quote.subtotal).toBe('1350.00');
    expect(quote.tax_total).toBe('135.00');
    expect(quote.total).toBe('1485.00');

    const pdf = await ctx.app.handle(req('GET', `/v1/quotes/${String(quote.id)}/pdf`));
    expect(pdf.status).toBe(200);
    const text = pdfLines(new Uint8Array(await pdf.arrayBuffer())).join('\n');
    expect(text).toContain('IVA 10%');
    expect(text).toContain('1.485,00');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { pdfLines } from '../export/pdfText';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, req, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('pedido en PDF', () => {
  it('imprime el pedido con la maqueta de Holded, en borrador y confirmado', async () => {
    const created = await json(ctx, 'POST', '/v1/sales-orders', {
      customer_id: fx.customer,
      channel: 'direct',
      customer_order_ref: 'OC-77',
      notes: 'Entregar por la mañana',
      customer_references: 'PEDIDO 56192401\nCENTRO 0059',
      lines: [{ product_id: fx.product, quantity: '12' }],
    }, { 'Idempotency-Key': `pedido-pdf-${newId()}` });
    const id = String(created.id);

    const draft = await ctx.app.handle(req('GET', `/v1/sales-orders/${id}/pdf`));
    expect(draft.status).toBe(200);
    expect(draft.headers.get('content-type')).toContain('application/pdf');
    expect(draft.headers.get('content-disposition')).toContain('pedido-borrador.pdf');
    const draftText = pdfLines(new Uint8Array(await draft.arrayBuffer())).join('\n');
    expect(draftText).toContain('PEDIDO');
    expect(draftText).toContain('Borrador');
    expect(draftText).toContain('OC-77');
    expect(draftText).toContain('PEDIDO 56192401');
    expect(draftText).toContain('Entregar por la mañana');
    expect(draftText).toContain('No es una factura');
    expect(draftText).not.toContain('Verifactu');

    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${id}/confirm`);
    const pdf = await ctx.app.handle(req('GET', `/v1/sales-orders/${id}/pdf`));
    expect(pdf.status).toBe(200);
    const text = pdfLines(new Uint8Array(await pdf.arrayBuffer())).join('\n');
    expect(text).toContain(`PEDIDO #${String(confirmed.number)}`);
    expect(text).toContain('Confirmado');
  });

  it('responde 404 si el pedido no existe', async () => {
    const missing = await call(ctx, 'GET', '/v1/sales-orders/019a0000-0000-7000-8000-0000000fffff/pdf');
    expect(missing.status).toBe(404);
  });

  it('ofrece el pedido como documento de muestra del perfil', async () => {
    const sample = await ctx.app.handle(
      req('POST', '/v1/legal-entities/PO/document-profile/sample', { kind: 'order' }),
    );
    expect(sample.status).toBe(200);
    const text = pdfLines(new Uint8Array(await sample.arrayBuffer())).join('\n');
    expect(text).toContain('PEDIDO #PE260031');
  });
});

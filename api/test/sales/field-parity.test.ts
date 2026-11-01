import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createSeries } from '../../src/core/series';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, req, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;

const SHIP_TO = {
  name: 'Almacén Cliente Ejemplo',
  line1: 'Calle Ficticia 1',
  postal_code: '00000',
  city: 'Villa Ejemplo',
  province: 'Provincia Ejemplo',
  country_code: 'ES',
};
const REFERENCES = 'Pedido cliente 0001\nDepartamento de compras';

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
  const actor = { type: 'system' as const, id: 'parity', requestId: 'parity-series' };
  await ctx.writer.withWrite(actor, (tx) => {
    tx.write(sql`
      INSERT INTO party.contact_address (id, contact_id, kind, line1, postal_code, city, province, country_code, is_default)
      VALUES (
        CAST(${newId()} AS UUID), CAST(${fx.customer} AS UUID), 'billing', 'Calle Facturación 5', '00000',
        'Villa Ejemplo', 'Provincia Ejemplo', 'ES', TRUE
      )
    `);
    return createSeries(tx, {
      legal_entity_id: fx.po,
      doc_type: 'invoice',
      code: 'PF',
      prefix: `PF${String(fx.year).slice(2)}-`,
      padding: 4,
      is_default: true,
      verifactu: false,
      year: fx.year,
    });
  });
});

afterAll(async () => {
  await ctx.close();
});

async function pdfText(path: string): Promise<string> {
  const response = await ctx.app.handle(req('GET', path));
  if (response.status !== 200) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return extractPdfText(new Uint8Array(await response.arrayBuffer()));
}

describe('paridad de campos con Holded', () => {
  it('guarda dirección de envío, referencias y unidad en el presupuesto, los edita y los imprime', async () => {
    const created = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      ship_to: SHIP_TO,
      customer_references: REFERENCES,
      lines: [{ product_id: fx.product, quantity: '12', discount_pct: '10', unit: 'Botellas' }],
    });
    expect(created.ship_to).toEqual(SHIP_TO);
    expect(created.customer_references).toBe(REFERENCES);
    const line = (created.lines as { unit: string | null; discount_pct: string }[])[0];
    expect(line?.unit).toBe('Botellas');
    expect(line?.discount_pct).toBe('10.00');
    expect(created.subtotal).toBe('102.60');

    const text = await pdfText(`/v1/quotes/${String(created.id)}/pdf`);
    expect(text).toContain('PRESUPUESTO (BORRADOR)');
    expect(text).toContain('Almacén Cliente Ejemplo');
    expect(text).toContain('Calle Ficticia 1');
    expect(text).toContain('Pedido cliente 0001');
    expect(text).toContain('Departamento de compras');

    const edited = await json(ctx, 'PATCH', `/v1/quotes/${String(created.id)}`, {
      customer_references: 'Referencia nueva',
      ship_to: null,
    }, { 'If-Match': String(created.updated_at) });
    expect(edited.ship_to).toBeNull();
    expect(edited.customer_references).toBe('Referencia nueva');
    expect(edited.subtotal).toBe('102.60');
    expect((edited.lines as { unit: string | null }[])[0]?.unit).toBe('Botellas');

    const invalid = await call(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      customer_references: Array.from({ length: 11 }, (_, index) => `línea ${index}`).join('\n'),
      lines: [{ product_id: fx.product, quantity: '1' }],
    });
    expect(invalid.status).toBe(422);
    expect(JSON.stringify(invalid.body)).toContain('customer_references');
  });

  it('lleva dirección, referencias y unidad del presupuesto al pedido, al albarán y a la factura, con «Albarán: …»', async () => {
    const profile = await call(ctx, 'PUT', '/v1/legal-entities/PO/document-profile', {
      variant: 'cvpo',
      email: 'info@example.com',
      phone: '+34 000 000 000',
      footer_lines: ['Pie de página sintético de la sociedad'],
    });
    expect(profile.status).toBe(200);

    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      ship_to: SHIP_TO,
      customer_references: REFERENCES,
      lines: [{ product_id: fx.product, quantity: '12', discount_pct: '10', unit: 'Botellas' }],
    });
    const converted = await call(ctx, 'POST', `/v1/quotes/${String(quote.id)}/to-order`);
    expect(converted.status).toBe(201);
    const orderId = String(converted.body?.id);
    expect(converted.body?.ship_to).toEqual(SHIP_TO);
    expect(converted.body?.customer_references).toBe(REFERENCES);
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    const orderLines = confirmed.lines as { id: string; unit: string | null }[];
    expect(orderLines[0]?.unit).toBe('Botellas');

    const note = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: orderLines[0]?.id, quantity: '12', lot_id: fx.lot }],
    });
    expect(note.ship_to).toEqual(SHIP_TO);
    expect(note.customer_references).toBe(REFERENCES);
    expect((note.lines as { unit: string | null }[])[0]?.unit).toBe('Botellas');

    const patched = await json(ctx, 'PATCH', `/v1/delivery-notes/${String(note.id)}`, {
      customer_references: 'Pedido cliente 0002',
    });
    expect(patched.customer_references).toBe('Pedido cliente 0002');
    expect(patched.ship_to).toEqual(SHIP_TO);
    const issued = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
    expect(String(issued.number)).toMatch(/^A\d{2}-\d{4}$/);

    const albaran = await pdfText(`/v1/delivery-notes/${String(note.id)}/pdf`);
    expect(albaran).toContain(`ALBARÁN #${String(issued.number)}`);
    expect(albaran).toContain('Almacén Cliente Ejemplo');
    expect(albaran).toContain('Pedido cliente 0002');
    expect(albaran).toContain('Botellas');

    const draft = await json(ctx, 'POST', '/v1/invoices', { from_delivery_notes: [String(note.id)] });
    expect(draft.ship_to).toEqual(SHIP_TO);
    expect(draft.customer_references).toBe('Pedido cliente 0002');
    const draftLines = draft.lines as { unit: string | null; discount_pct: string; line_base: string }[];
    expect(draftLines[0]?.unit).toBe('Botellas');
    expect(draftLines[0]?.discount_pct).toBe('10.00');
    expect(draft.subtotal).toBe('102.60');
    expect(draft.total).toBe('124.15');

    const edited = await json(ctx, 'PATCH', `/v1/invoices/${String(draft.id)}`, {
      customer_references: 'Pedido cliente 0003\nSegunda línea',
      ship_to: { ...SHIP_TO, line2: 'Nave 2' },
    }, { 'If-Match': String(draft.updated_at) });
    expect(edited.customer_references).toBe('Pedido cliente 0003\nSegunda línea');
    expect((edited.ship_to as Record<string, string>).line2).toBe('Nave 2');
    expect(edited.subtotal).toBe('102.60');
    expect(edited.total).toBe('124.15');
    expect((edited.lines as { unit: string | null }[])[0]?.unit).toBe('Botellas');

    const emitted = await json(ctx, 'POST', `/v1/invoices/${String(draft.id)}/issue`, undefined, {
      'Idempotency-Key': 'emitir-paridad-0001',
    });
    const number = String(emitted.number);
    expect(number).toMatch(/^PF\d{2}-0001$/);

    const stored = await json(ctx, 'GET', `/v1/invoices/${String(draft.id)}`);
    expect(stored.ship_to).toEqual({ ...SHIP_TO, line2: 'Nave 2' });
    expect(stored.customer_references).toBe('Pedido cliente 0003\nSegunda línea');

    const text = await pdfText(`/v1/invoices/${String(draft.id)}/pdf`);
    expect(text).toContain(`FACTURA #${number}`);
    expect(text).toContain('Pie de página sintético de la sociedad');
    expect(text).toContain('Almacén Cliente Ejemplo');
    expect(text).toContain('Nave 2');
    expect(text).toContain('Pedido cliente 0003');
    expect(text).toContain('Segunda línea');
    expect(text).toMatch(new RegExp(`Albarán:\\n${String(issued.number)}`));
    expect(text).toContain('Botellas');
    expect(text).toContain('DESCUENTO POR ITEM');
  });

  it('crea el borrador de factura con dirección, referencias, unidad y descuento sin alterar los totales', async () => {
    const withoutFields = await json(ctx, 'POST', '/v1/invoices', {
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      lines: [{ product_id: fx.product, quantity: 10, lot_code: 'L25T01B1', discount_pct: '20' }],
    });
    const withFields = await json(ctx, 'POST', '/v1/invoices', {
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      ship_to: SHIP_TO,
      customer_references: 'Ref. sintética',
      lines: [{ product_id: fx.product, quantity: 10, lot_code: 'L25T01B1', discount_pct: '20', unit: 'Cajas' }],
    });
    expect(withFields.subtotal).toBe(withoutFields.subtotal);
    expect(withFields.tax_total).toBe(withoutFields.tax_total);
    expect(withFields.total).toBe(withoutFields.total);
    expect(withoutFields.ship_to).toBeNull();
    expect(withoutFields.customer_references).toBeNull();
    expect(withFields.ship_to).toEqual(SHIP_TO);
    expect((withFields.lines as { unit: string }[])[0]?.unit).toBe('Cajas');
    expect((withoutFields.lines as { unit: string }[])[0]?.unit).toBe('ud');

    const badShip = await call(ctx, 'POST', '/v1/invoices', {
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      ship_to: 'Calle Falsa 123',
      lines: [{ product_id: fx.product, quantity: 1 }],
    });
    expect(badShip.status).toBe(422);
    expect(JSON.stringify(badShip.body)).toContain('ship_to');
  });

  it('rechaza cambiar la dirección o las referencias de una factura ya emitida (WC080)', async () => {
    const issued = await ctx.writer.read<{ id: string; updated_at: string }>(sql`
      SELECT id, updated_at FROM billing.invoice WHERE status = 'issued' ORDER BY issued_at DESC LIMIT 1
    `);
    const target = issued[0];
    if (!target) throw new Error('sin factura emitida');
    const response = await ctx.app.handle(req('PATCH', `/v1/invoices/${String(target.id)}`, {
      customer_references: 'Cambio tardío',
    }, { 'If-Match': String(target.updated_at) }));
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe('WC080');
  });
});

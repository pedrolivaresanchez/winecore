import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createSeries } from '../../src/core/series';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, req, type SalesFixture } from './fixture';

const INTERNAL = 'Venta a tarifa distribuidor. Origen Almacén TFRP, condicionado a los traspasos en borrador. Sustituye el borrador anterior 01a1e629-3f4d-79eb-848b-445c7cec883e.';
const GIFT = 'Obsequio Pack Navidad 2026 (PACK-NAV-2026)';

const ctx = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
  const actor = { type: 'system' as const, id: 'customer-notes', requestId: 'customer-notes-series' };
  await ctx.writer.withWrite(actor, async (tx) => {
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
    code: 'FN',
    prefix: `FN${String(fx.year).slice(2)}-`,
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
  expect(response.status).toBe(200);
  return extractPdfText(new Uint8Array(await response.arrayBuffer()));
}

function customerPdf(text: string): void {
  expect(text).toContain(`Notas: ${GIFT}`);
  expect(text).not.toContain('tarifa distribuidor');
  expect(text).not.toContain('01a1e629');
  expect(text).not.toContain('Clase ');
  expect(text).not.toContain('Origen ');
  expect(text).not.toContain('Destino');
  expect(text).not.toContain('Sin lote');
  expect(text).not.toContain('LOTE: Sin lote');
  expect(text).not.toContain('Borrador');
  expect(text).not.toContain('BORRADOR');
  expect(text).not.toContain('PAGADO');
  expect(text).not.toContain('PENDIENTE');
}

describe('notas en los PDF de cliente', () => {
  it('el albarán emitido imprime el obsequio, no la nota interna, y la nota interna se puede corregir', async () => {
    const note = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      notes: INTERNAL,
      customer_note: GIFT,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    const id = String(note.id);
    expect(note.notes).toBe(INTERNAL);
    expect(note.customer_note).toBe(GIFT);
    const issued = await json(ctx, 'POST', `/v1/delivery-notes/${id}/issue`);
    expect(issued.number).toBeTruthy();
    customerPdf(await pdfText(`/v1/delivery-notes/${id}/pdf`));

    const cleaned = 'Nota interna corregida, sigue sin imprimirse';
    const patched = await json(ctx, 'PATCH', `/v1/delivery-notes/${id}`, { notes: cleaned });
    expect(patched.notes).toBe(cleaned);
    expect(patched.customer_note).toBe(GIFT);
    const again = await pdfText(`/v1/delivery-notes/${id}/pdf`);
    expect(again).toContain(`Notas: ${GIFT}`);
    expect(again).not.toContain(cleaned);
    expect(again).not.toContain('tarifa distribuidor');

    const lockedNote = await call(ctx, 'PATCH', `/v1/delivery-notes/${id}`, { customer_note: 'Otro obsequio' });
    expect(lockedNote.status).toBe(409);
    expect(lockedNote.body?.code).toBe('WC060');
    const lockedLines = await call(ctx, 'PATCH', `/v1/delivery-notes/${id}`, {
      lines: [{ product_id: fx.product, quantity: '2', lot_id: fx.lot }],
    });
    expect(lockedLines.status).toBe(409);
    expect(lockedLines.body?.code).toBe('WC060');
  });

  it('el presupuesto imprime la nota del cliente y, una vez enviado, solo admite la nota interna', async () => {
    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      legal_entity_id: fx.po,
      notes: INTERNAL,
      customer_note: GIFT,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    const id = String(quote.id);
    const draftPdf = await pdfText(`/v1/quotes/${id}/pdf`);
    expect(draftPdf).toContain(`Notas: ${GIFT}`);
    expect(draftPdf).toContain('Borrador');
    expect(draftPdf).not.toContain('tarifa distribuidor');
    await json(ctx, 'POST', `/v1/quotes/${id}/send`);
    const sent = await pdfText(`/v1/quotes/${id}/pdf`);
    customerPdf(sent);
    expect(sent).toContain('PRESUPUESTO #');

    const patched = await json(ctx, 'PATCH', `/v1/quotes/${id}`, { notes: 'Nota interna del presupuesto' });
    expect(patched.notes).toBe('Nota interna del presupuesto');
    expect(patched.customer_note).toBe(GIFT);
    const kept = await pdfText(`/v1/quotes/${id}/pdf`);
    expect(kept).toContain(`Notas: ${GIFT}`);
    expect(kept).not.toContain('Nota interna del presupuesto');

    const denied = await call(ctx, 'PATCH', `/v1/quotes/${id}`, { customer_note: 'Otro texto' });
    expect(denied.status).toBe(422);
  });

  it('la factura emitida imprime la nota del cliente y deja corregir la nota interna', async () => {
    const draft = await json(ctx, 'POST', '/v1/invoices', {
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      invoice_type: 'F1',
      notes: INTERNAL,
      customer_note: GIFT,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot }],
    });
    const id = String(draft.id);
    expect(draft.notes).toBe(INTERNAL);
    expect(draft.customer_note).toBe(GIFT);
    const issued = await json(ctx, 'POST', `/v1/invoices/${id}/issue`, undefined, { 'Idempotency-Key': `emitir-notas-${id}` });
    expect(issued.number).toMatch(/^FN/);
    const text = await pdfText(`/v1/invoices/${id}/pdf`);
    customerPdf(text);
    expect(text).toContain('FACTURA #');
    expect(text).toMatch(/21%/);

    const current = await json(ctx, 'GET', `/v1/invoices/${id}`);
    const patched = await json(ctx, 'PATCH', `/v1/invoices/${id}`, { notes: 'Nota interna de la factura' }, {
      'If-Match': String(current.updated_at),
    });
    expect(patched.notes).toBe('Nota interna de la factura');
    expect(patched.customer_note).toBe(GIFT);
    const stored = await pdfText(`/v1/invoices/${id}/pdf`);
    expect(stored).toContain(`Notas: ${GIFT}`);
    expect(stored).not.toContain('tarifa distribuidor');
    expect(stored).not.toContain('Nota interna de la factura');

    const denied = await call(ctx, 'PATCH', `/v1/invoices/${id}`, { customer_note: 'Otro obsequio' }, {
      'If-Match': String(patched.updated_at),
    });
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC080');
  });
});

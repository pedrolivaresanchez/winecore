import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createTestApp } from '../helpers';
import { buildSalesFixture, type SalesFixture } from '../sales/fixture';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

const t: TestApp = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(t);
});

afterAll(async () => {
  await t.close();
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await t.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, json: text.trim() === '' ? null : JSON.parse(text) as unknown };
}

async function tool(name: string, args: unknown) {
  const response = await post('/m2m/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const body = response.json as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const block = body.result?.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Data : {};
  return { error: body.result?.isError === true, data };
}

/** Prepare and commit, failing loudly with the API's answer when either step is refused. */
async function write(name: string, args: unknown) {
  const prepared = await tool(`${name}_prepare`, args);
  expect(prepared.error ? JSON.stringify(prepared.data) : 'ok').toBe('ok');
  const committed = await tool(`${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? JSON.stringify(committed.data) : 'ok').toBe('ok');
  return { prepared: prepared.data, committed: committed.data };
}

async function rest(path: string): Promise<Data> {
  const response = await t.app.handle(new Request(`http://localhost${path}`));
  expect(response.status).toBe(200);
  return await response.json() as Data;
}

function webOf(data: Data): string {
  return String((data.links as { web?: string } | undefined)?.web ?? '');
}

describe('MCP de ventas sobre las rutas de la app', () => {
  test('presupuesto: crear, editar, PDF, marcar enviado y convertir en pedido', async () => {
    const created = await write('sales_quote_create', {
      customer_id: fx.customer,
      channel: 'horeca',
      notes: 'Bodegas Sintéticas: oferta de prueba',
      lines: [{ product_id: fx.product, quantity: '12' }],
    });
    expect((created.prepared.preview as { route: string }).route).toBe('POST /v1/quotes');
    const quoteId = String(created.committed.id);
    expect(created.committed.status).toBe('draft');
    expect(webOf(created.committed).endsWith(`/ventas/presupuestos/${quoteId}`)).toBe(true);

    const stored = await rest(`/v1/quotes/${quoteId}`);
    expect(stored.customer_id).toBe(fx.customer);
    expect(stored.total).toBe('137.94');

    const list = await tool('sales_quotes_list', { limit: 50 });
    expect(list.error).toBe(false);
    expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(quoteId);

    const edited = await write('sales_quote_update', {
      id: quoteId,
      changes: { valid_until: '2027-01-31', notes: 'Bodegas Sintéticas: precio para 24', lines: [{ product_id: fx.product, quantity: '24' }] },
    });
    expect((edited.prepared.preview as { record: { status: string } }).record.status).toBe('draft');
    const afterEdit = await rest(`/v1/quotes/${quoteId}`);
    expect(afterEdit.valid_until).toBe('2027-01-31');
    expect((afterEdit.lines as { unit_price: string }[])[0]?.unit_price).toBe('9.000000');

    const pdf = await tool('sales_quote_pdf_get', { id: quoteId });
    expect(pdf.error).toBe(false);
    expect(pdf.data.content_type).toBe('application/pdf');
    expect(Buffer.from(String(pdf.data.base64), 'base64').subarray(0, 4).toString()).toBe('%PDF');

    const sent = await write('sales_quote_mark_sent', { id: quoteId });
    expect(String(sent.prepared.summary_es)).toContain('No se envía ningún correo');
    expect(sent.committed.status).toBe('sent');
    expect(sent.committed.number).toBeTruthy();

    const converted = await write('sales_quote_convert', { id: quoteId });
    expect(String(converted.prepared.summary_es)).toContain(String(sent.committed.number));
    const orderId = String(converted.committed.id);
    expect(converted.committed.status).toBe('draft');
    expect(converted.committed.quote_id).toBe(quoteId);
    expect(webOf(converted.committed).endsWith(`/ventas/pedidos/${orderId}`)).toBe(true);
    expect((await rest(`/v1/quotes/${quoteId}`)).status).toBe('converted');

    const again = await tool('sales_quote_convert_prepare', { id: quoteId });
    expect(again.error).toBe(false);
    const refused = await tool('sales_quote_convert_commit', { confirmation_token: again.data.confirmation_token });
    expect(refused.error).toBe(true);
    expect(refused.data.code).toBe('WC_VALIDATION');
  });

  test('pedido: editar conservando líneas, confirmar, servir con albarán, emitir y ver lo pendiente de facturar', async () => {
    const order = await write('sales_order_create', {
      customer_id: fx.customer,
      channel: 'horeca',
      customer_order_ref: 'SINT-0001',
      customer_references: 'Pedido cliente 0001\nDepartamento de compras',
      lines: [{ product_id: fx.product, quantity: '6', description: 'Tinto sintético de prueba', unit: 'botella' }],
    });
    const orderId = String(order.committed.id);
    expect((await rest(`/v1/sales-orders/${orderId}`)).customer_order_ref).toBe('SINT-0001');

    await write('sales_order_update', { id: orderId, changes: { ship_to: { country_code: 'ES' }, requested_date: '2027-01-15' } });
    const kept = await write('sales_order_update', { id: orderId, changes: { notes: 'Bodegas Sintéticas: entregar por la mañana' } });
    expect((kept.prepared.preview as { changes: { lines: unknown[] } }).changes.lines).toHaveLength(1);
    const edited = await rest(`/v1/sales-orders/${orderId}`);
    expect(edited.customer_order_ref).toBe('SINT-0001');
    expect(edited.requested_date).toBe('2027-01-15');
    expect(edited.notes).toBe('Bodegas Sintéticas: entregar por la mañana');
    expect(JSON.stringify(edited.ship_to)).toContain('ES');
    expect(edited.customer_references).toBe('Pedido cliente 0001\nDepartamento de compras');
    const lines = edited.lines as { id: string; quantity: string; description: string; unit: string | null }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe('6.000');
    expect(lines[0]?.description).toBe('Tinto sintético de prueba');
    expect(lines[0]?.unit).toBe('botella');

    const orderPdf = await tool('sales_order_pdf_get', { id: orderId });
    expect(orderPdf.error ? JSON.stringify(orderPdf.data) : 'ok').toBe('ok');
    expect(orderPdf.data.content_type).toBe('application/pdf');
    expect(Buffer.from(String(orderPdf.data.base64), 'base64').subarray(0, 4).toString()).toBe('%PDF');

    const confirmed = await write('sales_order_confirm', { id: orderId });
    expect(String(confirmed.prepared.summary_es)).toContain('ya no se podrá editar');
    expect(confirmed.committed.status).toBe('confirmed');
    expect(confirmed.committed.legal_entity_id).toBe(fx.po);

    const listed = await tool('sales_orders_list', { status: 'confirmed', customer_id: fx.customer });
    expect((listed.data.items as { id: string }[]).map((item) => item.id)).toContain(orderId);

    const note = await write('sales_order_delivery_note_create', {
      id: orderId,
      from_location_id: fx.bod,
      lines: [{ order_line_id: lines[0]?.id, quantity: '6', lot_id: fx.lot }],
    });
    const noteId = String(note.committed.id);
    expect(note.committed.sales_order_id).toBe(orderId);
    expect(webOf(note.committed).endsWith(`/ventas/albaranes/${noteId}`)).toBe(true);

    const issued = await write('sales_delivery_note_issue', { id: noteId });
    expect(String(issued.prepared.summary_es)).toContain('se mueve el stock');
    expect(issued.committed.status).toBe('issued');
    expect((await rest(`/v1/delivery-notes/${noteId}`)).number).toBeTruthy();
    expect((await rest(`/v1/sales-orders/${orderId}`)).status).toBe('delivered');

    const pending = await tool('sales_delivery_notes_uninvoiced_lines_list', {});
    expect((pending.data.items as { delivery_note_id: string }[]).map((item) => item.delivery_note_id)).toContain(noteId);

    const pdf = await tool('sales_delivery_note_pdf_get', { id: noteId });
    expect(pdf.data.content_type).toBe('application/pdf');

    const notes = await tool('sales_delivery_notes_list', { customer_id: fx.customer, status: 'issued', entity: 'PO' });
    expect((notes.data.items as { id: string }[]).map((item) => item.id)).toContain(noteId);
  });

  test('cancelar un pedido avisa de que es irreversible y no confirma sobre una vista previa caducada', async () => {
    const stale = await write('sales_order_create', {
      customer_id: fx.customer,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '2' }],
    });
    const staleId = String(stale.committed.id);
    const prepared = await tool('sales_order_cancel_prepare', { id: staleId, reason: 'Cliente sintético anula la compra' });
    expect(String(prepared.data.summary_es)).toContain('irreversible');
    await post(`/v1/sales-orders/${staleId}/confirm`, {});
    const refused = await tool('sales_order_cancel_commit', { confirmation_token: prepared.data.confirmation_token });
    expect(refused.error).toBe(true);
    expect(refused.data.code).toBe('WC_MCP_PREVIEW_STALE');
    expect((await rest(`/v1/sales-orders/${staleId}`)).status).toBe('confirmed');

    const cancelled = await write('sales_order_cancel', { id: staleId, reason: 'Cliente sintético anula la compra' });
    expect(cancelled.committed.status).toBe('cancelled');
    expect((await rest(`/v1/sales-orders/${staleId}`)).status).toBe('cancelled');

    const invalid = await tool('sales_order_cancel_prepare', { id: staleId, reason: 'no' });
    expect(invalid.error).toBe(true);
    expect(invalid.data.code).toBe('WC_VALIDATION');
  });

  test('lecturas de catálogo, documentos y reglas; requisitos de exportación', async () => {
    const catalog = await tool('sales_catalog_get', { customer_id: fx.customer });
    expect(catalog.error).toBe(false);
    expect((catalog.data.products as { id: string }[]).map((item) => item.id)).toContain(fx.product);

    const documents = await tool('sales_documents_list', { kind: 'quote', origin: ['winecore'], sort: 'date', dir: 'desc' });
    expect(documents.error ? JSON.stringify(documents.data) : 'ok').toBe('ok');
    expect(documents.data.kind).toBe('quote');

    const state = await tool('sales_billing_rules_state_get', {});
    expect(state.data.state).toBe('active');
    const resolved = await tool('sales_billing_rules_resolve', { customer_id: fx.customer, channel: 'direct' });
    expect(resolved.data.entity_id).toBe(fx.po);
    expect(resolved.data.matched_scope).toBe('customer');

    const before = await tool('sales_export_country_documents_get', {});
    expect(before.error).toBe(false);
    expect(Object.keys((before.data.value as { countries: Record<string, unknown> }).countries)).toEqual(['GB']);
    await write('sales_export_country_documents_update', {
      countries: {
        CH: {
          example: false,
          confirmed: true,
          required_fields: ['incoterm', 'nc_code'],
          documents: [{ code: 'commercial_invoice', name_es: 'Factura comercial', name_en: 'Commercial invoice' }],
          notes: 'Requisitos sintéticos de prueba',
        },
      },
    });
    const stored = await rest('/v1/export/documents-by-country');
    const countries = (stored.value as { countries: Record<string, unknown> }).countries;
    expect(Object.keys(countries).sort()).toEqual(['CH', 'GB']);

    const second = await write('sales_export_country_documents_update', { remove_countries: ['gb'] });
    expect(Object.keys((second.committed.value as { countries: Record<string, unknown> }).countries)).toEqual(['CH']);

    const readiness = await tool('sales_export_readiness_check', {
      destination_country: 'CH',
      entity: { legal_name: 'Bodegas Sintéticas SL', country_code: 'ES' },
      customer: { legal_name: 'Importadora Sintética AG', country_code: 'CH' },
      lines: [{ line_no: 1, description: 'Tinto sintético', kind: 'wine', quantity: '12', unit_price: '9.5' }],
    });
    expect(readiness.error).toBe(false);
    expect(readiness.data.ready).toBe(false);
    expect((readiness.data.missing as string[]).length).toBeGreaterThan(0);
  });
});

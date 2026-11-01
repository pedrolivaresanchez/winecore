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

describe('MCP de facturación sobre las rutas de la app', () => {
  test('factura: borrador, edición, emisión, PDF, marcar enviada y rectificativa', async () => {
    await write('contacts_address_add', {
      id: fx.customer,
      address: { kind: 'both', line1: 'Calle Ejemplo 1', postal_code: '46300', city: 'Utiel', country_code: 'ES', is_default: true },
    });
    await write('contacts_person_add', { id: fx.customer, person: { full_name: 'Persona Ejemplo', email: 'cliente@example.com', receives_invoices: true, receives_dunning: false } });
    const created = await write('billing_invoice_create', {
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, lot_id: fx.lot, quantity: '6', unit_price: '10' }],
    });
    expect((created.prepared.preview as { route: string }).route).toBe('POST /v1/invoices');
    const invoiceId = String(created.committed.id);
    expect(created.committed.status).toBe('draft');
    expect(webOf(created.committed).endsWith(`/facturas/${invoiceId}`)).toBe(true);

    const edited = await write('billing_invoice_update', {
      id: invoiceId,
      changes: { notes: 'Pedido de prueba', lines: [{ product_id: fx.product, lot_id: fx.lot, quantity: '12', unit_price: '10' }] },
    });
    expect(edited.committed.notes).toBe('Pedido de prueba');
    const stored = await rest(`/v1/invoices/${invoiceId}`);
    expect(stored.notes).toBe('Pedido de prueba');

    const checked = await tool('billing_invoice_validate', { id: invoiceId });
    expect(checked.error).toBe(false);

    const list = await tool('billing_invoices_list', { customer_id: fx.customer, status: 'draft' });
    expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(invoiceId);

    const opened = await write('billing_series_open', { legal_entity_id: fx.po, doc_type: 'invoice', year: fx.year, choice: 'fresh' });
    expect(opened.committed).toBeTruthy();

    const issued = await write('billing_invoice_issue', { id: invoiceId });
    expect(issued.committed.status).toBe('issued');
    const number = String(issued.committed.number);
    expect(number.length).toBeGreaterThan(2);

    const got = await tool('billing_invoice_get', { id: invoiceId });
    expect(got.data.number).toBe(number);

    const pdf = await tool('billing_invoice_pdf_download', { id: invoiceId });
    expect(pdf.error ? JSON.stringify(pdf.data) : 'ok').toBe('ok');
    expect(JSON.stringify(pdf.data)).toContain('pdf');

    const pending = await tool('billing_invoice_deliveries_pending_list', {});
    expect(pending.error).toBe(false);
    const pack = await tool('billing_invoice_delivery_package_get', { id: invoiceId });
    expect(pack.error).toBe(false);
    const sent = await write('billing_invoice_delivery_record_sent', {
      id: invoiceId,
      attempt: Number(pack.data.attempt ?? 1),
      message_id: 'mensaje-de-prueba-1',
      sent_at: new Date().toISOString(),
      recipients: ['cliente@example.com'],
    });
    expect(sent.committed).toBeTruthy();
    const resent = await write('billing_invoice_delivery_resend', { id: invoiceId });
    expect(resent.committed).toBeTruthy();
    const history = await tool('billing_invoice_deliveries_list', { id: invoiceId });
    expect(history.error).toBe(false);

    const voidAsk = await tool('billing_invoice_void_prepare', { id: invoiceId, reason_code: 'duplicate' });
    expect(voidAsk.error ? JSON.stringify(voidAsk.data) : 'ok').toBe('ok');

    const rect = await write('billing_invoice_create', {
      invoice_type: 'R1',
      rectification_kind: 'I',
      rectifies: [{ invoice_id: invoiceId }],
      reason: 'Error en el precio',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, lot_id: fx.lot, quantity: '-1', unit_price: '10' }],
    });
    expect(rect.committed.status).toBe('draft');
    const discarded = await write('billing_invoice_discard', { id: String(rect.committed.id), reason: 'Prueba' });
    expect(discarded.committed).toBeTruthy();
  });

  test('un borrador cambiado entre la vista previa y la confirmación se rechaza', async () => {
    const created = await write('billing_invoice_create', {
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, lot_id: fx.lot, quantity: '1', unit_price: '10' }],
    });
    const invoiceId = String(created.committed.id);
    const prepared = await tool('billing_invoice_discard_prepare', { id: invoiceId });
    expect(prepared.error).toBe(false);
    await write('billing_invoice_update', { id: invoiceId, changes: { notes: 'Cambio intermedio' } });
    const committed = await tool('billing_invoice_discard_commit', { confirmation_token: prepared.data.confirmation_token });
    expect(committed.error).toBe(true);
    expect(JSON.stringify(committed.data)).toContain('WC_MCP_PREVIEW_STALE');
    const stored = await rest(`/v1/invoices/${invoiceId}`);
    expect(stored.status).toBe('draft');
  });

  test('series, sociedades e histórico', async () => {
    const series = await tool('billing_series_list', { legal_entity_id: fx.po, doc_type: 'invoice' });
    expect(series.error).toBe(false);
    const items = series.data.items as { id: string }[] | undefined ?? [];
    expect(Array.isArray(items)).toBe(true);
    const proposal = await tool('billing_series_proposal_get', { legal_entity_id: fx.po, doc_type: 'invoice', year: fx.year });
    expect(proposal.error).toBe(false);

    const entities = await tool('billing_legal_entities_list', {});
    expect(entities.error).toBe(false);
    const updated = await write('billing_legal_entities_update', { code: 'PO', changes: { city: 'Utiel' } });
    expect(updated.committed).toBeTruthy();

    const created = await write('billing_series_create', { legal_entity_id: fx.po, doc_type: 'delivery_note', code: 'QX', prefix: `QX${fx.year % 100}-`, year: fx.year + 5 });
    expect(created.committed).toBeTruthy();

    for (const name of ['billing_legacy_overview_get', 'billing_legacy_invoices_list', 'billing_legacy_documents_list', 'billing_legacy_products_list']) {
      const result = await tool(name, {});
      expect(result.error ? `${name}: ${JSON.stringify(result.data)}` : 'ok').toBe('ok');
    }
  });

  test('membrete de la sociedad: datos, logotipo y PDF de muestra', async () => {
    const empty = await tool('billing_legal_entities_document_profile_get', { code: 'po' });
    expect(empty.error ? JSON.stringify(empty.data) : 'ok').toBe('ok');
    expect(empty.data.logo).toBeNull();

    const updated = await write('billing_legal_entities_document_profile_update', {
      code: 'PO',
      changes: { variant: 'cvpo', email: 'bodega@example.com', footer_lines: ['Línea de pie de ejemplo'] },
    });
    expect((updated.prepared.preview as { route: string }).route).toBe('PUT /v1/legal-entities/PO/document-profile');
    expect(updated.committed).toMatchObject({ variant: 'cvpo', email: 'bodega@example.com', footer_lines: ['Línea de pie de ejemplo'] });
    const stored = await rest('/v1/legal-entities/PO/document-profile');
    expect(stored.variant).toBe('cvpo');

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const uploaded = await write('billing_legal_entities_document_logo_upload', {
      code: 'PO', file_base64: png, filename: 'logo-ejemplo.png', content_type: 'image/png',
    });
    expect(uploaded.committed.logo).toMatchObject({ filename: 'logo-ejemplo.png', mime_type: 'image/png' });
    const logo = await tool('billing_legal_entities_document_logo_get', { code: 'PO' });
    expect(logo.error ? JSON.stringify(logo.data) : 'ok').toBe('ok');
    expect(logo.data).toMatchObject({ content_type: 'image/png', base64: png });

    const sample = await tool('billing_legal_entities_document_sample_pdf', { code: 'PO', kind: 'order', website: 'https://example.com' });
    expect(sample.error ? JSON.stringify(sample.data) : 'ok').toBe('ok');
    expect(sample.data.content_type).toBe('application/pdf');
    expect((await rest('/v1/legal-entities/PO/document-profile')).website).toBeNull();

    const removed = await write('billing_legal_entities_document_logo_remove', { code: 'PO' });
    expect(removed.committed.logo).toBeNull();
    expect((await rest('/v1/legal-entities/PO/document-profile')).logo).toBeNull();
  });
});

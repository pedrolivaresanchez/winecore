import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { call, type TestApp } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

type Data = Record<string, unknown>;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ mcpRatePerMinute: 1000 });
});

afterAll(async () => {
  await t.close();
});

async function tool(name: string, args: unknown): Promise<{ error: boolean; data: Data }> {
  const response = await t.app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = await response.json() as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  if (!body.result) throw new Error(`${name}: ${response.status} ${JSON.stringify(body)}`);
  const block = body.result.content?.[0];
  return { error: body.result.isError === true, data: block?.type === 'text' ? JSON.parse(block.text) as Data : {} };
}

async function read(name: string, args: unknown): Promise<Data> {
  const result = await tool(name, args);
  expect(result.error ? `${name}: ${JSON.stringify(result.data)}` : 'ok').toBe('ok');
  return result.data;
}

async function write(name: string, args: unknown): Promise<{ prepared: Data; result: Data }> {
  const prepared = await tool(`${name}_prepare`, args);
  expect(prepared.error ? `${name}: ${JSON.stringify(prepared.data)}` : 'ok').toBe('ok');
  expect(String(prepared.data.summary_es).length).toBeGreaterThan(10);
  expect(prepared.data.confirmation_token).toBeString();
  const committed = await tool(`${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? `${name}: ${JSON.stringify(committed.data)}` : 'ok').toBe('ok');
  return { prepared: prepared.data, result: committed.data };
}

describe('MCP · agenda de ideas', () => {
  test('alta, edición, listado, archivo y petición de calendario sin llamar a Outlook', async () => {
    const contactResponse = await t.app.handle(new Request('http://localhost/v1/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'agenda-contacto-0001' },
      body: JSON.stringify({
        kind: 'company',
        legal_name: 'Distribuidor Agenda Sintética SL',
        tax_id: 'B11111119',
        country_code: 'ES',
        language: 'es',
        is_customer: true,
        is_supplier: false,
        is_carrier: false,
        is_logistics_operator: false,
        vat_regime: 'general',
        payment_terms_days: 30,
      }),
    }));
    const contactBody = await contactResponse.json() as Record<string, unknown>;
    const contact = { status: contactResponse.status, body: contactBody };
    expect(contact.status).toBe(201);
    const contactId = String(contact.body.id);

    const created = await write('agenda_idea_create', {
      title: 'Llamar al distribuidor',
      note: 'Repasar el pedido de la feria',
      kind: 'appointment',
      scheduled_at: '2026-11-12T10:30:00+01:00',
      contact_id: contactId,
      source: 'voice',
    });
    expect(String(created.prepared.summary_es)).toContain('Llamar al distribuidor');
    expect(String(created.prepared.summary_es)).toContain('¿Confirmas?');
    const ideaId = String(created.result.id);
    expect(created.result.status).toBe('idea');
    expect(created.result.kind).toBe('appointment');
    expect(created.result.contact_id).toBe(contactId);
    expect(created.result.calendar_export_requested_at).toBeNull();
    expect(created.result.calendar_external_id).toBeNull();

    const listed = await read('agenda_idea_list', { q: 'distribuidor', contact_id: contactId });
    expect((listed.items as { id: string }[]).map((item) => item.id)).toContain(ideaId);

    const planned = await write('agenda_idea_update', {
      id: ideaId,
      changes: { status: 'planned', note: 'Confirmar hora antes de llamar' },
    });
    expect(planned.result.status).toBe('planned');
    expect(planned.result.note).toBe('Confirmar hora antes de llamar');
    expect(String(planned.prepared.summary_es)).toContain('status');

    const exported = await write('agenda_idea_calendar_export', { id: ideaId });
    expect(String(exported.prepared.summary_es)).toContain('No se llama a Outlook');
    const sync = exported.result.calendar_sync as Data;
    expect(sync.status).toBe('pending_connector');
    expect(sync.provider).toBe('outlook');
    expect(sync.external_id).toBeNull();
    expect(String(sync.message_es)).toContain('No se ha creado ningún evento');
    expect(exported.result.calendar_exported_at).toBeNull();
    expect(exported.result.calendar_external_id).toBeNull();
    expect(exported.result.calendar_export_requested_at).toBeString();

    const again = await write('agenda_idea_calendar_export', { id: ideaId });
    expect((again.result.calendar_sync as Data).status).toBe('pending_connector');
    expect(again.result.calendar_export_requested_at).toBe(exported.result.calendar_export_requested_at);

    const process = await write('agenda_idea_create', { title: 'Revisar existencias de cápsulas', kind: 'process' });
    const refused = await tool('agenda_idea_calendar_export_prepare', { id: String(process.result.id) });
    expect(refused.error).toBe(true);
    expect(JSON.stringify(refused.data)).toContain('WC_VALIDATION');

    const missing = await tool('agenda_idea_create_prepare', {
      title: 'Idea con factura inventada',
      invoice_id: '00000000-0000-4000-8000-000000000099',
    });
    expect(missing.error).toBe(false);
    const missingCommit = await tool('agenda_idea_create_commit', { confirmation_token: missing.data.confirmation_token });
    expect(missingCommit.error).toBe(true);
    expect(JSON.stringify(missingCommit.data)).toContain('factura');

    const stale = await tool('agenda_idea_update_prepare', { id: ideaId, changes: { title: 'Llamar mañana' } });
    expect(stale.error).toBe(false);
    const other = await call(t, 'PATCH', `/v1/agenda/ideas/${ideaId}`, { status: 'done' });
    expect(other.status).toBe(200);
    const late = await tool('agenda_idea_update_commit', { confirmation_token: stale.data.confirmation_token });
    expect(late.error).toBe(true);
    expect(JSON.stringify(late.data)).toContain('WC_MCP_PREVIEW_STALE');

    const archived = await write('agenda_idea_delete', { id: ideaId });
    expect(String(archived.prepared.summary_es)).toContain('Archivar');
    expect(archived.result.archived_at).toBeString();
    const visible = await read('agenda_idea_list', { q: 'Llamar' });
    expect((visible.items as { id: string }[]).map((item) => item.id)).not.toContain(ideaId);
    const hidden = await read('agenda_idea_list', { q: 'Llamar', include_archived: 'true' });
    expect((hidden.items as { id: string }[]).map((item) => item.id)).toContain(ideaId);
    const got = await read('agenda_idea_get', { id: ideaId });
    expect(got.status).toBe('done');
    expect(got.calendar_exported_at).toBeNull();
  });
});

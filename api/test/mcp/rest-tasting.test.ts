import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { call, seedWorld, type TastingWorld } from '../tasting/fixture';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

let t: TestApp;
let world: TastingWorld;

beforeAll(async () => {
  t = await createTestApp({ mcpRatePerMinute: 1000 });
  world = await seedWorld(t);
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

async function write(name: string, args: unknown): Promise<Data> {
  const prepared = await tool(`${name}_prepare`, args);
  expect(prepared.error ? `${name}: ${JSON.stringify(prepared.data)}` : 'ok').toBe('ok');
  const committed = await tool(`${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? `${name}: ${JSON.stringify(committed.data)}` : 'ok').toBe('ok');
  return committed.data;
}

describe('MCP · catas', () => {
  test('cata a ciegas: crear, muestras, votos, destapar, selección y borrar', async () => {
    const session = await write('tasting_session_create', { title: 'Cata sintética', target: 'Coupage sintético', started_on: '2026-10-01', days: 2 });
    const sessionId = String(session.id);
    expect(session.status).toBe('open');
    await write('tasting_session_sample_add', { id: sessionId, lot_id: world.lotA2026, vessel_id: world.vesselA });
    await write('tasting_session_sample_add', { id: sessionId, lot_id: world.lotB2026 });
    const duplicated = await tool('tasting_session_sample_add_prepare', { id: sessionId, lot_id: world.lotB2026 });
    const refused = await tool('tasting_session_sample_add_commit', { confirmation_token: duplicated.data.confirmation_token });
    expect(refused.error).toBe(true);

    const blind = await read('tasting_session_get', { id: sessionId });
    expect(JSON.stringify(blind.samples)).not.toContain('REFA2026');
    expect(((await read('tasting_sessions_list', { status: 'open' })).items as unknown[]).length).toBe(1);

    for (const [sample, vote, scoreValue] of [[1, 'yes', 80], [2, 'no', 40]] as const) {
      const cast = await write('tasting_vote_cast', { session_id: sessionId, sample_no: sample, day_no: 1, vote, score: scoreValue });
      expect(cast.vote).toBe(vote);
    }
    const hidden = await tool('tasting_session_selection_get', { id: sessionId });
    expect(hidden.error).toBe(true);

    const revealed = await write('tasting_session_reveal', { id: sessionId });
    expect(revealed.status).toBe('revealed');
    const selection = await read('tasting_session_selection_get', { id: sessionId });
    expect(Array.isArray(selection.lots)).toBe(true);
    const chosen = await write('tasting_session_selection_update', { id: sessionId, lot_ids: [world.lotA2026] });
    expect((chosen.lots as { lot_code: string }[]).map((item) => item.lot_code)).toEqual(['REFA2026']);

    const started = await tool('tasting_session_delete_prepare', { id: sessionId });
    expect(started.error).toBe(false);
    const refusedDelete = await tool('tasting_session_delete_commit', { confirmation_token: started.data.confirmation_token });
    expect(refusedDelete.error).toBe(true);
    expect(JSON.stringify(refusedDelete.data)).toContain('WC_TASTING_CLOSED');

    const empty = await write('tasting_session_create', { title: 'Cata vacía', target: 'Prueba', started_on: '2026-10-02', days: 3 });
    const deleted = await write('tasting_session_delete', { id: empty.id });
    expect(deleted.deleted).toBe(true);
    expect(((await read('tasting_sessions_list', {})).items as unknown[]).length).toBe(1);
  });

  test('plantillas y campos', async () => {
    const listed = await read('tasting_templates_list', { subject: 'wine_aging' });
    expect((listed.items as { code: string }[]).map((item) => item.code)).toContain('CRIANZA');
    const created = await write('tasting_template_create', {
      code: 'PRUEBA-SINT', name: 'Ficha sintética', subject: 'wine_aging', score_scale: '0-10',
      fields: [{ field_key: 'fruta', label: 'Fruta', kind: 'scale', position: 1, min_value: 1, max_value: 5 }],
    });
    const templateId = String(created.id);
    expect((created.fields as unknown[]).length).toBe(1);
    const renamed = await write('tasting_template_update', { id: templateId, changes: { name: 'Ficha sintética 2' } });
    expect(renamed.name).toBe('Ficha sintética 2');
    const withField = await write('tasting_template_field_add', { id: templateId, field_key: 'madera', label: 'Madera', kind: 'scale', position: 2, min_value: 1, max_value: 5 });
    const fields = withField.fields as { id: string; field_key: string }[];
    expect(fields.map((field) => field.field_key)).toEqual(['fruta', 'madera']);
    const fieldId = String(fields.find((field) => field.field_key === 'madera')?.id);
    const edited = await write('tasting_template_field_update', { id: templateId, field_id: fieldId, changes: { label: 'Madera y tostado', required: true } });
    expect((edited.fields as { label: string }[]).map((field) => field.label)).toContain('Madera y tostado');
    const got = await read('tasting_template_get', { id: templateId });
    expect(got.code).toBe('PRUEBA-SINT');

    const stale = await tool('tasting_template_update_prepare', { id: templateId, changes: { name: 'Ficha sintética 3' } });
    expect(stale.error).toBe(false);
    const other = await call(t, 'PATCH', `/v1/tasting-templates/${templateId}`, { is_active: false });
    expect(other.status).toBe(200);
    const late = await tool('tasting_template_update_commit', { confirmation_token: stale.data.confirmation_token });
    expect(late.error).toBe(true);
    expect(JSON.stringify(late.data)).toContain('WC_MCP_PREVIEW_STALE');
  });

  test('descriptores', async () => {
    const created = await write('tasting_descriptor_create', { code: 'fruta_sint', name_es: 'Fruta sintética', family: 'nose' });
    expect(created.is_active).toBe(true);
    const updated = await write('tasting_descriptor_update', { code: 'fruta_sint', changes: { name_es: 'Fruta sintética roja' } });
    expect(updated.name_es).toBe('Fruta sintética roja');
    const listed = await read('tasting_descriptors_list', {});
    expect((listed.items as { code: string }[]).map((item) => item.code)).toContain('fruta_sint');
  });

  test('notas de cata, evolución y comparación de añadas', async () => {
    const note = await write('tasting_note_create', {
      template_code: 'CRIANZA', tasted_at: '2026-03-02T11:00:00Z', taster_name: 'Catador Sintético', lot_id: world.lotA2026,
      overall_score: 8, defects: ['reduction'], decision: 'Seguir en depósito', values: { fruit: 4, oak: 2 }, source: 'chat',
    });
    const noteId = String(note.id);
    expect(note.overall_score).toBe(8);
    const edited = await write('tasting_note_update', { id: noteId, changes: { notes: 'Más fruta que madera', overall_score: 7 } });
    expect(edited.notes).toBe('Más fruta que madera');
    expect((await read('tasting_note_get', { id: noteId })).overall_score).toBe(7);
    const listed = await read('tasting_notes_list', { lot_id: world.lotA2026, template_code: 'CRIANZA' });
    expect((listed.items as { id: string }[]).map((item) => item.id)).toEqual([noteId]);

    const evolution = await read('tasting_evolution_get', { lot_code: 'REFA2026' });
    expect((evolution.points as unknown[]).length).toBeGreaterThan(0);
    const both = await tool('tasting_evolution_get', { lot_code: 'REFA2026', wine_code: 'REFA' });
    expect(both.error).toBe(true);

    const comparison = await read('tasting_vintage_comparison_get', { vintage_from: 2024, vintage_to: 2026 });
    expect(comparison).toHaveProperty('by_wine');
    const csv = await read('tasting_vintage_comparison_csv_get', { vintage_from: 2024, vintage_to: 2026 });
    expect(String(csv.content_type)).toContain('csv');
    expect(typeof csv.text).toBe('string');

    const removal = await tool('tasting_note_delete_prepare', { id: noteId });
    expect(removal.error).toBe(false);
    const refusedRemoval = await tool('tasting_note_delete_commit', { confirmation_token: removal.data.confirmation_token });
    expect(refusedRemoval.error).toBe(true);
    expect(JSON.stringify(refusedRemoval.data)).toContain('WC_TASTING_CLOSED');
  });
});

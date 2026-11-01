import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';
import { line, operation, write as writeRows } from '../lot-design/fixture';
import { createTestApp } from '../helpers';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let t: TestApp;
let po: string;
let vesselId: string;
let lotId: string;

beforeAll(async () => {
  t = await createTestApp({ mcpRatePerMinute: 1000 });
  po = await entityId(t);
  const warehouse = await seedWarehouse(t, po);
  const location = await call(t, 'POST', '/v1/locations', {
    code: 'BOD', name: 'Bodega sintética', kind: 'cellar', controlling_entity_id: po, tax_warehouse_id: warehouse,
  });
  expect(location.status).toBe(201);
  const vessel = await call(t, 'POST', '/v1/vessels', {
    code: 'INOX-01', name: 'Depósito sintético', kind: 'tank_storage', capacity_ml: 8_000_000, material: 'stainless_steel', location_id: String(location.body.id),
  });
  expect(vessel.status).toBe(201);
  vesselId = String(vessel.body.id);
  lotId = await seedHolding(t, { entityId: po, warehouseId: warehouse, locationId: String(location.body.id), vesselId, code: 'L25SINT', volumeMl: 1_000_000 });
  const owner = await t.writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM core.app_user WHERE email = 'owner@winecore.test'`);
  const op = newId();
  await writeRows(t, (tx) => {
    operation(tx, {
      id: op, entityId: po, ownerId: String(owner[0]?.id), number: 'OB-SINT-1', opType: 'racking', occurredAt: '2026-09-15T08:00:00.000Z',
      details: { temperature_c: 16, duration_hours: 6 },
    });
    line(tx, { operationId: op, lotId, vesselId, state: 'wine', volumeMl: 900_000 });
  });
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

const design = {
  destination_kind: 'pending',
  vinification: 'tinto',
  destemmed: true,
  inoculation_kind: 'espontanea',
  practices_applied: ['filtracion'],
  practices_not_applied: [],
  no_intervention: false,
  aging_method: 'barrica',
  aging_duration_days: 180,
  single_plot: false,
};

describe('MCP · lotes y enología', () => {
  test('lista y detalle de lotes, con todas las lecturas del lote', async () => {
    const list = await read('cellar_lots_list', { status: 'active', limit: 10 });
    expect((list.items as { code: string }[]).map((item) => item.code)).toContain('L25SINT');
    const detail = await read('cellar_lot_detail_get', { code: 'L25SINT' });
    expect(detail.code).toBe('L25SINT');
    expect(detail.id).toBe(lotId);
    const trace = await read('cellar_lot_traceability_get', { code: 'L25SINT', direction: 'up' });
    expect(trace).toBeDefined();
    const moves = await read('cellar_lot_moves_list', { code: 'L25SINT', limit: 5 });
    expect(Array.isArray(moves.items)).toBe(true);
    for (const name of [
      'cellar_lot_additions_list', 'cellar_lot_sales_list', 'cellar_lot_analyses_list', 'cellar_lot_samples_list',
      'cellar_lot_tastings_list', 'cellar_lot_evolution_get', 'cellar_lot_fermentation_curve_get', 'cellar_lot_phases_list',
      'lot_design_get',
    ]) {
      await read(name, { code: 'L25SINT' });
    }
    const noPlan = await tool('cellar_lot_plan_get', { code: 'L25SINT' });
    expect(noPlan.error).toBe(true);
    const missing = await tool('cellar_lot_detail_get', { code: 'NOEXISTE' });
    expect(missing.error).toBe(true);
  });

  test('anota una analítica y la última aparece; el informe se adjunta y se descarga', async () => {
    const recorded = await write('cellar_lot_analysis_record', {
      code: 'L25SINT',
      at: '2026-09-20T08:00:00Z',
      lab: 'internal',
      results: [{ parameter: 'abv', value: '13.5', unit: '% vol' }, { parameter: 'ph', value: '3.4', unit: 'pH' }],
    });
    const analysisId = String(recorded.id);
    const latest = await read('cellar_lot_analysis_latest_get', { code: 'L25SINT' });
    expect(latest.id).toBe(analysisId);
    const analyses = await read('cellar_lot_analyses_list', { code: 'L25SINT' });
    expect((analyses.items as unknown[]).length).toBe(1);

    const attached = await write('cellar_analysis_report_attach', { id: analysisId, file_base64: PNG, filename: 'informe-sintetico.png', content_type: 'image/png' });
    expect(attached.mime_type).toBe('image/png');
    const report = await read('cellar_analysis_report_get', { id: analysisId });
    expect(report.content_type).toBe('image/png');
    expect(typeof report.base64).toBe('string');
  });

  test('lecturas de fermentación y fases', async () => {
    await write('cellar_fermentation_reading_record', {
      lot_id: lotId, vessel_id: vesselId, at: '2026-09-21T08:00:00Z', density: '1.0850', temperature_c: '22.5', sugar: '120',
    });
    const readings = await read('cellar_fermentation_readings_list', { lot_id: lotId });
    expect(readings.items).toEqual([{ at: expect.any(String), density: '1.0850', temperature_c: '22.5', residual_sugar_gl: '120.000' }]);
    const curve = await read('cellar_lot_fermentation_curve_get', { code: 'L25SINT' });
    expect((curve.points as unknown[]).length).toBe(1);
    const noFilter = await tool('cellar_fermentation_readings_list', {});
    expect(noFilter.error).toBe(true);

    const started = await write('cellar_lot_phase_start', {
      code: 'L25SINT', phase: 'alcoholic_fermentation', started_at: '2026-09-21T08:00:00Z', vessel_id: vesselId, inoculation: 'spontaneous',
    });
    expect(started.status).toBe('in_progress');
    const ended = await write('cellar_lot_phase_end', { code: 'L25SINT', id: started.id, ended_at: '2026-10-01T08:00:00Z', end_evidence: 'sensory' });
    expect(ended.status).toBe('completed');
    const second = await write('cellar_lot_phase_start', { code: 'L25SINT', phase: 'skin_maceration', started_at: '2026-10-02T08:00:00Z' });
    const stopped = await write('cellar_lot_phase_stop', { code: 'L25SINT', id: second.id, ended_at: '2026-10-03T08:00:00Z' });
    expect(stopped.status).toBe('stopped');
    const phases = await read('cellar_lot_phases_list', { code: 'L25SINT' });
    expect((phases.items as unknown[]).length).toBe(2);

    const alerts = await write('cellar_winemaking_fermentation_alerts_run', {});
    expect(alerts).toHaveProperty('opened');
  });

  test('cata rápida del lote', async () => {
    await write('cellar_lot_tasting_record', { code: 'L25SINT', at: '2026-10-05T08:00:00Z', author: 'Catador Sintético', notes: 'Fruta roja y taninos suaves', source: 'chat' });
    const tastings = await read('cellar_lot_tastings_list', { code: 'L25SINT' });
    expect((tastings.items as unknown[]).length).toBe(1);
  });

  test('diseño, receta desde el lote, edición y publicación; el diseño cambiado a mitad se rechaza', async () => {
    await write('cellar_lot_design_update', { code: 'L25SINT', design });
    const created = await write('cellar_lot_recipe_create', { code: 'L25SINT', name: 'Receta sintética' });
    const recipeId = String(created.id);
    const recipes = await read('recipes_list', {});
    expect(JSON.stringify(recipes)).toContain(recipeId);
    const updated = await write('cellar_recipe_update', { id: recipeId, changes: { notes: 'Notas de prueba' } });
    expect(updated.notes).toBe('Notas de prueba');
    const detail = await read('cellar_recipe_get', { id: recipeId });
    expect(detail.name).toBe('Receta sintética');
    const deviations = await read('cellar_lot_deviations_get', { code: 'L25SINT', recipe_id: recipeId });
    expect(deviations).toBeDefined();

    const published = await write('cellar_recipe_publish', { id: recipeId });
    expect(published.status).toBe('published');
    const planned = await write('lot_plan_from_recipe', { code: 'L25SINT', recipe_id: recipeId, start_date: '2026-11-01' });
    expect(planned).toBeDefined();
    const plan = await read('cellar_lot_plan_get', { code: 'L25SINT' });
    expect(plan).toBeDefined();
    const version = await write('cellar_recipe_version_create', { id: recipeId });
    expect(version).toBeDefined();

    const prepared = await tool('cellar_lot_design_update_prepare', { code: 'L25SINT', design: { ...design, notes: 'Primera' } });
    expect(prepared.error).toBe(false);
    const other = await call(t, 'PUT', '/v1/lots/L25SINT/design', { ...design, notes: 'Cambio por otro lado' });
    expect(other.status).toBe(200);
    const stale = await tool('cellar_lot_design_update_commit', { confirmation_token: prepared.data.confirmation_token });
    expect(stale.error).toBe(true);
    expect(JSON.stringify(stale.data)).toContain('WC_MCP_PREVIEW_STALE');
  });

  test('calculadoras y ajustes de enología', async () => {
    const so2 = await read('cellar_enology_so2_calculate', {
      ph: '3.5', free_so2_mg_l: '10', volume_l: '1000', wine_type: 'red', product: { kind: 'potassium_metabisulfite' },
    });
    expect(so2).toBeDefined();
    const cold = await read('cellar_enology_cold_stabilisation_calculate', { alcohol_pct: '13' });
    expect(cold.temperature_c).toBeDefined();
    const alcohol = await read('cellar_enology_probable_alcohol_calculate', { sugars_g_l: '230' });
    expect(alcohol).toBeDefined();
    const blend = await read('cellar_enology_blend_calculate', {
      target_volume_l: '100', components: [{ label: 'A', volume_ml: 60000 }, { label: 'B', volume_ml: 40000 }],
    });
    expect(blend.components).toBeDefined();
    const checks = await read('cellar_enology_checks_run', {
      legal_entity_id: po,
      operation: { op_type: 'racking', product_state: 'wine', input_volume_ml: 1000, loss_volume_ml: 0 },
      lot: { id: lotId },
    });
    expect(checks).toBeDefined();

    const settings = await read('cellar_enology_settings_get', { legal_entity_id: po });
    expect(settings.parameters).toBeDefined();
    const saved = await write('cellar_enology_settings_update', {
      legal_entity_id: po,
      parameters: [{ code: 'pre_bottling_freshness_days', value: '45', source_ref: 'Criterio de la bodega sintética' }],
    });
    expect(JSON.stringify(saved)).toContain('45');
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

let t: TestApp;
let po: string;
let locationId: string;
let tankId: string;
let lotId: string;

beforeAll(async () => {
  t = await createTestApp({ mcpRatePerMinute: 1000 });
  po = await entityId(t);
  const warehouse = await seedWarehouse(t, po);
  const location = await call(t, 'POST', '/v1/locations', {
    code: 'BOD', name: 'Bodega sintética', kind: 'cellar', controlling_entity_id: po, tax_warehouse_id: warehouse,
  });
  locationId = String(location.body.id);
  const tank = await call(t, 'POST', '/v1/vessels', {
    code: 'INOX-01', name: 'Depósito sintético', kind: 'tank_storage', capacity_ml: 8_000_000, material: 'stainless_steel', location_id: locationId,
  });
  tankId = String(tank.body.id);
  lotId = await seedHolding(t, { entityId: po, warehouseId: warehouse, locationId, vesselId: tankId, code: 'L25SINT', volumeMl: 1_000_000 });
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

async function product(sku: string, name: string): Promise<string> {
  const created = await call(t, 'POST', '/v1/products', { sku, name, kind: 'packaging_material', unit: 'ud', is_stock_tracked: true, requires_lot: false });
  expect(created.status).toBe(201);
  return String(created.body.id);
}

const procedure = {
  code: 'PERAC-01',
  name: 'Desinfección con producto sintético',
  purpose: 'disinfection',
  product_name: 'Desinfectante sintético',
  active_substance: 'sustancia sintética',
  dose_min: '0.200',
  dose_max: '0.500',
  dose_unit: 'pct',
  contact_time_min: 15,
  rinse_required: true,
  applicable_classes: ['tank_storage', 'barrel'],
  effluent_destination: 'canal a pozo de biodegradación',
};

describe('MCP · higiene', () => {
  test('procedimientos, equipos y mantenimiento', async () => {
    const created = await write('hygiene_procedure_create', procedure);
    const procedureId = String(created.id);
    expect(created.dose_min).toBe('0.200');
    const listed = await read('hygiene_procedures_list', { active: 'true' });
    expect((listed.items as { id: string }[]).map((item) => item.id)).toContain(procedureId);
    const updated = await write('hygiene_procedure_update', { id: procedureId, changes: { contact_time_min: 20 } });
    expect(updated.contact_time_min).toBe(20);
    const got = await read('hygiene_procedure_get', { id: procedureId });
    expect(got.contact_time_min).toBe(20);
    const rejected = await tool('hygiene_procedure_update_prepare', { id: procedureId, changes: { dose_max: '0.100' } });
    expect(rejected.error).toBe(false);
    const refused = await tool('hygiene_procedure_update_commit', { confirmation_token: rejected.data.confirmation_token });
    expect(refused.error).toBe(true);

    const pump = await write('hygiene_equipment_create', { code: 'BOMB-1', name: 'Bomba sintética', kind: 'pump' });
    const pumpId = String(pump.id);
    const renamed = await write('hygiene_equipment_update', { id: pumpId, changes: { name: 'Bomba sintética 2', capacity: '5.000', capacity_unit: 'hl' } });
    expect(renamed.name).toBe('Bomba sintética 2');
    expect((await read('hygiene_equipment_get', { id: pumpId })).code).toBe('BOMB-1');
    expect(((await read('hygiene_equipment_list', {})).items as unknown[]).length).toBe(1);
    await write('hygiene_equipment_maintenance_record', {
      id: pumpId, performed_at: '2026-06-18T09:00:00Z', notes: 'Cambio de juntas', operator: 'Operario sintético', next_due_on: '2026-12-18',
    });
    const maintenance = await read('hygiene_maintenance_list', { equipment_id: pumpId });
    expect((maintenance.items as unknown[]).length).toBe(1);

    const stale = await tool('hygiene_equipment_update_prepare', { id: pumpId, changes: { name: 'Bomba sintética 3' } });
    expect(stale.error).toBe(false);
    const other = await call(t, 'PATCH', `/v1/hygiene/equipment/${pumpId}`, { status: 'out_of_service' });
    expect(other.status).toBe(200);
    const late = await tool('hygiene_equipment_update_commit', { confirmation_token: stale.data.confirmation_token });
    expect(late.error).toBe(true);
    expect(JSON.stringify(late.data)).toContain('WC_MCP_PREVIEW_STALE');
  });

  test('consumibles, filtración y limpieza con su operación', async () => {
    const plates = await product('PLACAV13', 'Placas sintéticas V13');
    await write('hygiene_consumable_register', { product_id: plates, consumable_kind: 'filter_plate' });
    expect(((await read('hygiene_consumables_list', {})).items as unknown[]).length).toBe(1);
    const receipt = await write('hygiene_consumable_receipt_record', {
      product_id: plates, location_id: locationId, owner_entity_id: po, quantity: 20, occurred_at: '2026-06-01T08:00:00Z', supplier_name: 'Proveedor sintético',
    });
    expect(receipt.balance_units).toBe(20);
    expect(((await read('hygiene_consumable_receipts_list', {})).items as unknown[]).length).toBe(1);

    const supplier = newId();
    await t.writer.withWrite({ type: 'system', id: 'hygiene-mcp-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_supplier, created_by)
        VALUES (CAST(${supplier} AS UUID), 'company', 'Suministros Sintéticos S.L.', 'B00000000', 'nif', TRUE, 'hygiene-mcp-test')
      `);
    });
    const filtration = await write('hygiene_filtration_record', {
      occurred_at: '2026-06-15T08:00:00Z', plate_grade: 'V13', plate_format: '40x40', supplier_contact_id: supplier, plate_count: 12,
      operator: 'Operario sintético', location_id: locationId, owner_entity_id: po, consumptions: [{ product_id: plates, quantity: 12 }],
    });
    expect(filtration.balances).toEqual([{ product_id: plates, balance_units: 8 }]);
    expect(((await read('hygiene_filtrations_list', { from: '2026-06-01', to: '2026-06-30' })).items as unknown[]).length).toBe(1);
    const balances = await read('hygiene_consumable_balances_list', { product_id: plates });
    expect(JSON.stringify(balances)).toContain(plates);

    const cleaner = await product('LIMPSINT', 'Limpiador sintético');
    const proc = await call(t, 'GET', '/v1/hygiene/procedures');
    const procedureId = String((proc.body.items as { id: string }[])[0]?.id);
    const draft = await call(t, 'POST', '/v1/cellar-operations', {
      op_type: 'cleaning', legal_entity_id: po, occurred_at: '2026-06-15T08:00:00Z', fiscal_date: '2026-06-15', performed_by: 'Operario sintético',
      cleaning: { vessel_id: tankId, product_id: cleaner, active_substance: 'sustancia sintética', quantity: '1.000', quantity_unit: 'l', efficacy_check: 'aclarado' },
    });
    expect(draft.status).toBe(201);
    const bad = await tool('hygiene_cleaning_log_record_prepare', {
      operation_id: draft.body.id, procedure_id: procedureId, actual_dose: '0.900', actual_dose_unit: 'pct', actual_contact_time_min: 20, rinsed: true, operator: 'Operario sintético', vessel_id: tankId,
    });
    expect(bad.error).toBe(false);
    const rejected = await tool('hygiene_cleaning_log_record_commit', { confirmation_token: bad.data.confirmation_token });
    expect(rejected.error).toBe(true);
    expect(JSON.stringify(rejected.data)).toContain('WC_HYGIENE_DOSE');
    const log = await write('hygiene_cleaning_log_record', {
      operation_id: draft.body.id, procedure_id: procedureId, actual_dose: '0.300', actual_dose_unit: 'pct', actual_contact_time_min: 20, rinsed: true, operator: 'Operario sintético', vessel_id: tankId,
    });
    expect(log.actual_dose).toBe('0.300');
    expect(((await read('hygiene_cleaning_logs_list', {})).items as unknown[]).length).toBe(1);
  });

  test('control de envasado, vínculo de equipo, ajuste y registro APPCC', async () => {
    const bottled = newId();
    await t.writer.withWrite({ type: 'system', id: 'hygiene-mcp-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, unit, is_stock_tracked, requires_lot)
        VALUES (CAST(${bottled} AS UUID), 'B075SINT', 'Botella sintética 0,75', 'wine', 'ud', TRUE, TRUE)
      `);
    });
    const filler = await write('hygiene_equipment_create', { code: 'LLEN-4', name: 'Llenadora sintética', kind: 'bottler' });
    const bottling = await call(t, 'POST', '/v1/cellar-operations', {
      op_type: 'bottling', legal_entity_id: po, occurred_at: '2026-06-20T08:00:00Z', fiscal_date: '2026-06-20', performed_by: 'Operario sintético',
      new_lot: { code: 'L26001' },
      lines: [
        { role: 'input', lot_id: lotId, vessel_id: tankId, volume_ml: 7_500, product_state: 'wine' },
        { role: 'output', location_id: locationId, product_id: bottled, product_state: 'packaged_unlabeled', qty_units: 10, volume_ml: 7_500, nominal_volume_ml: 750, excise_product_key: 'B075-EJEM', nc_code: '22042100' },
      ],
    });
    expect(bottling.status).toBe(201);
    const operationId = String(bottling.body.id);
    await write('hygiene_operation_equipment_link', { operation_id: operationId, equipment_id: filler.id, role: 'used' });
    expect(((await read('hygiene_equipment_links_list', {})).items as unknown[]).length).toBe(1);

    const missing = await tool('hygiene_bottling_check_get', { operation_id: operationId });
    expect(missing.error).toBe(true);
    const saved = await write('hygiene_bottling_check_save', {
      operation_id: operationId, bottles_disinfected: false, fill_rejects: 1, closure_rejects: 0, label_rejects: 3,
      equipment_id: filler.id, closure_type: 'agglomerated_cork', seal_type: 'wax_seal', operator: 'Operario sintético',
    });
    expect(saved.closure_type).toBe('agglomerated_cork');
    const check = await read('hygiene_bottling_check_get', { operation_id: operationId });
    expect(check.label_rejects).toBe(3);
    expect(((await read('hygiene_bottling_checks_list', {})).items as unknown[]).length).toBe(1);

    expect((await read('hygiene_policy_get', {})).bottling_checklist_required).toBe(true);
    const policy = await write('hygiene_policy_update', { bottling_checklist_required: false });
    expect(policy.bottling_checklist_required).toBe(false);

    const report = await read('hygiene_appcc_report_get', { from: '2026-06-01', to: '2026-06-30' });
    expect(report.title).toBe('Registro APPCC de bodega');
    expect((report.equipment_maintenance as unknown[]).length).toBe(1);
    expect((report.filtrations as unknown[]).length).toBe(1);
    const csv = await read('hygiene_appcc_report_get', { from: '2026-06-01', to: '2026-06-30', format: 'csv' });
    expect(csv.content_type).toBe('text/csv');
    expect(String(csv.text).length).toBeGreaterThan(20);
  });
});

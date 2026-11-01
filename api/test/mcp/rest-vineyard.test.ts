import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { call, entityId, seedWarehouse } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function tool(t: TestApp, name: string, args: unknown) {
  const response = await t.app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = await response.json() as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const block = body.result?.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Record<string, unknown> : {};
  return { error: body.result?.isError === true, data };
}

async function write(t: TestApp, name: string, args: unknown) {
  const prepared = await tool(t, `${name}_prepare`, args);
  if (prepared.error) throw new Error(`${name}_prepare: ${JSON.stringify(prepared.data)}`);
  const committed = await tool(t, `${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  if (committed.error) throw new Error(`${name}_commit: ${JSON.stringify(committed.data)}`);
  return { prepared: prepared.data, committed: committed.data };
}

async function rest(t: TestApp, path: string): Promise<Record<string, unknown>> {
  const response = await call(t, 'GET', path);
  if (response.status !== 200) throw new Error(`${path}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function seedVineyard(t: TestApp) {
  const variety = await call(t, 'POST', '/v1/grape-varieties', { code: 'BOBAL', name: 'Bobal', color: 'red' });
  expect(variety.status).toBe(201);
  const parcel = await call(t, 'POST', '/v1/parcels', {
    code: 'PSINT-02',
    name: 'Parcela Sintética Sur',
    ownership: 'own',
    sigpac: '46:250:0:0:12:35:1',
    area_ha: '1.2500',
    organic_status: 'conventional',
    varieties: [{ variety: 'BOBAL', area_ha: '1.2500', planting_year: 2004 }],
  });
  expect(parcel.status).toBe(201);
  return String(parcel.body.id);
}

describe('MCP del viñedo sobre las rutas de la app', () => {
  test('lista y da de alta parcelas, prepara su edición, edita una variedad y fija la cuadrilla de un día', async () => {
    const t = await createTestApp();
    try {
      await write(t, 'vineyard_grape_variety_create', { code: 'BOBAL', name: 'Bobal', color: 'red' });

      const created = await write(t, 'vineyard_parcel_create', {
        code: 'PSINT-01',
        name: 'Parcela Sintética Norte',
        ownership: 'own',
        sigpac: '46:250:0:0:12:34:1',
        area_ha: '1.5',
        organic_status: 'conventional',
        varieties: [{ variety: 'BOBAL', area_ha: '1.5', planting_year: 2004 }],
      });
      expect(String(created.prepared.summary_es)).toContain('PSINT-01');
      expect(created.committed.code).toBe('PSINT-01');
      expect((created.committed.links as { web: string }).web.endsWith('/vinedo/PSINT-01')).toBe(true);

      const list = await tool(t, 'vineyard_parcels_list', {});
      expect(list.error).toBe(false);
      expect((list.data.items as { code: string }[]).map((item) => item.code)).toContain('PSINT-01');

      const prepared = await tool(t, 'vineyard_parcel_update_prepare', {
        code: 'PSINT-01',
        changes: { name: 'Parcela Sintética Norte Alta', altitude_m: 720 },
      });
      expect(prepared.error).toBe(false);
      const preview = prepared.data.preview as { route: string; record: { name: string }; changes: Record<string, unknown> };
      expect(preview.route).toBe('PATCH /v1/parcels/PSINT-01');
      expect(preview.record.name).toBe('Parcela Sintética Norte');
      expect(preview.changes).toEqual({ name: 'Parcela Sintética Norte Alta', altitude_m: 720 });
      expect((await rest(t, '/v1/parcels/PSINT-01')).name).toBe('Parcela Sintética Norte');

      const invalid = await tool(t, 'vineyard_parcel_update_prepare', { code: 'PSINT-01', changes: { sigpac: '46-250' } });
      expect(invalid.error).toBe(true);
      expect(invalid.data.code).toBe('WC_VALIDATION');

      const renamed = await write(t, 'vineyard_grape_variety_update', { code: 'BOBAL', changes: { name: 'Bobal Sintética' } });
      expect((renamed.prepared.preview as { record: { name: string } }).record.name).toBe('Bobal');
      const variety = await rest(t, '/v1/grape-varieties/BOBAL');
      expect(variety.name).toBe('Bobal Sintética');
      expect(variety.color).toBe('red');

      await write(t, 'vineyard_crew_availability_set', { day: '2026-09-20', changes: { people: 6, notes: 'Cuadrilla sintética' } });
      const notesOnly = await write(t, 'vineyard_crew_availability_set', { day: '2026-09-20', changes: { notes: 'Llega a las 7' } });
      expect((notesOnly.prepared.preview as { changes: Record<string, unknown> }).changes).toEqual({ people: 6, notes: 'Llega a las 7' });
      const crew = await rest(t, '/v1/crew-availability?from=2026-09-20&to=2026-09-20');
      expect(crew.items).toEqual([{ day: '2026-09-20', people: 6, notes: 'Llega a las 7' }]);
    } finally {
      await t.close();
    }
  });

  // PATCH /v1/parcels/:code responde 500: DuckDB rechaza el UPDATE de vineyard.parcel mientras
  // vineyard.parcel_variety la referencia por clave foránea. Pasará a `test` cuando se corrija updateParcel.
  test.failing('edita una parcela con prepare/commit y lo comprueba en la ficha', async () => {
    const t = await createTestApp();
    try {
      await seedVineyard(t);
      await write(t, 'vineyard_parcel_update', {
        code: 'PSINT-02',
        changes: { name: 'Parcela Sintética Sur Alta', altitude_m: 720 },
      });
      const after = await rest(t, '/v1/parcels/PSINT-02');
      expect(after.name).toBe('Parcela Sintética Sur Alta');
      expect(after.altitude_m).toBe(720);
      expect(after.area_ha).toBe('1.2500');
      expect((after.varieties as { variety: string }[]).map((item) => item.variety)).toEqual(['BOBAL']);
    } finally {
      await t.close();
    }
  });

  test('anota un producto y un tratamiento en el cuaderno de campo y lo completa', async () => {
    const t = await createTestApp();
    try {
      const parcelId = await seedVineyard(t);
      const product = await write(t, 'vineyard_notebook_product_create', {
        commercial_name: 'Azufre Sintético',
        registration_number: 'ES-SINT-0001',
        active_substances: 'azufre',
        is_organic_approved: true,
        safety_interval_days: 21,
        max_dose: '4',
        max_dose_unit: 'kg/ha',
        product_kind: 'phytosanitary',
      });
      const productId = String(product.committed.id);

      const treatment = await write(t, 'vineyard_treatment_create', {
        parcel_ids: [parcelId],
        applied_on: '2026-10-20',
        product_id: productId,
        dose: '3.000',
        dose_unit: 'kg/ha',
        target: 'Oídio',
        operator_name: 'Operario Sintético',
        applicator_ropo: 'ROPO-SINT-1001',
        method: 'Pulverización',
      });
      expect(String(treatment.prepared.summary_es)).toContain('cuaderno de campo');
      const stored = (treatment.committed.treatments as { id: string; parcel_code: string; safety_interval_days: number; total_quantity: string }[])[0];
      expect(stored?.parcel_code).toBe('PSINT-02');
      expect(stored?.safety_interval_days).toBe(21);
      expect(stored?.total_quantity).toBe('3.7500');

      const listed = await rest(t, '/v1/treatments?campaign=2026');
      expect((listed.items as { id: string }[]).map((item) => item.id)).toEqual([String(stored?.id)]);

      await write(t, 'vineyard_treatment_update', { id: stored?.id, changes: { efficacy: 'Buena, sin síntomas a los 7 días' } });
      const completed = await rest(t, `/v1/treatments/${stored?.id}`);
      expect(completed.efficacy).toBe('Buena, sin síntomas a los 7 días');
      expect(completed.dose).toBe('3.000');
    } finally {
      await t.close();
    }
  });

  test('anota, corrige, previsualiza y confirma una entrada de uva', async () => {
    const t = await createTestApp();
    try {
      await seedVineyard(t);
      const po = await entityId(t);
      const warehouse = await seedWarehouse(t, po);
      const location = await call(t, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega sintética',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      const vessel = await call(t, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito sintético',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: location.body.id,
      });
      expect(vessel.status).toBe(201);
      await t.writer.withWrite({ type: 'system', id: 'mcp-vineyard-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year, status)
          VALUES (CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), 2026, 'open')
        `);
      });

      const draft = await write(t, 'vineyard_grape_reception_create', {
        legal_entity_id: po,
        performed_by: 'Operario Sintético',
        occurred_at: '2026-10-15T10:00:00Z',
        variety_code: 'BOBAL',
        gross_kg: '1200',
        tare_kg: '200',
        net_kg: '1000',
        probable_abv: '13.00',
        sanitary_status: 'good',
        is_organic: false,
        organic_label_checked: false,
        has_do: false,
        destination_vessel_id: String(vessel.body.id),
        lot_code: 'U26-PSINT',
        vintage: 2026,
        parcels: [{ parcel_code: 'PSINT-02', kg: '1000' }],
        intake: { container: 'box', container_count: 50, weighing: 'weighed', sanitary_state: 'healthy' },
      });
      const id = String(draft.committed.id);
      expect(draft.committed.status).toBe('draft');

      const corrected = await write(t, 'vineyard_grape_reception_update', {
        id,
        changes: { probable_abv: '13.50', intake: { botrytis_pct: '2' } },
      });
      const sent = (corrected.prepared.preview as { changes: Record<string, unknown> }).changes;
      expect(sent.parcels).toEqual([{ parcel_code: 'PSINT-02', kg: '1000.000' }]);
      expect(sent.grower_contact_id).toBeUndefined();
      const ticket = (await rest(t, `/v1/grape-receptions/${id}`)).ticket as { probable_abv: string; net_kg: string; intake: { botrytis_pct: string; container_count: number } };
      expect(ticket.probable_abv).toBe('13.50');
      expect(ticket.net_kg).toBe('1000.000');
      expect(ticket.intake.botrytis_pct).toBe('2.00');
      expect(ticket.intake.container_count).toBe(50);

      const preview = await tool(t, 'vineyard_grape_reception_preview', { id });
      expect(preview.error).toBe(false);
      expect((preview.data.silicie as { entry_kind: string }).entry_kind).toBe('A02');
      expect((await rest(t, `/v1/grape-receptions/${id}`)).status).toBe('draft');

      const confirmed = await write(t, 'vineyard_grape_reception_confirm', { id });
      expect(String(confirmed.prepared.summary_es)).toContain('U26-PSINT');
      expect(confirmed.committed.status).toBe('confirmed');
      expect((await rest(t, `/v1/grape-receptions/${id}`)).status).toBe('confirmed');
    } finally {
      await t.close();
    }
  });
});

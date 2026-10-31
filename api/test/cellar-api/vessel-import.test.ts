import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from './fixtures';

const CELLAR = 'bodega@winecore.test';

async function bodega(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  expect(location.status).toBe(201);
  return { po, warehouse, locationId: String(location.body.id) };
}

async function textCall(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  path: string,
  user?: string,
): Promise<{ status: number; type: string; text: string }> {
  const headers: Record<string, string> = {};
  if (user) headers['x-dev-user'] = user;
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, { headers }));
  return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
}

async function importCsv(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  locationId: string,
  csv: string,
  user = CELLAR,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.set('location_id', locationId);
  form.set('file', new File([csv], 'recipientes.csv', { type: 'text/csv' }));
  const response = await ctx.app.handle(new Request('http://localhost/v1/vessels/import', {
    method: 'POST',
    headers: { 'x-dev-user': user },
    body: form,
  }));
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown> };
}

describe('importación de depósitos', () => {
  it('sirve la plantilla y carga la fila de ejemplo en mililitros', async () => {
    const ctx = await createTestApp();
    try {
      const { locationId } = await bodega(ctx);
      const denied = await call(ctx, 'POST', '/v1/vessels/import', {
        location_id: locationId,
        rows: [{ code: 'EJ-01', name: 'Depósito de ejemplo', kind: 'tank_storage', capacity_litres: 1, material: 'stainless_steel' }],
      }, 'asesor@winecore.test');
      expect(denied.status).toBe(403);

      const template = await textCall(ctx, '/v1/vessels/import-template', CELLAR);
      expect(template.status).toBe(200);
      expect(template.type).toContain('text/csv');
      const lines = template.text.trim().split(/\r?\n/);
      expect(lines).toEqual([
        'code,name,kind,capacity_litres,material,cooling,zone,status',
        'EJ-01,Depósito de ejemplo,tank_storage,1000,stainless_steel,no,Nave ejemplo,in_service',
      ]);

      const created = await importCsv(ctx, locationId, template.text);
      expect(created.status).toBe(200);
      expect(created.body.created).toBe(1);
      expect(created.body.updated).toBe(0);
      expect(created.body.errors).toEqual([]);

      const vessel = await call(ctx, 'GET', '/v1/vessels/EJ-01', undefined, CELLAR);
      expect(vessel.body).toMatchObject({
        code: 'EJ-01',
        name: 'Depósito de ejemplo',
        kind: 'tank_storage',
        capacity_ml: 1_000_000,
        zone: 'Nave ejemplo',
        status: 'in_service',
        has_cooling_jacket: false,
      });

      const zones = await call(ctx, 'GET', '/v1/cellar-zones?limit=20', undefined, CELLAR);
      const zone = (zones.body.items as { code: string; name: string; kind: string }[]).find((item) => item.name === 'Nave ejemplo');
      expect(zone).toMatchObject({ code: 'NAVE-EJEMPLO', kind: 'elaboration' });

      const map = await call(ctx, 'GET', `/v1/cellar-map?location_id=${locationId}`, undefined, CELLAR);
      const placed = (map.body.zones as { vessels: { code: string; x: number }[] }[])
        .flatMap((item) => item.vessels);
      expect(placed.map((item) => item.code)).toEqual(['EJ-01']);
      expect((map.body.unplaced_vessels as { code: string }[]).map((item) => item.code)).toEqual([]);

      const again = await importCsv(ctx, locationId, template.text);
      expect(again.body).toMatchObject({ created: 0, updated: 0, skipped: 1, errors: [] });
      const listed = await call(ctx, 'GET', '/v1/vessels?limit=20', undefined, CELLAR);
      expect((listed.body.items as { code: string }[]).map((item) => item.code)).toEqual(['EJ-01']);

      const audits = await ctx.writer.read<{ action: string; reason: string | null }>(sql`
        SELECT action, reason FROM audit.audit_log
        WHERE table_name = 'cellar.vessel'
        ORDER BY id
      `);
      expect(audits.some((row) => row.action === 'INSERT' && row.reason === 'importación de recipientes')).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('actualiza el código repetido y rechaza el fermentador sin frío y el tipo inválido', async () => {
    const ctx = await createTestApp();
    try {
      const { po, warehouse, locationId } = await bodega(ctx);
      const csv = [
        'code,name,kind,capacity_litres,material,cooling,zone,status',
        'EJ-10,Depósito diez,tank_storage,10,stainless_steel,no,Nave ejemplo,in_service',
        'EJ-10,Depósito diez bis,tank_storage,12,stainless_steel,no,Nave ejemplo,in_service',
        'EJ-11,Fermentador suelto,tank_fermenter,8,stainless_steel,no,,in_service',
        'EJ-12,Recipiente raro,tinaja,5,oak,no,,in_service',
        'EJ-13,Depósito suelto,tank_storage,3,stainless_steel,no,,in_service',
        'EJ-14,Fermentador con frío,tank_fermenter,8,stainless_steel,si,Nave ejemplo,in_service',
      ].join('\n');
      const imported = await importCsv(ctx, locationId, csv);
      expect(imported.status).toBe(200);
      expect(imported.body.created).toBe(3);
      expect(imported.body.updated).toBe(1);
      expect(imported.body.skipped).toBe(0);
      const errors = imported.body.errors as { row: number; message: string }[];
      expect(errors).toEqual([
        { row: 4, code: 'EJ-11', message: 'El fermentador exige camisa de frío' },
        { row: 5, code: 'EJ-12', message: 'Tipo no válido. Debe ser uno de: tank_storage, tank_fermenter, barrel, demijohn, ibc, other' },
      ]);

      const updated = await call(ctx, 'GET', '/v1/vessels/EJ-10', undefined, CELLAR);
      expect(updated.body).toMatchObject({ name: 'Depósito diez bis', capacity_ml: 12_000, zone: 'Nave ejemplo' });
      const loose = await call(ctx, 'GET', '/v1/vessels/EJ-13', undefined, CELLAR);
      expect(loose.body).toMatchObject({ capacity_ml: 3_000, zone: null });
      const jacket = await call(ctx, 'GET', '/v1/vessels/EJ-14', undefined, CELLAR);
      expect(jacket.body).toMatchObject({ kind: 'tank_fermenter', has_cooling_jacket: true, capacity_ml: 8_000 });
      expect((await call(ctx, 'GET', '/v1/vessels/EJ-11', undefined, CELLAR)).status).toBe(404);
      expect((await call(ctx, 'GET', '/v1/vessels/EJ-12', undefined, CELLAR)).status).toBe(404);

      const map = await call(ctx, 'GET', `/v1/cellar-map?location_id=${locationId}`, undefined, CELLAR);
      const placed = (map.body.zones as { code: string; vessels: { code: string }[] }[])
        .flatMap((zone) => zone.vessels.map((vessel) => vessel.code));
      expect(placed.sort()).toEqual(['EJ-10', 'EJ-14']);
      expect((map.body.unplaced_vessels as { code: string }[]).map((item) => item.code)).toEqual(['EJ-13']);
      const positions = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total
        FROM cellar.plan_position p
        JOIN cellar.vessel v ON v.id = p.vessel_id
        WHERE v.code = 'EJ-10'
      `);
      expect(positions[0]?.total).toBe('1');

      const moved = await call(ctx, 'POST', '/v1/vessels/import', {
        location_id: locationId,
        rows: [{
          code: 'EJ-10',
          name: 'Depósito diez bis',
          kind: 'tank_storage',
          capacity_litres: 12,
          material: 'stainless_steel',
          cooling: 'no',
          zone: 'Sala sintetica|barrel_room',
        }],
      }, CELLAR);
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ created: 0, updated: 1, skipped: 0, errors: [] });
      const after = await call(ctx, 'GET', `/v1/cellar-map?location_id=${locationId}`, undefined, CELLAR);
      const sala = (after.body.zones as { name: string; kind: string; vessels: { code: string }[] }[])
        .find((zone) => zone.name === 'Sala sintetica');
      expect(sala).toMatchObject({ kind: 'barrel_room' });
      expect(sala?.vessels.map((vessel) => vessel.code)).toEqual(['EJ-10']);
      const stillOne = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total
        FROM cellar.plan_position p
        JOIN cellar.vessel v ON v.id = p.vessel_id
        WHERE v.code = 'EJ-10'
      `);
      expect(stillOne[0]?.total).toBe('1');

      const decimal = await importCsv(ctx, locationId, [
        'code;name;kind;capacity_litres;material;cooling;zone;status',
        'EJ-30;Depósito coma;tank_storage;1,5;glass;no;;in_service',
      ].join('\n'));
      expect(decimal.body).toMatchObject({ created: 1, errors: [] });
      expect((await call(ctx, 'GET', '/v1/vessels/EJ-30', undefined, CELLAR)).body.capacity_ml).toBe(1_500);

      await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(loose.body.id),
        code: 'L-SINT',
        volumeMl: 2_000,
      });
      const shrunk = await call(ctx, 'POST', '/v1/vessels/import', {
        location_id: locationId,
        rows: [{
          code: 'EJ-13',
          name: 'Depósito suelto',
          kind: 'tank_storage',
          capacity_litres: 1,
          material: 'stainless_steel',
          cooling: 'no',
        }],
      }, CELLAR);
      expect(shrunk.status).toBe(200);
      expect(shrunk.body.errors).toEqual([
        { row: 1, code: 'EJ-13', message: 'La capacidad no cubre el volumen actual' },
      ]);
      expect((await call(ctx, 'GET', '/v1/vessels/EJ-13', undefined, CELLAR)).body.capacity_ml).toBe(3_000);
    } finally {
      await ctx.close();
    }
  });
});

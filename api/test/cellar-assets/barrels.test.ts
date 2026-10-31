import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';

describe('usos de barrica', () => {
  it('incrementa el uso solo al llenar una barrica vacía', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      const locationId = String(location.body.id);
      const tank = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      const barrel = await call(ctx, 'POST', '/v1/vessels', {
        code: 'BAR-001',
        name: 'Barrica',
        kind: 'barrel',
        capacity_ml: 300_000,
        material: 'oak',
        location_id: locationId,
      });
      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(tank.body.id),
        code: 'L25T01',
        volumeMl: 1_000_000,
      });

      const sheet = await call(ctx, 'POST', '/v1/vessels/BAR-001/barrel', {
        oak_origin: 'frances',
        forest: 'Allier',
        toast: 'medio_plus',
        head_toast: true,
        cooper: 'Tonelería Ejemplo',
        year_made: 2019,
        nominal_volume_ml: 225_000,
        purchase_date: '2019-03-01',
        purchase_price: '420.00',
      });
      expect(sheet.status).toBe(201);
      expect(sheet.body).toMatchObject({
        oak_origin: 'frances',
        oak_origin_label: 'francés',
        toast: 'medio_plus',
        toast_label: 'medio+',
        head_toast: true,
        status: 'in_use',
        status_label: 'en uso',
        use_count: 0,
        purchase_price: '420.00',
      });

      const first = await confirm(ctx, transfer(po, lotId, String(tank.body.id), String(barrel.body.id), 200_000, 5_000, '2026-06-15T08:00:00Z'));
      expect(first.status).toBe(200);
      const afterFirst = await call(ctx, 'GET', '/v1/vessels/BAR-001/barrel');
      expect(afterFirst.body.use_count).toBe(1);

      const second = await confirm(ctx, transfer(po, lotId, String(tank.body.id), String(barrel.body.id), 20_000, 0, '2026-06-16T08:00:00Z'));
      expect(second.status).toBe(200);
      const afterSecond = await call(ctx, 'GET', '/v1/vessels/BAR-001/barrel');
      expect(afterSecond.body.use_count).toBe(1);

      const fills = await ctx.writer.read<{ total: string; vessel_id: string }>(sql`
        SELECT count(*)::VARCHAR AS total, min(vessel_id)::VARCHAR AS vessel_id
        FROM cellar.barrel_fill
      `);
      expect(Number(fills[0]?.total)).toBe(1);
      expect(String(fills[0]?.vessel_id).toLowerCase()).toBe(String(barrel.body.id).toLowerCase());

      const resting = await call(ctx, 'PATCH', '/v1/vessels/BAR-001/barrel', { status: 'resting' });
      expect(resting.body).toMatchObject({ status: 'resting', status_label: 'en reposo', use_count: 1 });
    } finally {
      await ctx.close();
    }
  });

  it('recalcula el uso desde el historial de llenados y se puede repetir', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      const locationId = String(location.body.id);
      const tank = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      const barrel = await call(ctx, 'POST', '/v1/vessels', {
        code: 'BAR-002',
        name: 'Barrica 2',
        kind: 'barrel',
        capacity_ml: 300_000,
        material: 'oak',
        location_id: locationId,
      });
      const barrelId = String(barrel.body.id);
      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(tank.body.id),
        code: 'L25T02',
        volumeMl: 1_000_000,
      });
      const sheet = await call(ctx, 'POST', '/v1/vessels/BAR-002/barrel', {
        oak_origin: 'frances',
        toast: 'medio',
        head_toast: false,
        cooper: 'Tonelería Ejemplo',
        year_made: 2020,
        nominal_volume_ml: 225_000,
      });
      expect(sheet.status).toBe(201);
      const filled = await confirm(ctx, transfer(po, lotId, String(tank.body.id), barrelId, 200_000, 0, '2026-06-15T08:00:00Z'));
      expect(filled.status).toBe(200);

      const denied = await call(ctx, 'POST', '/v1/barrels/use-count-backfill', undefined, 'bodega@winecore.test');
      expect(denied.status).toBe(403);

      await ctx.writer.withWrite({ type: 'system', id: 'backfill-test', requestId: 'backfill-1' }, async (tx) => {
        tx.write(sql`UPDATE cellar.barrel SET use_count = 0 WHERE vessel_id = CAST(${barrelId} AS UUID)`);
      });
      const first = await call(ctx, 'POST', '/v1/barrels/use-count-backfill');
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ fills_added: 0, updated: 1 });
      expect((await call(ctx, 'GET', '/v1/vessels/BAR-002/barrel')).body.use_count).toBe(1);
      const again = await call(ctx, 'POST', '/v1/barrels/use-count-backfill');
      expect(again.body).toMatchObject({ fills_added: 0, updated: 0 });
      expect((await call(ctx, 'GET', '/v1/vessels/BAR-002/barrel')).body.use_count).toBe(1);

      await ctx.writer.withWrite({ type: 'system', id: 'backfill-test', requestId: 'backfill-2' }, async (tx) => {
        tx.write(sql`DELETE FROM cellar.barrel_fill WHERE vessel_id = CAST(${barrelId} AS UUID)`);
        tx.write(sql`UPDATE cellar.barrel SET use_count = 0 WHERE vessel_id = CAST(${barrelId} AS UUID)`);
      });
      const rebuilt = await call(ctx, 'POST', '/v1/barrels/use-count-backfill');
      expect(rebuilt.status, JSON.stringify(rebuilt.body)).toBe(200);
      expect(rebuilt.body).toMatchObject({ fills_added: 1, updated: 1 });
      expect((await call(ctx, 'GET', '/v1/vessels/BAR-002/barrel')).body.use_count).toBe(1);
      const stable = await call(ctx, 'POST', '/v1/barrels/use-count-backfill');
      expect(stable.body).toMatchObject({ fills_added: 0, updated: 0 });

      const audit = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM audit.audit_log
        WHERE table_name = 'cellar.barrel' AND action = 'EVENT'
      `);
      expect(Number(audit[0]?.n)).toBeGreaterThanOrEqual(4);
    } finally {
      await ctx.close();
    }
  });
});

function transfer(
  entity: string,
  lotId: string,
  tankId: string,
  barrelId: string,
  outputMl: number,
  lossMl: number,
  occurredAt: string,
) {
  return {
    op_type: 'racking',
    legal_entity_id: entity,
    occurred_at: occurredAt,
    fiscal_date: occurredAt.slice(0, 10),
    performed_by: 'Operario sintético',
    lines: [
      { role: 'input', lot_id: lotId, vessel_id: tankId, volume_ml: outputMl + lossMl, product_state: 'wine' },
      { role: 'output', lot_id: lotId, vessel_id: barrelId, volume_ml: outputMl, product_state: 'wine' },
      ...(lossMl > 0
        ? [{ role: 'loss', lot_id: lotId, vessel_id: tankId, volume_ml: lossMl, loss_kind: 'authorized', product_state: 'wine' }]
        : []),
    ],
  };
}

async function confirm(ctx: Awaited<ReturnType<typeof createTestApp>>, body: unknown) {
  const draft = await call(ctx, 'POST', '/v1/cellar-operations', body, 'bodega@winecore.test');
  expect(draft.status).toBe(201);
  return call(ctx, 'POST', `/v1/cellar-operations/${String(draft.body.id)}/confirm`, undefined, 'bodega@winecore.test');
}

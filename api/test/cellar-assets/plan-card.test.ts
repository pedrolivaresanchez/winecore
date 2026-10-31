import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';

describe('ficha y posición del plano', () => {
  it('la ficha trae lote, vino, litros, operación y analítica', async () => {
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
      expect(location.status).toBe(201);
      const locationId = String(location.body.id);
      const barrel = await call(ctx, 'POST', '/v1/vessels', {
        code: 'BAR-001',
        name: 'Barrica 1',
        kind: 'barrel',
        capacity_ml: 225_000,
        material: 'oak',
        location_id: locationId,
      });
      expect(barrel.status).toBe(201);
      const vesselId = String(barrel.body.id);
      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId,
        code: 'L25T01',
        volumeMl: 225_000,
      });
      const wineId = newId();
      const operationId = newId();
      const lineId = newId();
      const analysisId = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'plan-card-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color)
          VALUES (CAST(${wineId} AS UUID), 'PLANO', 'Vino de plano', 'red')
        `);
        tx.write(sql`
          UPDATE inventory.lot SET wine_id = CAST(${wineId} AS UUID) WHERE id = CAST(${lotId} AS UUID)
        `);
        tx.write(sql`
          INSERT INTO cellar.operation (
            id, legal_entity_id, number, op_type, occurred_at, status, confirmed_at, performed_by, created_by
          ) VALUES (
            CAST(${operationId} AS UUID),
            CAST(${po} AS UUID),
            'OB26-PLANO',
            'racking',
            CAST('2026-09-12T08:30:00Z' AS TIMESTAMPTZ),
            'confirmed',
            CAST('2026-09-12T08:35:00Z' AS TIMESTAMPTZ),
            'Bodega',
            'plan-card-test'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation_line (
            id, operation_id, role, lot_id, vessel_id, product_state, volume_ml
          ) VALUES (
            CAST(${lineId} AS UUID),
            CAST(${operationId} AS UUID),
            'output',
            CAST(${lotId} AS UUID),
            CAST(${vesselId} AS UUID),
            'wine',
            1000
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.analysis (id, lot_id, vessel_id, kind, sampled_at, lab, created_by)
          VALUES (
            CAST(${analysisId} AS UUID),
            CAST(${lotId} AS UUID),
            CAST(${vesselId} AS UUID),
            'control',
            CAST('2026-09-10T07:00:00Z' AS TIMESTAMPTZ),
            'internal',
            'plan-card-test'
          )
        `);
        for (const [code, value] of [['ph', '3.4500'], ['free_so2', '28'], ['abv', '13.8000']] as const) {
          tx.write(sql`
            INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value)
            VALUES (
              CAST(${newId()} AS UUID),
              CAST(${analysisId} AS UUID),
              ${code},
              CAST(${value} AS DECIMAL(12,4))
            )
          `);
        }
      });

      const denied = await call(ctx, 'GET', '/v1/vessels/NO-EXISTE/plan-card');
      expect(denied.status).toBe(404);

      const card = await call(ctx, 'GET', '/v1/vessels/BAR-001/plan-card', undefined, 'asesor@winecore.test');
      expect(card.status).toBe(200);
      expect(card.body).toMatchObject({
        code: 'BAR-001',
        name: 'Barrica 1',
        kind: 'barrel',
        kind_label: 'Barrica',
        capacity_ml: 225_000,
        capacity_litres: '225.0',
        volume_ml: 225_000,
        litres: '225.0',
        fill_pct: '100.0',
        status: 'in_service',
        state: 'aging',
        state_label: 'Crianza',
        lot_id: lotId,
        lot_code: 'L25T01',
        wine_name: 'Vino de plano',
        product_state: 'wine',
      });
      expect(card.body.last_operation).toMatchObject({
        op_type: 'racking',
        op_type_label: 'Trasiego',
        status: 'confirmed',
      });
      const occurred = String((card.body.last_operation as { occurred_at: string }).occurred_at);
      expect(occurred.startsWith('2026-09-12')).toBe(true);
      const analysis = card.body.last_analysis as { sampled_at: string; results: Array<{ parameter_code: string; value: string; unit: string }> };
      expect(analysis.sampled_at.startsWith('2026-09-10')).toBe(true);
      expect(analysis.results.map((row) => row.parameter_code).sort()).toEqual(['abv', 'free_so2', 'ph']);
      const ph = analysis.results.find((row) => row.parameter_code === 'ph');
      expect(ph?.unit).toBe('pH');
      expect(Number(ph?.value)).toBeCloseTo(3.45, 2);
    } finally {
      await ctx.close();
    }
  });

  it('quitar del plano devuelve el recipiente a sin colocar y no lo borra', async () => {
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
      const zone = await call(ctx, 'POST', '/v1/cellar-zones', {
        location_id: locationId,
        code: 'ELAB',
        name: 'Nave de elaboración',
        kind: 'elaboration',
      });
      expect(zone.status).toBe(201);
      const vessel = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito 1',
        kind: 'tank_storage',
        capacity_ml: 5_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      expect(vessel.status).toBe(201);
      const placed = await call(ctx, 'POST', '/v1/cellar-zones/ELAB/positions', {
        vessel_code: 'INOX-01',
        x: 40,
        y: 48,
        width: 136,
        height: 88,
        rotation: 0,
      });
      expect(placed.status).toBe(201);
      const positionId = String(placed.body.id);

      const forbidden = await call(ctx, 'DELETE', `/v1/cellar-zones/ELAB/positions/${positionId}`, undefined, 'asesor@winecore.test');
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe('WC_FORBIDDEN');

      const removed = await call(ctx, 'DELETE', `/v1/cellar-zones/ELAB/positions/${positionId}`);
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ id: positionId, deleted: true, vessel_code: 'INOX-01', holder_code: null });

      const again = await call(ctx, 'DELETE', `/v1/cellar-zones/ELAB/positions/${positionId}`);
      expect(again.status).toBe(404);

      const still = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total FROM cellar.vessel WHERE code = 'INOX-01'
      `);
      expect(Number(still[0]?.total)).toBe(1);

      const map = await call(ctx, 'GET', `/v1/cellar-map?location_id=${locationId}`);
      expect(map.status).toBe(200);
      const zones = map.body.zones as Array<{ code: string; vessels: unknown[] }>;
      expect(zones.find((item) => item.code === 'ELAB')?.vessels).toEqual([]);
      const unplaced = map.body.unplaced_vessels as Array<Record<string, unknown>>;
      expect(unplaced.find((item) => item.code === 'INOX-01')).toMatchObject({
        kind: 'tank_storage',
        status: 'in_service',
        state: 'empty',
        litres: '0.0',
        fill_pct: '0.0',
        lot_code: null,
        position_id: null,
      });

      const audits = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total
        FROM audit.audit_log
        WHERE table_name = 'cellar.plan_position' AND action = 'DELETE'
      `);
      expect(Number(audits[0]?.total)).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});

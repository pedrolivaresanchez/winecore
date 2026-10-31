import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';

describe('plano de bodega', () => {
  it('devuelve zonas, coordenadas, llenado, lote y estado', async () => {
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

      const denied = await call(ctx, 'POST', '/v1/cellar-zones', {
        location_id: locationId,
        code: 'SALA',
        name: 'Sala de barricas',
        kind: 'barrel_room',
      }, 'asesor@winecore.test');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');

      const attachmentId = newId();
      const sha = 'ab'.repeat(32);
      await ctx.writer.withWrite({ type: 'system', id: 'cellar-assets-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO core.attachment (id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes, created_by)
          VALUES (
            CAST(${attachmentId} AS UUID), ${sha}, 'knowledge_base', ${sha}, 'plano.png', 'image/png', 8, 'sintetico'
          )
        `);
      });

      const sala = await call(ctx, 'POST', '/v1/cellar-zones', {
        location_id: locationId,
        code: 'SALA',
        name: 'Sala de barricas',
        kind: 'barrel_room',
        plan_attachment_id: attachmentId,
      });
      expect(sala.status).toBe(201);
      expect(sala.body.kind_label).toBe('Sala de barricas');
      expect(sala.body.plan_attachment_id).toBe(attachmentId);

      const ext = await call(ctx, 'POST', '/v1/cellar-zones', {
        location_id: locationId,
        code: 'EXT',
        name: 'Exterior',
        kind: 'outdoor',
      });
      expect(ext.status).toBe(201);
      expect(ext.body.kind_label).toBe('Exterior / intemperie');

      const fermenter = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-B1',
        name: 'Fermentador B1',
        kind: 'tank_fermenter',
        capacity_ml: 8_000_000,
        has_cooling_jacket: true,
        material: 'stainless_steel',
        location_id: locationId,
      });
      expect(fermenter.status).toBe(201);
      const barrel = await call(ctx, 'POST', '/v1/vessels', {
        code: 'BAR-001',
        name: 'Barrica 1',
        kind: 'barrel',
        capacity_ml: 225_000,
        material: 'oak',
        location_id: locationId,
      });
      const dame = await call(ctx, 'POST', '/v1/vessels', {
        code: 'DAM-001',
        name: 'Damajuana 1',
        kind: 'demijohn',
        capacity_ml: 54_000,
        material: 'glass',
        location_id: locationId,
      });
      expect(barrel.status).toBe(201);
      expect(dame.status).toBe(201);

      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(barrel.body.id),
        code: 'L25T01',
        volumeMl: 225_000,
      });

      const placed = await call(ctx, 'POST', '/v1/cellar-zones/SALA/positions', {
        vessel_code: 'BAR-001',
        x: 12.5,
        y: 40,
        width: 18,
        height: 22,
        rotation: 90,
      });
      expect(placed.status).toBe(201);
      await call(ctx, 'POST', '/v1/cellar-zones/SALA/positions', {
        vessel_code: 'INOX-B1',
        x: 80,
        y: 10,
        width: 40,
        height: 60,
        rotation: 0,
      });
      await call(ctx, 'POST', '/v1/cellar-zones/EXT/positions', {
        vessel_code: 'DAM-001',
        x: 4,
        y: 6,
        width: 10,
        height: 10,
        rotation: 0,
      });

      const outdoor = await call(ctx, 'PUT', '/v1/vessels/DAM-001/demijohn', { outdoor_aging: true });
      expect(outdoor.status).toBe(200);
      expect(outdoor.body.aging_label).toBe('crianza a la intemperie');

      const capacity = await call(ctx, 'POST', '/v1/vessels/INOX-B1/capacity', {
        capacity_ml: 10_000_000,
        reason: 'Aforo sintético',
      });
      expect(capacity.status).toBe(201);
      expect(capacity.body).toMatchObject({
        vessel_code: 'INOX-B1',
        capacity_ml: 10_000_000,
        has_cooling_jacket: true,
      });
      expect(capacity.body.history).toHaveLength(1);

      const map = await call(ctx, 'GET', `/v1/cellar-map?location_id=${locationId}`, undefined, 'asesor@winecore.test');
      expect(map.status).toBe(200);
      expect(map.body.location_code).toBe('BOD');
      const zones = map.body.zones as Array<{
        code: string;
        kind_label: string;
        plan_attachment_id: string | null;
        vessels: Array<Record<string, unknown>>;
      }>;
      expect(zones.map((zone) => zone.code)).toEqual(['EXT', 'SALA']);
      const salaZone = zones.find((zone) => zone.code === 'SALA');
      expect(salaZone?.plan_attachment_id).toBe(attachmentId);
      expect(salaZone?.kind_label).toBe('Sala de barricas');
      const bar = salaZone?.vessels.find((vessel) => vessel.code === 'BAR-001');
      expect(bar).toMatchObject({
        x: 12.5,
        y: 40,
        width: 18,
        height: 22,
        rotation: 90,
        fill_pct: '100.0',
        lot_id: lotId,
        lot_code: 'L25T01',
        state: 'aging',
        volume_ml: 225_000,
        capacity_ml: 225_000,
      });
      const b1 = salaZone?.vessels.find((vessel) => vessel.code === 'INOX-B1');
      expect(b1).toMatchObject({
        state: 'empty',
        fill_pct: '0.0',
        has_cooling_jacket: true,
        capacity_ml: 10_000_000,
        lot_id: null,
      });
      const outside = zones.find((zone) => zone.code === 'EXT')?.vessels.find((vessel) => vessel.code === 'DAM-001');
      expect(outside).toMatchObject({
        outdoor_aging: true,
        aging_label: 'crianza a la intemperie',
        state: 'empty',
      });

      const audits = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total FROM audit.audit_log WHERE table_name = 'cellar.zone' AND action = 'INSERT'
      `);
      expect(Number(audits[0]?.total)).toBeGreaterThanOrEqual(2);
    } finally {
      await ctx.close();
    }
  });
});

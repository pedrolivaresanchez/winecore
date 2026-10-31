import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from './fixtures';

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

describe('recipientes', () => {
  it('crea el mapa vacío, edita y rechaza un fermentador sin camisa', async () => {
    const ctx = await createTestApp();
    try {
      const { locationId } = await bodega(ctx);
      const bare = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-B1',
        name: 'Fermentador',
        kind: 'tank_fermenter',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      expect(bare.status).toBe(422);
      expect(bare.body.code).toBe('WC_VALIDATION');

      const created = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito 1',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: locationId,
        zone: 'Nave 1',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        code: 'INOX-01',
        kind: 'tank_storage',
        material: 'stainless_steel',
        capacity_ml: 8_000_000,
        location_code: 'BOD',
        zone: 'Nave 1',
        status: 'in_service',
        state: 'empty',
        lot_id: null,
        volume_ml: 0,
        fill_pct: '0.0',
      });
      expect(String(created.body.qr_token)).toMatch(/^wcqr_[A-Za-z0-9_-]{16,}$/);

      const listed = await call(ctx, 'GET', '/v1/vessels?zone=Nave%201&kind=tank_storage&status=in_service');
      const items = (listed.body.items as { code: string; qr_token?: string }[]);
      expect(items.map((item) => item.code)).toEqual(['INOX-01']);
      expect(items[0]?.qr_token).toBeUndefined();

      const renamed = await call(ctx, 'PATCH', '/v1/vessels/INOX-01', { name: 'Depósito norte' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Depósito norte');

      const jacket = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-B1',
        name: 'Fermentador',
        kind: 'tank_fermenter',
        capacity_ml: 8_000_000,
        has_cooling_jacket: true,
        material: 'stainless_steel',
        location_id: locationId,
      });
      expect(jacket.status).toBe(201);
    } finally {
      await ctx.close();
    }
  });

  it('resuelve su QR y rechaza el de otro sistema', async () => {
    const ctx = await createTestApp();
    try {
      const { locationId } = await bodega(ctx);
      await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito 1',
        kind: 'tank_storage',
        capacity_ml: 1_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      const label = await call(ctx, 'GET', '/v1/vessels/INOX-01/qr', undefined, 'bodega@winecore.test');
      expect(label.status).toBe(200);
      const token = String(label.body.qr_token);
      expect(label.body.payload).toBe(`winecore:vessel:${token}`);
      const resolved = await call(ctx, 'GET', `/v1/vessels/qr/${token}`);
      expect(resolved.status).toBe(200);
      expect(resolved.body.code).toBe('INOX-01');

      const foreign = await call(ctx, 'GET', `/v1/vessels/qr/${encodeURIComponent('OTRO-SISTEMA-123456')}`);
      expect(foreign.status).toBe(422);
      expect(foreign.body.code).toBe('WC_QR_FOREIGN');
      const unknown = await call(ctx, 'GET', '/v1/vessels/qr/wcqr_aaaaaaaaaaaaaaaaaaaaaa');
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('WC_NOT_FOUND');
    } finally {
      await ctx.close();
    }
  });

  it('da de baja un recipiente vacío y no uno con vino', async () => {
    const ctx = await createTestApp();
    try {
      const { po, warehouse, locationId } = await bodega(ctx);
      const empty = await call(ctx, 'POST', '/v1/vessels', {
        code: 'DAM-001',
        name: 'Damajuana',
        kind: 'demijohn',
        capacity_ml: 50_000,
        material: 'glass',
        location_id: locationId,
      });
      expect(empty.status).toBe(201);
      const denied = await call(ctx, 'POST', '/v1/vessels/DAM-001/retire', { reason: 'rotura' }, 'bodega@winecore.test');
      expect(denied.status).toBe(403);
      const retired = await call(ctx, 'POST', '/v1/vessels/DAM-001/retire', { reason: 'rotura' });
      expect(retired.status).toBe(200);
      expect(retired.body.status).toBe('retired');
      expect(retired.body.state).toBe('retired');

      const tank = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 1_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(tank.body.id),
        code: 'L25T01',
        volumeMl: 10_000,
      });
      const blocked = await call(ctx, 'POST', '/v1/vessels/INOX-01/retire', { reason: 'baja' });
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('WC_VALIDATION');
      const still = await call(ctx, 'GET', '/v1/vessels/INOX-01');
      expect(still.body.status).toBe('in_service');
      expect(still.body.volume_ml).toBe(10_000);
      expect(still.body.lot_code).toBe('L25T01');
    } finally {
      await ctx.close();
    }
  });

  it('no archiva una ubicación con recipientes en servicio', async () => {
    const ctx = await createTestApp();
    try {
      const { locationId } = await bodega(ctx);
      await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-01',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 1_000_000,
        material: 'stainless_steel',
        location_id: locationId,
      });
      const archived = await call(ctx, 'POST', '/v1/locations/BOD/archive', { reason: 'cierre' });
      expect(archived.status).toBe(422);
      const location = await call(ctx, 'GET', '/v1/locations/BOD');
      expect(location.body.is_active).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

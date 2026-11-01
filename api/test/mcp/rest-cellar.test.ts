import { describe, expect, test } from 'bun:test';

import { call, entityId, seedHolding, seedWarehouse, type TestApp } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

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

async function confirmed(t: TestApp, name: string, args: unknown) {
  const prepared = await tool(t, `${name}_prepare`, args);
  expect(prepared.error ? JSON.stringify(prepared.data) : 'ok').toBe('ok');
  const committed = await tool(t, `${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? JSON.stringify(committed.data) : 'ok').toBe('ok');
  return { prepared: prepared.data, committed: committed.data };
}

interface Cellar {
  po: string;
  locationId: string;
  tankId: string;
  spareTankId: string;
  barrelId: string;
  lotId: string;
}

async function cellar(t: TestApp): Promise<Cellar> {
  const po = await entityId(t);
  const warehouse = await seedWarehouse(t, po);
  const location = await call(t, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega sintética',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  expect(location.status).toBe(201);
  const locationId = String(location.body.id);
  const vessel = async (code: string, kind: string, capacity: number, material: string) => {
    const created = await call(t, 'POST', '/v1/vessels', { code, name: `Recipiente ${code}`, kind, capacity_ml: capacity, material, location_id: locationId });
    expect(created.status).toBe(201);
    return String(created.body.id);
  };
  const tankId = await vessel('INOX-01', 'tank_storage', 8_000_000, 'stainless_steel');
  const spareTankId = await vessel('INOX-02', 'tank_storage', 8_000_000, 'stainless_steel');
  const barrelId = await vessel('BAR-001', 'barrel', 225_000, 'oak');
  const lotId = await seedHolding(t, { entityId: po, warehouseId: warehouse, locationId, vesselId: tankId, code: 'L25SINT', volumeMl: 1_000_000 });
  return { po, locationId, tankId, spareTankId, barrelId, lotId };
}

function rackingLines(world: Cellar, to: string, volumeMl: number, withLot = true) {
  const lot = withLot ? { lot_id: world.lotId } : {};
  return [
    { role: 'input', ...lot, vessel_id: world.tankId, volume_ml: volumeMl, product_state: 'wine' },
    { role: 'output', ...lot, vessel_id: to, volume_ml: volumeMl, product_state: 'wine' },
  ];
}

function racking(world: Cellar, to: string, volumeMl: number, withLot = true) {
  return {
    op_type: 'racking',
    legal_entity_id: world.po,
    occurred_at: '2026-06-15T08:00:00Z',
    performed_by: 'Operario sintético',
    lines: rackingLines(world, to, volumeMl, withLot),
  };
}

describe('MCP de bodega sobre las rutas de la app', () => {
  test('lista recipientes, da de alta y edita uno, y coloca y quita en el plano de una zona nueva', async () => {
    const t = await createTestApp();
    try {
      const world = await cellar(t);

      const listed = await tool(t, 'cellar_vessels_browse', { kind: 'tank_storage' });
      expect(listed.error).toBe(false);
      expect((listed.data.items as { code: string }[]).map((item) => item.code)).toEqual(['INOX-01', 'INOX-02']);
      const tank = await tool(t, 'cellar_vessel_get', { code: 'INOX-01' });
      expect(tank.data).toMatchObject({ id: world.tankId, lot_code: 'L25SINT', volume_ml: 1_000_000 });

      const prepared = await tool(t, 'cellar_vessel_create_prepare', {
        code: 'BAR-101',
        name: 'Barrica sintética',
        kind: 'barrel',
        capacity_ml: 225_000,
        material: 'oak',
        location_id: world.locationId,
      });
      expect(prepared.error).toBe(false);
      expect((prepared.data.preview as { route: string }).route).toBe('POST /v1/vessels');
      expect(String(prepared.data.summary_es)).toContain('225 L');
      expect((await call(t, 'GET', '/v1/vessels/BAR-101')).status).toBe(404);
      const created = await tool(t, 'cellar_vessel_create_commit', { confirmation_token: prepared.data.confirmation_token });
      expect(created.error).toBe(false);
      expect((created.data.links as { web: string }).web.endsWith('/bodega/depositos/BAR-101')).toBe(true);
      expect((await call(t, 'GET', '/v1/vessels/BAR-101')).body).toMatchObject({ kind: 'barrel', status: 'in_service', volume_ml: 0 });

      const edit = await confirmed(t, 'cellar_vessel_update', { code: 'BAR-101', changes: { name: 'Barrica francesa', zone: 'Crianza' } });
      expect((edit.prepared.preview as { record: { name: string }; changes: unknown }).record.name).toBe('Barrica sintética');
      expect((edit.prepared.preview as { changes: unknown }).changes).toEqual({ name: 'Barrica francesa', zone: 'Crianza' });
      expect((await call(t, 'GET', '/v1/vessels/BAR-101')).body).toMatchObject({ name: 'Barrica francesa', zone: 'Crianza' });

      const tooSmall = await tool(t, 'cellar_vessel_update_prepare', { code: 'INOX-01', changes: { capacity_ml: 500_000 } });
      expect(tooSmall.error).toBe(false);
      const refused = await tool(t, 'cellar_vessel_update_commit', { confirmation_token: tooSmall.data.confirmation_token });
      expect(refused.error).toBe(true);
      expect(refused.data.code).toBe('WC025');

      await confirmed(t, 'cellar_zone_create', {
        location_id: world.locationId,
        code: 'CRIANZA',
        name: 'Sala de barricas',
        kind: 'barrel_room',
      });
      expect((await call(t, 'GET', '/v1/cellar-zones/CRIANZA')).body).toMatchObject({ kind: 'barrel_room', is_active: true, positions: [] });

      const placed = await confirmed(t, 'cellar_zone_position_add', {
        code: 'CRIANZA',
        vessel_code: 'BAR-101',
        x: 24,
        y: 24,
        width: 108,
        height: 64,
        rotation: 0,
      });
      const positionId = String(placed.committed.id);
      await confirmed(t, 'cellar_zone_update', { code: 'CRIANZA', changes: { name: 'Sala de crianza' } });
      const zone = (await call(t, 'GET', '/v1/cellar-zones/CRIANZA')).body;
      expect(zone.name).toBe('Sala de crianza');
      expect((zone.positions as { id: string; vessel_code: string }[]).map((item) => [item.id, item.vessel_code])).toEqual([[positionId, 'BAR-101']]);

      const map = await tool(t, 'cellar_map_get', { location: 'BOD' });
      expect(map.error).toBe(false);
      const zones = map.data.zones as { code: string; vessels: { code: string }[] }[];
      expect(zones.find((item) => item.code === 'CRIANZA')?.vessels.map((item) => item.code)).toEqual(['BAR-101']);

      const removed = await confirmed(t, 'cellar_zone_position_remove', { code: 'CRIANZA', position_id: positionId });
      expect(String(removed.prepared.summary_es)).toContain('BAR-101');
      expect((await call(t, 'GET', '/v1/cellar-zones/CRIANZA')).body.positions).toEqual([]);
    } finally {
      await t.close();
    }
  });

  test('crea, edita, previsualiza, confirma y rectifica un trasiego; la confirmación se niega si el borrador cambió', async () => {
    const t = await createTestApp();
    try {
      const world = await cellar(t);

      const draft = await confirmed(t, 'cellar_operation_create', racking(world, world.barrelId, 225_000, false));
      expect(String(draft.prepared.summary_es)).toContain('trasiego');
      expect(String(draft.prepared.summary_es)).toContain('225 L');
      expect(draft.committed).toMatchObject({ status: 'draft', op_type: 'racking', number: null });
      const id = String(draft.committed.id);
      expect((draft.committed.links as { web: string }).web.endsWith(`/bodega/operaciones/${id}`)).toBe(true);

      const edited = await confirmed(t, 'cellar_operation_update', {
        id,
        changes: { performed_by: 'Bodeguera sintética', lines: rackingLines(world, world.barrelId, 225_000) },
      });
      const sent = (edited.prepared.preview as { changes: Record<string, unknown> & { lines: unknown[] } }).changes;
      expect(sent).toMatchObject({ op_type: 'racking', legal_entity_id: world.po, performed_by: 'Bodeguera sintética', occurred_at: '2026-06-15T08:00:00.000Z' });
      expect(sent.lines).toHaveLength(2);
      expect(edited.committed).toMatchObject({ status: 'draft', performed_by: 'Bodeguera sintética' });
      expect(((edited.committed.details as { lines: unknown[] }).lines)).toHaveLength(2);

      const preview = await tool(t, 'cellar_operation_preview', { id });
      expect(preview.error).toBe(false);
      expect((preview.data.stock_moves as unknown[]).length).toBeGreaterThan(0);
      expect((await call(t, 'GET', `/v1/cellar-operations/${id}`)).body.status).toBe('draft');
      expect((await call(t, 'GET', '/v1/vessels/BAR-001')).body.volume_ml).toBe(0);

      const posted = await confirmed(t, 'cellar_operation_confirm', { id });
      expect(String(posted.prepared.summary_es)).toContain('No se deshace');
      expect(posted.committed.status).toBe('confirmed');
      expect(String(posted.committed.number)).toMatch(/^OB26-\d{4}$/);
      expect((await call(t, 'GET', '/v1/vessels/BAR-001')).body.volume_ml).toBe(225_000);
      expect((await call(t, 'GET', '/v1/vessels/INOX-01')).body.volume_ml).toBe(775_000);

      const undone = await confirmed(t, 'cellar_operation_rectify', { id, reason: 'Barrica equivocada' });
      expect(undone.committed).toMatchObject({ status: 'confirmed', rectifies_operation_id: id });
      expect((await call(t, 'GET', `/v1/cellar-operations/${id}`)).body.status).toBe('rectified');
      expect((await call(t, 'GET', '/v1/vessels/BAR-001')).body.volume_ml).toBe(0);
      expect((await call(t, 'GET', '/v1/vessels/INOX-01')).body.volume_ml).toBe(1_000_000);

      const other = await call(t, 'POST', '/v1/cellar-operations', racking(world, world.spareTankId, 100_000));
      expect(other.status).toBe(201);
      const otherId = String(other.body.id);
      const stale = await tool(t, 'cellar_operation_confirm_prepare', { id: otherId });
      expect(stale.error).toBe(false);
      expect((await call(t, 'POST', `/v1/cellar-operations/${otherId}/confirm`)).status).toBe(200);
      const late = await tool(t, 'cellar_operation_confirm_commit', { confirmation_token: stale.data.confirmation_token });
      expect(late.error).toBe(true);
      expect(late.data.code).toBe('WC_MCP_PREVIEW_STALE');
      expect((await call(t, 'GET', '/v1/vessels/INOX-02')).body.volume_ml).toBe(100_000);
    } finally {
      await t.close();
    }
  });
});

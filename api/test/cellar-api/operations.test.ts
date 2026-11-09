import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, counts, entityId, seedHolding, seedWarehouse } from './fixtures';

interface World {
  po: string;
  warehouse: string;
  locationId: string;
  tankId: string;
  barrelId: string;
  lotId: string;
}

async function world(ctx: Awaited<ReturnType<typeof createTestApp>>): Promise<World> {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  const tank = await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-01',
    name: 'Depósito',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: String(location.body.id),
    zone: 'Nave 1',
  });
  const barrel = await call(ctx, 'POST', '/v1/vessels', {
    code: 'BAR-001',
    name: 'Barrica',
    kind: 'barrel',
    capacity_ml: 225_000,
    material: 'oak',
    location_id: String(location.body.id),
    zone: 'Crianza',
  });
  const lotId = await seedHolding(ctx, {
    entityId: po,
    warehouseId: warehouse,
    locationId: String(location.body.id),
    vesselId: String(tank.body.id),
    code: 'L25T01',
    volumeMl: 1_000_000,
  });
  return {
    po,
    warehouse,
    locationId: String(location.body.id),
    tankId: String(tank.body.id),
    barrelId: String(barrel.body.id),
    lotId,
  };
}

function transfer(cellar: World, outputMl: number, lossMl: number) {
  const input = outputMl + lossMl;
  return {
    op_type: 'racking',
    legal_entity_id: cellar.po,
    occurred_at: '2026-06-15T08:00:00Z',
    fiscal_date: '2026-06-15',
    performed_by: 'Operario sintético',
    lines: [
      { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: input, product_state: 'wine' },
      { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: outputMl, product_state: 'wine' },
      ...(lossMl > 0
        ? [{
          role: 'loss',
          lot_id: cellar.lotId,
          vessel_id: cellar.tankId,
          volume_ml: lossMl,
          loss_kind: 'authorized',
          product_state: 'wine',
        }]
        : []),
    ],
  };
}

describe('operaciones de bodega', () => {
  it('edita un borrador con lotes y recipientes, también su fecha', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const draft = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'bodega@winecore.test');
      expect(draft.status).toBe(201);
      const edited = await call(ctx, 'PATCH', `/v1/cellar-operations/${draft.body.id}`, {
        ...transfer(cellar, 200_000, 0),
        occurred_at: '2026-06-16T08:00:00Z',
        fiscal_date: '2026-06-16',
      }, 'bodega@winecore.test');
      expect(edited.status).toBe(200);
      expect(String(edited.body.occurred_at)).toStartWith('2026-06-16');
      const lines = edited.body.lines as { role: string; volume_ml: number }[];
      expect(lines.map((line) => [line.role, line.volume_ml])).toEqual([['input', 200_000], ['output', 200_000]]);
    } finally {
      await ctx.close();
    }
  });

  it('trasiega de depósito a barrica con merma y mueve el libro fiscal', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const denied = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'asesor@winecore.test');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');

      const draft = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'bodega@winecore.test');
      expect(draft.status).toBe(201);
      expect(draft.body.status).toBe('draft');
      expect(draft.body.number).toBeNull();
      expect(draft.body.stock_moves).toEqual([]);

      const preview = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/preview`, undefined, 'bodega@winecore.test');
      expect(preview.status).toBe(200);
      const previewFiscal = preview.body.fiscal_moves as { move_type: string }[];
      expect(previewFiscal.map((row) => row.move_type)).toEqual(['ledger_change_out', 'ledger_change_in', 'loss']);
      expect(await counts(ctx)).toMatchObject({ operations: 1, stock: 1, fiscal: 1, edges: 0 });

      const created = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({
        number: 'OB26-0001',
        op_type: 'racking',
        status: 'confirmed',
        silicie_relevant: true,
      });
      const fiscal = created.body.fiscal_moves as { move_type: string; product_class: string; volume_ml: number; excise_product_key: string }[];
      expect(fiscal.map((row) => [row.move_type, row.product_class, row.volume_ml, row.excise_product_key])).toEqual([
        ['ledger_change_out', 'bulk', -220_000, 'GRANEL-TINTO'],
        ['ledger_change_in', 'bulk_wood', 220_000, 'CRIANZA-TINTO'],
        ['loss', 'bulk', -5_000, 'GRANEL-TINTO'],
      ]);
      const stock = created.body.stock_moves as { move_type: string; vessel_id: string; volume_ml: number; loss_kind: string | null }[];
      expect(stock.map((row) => [row.move_type, row.vessel_id, row.volume_ml, row.loss_kind])).toEqual([
        ['cellar_out', cellar.tankId, -220_000, null],
        ['loss', cellar.tankId, -5_000, 'authorized'],
        ['cellar_in', cellar.barrelId, 220_000, null],
      ]);

      const vessels = await call(ctx, 'GET', '/v1/vessels', undefined, 'asesor@winecore.test');
      const items = vessels.body.items as { code: string; volume_ml: number; state: string; fill_pct: string; lot_code: string }[];
      expect(items.find((item) => item.code === 'INOX-01')).toMatchObject({
        volume_ml: 775_000,
        lot_code: 'L25T01',
        state: 'wine',
        fill_pct: '9.7',
      });
      expect(items.find((item) => item.code === 'BAR-001')).toMatchObject({
        volume_ml: 220_000,
        lot_code: 'L25T01',
        state: 'aging',
        fill_pct: '97.8',
      });

      const detail = await call(ctx, 'GET', `/v1/cellar-operations/${created.body.id}`, undefined, 'asesor@winecore.test');
      expect(detail.status).toBe(200);
      expect(detail.body.number).toBe('OB26-0001');
      const list = await call(ctx, 'GET', '/v1/cellar-operations');
      expect(list.body.total).toBe(1);
      expect((list.body.items as { number: string }[])[0]?.number).toBe('OB26-0001');

      const history = await call(ctx, 'GET', '/v1/vessels/INOX-01/history');
      expect(history.body.total).toBe(1);
      expect((history.body.items as { op_type: string; lines: unknown[] }[])[0]?.op_type).toBe('racking');

      const immutable = await call(ctx, 'PATCH', `/v1/cellar-operations/${created.body.id}`, transfer(cellar, 220_000, 5_000));
      expect(immutable.status).toBe(409);
      expect(immutable.body.code).toBe('WC031');
      const still = await call(ctx, 'GET', `/v1/cellar-operations/${created.body.id}`);
      expect(still.body.reason).toBeNull();

      const where = await call(ctx, 'GET', '/v1/lots/L25T01');
      const positions = where.body.positions as { vessel_code: string; volume_ml: number }[];
      expect(positions.map((row) => [row.vessel_code, row.volume_ml])).toEqual([
        ['BAR-001', 220_000],
        ['INOX-01', 775_000],
      ]);

      const chain = await call(ctx, 'POST', '/v1/audit/verify');
      expect(chain.body.intact).toBe(true);

      const rectified = await call(ctx, 'POST', `/v1/cellar-operations/${created.body.id}/rectify`, {
        reason: 'error de litros',
      }, 'bodega@winecore.test');
      expect(rectified.status).toBe(201);
      expect(rectified.body.status).toBe('confirmed');
      expect(rectified.body.rectifies_operation_id).toBe(created.body.id);
      const moves = rectified.body.stock_moves as { move_type: string; volume_ml: number }[];
      expect(moves.every((row) => row.move_type === 'reversal')).toBe(true);
      expect(moves.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(5_000);
      const original = await call(ctx, 'GET', `/v1/cellar-operations/${created.body.id}`);
      expect(original.body.status).toBe('rectified');
      expect(original.body.number).toBe('OB26-0001');
      const restored = await call(ctx, 'GET', '/v1/vessels/INOX-01');
      expect(restored.body.volume_ml).toBe(1_000_000);
      const barrel = await call(ctx, 'GET', '/v1/vessels/BAR-001');
      expect(barrel.body.volume_ml).toBe(0);
      expect(barrel.body.state).toBe('empty');
    } finally {
      await ctx.close();
    }
  });

  it('el ensamblaje crea un lote con genealogía', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const second = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-02',
        name: 'Depósito 2',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: cellar.locationId,
      });
      const third = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-03',
        name: 'Depósito 3',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: cellar.locationId,
      });
      const other = await seedHolding(ctx, {
        entityId: cellar.po,
        warehouseId: cellar.warehouse,
        locationId: cellar.locationId,
        vesselId: String(second.body.id),
        code: 'L25T02',
        volumeMl: 600_000,
      });
      const draft = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'blend',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-16T08:00:00Z',
        fiscal_date: '2026-06-16',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L25ENS1' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 400_000, product_state: 'wine' },
          { role: 'input', lot_id: other, vessel_id: String(second.body.id), volume_ml: 600_000, product_state: 'wine' },
          { role: 'output', vessel_id: String(third.body.id), volume_ml: 1_000_000, product_state: 'wine' },
        ],
      });
      expect(draft.status).toBe(201);
      const created = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`);
      expect(created.status).toBe(200);
      expect(created.body.number).toBe('OB26-0001');
      const edges = created.body.lot_edges as { volume_ml: number }[];
      expect(edges.map((edge) => edge.volume_ml).sort((a, b) => a - b)).toEqual([400_000, 600_000]);

      const child = await call(ctx, 'GET', '/v1/lots/L25ENS1', undefined, 'asesor@winecore.test');
      expect(child.status).toBe(200);
      expect(child.body.kind).toBe('wine');
      expect(child.body.vintage).toBe(2025);
      const ancestors = child.body.ancestors as { code: string; depth: number }[];
      expect(ancestors.map((row) => row.code).sort()).toEqual(['L25T01', 'L25T02']);
      expect(ancestors.every((row) => row.depth === 1)).toBe(true);
      const composition = child.body.composition as { parent_code: string; volume_ml: number }[];
      expect(composition.map((row) => [row.parent_code, row.volume_ml]).sort()).toEqual([
        ['L25T01', 400_000],
        ['L25T02', 600_000],
      ]);
      expect(child.body.positions).toEqual([
        expect.objectContaining({ vessel_code: 'INOX-03', volume_ml: 1_000_000, product_state: 'wine' }),
      ]);

      const parent = await call(ctx, 'GET', '/v1/lots/L25T02');
      expect(parent.body.descendants).toEqual([
        expect.objectContaining({ code: 'L25ENS1', depth: 1 }),
      ]);
      const missing = await call(ctx, 'GET', '/v1/lots/NOEXISTE');
      expect(missing.status).toBe(404);
      const index = await call(ctx, 'GET', '/v1/lots?kind=wine&vintage=2025&status=active&q=ENS');
      const found = index.body.items as { code: string; volume_ml: number; vessel_code: string | null }[];
      expect(found.map((row) => row.code)).toContain('L25ENS1');
      expect(found.find((row) => row.code === 'L25ENS1')).toMatchObject({ volume_ml: 1_000_000, vessel_code: 'INOX-03' });
      const trace = await call(ctx, 'GET', '/v1/lots/L25ENS1/traceability?direction=up');
      expect(trace.status).toBe(200);
      const nodes = trace.body.nodes as { code: string }[];
      expect(nodes.map((node) => node.code).sort()).toEqual(['L25ENS1', 'L25T01', 'L25T02']);
      expect(String(trace.body.mermaid)).toContain('L25T01');
      expect(String(trace.body.mermaid)).toContain('-->');
      const down = await call(ctx, 'GET', '/v1/lots/L25T02/traceability?direction=down');
      expect((down.body.nodes as { code: string }[]).map((node) => node.code).sort()).toEqual(['L25ENS1', 'L25T02']);
      const moves = await call(ctx, 'GET', '/v1/lots/L25ENS1/moves');
      expect((moves.body.total as number) > 0).toBe(true);
      const analyses = await call(ctx, 'GET', '/v1/lots/L25ENS1/analyses');
      expect(analyses.body).toEqual({ items: [], next_cursor: null, total: 0 });
      const sales = await call(ctx, 'GET', '/v1/lots/L25ENS1/sales');
      expect(sales.body).toEqual({ items: [], next_cursor: null, total: 0 });
    } finally {
      await ctx.close();
    }
  });

  it('capacidad y conservación no dejan rastro', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const unbalanced = await call(ctx, 'POST', '/v1/cellar-operations', {
        ...transfer(cellar, 900, 0),
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 1_000, product_state: 'wine' },
          { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: 900, product_state: 'wine' },
        ],
      });
      const capacityDraft = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 300_000, 0));
      expect(unbalanced.status).toBe(201);
      expect(capacityDraft.status).toBe(201);
      const before = await counts(ctx);
      const conserved = await call(ctx, 'POST', `/v1/cellar-operations/${unbalanced.body.id}/confirm`);
      expect(conserved.status).toBe(422);
      expect(conserved.body.code).toBe('WC020');
      expect(String(conserved.body.message)).toContain('no cuadra');
      const capacity = await call(ctx, 'POST', `/v1/cellar-operations/${capacityDraft.body.id}/confirm`);
      expect(capacity.status).toBe(422);
      expect(capacity.body.code).toBe('WC025');
      expect(await counts(ctx)).toEqual(before);

      const vessels = await call(ctx, 'GET', '/v1/vessels/INOX-01');
      expect(vessels.body.volume_ml).toBe(1_000_000);
      const series = await ctx.writer.read<{ next_value: number }>(`
        SELECT next_value FROM core.number_series
        WHERE doc_type = 'cellar_operation' AND year = 2026
      `);
      expect(series.every((row) => row.next_value === 1)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un periodo cerrado sin escribir', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const draft = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000));
      const before = await counts(ctx);
      await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: 'lock' }, async (tx) => {
        tx.write(`
          INSERT INTO inventory.period_lock (ledger, locked_until, locked_by, reason)
          VALUES ('physical', DATE '2026-10-31', 'asesor', 'cierre de prueba')
        `);
      });
      const closed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('WC021');
      expect(String(closed.body.message)).toContain('cerrado');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('la destrucción y la merma por incidencia no se registran sin el módulo de aprobaciones', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const destructionDraft = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'destruction',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-15T08:00:00Z',
        fiscal_date: '2026-06-15',
        performed_by: 'Operario sintético',
        reason: 'producto defectuoso',
        approval_request_id: '019a0000-0000-7000-8000-00000000aa01',
        lines: [{
          role: 'loss',
          lot_id: cellar.lotId,
          vessel_id: cellar.tankId,
          volume_ml: 1_000,
          loss_kind: 'incident',
          product_state: 'wine',
        }],
      });
      expect(destructionDraft.status).toBe(201);
      const incidentDraft = await call(ctx, 'POST', '/v1/cellar-operations', {
        ...transfer(cellar, 220_000, 5_000),
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 225_000, product_state: 'wine' },
          { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: 220_000, product_state: 'wine' },
          {
            role: 'loss',
            lot_id: cellar.lotId,
            vessel_id: cellar.tankId,
            volume_ml: 5_000,
            loss_kind: 'incident',
            product_state: 'wine',
          },
        ],
        reason: 'derrame',
        approval_request_id: '019a0000-0000-7000-8000-00000000aa01',
      });
      expect(incidentDraft.status).toBe(201);
      const before = await counts(ctx);
      const destruction = await call(ctx, 'POST', `/v1/cellar-operations/${destructionDraft.body.id}/confirm`);
      expect(destruction.status).toBe(409);
      expect(destruction.body.code).toBe('WC_NOT_APPROVED');
      const incident = await call(ctx, 'POST', `/v1/cellar-operations/${incidentDraft.body.id}/confirm`);
      expect(incident.status).toBe(409);
      expect(incident.body.code).toBe('WC_NOT_APPROVED');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza una referencia que no existe', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const missingLot = await call(ctx, 'POST', '/v1/cellar-operations', {
        ...transfer(cellar, 220_000, 5_000),
        lines: [
          {
            role: 'input',
            lot_id: '019a0000-0000-7000-8000-00000000ffff',
            vessel_id: cellar.tankId,
            volume_ml: 1_000,
            product_state: 'wine',
          },
          {
            role: 'output',
            lot_id: cellar.lotId,
            vessel_id: cellar.barrelId,
            volume_ml: 1_000,
            product_state: 'wine',
          },
        ],
      });
      expect(missingLot.status).toBe(422);
      expect(missingLot.body.code).toBe('WC_VALIDATION');
      expect((missingLot.body.fields as { 'lines[0].lot_id'?: string })['lines[0].lot_id']).toContain('lote');
      const missingWine = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'blend',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-16T08:00:00Z',
        fiscal_date: '2026-06-16',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L25ENS9', wine_id: '019a0000-0000-7000-8000-00000000eeee' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 100, product_state: 'wine' },
          { role: 'output', vessel_id: cellar.barrelId, volume_ml: 100, product_state: 'wine' },
        ],
      });
      expect(missingWine.status).toBe(422);
      expect((missingWine.body.fields as { 'new_lot.wine_id'?: string })['new_lot.wine_id']).toContain('vino');
    } finally {
      await ctx.close();
    }
  });

  it('sin serie de numeración responde WC010 y no escribe', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: 'drop-series' }, async (tx) => {
        tx.write(`
          DELETE FROM core.number_series
          WHERE doc_type = 'cellar_operation' AND year = 2026
            AND legal_entity_id = CAST('${cellar.po}' AS UUID)
        `);
      });
      const draft = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000));
      const before = await counts(ctx);
      const missing = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`);
      expect(missing.status).toBe(409);
      expect(missing.body.code).toBe('WC010');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('filtra, etiqueta, recibe granel y deja la revisión en el depósito', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const empty = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-02',
        name: 'Depósito vacío',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: cellar.locationId,
        zone: 'Nave 1',
      });
      expect(empty.status).toBe(201);
      const filtered = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'filtration',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-15T09:00:00Z',
        fiscal_date: '2026-06-15',
        performed_by: 'Operario sintético',
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 300_000, product_state: 'wine' },
          { role: 'output', lot_id: cellar.lotId, vessel_id: String(empty.body.id), volume_ml: 300_000, product_state: 'wine' },
        ],
      }, 'bodega@winecore.test');
      expect(filtered.status).toBe(201);
      const filteredOk = await call(ctx, 'POST', `/v1/cellar-operations/${filtered.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(filteredOk.status).toBe(200);

      const bought = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bulk_reception',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-16T09:00:00Z',
        fiscal_date: '2026-06-16',
        performed_by: 'Operario sintético',
        vessel_id: cellar.barrelId,
        volume_ml: 200_000,
        product_state: 'wine',
        lot_code: 'L26COMPRA',
        vintage: 2026,
        is_organic: true,
        excise_product_key: 'CRIANZA-TINTO',
        abv_pct: '13.50',
      }, 'bodega@winecore.test');
      expect(bought.status).toBe(201);
      const boughtOk = await call(ctx, 'POST', `/v1/cellar-operations/${bought.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(boughtOk.status).toBe(200);
      const fiscal = boughtOk.body.fiscal_moves as { move_type: string }[];
      expect(fiscal.map((row) => row.move_type)).toContain('bulk_receipt');

      const productId = newId();
      const bottledLot = newId();
      const opening = newId();
      const placement = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, unit, is_stock_tracked, requires_lot)
          VALUES (CAST(${productId} AS UUID), ${'B075FLUJO'}, ${'Botella de prueba'}, ${'wine'}, ${'ud'}, TRUE, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, is_organic, status, origin)
          VALUES (
            CAST(${bottledLot} AS UUID), CAST(${cellar.po} AS UUID), ${'B26JAULON'}, ${'bottled'},
            2026, TRUE, ${'active'}, ${'operation'}
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
            qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${opening} AS UUID),
            CAST(${'2026-06-01T06:00:00Z'} AS TIMESTAMPTZ),
            ${'opening'},
            CAST(${cellar.locationId} AS UUID),
            CAST(${cellar.po} AS UUID),
            CAST(${bottledLot} AS UUID),
            CAST(${productId} AS UUID),
            ${'packaged_unlabeled'},
            40,
            30000,
            0,
            ${'inventory.inventory_count'},
            CAST(${opening} AS UUID),
            ${'cellar-test'}
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, line_no, wine_label, lot_id, product_id,
            owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml, product_state, not_for_sale,
            match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${placement} AS UUID), CAST(${cellar.locationId} AS UUID), 'jaulon', 'JAU-01', 1, 'Jaulón',
            CAST(${bottledLot} AS UUID), CAST(${productId} AS UUID), CAST(${cellar.po} AS UUID),
            40, 750, 30000, 'packaged_unlabeled', FALSE, 'matched', 'test', 1, DATE '2026-11-09'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_move (
            id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-06-01 08:00:00+02', CAST(${placement} AS UUID),
            40, 30000, 'opening', CAST(${bottledLot} AS UUID), 'cellar.bottled_placement', CAST(${placement} AS UUID), 'cellar-test'
          )
        `);
      });
      const labeled = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'labeling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-17T09:00:00Z',
        fiscal_date: '2026-06-17',
        performed_by: 'Operario sintético',
        lines: [
          {
            role: 'input', lot_id: bottledLot, location_id: cellar.locationId, owner_entity_id: cellar.po,
            product_id: productId, product_state: 'packaged_unlabeled', qty_units: 40, volume_ml: 30_000, nominal_volume_ml: 750,
          },
          {
            role: 'output', location_id: cellar.locationId, lot_id: bottledLot, product_id: productId,
            product_state: 'packaged_labeled', qty_units: 40, volume_ml: 30_000, nominal_volume_ml: 750,
          },
        ],
      }, 'bodega@winecore.test');
      expect(labeled.status, JSON.stringify(labeled.body)).toBe(201);
      const labeledOk = await call(ctx, 'POST', `/v1/cellar-operations/${labeled.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(labeledOk.status, JSON.stringify(labeledOk.body)).toBe(200);
      const moves = labeledOk.body.stock_moves as { product_state: string; qty_units: number }[];
      expect(moves).toEqual([]);
      expect(labeledOk.body.fiscal_moves).toEqual([]);
      const map = await ctx.writer.read<{ code: string; state: string; bottles: string }>(sql`
        SELECT p.slot_code AS code, p.product_state AS state, coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
        FROM cellar.bottled_placement p
        LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
        WHERE p.lot_id = CAST(${bottledLot} AS UUID)
        GROUP BY p.slot_code, p.product_state
      `);
      expect(map.find((row) => row.code === 'JAU-01')?.bottles).toBe('0');
      expect(map.some((row) => row.state === 'packaged_labeled' && row.bottles === '40')).toBe(true);

      const sample = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-18T09:00:00Z',
        performed_by: 'Operario sintético',
        vessel_id: cellar.tankId,
        lot_id: cellar.lotId,
        sampled_at: '2026-06-18T09:00:00Z',
        sample_code: 'M-REV-01',
        destination: 'internal',
      }, 'bodega@winecore.test');
      expect(sample.status).toBe(201);
      const sampleOk = await call(ctx, 'POST', `/v1/cellar-operations/${sample.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(sampleOk.status).toBe(200);
      const history = await call(ctx, 'GET', '/v1/vessels/INOX-01/history?limit=20', undefined, 'bodega@winecore.test');
      expect(history.status).toBe(200);
      const kinds = (history.body.items as { op_type: string }[]).map((row) => row.op_type);
      expect(kinds).toContain('sampling');
      expect(kinds).toContain('filtration');
    } finally {
      await ctx.close();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { call, entityId, seedWarehouse } from '../cellar-api/fixtures';

describe('nichos y jaulones', () => {
  it('rechaza un jaulón por encima de su capacidad y lo deja en la clave de stock', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const { locationId, lotId, productId } = await bottled(ctx, po);
      const created = await call(ctx, 'POST', '/v1/holders', {
        code: 'JAU-001',
        name: 'Jaulón 1',
        kind: 'jaulon',
        location_id: locationId,
        number: 1,
        capacity_bottles: 600,
        nominal_volume_ml: 750,
        format: 'B075',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        kind: 'jaulon',
        kind_label: 'jaulón',
        number: 1,
        capacity_bottles: 600,
        count: 0,
        state: 'empty',
      });

      const overflow = await move(ctx, 'JAU-001', po, lotId, productId, 'packaged_unlabeled', 601);
      expect(overflow.status).toBe(422);
      expect(overflow.body.code).toBe('WC025');

      const filled = await move(ctx, 'JAU-001', po, lotId, productId, 'packaged_unlabeled', 600);
      expect(filled.status).toBe(201);
      expect(filled.body.count).toBe(600);
      expect(filled.body.lot_id).toBe(lotId);
      expect(filled.body.stock_key).toMatchObject({
        recipiente: created.body.id,
        estado: 'packaged_unlabeled',
        lote: lotId,
        producto: productId,
        propietario: po,
        ubicacion: locationId,
      });

      const extra = await move(ctx, 'JAU-001', po, lotId, productId, 'packaged_unlabeled', 1);
      expect(extra.status).toBe(422);
      expect(extra.body.code).toBe('WC025');

      const stock = await call(ctx, 'GET', '/v1/holder-stock?holder=JAU-001&state=packaged_unlabeled');
      expect(stock.status).toBe(200);
      const items = stock.body.items as Array<{ qty_units: number; stock_key: { recipiente: string; estado: string } }>;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        qty_units: 600,
        stock_key: { recipiente: created.body.id, estado: 'packaged_unlabeled' },
      });
    } finally {
      await ctx.close();
    }
  });

  it('anota un nicho dentro de un aforo', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const { locationId, lotId, productId } = await bottled(ctx, po);
      const niche = await call(ctx, 'POST', '/v1/holders', {
        code: 'NIC-A1',
        name: 'Nicho A1',
        kind: 'nicho',
        location_id: locationId,
        nominal_volume_ml: 750,
      });
      expect(niche.status).toBe(201);
      const entered = await move(ctx, 'NIC-A1', po, lotId, productId, 'packaged_labeled', 24);
      expect(entered.status).toBe(201);

      const count = await call(ctx, 'POST', '/v1/inventory-counts', {
        legal_entity_id: po,
        kind: 'spot',
        counted_at: '2026-10-15T10:00:00+02:00',
        location_ids: [locationId],
      });
      expect(count.status).toBe(200);
      const countId = String(count.body.id);

      const denied = await call(ctx, 'POST', `/v1/inventory-counts/${countId}/holder-lines`, {
        holder_code: 'NIC-A1',
        owner_entity_id: po,
        lot_id: lotId,
        product_id: productId,
        product_state: 'packaged_labeled',
        counted_qty_units: 24,
      }, 'asesor@winecore.test');
      expect(denied.status).toBe(403);

      const line = await call(ctx, 'POST', `/v1/inventory-counts/${countId}/holder-lines`, {
        holder_code: 'NIC-A1',
        owner_entity_id: po,
        lot_id: lotId,
        product_id: productId,
        product_state: 'packaged_labeled',
        counted_qty_units: 24,
      });
      expect(line.status).toBe(201);
      expect(line.body).toMatchObject({
        holder_code: 'NIC-A1',
        holder_kind: 'nicho',
        product_state: 'packaged_labeled',
        counted_qty_units: 24,
        counted_volume_ml: 18_000,
        expected_qty_units: 24,
        stock_key: {
          recipiente: niche.body.id,
          estado: 'packaged_labeled',
        },
      });

      const stored = await ctx.writer.read<{ vessel_id: string | null; product_state: string; counted_qty_units: number; holder_id: string }>(sql`
        SELECT l.vessel_id::VARCHAR AS vessel_id, l.product_state, l.counted_qty_units,
               h.holder_id::VARCHAR AS holder_id
        FROM inventory.inventory_count_line l
        JOIN cellar.holder_count_line h ON h.count_line_id = l.id
        WHERE l.count_id = CAST(${countId} AS UUID)
      `);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.vessel_id ?? null).toBeNull();
      expect(stored[0]?.product_state).toBe('packaged_labeled');
      expect(Number(stored[0]?.counted_qty_units)).toBe(24);
      expect(String(stored[0]?.holder_id).toLowerCase()).toBe(String(niche.body.id).toLowerCase());
    } finally {
      await ctx.close();
    }
  });
});

async function bottled(ctx: Awaited<ReturnType<typeof createTestApp>>, po: string) {
  const warehouse = await seedWarehouse(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOT',
    name: 'Almacén de botellas',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  expect(location.status).toBe(201);
  const locationId = String(location.body.id);
  const wineId = newId();
  const formatId = newId();
  const productId = newId();
  const lotId = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-assets-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
      VALUES (CAST(${wineId} AS UUID), 'TINTO', 'Tinto Ejemplo', 'red', 'wine', TRUE)
    `);
    tx.write(sql`
      INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
      VALUES (CAST(${formatId} AS UUID), 'B075', 'Botella 0,75 L', 'bottle', 750)
    `);
    tx.write(sql`
      INSERT INTO catalog.product (
        id, sku, name, kind, wine_id, vintage, format_id, unit, nc_code, excise_product_key, alcohol_pct, requires_lot
      ) VALUES (
        CAST(${productId} AS UUID), 'TB-2025-075', 'Tinto Ejemplo 2025 0,75', 'wine',
        CAST(${wineId} AS UUID), 2019, CAST(${formatId} AS UUID), 'ud', '22042138', 'B075-TINTO',
        CAST(${'13.50'} AS DECIMAL(4,2)), TRUE
      )
    `);
    tx.write(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin, status)
      VALUES (
        CAST(${lotId} AS UUID), CAST(${po} AS UUID), 'L25-B075', 'bottled',
        CAST(${wineId} AS UUID), 2019, 'operation', 'active'
      )
    `);
  });
  return { locationId, lotId, productId };
}

function move(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  code: string,
  owner: string,
  lotId: string,
  productId: string,
  state: string,
  qty: number,
) {
  return call(ctx, 'POST', `/v1/holders/${code}/moves`, {
    occurred_at: '2026-10-01T08:00:00Z',
    owner_entity_id: owner,
    lot_id: lotId,
    product_id: productId,
    product_state: state,
    qty_units: qty,
  });
}

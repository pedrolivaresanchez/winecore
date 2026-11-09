import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId, seedWarehouse } from './fixtures';

describe('etiqueta hermana', () => {
  it('etiqueta enTreDicho como Bobastrell, conserva el lote y no toca el libro ni SILICIE', async () => {
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
      const wineId = newId();
      const sourceId = newId();
      const labelId = newId();
      const lotId = newId();
      const placement = newId();
      const opening = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'label-sibling', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, is_organic)
          VALUES (CAST(${wineId} AS UUID), 'ENTREDICHO', 'enTreDicho', 'red', TRUE)
        `);
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, unit, is_stock_tracked, requires_lot, for_sale)
          VALUES
            (CAST(${sourceId} AS UUID), 'ENT-2324', 'enTreDicho 23-24', 'wine', CAST(${wineId} AS UUID), 'ud', TRUE, TRUE, TRUE),
            (CAST(${labelId} AS UUID), 'BOBASTRELL', 'Bobastrell', 'wine', CAST(${wineId} AS UUID), 'ud', TRUE, TRUE, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, is_organic, status, origin)
          VALUES (
            CAST(${lotId} AS UUID), CAST(${po} AS UUID), '202324', 'bottled',
            CAST(${wineId} AS UUID), 2023, TRUE, 'active', 'opening_count'
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
            qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${opening} AS UUID), TIMESTAMPTZ '2026-11-09 11:00:00+01', 'opening',
            CAST(${locationId} AS UUID), CAST(${po} AS UUID), CAST(${lotId} AS UUID), CAST(${sourceId} AS UUID),
            'packaged_labeled', 12, 9000, 0, 'inventory.inventory_count', CAST(${opening} AS UUID), 'label-sibling'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, line_no, wine_label, lot_id, product_id,
            owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml, product_state, not_for_sale,
            match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${placement} AS UUID), CAST(${locationId} AS UUID), 'jaulon', 'JAU-02', 1, 'enTreDicho 23-24',
            CAST(${lotId} AS UUID), CAST(${sourceId} AS UUID), CAST(${po} AS UUID),
            12, 750, 9000, 'packaged_unlabeled', FALSE, 'matched', 'test', 1, DATE '2026-11-09'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_move (
            id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 11:00:00+01', CAST(${placement} AS UUID),
            12, 9000, 'opening', CAST(${lotId} AS UUID), 'cellar.bottled_placement', CAST(${placement} AS UUID), 'label-sibling'
          )
        `);
      });

      const unlabeled = await call(ctx, 'GET', '/v1/stock/unlabeled', undefined, 'bodega@winecore.test');
      expect(unlabeled.status).toBe(200);
      const row = (unlabeled.body.items as { lot_code: string; labels: { sku: string }[] }[])
        .find((item) => item.lot_code === '202324');
      expect(row?.labels.map((label) => label.sku)).toEqual(['BOBASTRELL']);

      const refused = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'labeling',
        legal_entity_id: po,
        occurred_at: '2026-11-09T12:00:00Z',
        fiscal_date: '2026-11-09',
        performed_by: 'Operario sintético',
        lines: [
          {
            role: 'input', lot_id: lotId, location_id: locationId, owner_entity_id: po,
            product_id: sourceId, product_state: 'packaged_unlabeled', qty_units: 12, volume_ml: 9_000, nominal_volume_ml: 750,
          },
          {
            role: 'output', location_id: locationId, lot_id: lotId, product_id: newId(),
            product_state: 'packaged_labeled', qty_units: 12, volume_ml: 9_000, nominal_volume_ml: 750,
          },
        ],
      }, 'bodega@winecore.test');
      expect(refused.status).toBe(422);

      const labeled = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'labeling',
        legal_entity_id: po,
        occurred_at: '2026-11-09T12:00:00Z',
        fiscal_date: '2026-11-09',
        performed_by: 'Operario sintético',
        lines: [
          {
            role: 'input', lot_id: lotId, location_id: locationId, owner_entity_id: po,
            product_id: sourceId, product_state: 'packaged_unlabeled', qty_units: 12, volume_ml: 9_000, nominal_volume_ml: 750,
          },
          {
            role: 'output', location_id: locationId, lot_id: lotId, product_id: labelId,
            product_state: 'packaged_labeled', qty_units: 12, volume_ml: 9_000, nominal_volume_ml: 750,
          },
        ],
      }, 'bodega@winecore.test');
      expect(labeled.status, JSON.stringify(labeled.body)).toBe(201);
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${labeled.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.stock_moves).toEqual([]);
      expect(confirmed.body.fiscal_moves).toEqual([]);

      const book = await ctx.writer.read<{ units: string; ml: string; state: string }>(sql`
        SELECT coalesce(sum(qty_units), 0)::VARCHAR AS units, coalesce(sum(volume_ml), 0)::VARCHAR AS ml, product_state AS state
        FROM inventory.stock_move
        WHERE lot_id = CAST(${lotId} AS UUID)
        GROUP BY product_state
      `);
      expect(book).toEqual([{ units: '12', ml: '9000', state: 'packaged_labeled' }]);
      const silicie = await ctx.writer.read<{ n: string }>(sql`SELECT count(*)::VARCHAR AS n FROM regulatory.silicie_entry`);
      expect(silicie[0]?.n).toBe('0');
      const map = await ctx.writer.read<{ sku: string; state: string; bottles: string; lot: string }>(sql`
        SELECT pr.sku, p.product_state AS state, coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles, l.code AS lot
        FROM cellar.bottled_placement p
        JOIN catalog.product pr ON pr.id = p.product_id
        JOIN inventory.lot l ON l.id = p.lot_id
        LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
        WHERE p.lot_id = CAST(${lotId} AS UUID)
        GROUP BY pr.sku, p.product_state, l.code
      `);
      expect(map.find((row) => row.sku === 'ENT-2324' && row.state === 'packaged_unlabeled')?.bottles).toBe('0');
      const boxes = map.find((row) => row.sku === 'BOBASTRELL');
      expect(boxes).toMatchObject({ state: 'packaged_labeled', bottles: '12', lot: '202324' });
    } finally {
      await ctx.close();
    }
  });
});

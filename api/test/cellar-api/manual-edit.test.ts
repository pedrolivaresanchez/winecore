import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId } from './fixtures';

describe('corrección manual', () => {
  it('cambia el lote y anota el ajuste de envasado sin SILICIE', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const locationId = newId();
      const wineId = newId();
      const productId = newId();
      const otherId = newId();
      const lotId = newId();
      const placement = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'manual-edit', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
          VALUES (CAST(${locationId} AS UUID), 'BOD', 'Bodega', 'cellar', CAST(${po} AS UUID))
        `);
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color) VALUES (CAST(${wineId} AS UUID), 'ENTREDICHO', 'enTreDicho', 'red')
        `);
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, unit, for_sale, is_active)
          VALUES (CAST(${productId} AS UUID), 'ENT-2324', 'enTreDicho 23-24', 'wine', CAST(${wineId} AS UUID), 'ud', TRUE, TRUE)
        `);
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, unit, for_sale, is_active)
          VALUES (CAST(${otherId} AS UUID), 'BOBASTRELL', 'Bobastrell', 'wine', CAST(${wineId} AS UUID), 'ud', TRUE, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, is_organic, origin)
          VALUES (CAST(${lotId} AS UUID), CAST(${po} AS UUID), '202324', 'bottled', CAST(${wineId} AS UUID), 2023, TRUE, 'opening_count')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
            qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 11:00:00+01', 'opening',
            CAST(${locationId} AS UUID), CAST(${po} AS UUID), CAST(${lotId} AS UUID), CAST(${productId} AS UUID),
            'packaged_labeled', 10, 7500, 0, 'inventory.inventory_count', CAST(${placement} AS UUID), 'manual-edit'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, line_no, wine_label, lot_id, product_id, wine_id,
            owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml, product_state,
            match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${placement} AS UUID), CAST(${locationId} AS UUID), 'caja', 'CAJAS', 1, 'enTreDicho 23-24',
            CAST(${lotId} AS UUID), CAST(${productId} AS UUID), CAST(${wineId} AS UUID), CAST(${po} AS UUID),
            10, 750, 7500, 'packaged_labeled', 'matched', 'test', 1, DATE '2026-11-09'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_move (
            id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 11:00:00+01', CAST(${placement} AS UUID),
            10, 7500, 'opening', CAST(${lotId} AS UUID), 'cellar.bottled_placement', CAST(${placement} AS UUID), 'manual-edit'
          )
        `);
      });

      const renamed = await call(ctx, 'PATCH', '/v1/lots/202324', {
        code: '202324',
        vintage: 2024,
        product_id: productId,
      }, 'bodega@winecore.test');
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(renamed.body.vintage).toBe(2024);
      expect(renamed.body.code).toBe('202324');

      const corrected = await call(ctx, 'PATCH', `/v1/stock/bottled-placements/${placement}`, {
        product_id: productId,
        lot_code: '202324',
        bottles: 8,
        labeled: true,
        note: 'Faltaban dos',
      }, 'bodega@winecore.test');
      expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
      expect(corrected.body).toMatchObject({ bottles: 8, lot_code: '202324', labeled: true, note: 'Faltaban dos' });

      const book = await ctx.writer.read<{ kind: string; units: string; ml: string; state: string }>(sql`
        SELECT move_type AS kind, qty_units::VARCHAR AS units, volume_ml::VARCHAR AS ml, product_state AS state
        FROM inventory.stock_move
        WHERE lot_id = CAST(${lotId} AS UUID)
        ORDER BY occurred_at, move_type
      `);
      expect(book).toEqual([
        { kind: 'opening', units: '10', ml: '7500', state: 'packaged_labeled' },
        { kind: 'count_adjust_out', units: '-2', ml: '-1500', state: 'packaged_labeled' },
      ]);
      const map = await ctx.writer.read<{ bottles: string; note: string }>(sql`
        SELECT coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles, p.note
        FROM cellar.bottled_placement p
        LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
        WHERE p.id = CAST(${placement} AS UUID)
        GROUP BY p.note
      `);
      expect(map[0]).toEqual({ bottles: '8', note: 'Faltaban dos' });
      const silicie = await ctx.writer.read<{ n: string }>(sql`SELECT count(*)::VARCHAR AS n FROM regulatory.silicie_entry`);
      const fiscal = await ctx.writer.read<{ n: string }>(sql`SELECT count(*)::VARCHAR AS n FROM inventory.fiscal_move`);
      expect(silicie[0]?.n).toBe('0');
      expect(fiscal[0]?.n).toBe('0');
      const audit = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM audit.audit_log
        WHERE table_name = 'cellar.bottled_placement' AND row_id = ${placement}
      `);
      expect(Number(audit[0]?.n)).toBeGreaterThan(0);

      const cage = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'manual-edit', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, line_no, wine_label, lot_id, product_id,
            owner_entity_id, bottle_ml, product_state, match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${cage} AS UUID), CAST(${locationId} AS UUID), 'jaulon', 'JAU-01', 1, 'Jaulón',
            CAST(${lotId} AS UUID), CAST(${productId} AS UUID), CAST(${po} AS UUID),
            750, 'packaged_unlabeled', 'matched', 'test', 2, DATE '2026-11-09'
          )
        `);
      });
      const refused = await call(ctx, 'PATCH', `/v1/stock/bottled-placements/${cage}`, {
        product_id: otherId,
        lot_code: '202324',
        bottles: 0,
        labeled: true,
        note: '',
      }, 'bodega@winecore.test');
      expect(refused.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });
});

import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { reconcileCatalog } from '../../src/core/catalog/reconcile';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();

describe('reparación de catálogo y bodega', () => {
  afterAll(async () => {
    await ctx.close();
  });

  it('simula, une las fichas, parte enTreDicho y se puede deshacer', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    if (!po) throw new Error('Falta P.O.');
    const formatId = newId();
    const location = newId();
    const zone = newId();
    const arcal = newId();
    const arcalYear = newId();
    const extra = newId();
    const entredicho = newId();
    const lotDup = newId();
    const lotEarly = newId();
    const lotLate = newId();
    const b10 = newId();
    const bar10 = newId();

    await ctx.writer.withWrite({ type: 'system', id: 'reconcile-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${location} AS UUID), 'BOD-TEST', 'Bodega de prueba', 'cellar', CAST(${po} AS UUID))
      `);
      tx.write(sql`
        INSERT INTO cellar.zone (id, location_id, code, name, kind)
        VALUES (CAST(${zone} AS UUID), CAST(${location} AS UUID), 'BARR', 'BARR', 'barrel_room')
      `);
      tx.write(sql`
        INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
        VALUES (CAST(${formatId} AS UUID), 'B075T', 'Botella 0,75 prueba', 'bottle', 750)
      `);
      const wine = (id: string, code: string, name: string) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
          VALUES (CAST(${id} AS UUID), ${code}, ${name}, 'red', 'wine', TRUE)
        `);
      };
      wine(arcal, 'ARCAL', 'Arcal');
      wine(arcalYear, 'ARCAL-2023', 'Arcal 2023');
      wine(extra, 'ENTREDICHO-2122', 'enTreDicho 2122');
      wine(entredicho, 'ENTREDICHO', 'enTreDicho');
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, unit, is_active, for_sale)
        VALUES (
          CAST(${newId()} AS UUID), 'ARCAL-B075', 'Arcal 2023', 'wine', CAST(${arcal} AS UUID),
          2023, CAST(${formatId} AS UUID), 'ud', TRUE, TRUE
        )
      `);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES (
          CAST(${newId()} AS UUID), 'ARCAL-2023-SUELTO', 'Arcal sin formato', 'wine', CAST(${arcalYear} AS UUID),
          2023, 'ud', TRUE, TRUE
        )
      `);
      tx.write(sql`
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
        VALUES
          (CAST(${lotDup} AS UUID), CAST(${po} AS UUID), '2023', 'wine', CAST(${arcalYear} AS UUID), 2023, 'legacy'),
          (CAST(${lotEarly} AS UUID), CAST(${po} AS UUID), 'E202122', 'bottled', CAST(${entredicho} AS UUID), 2021, 'legacy'),
          (CAST(${lotLate} AS UUID), CAST(${po} AS UUID), '202324', 'bottled', CAST(${entredicho} AS UUID), 2023, 'legacy')
      `);
      tx.write(sql`
        INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id, status)
        VALUES
          (CAST(${b10} AS UUID), 'B10', 'Barrica vieja', 'barrel', 500000, 'oak', CAST(${location} AS UUID), 'in_service'),
          (CAST(${bar10} AS UUID), 'BAR-10', 'Barrica', 'barrel', 500000, 'oak', CAST(${location} AS UUID), 'in_service')
      `);
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, product_state,
          qty_units, volume_ml, mass_g, source_table, source_id, created_by
        ) VALUES (
          CAST(${newId()} AS UUID), now(), 'opening', CAST(${location} AS UUID), CAST(${b10} AS UUID),
          CAST(${po} AS UUID), 'wine', 0, 500000, 0, 'cellar.vessel', CAST(${b10} AS UUID), 'test'
        )
      `);
    });

    const dry = await reconcileCatalog(ctx.writer, 'dry-run');
    expect(dry.mode).toBe('dry-run');
    expect(dry.merges.map((row) => row.drop).sort()).toEqual(['ARCAL-2023', 'ENTREDICHO-2122']);
    expect(dry.notes.some((line) => line.includes('150 L') && line.includes('300 L'))).toBe(true);

    const applied = await reconcileCatalog(ctx.writer, 'apply');
    expect(applied.merges.length).toBeGreaterThan(0);
    const wines = await ctx.writer.read<{ code: string; active: boolean; name: string }>(`
      SELECT code, is_active AS active, name FROM catalog.wine
      WHERE code IN ('ARCAL', 'ARCAL-2023', 'ENTREDICHO', 'ENTREDICHO-2122', 'ENTREDICHO-2324')
    `);
    const byCode = new Map(wines.map((row) => [row.code, row]));
    expect(byCode.get('ARCAL-2023')?.active).toBe(false);
    expect(byCode.get('ENTREDICHO-2122')?.active).toBe(false);
    expect(byCode.get('ENTREDICHO')?.name).toBe('enTreDicho 2020-2022');
    expect(byCode.get('ENTREDICHO-2324')?.name).toBe('enTreDicho 2023-2024');
    const lots = await ctx.writer.read<{ code: string; wine: string }>(`
      SELECT l.code, w.code AS wine
      FROM inventory.lot l JOIN catalog.wine w ON w.id = l.wine_id
      WHERE l.code IN ('2023', 'E202122', '202324')
    `);
    const lotWine = new Map(lots.map((row) => [row.code, row.wine]));
    expect(lotWine.get('2023')).toBe('ARCAL');
    expect(lotWine.get('E202122')).toBe('ENTREDICHO');
    expect(lotWine.get('202324')).toBe('ENTREDICHO-2324');
    const b10row = await ctx.writer.read<{ status: string }>(sql`SELECT status FROM cellar.vessel WHERE code = 'B10'`);
    expect(b10row[0]?.status).toBe('retired');
    const reversal = await ctx.writer.read<{ volume: string }>(`
      SELECT volume_ml::VARCHAR AS volume FROM inventory.stock_move
      WHERE move_type = 'reversal' AND created_by = 'reconcile-catalog'
    `);
    expect(reversal[0]?.volume).toBe('-500000');
    const placed = await ctx.writer.read<{ n: number }>(`
      SELECT count(*)::INTEGER AS n FROM cellar.plan_position p
      JOIN cellar.vessel v ON v.id = p.vessel_id
      WHERE v.code = 'BAR-10'
    `);
    expect(placed[0]?.n).toBe(1);

    const again = await reconcileCatalog(ctx.writer, 'apply');
    expect(again.skipped.some((line) => line.includes('Ya está aplicada'))).toBe(true);

    const undone = await reconcileCatalog(ctx.writer, 'revert');
    expect(undone.mode).toBe('revert');
    const restored = await ctx.writer.read<{ active: boolean }>(sql`
      SELECT is_active AS active FROM catalog.wine WHERE code = 'ARCAL-2023'
    `);
    expect(restored[0]?.active).toBe(true);
    const lotBack = await ctx.writer.read<{ wine: string }>(`
      SELECT w.code AS wine FROM inventory.lot l JOIN catalog.wine w ON w.id = l.wine_id WHERE l.code = '2023'
    `);
    expect(lotBack[0]?.wine).toBe('ARCAL-2023');
  });
});

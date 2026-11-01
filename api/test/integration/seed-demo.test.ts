import { describe, expect, it } from 'bun:test';
import { migrate } from '../../db/migrate';
import { seedDemo } from '../../db/seed-demo';
import { createLocalClient } from '../../src/core/db/local';
import { createWriter } from '../../src/core/db/writer';

describe('seedDemo', () => {
  it('carga el conjunto demo y repetirlo no duplica contactos', async () => {
    const client = await createLocalClient(':memory:');
    try {
      await migrate(client);
      const writer = createWriter(client);
      expect(await writer.tryAcquireLease()).toBe(true);
      const config = { nodeEnv: 'test', dbMode: 'local' };
      const first = await seedDemo(writer, config);
      const placedOnce = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM cellar.plan_position');
      const second = await seedDemo(writer, config);
      expect(first.contacts).toBe(150);
      expect(second.contacts).toBe(first.contacts);
      const placedTwice = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM cellar.plan_position');
      expect(Number(placedTwice[0]?.total)).toBe(Number(placedOnce[0]?.total));
      const wines = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM catalog.wine');
      const vessels = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM cellar.vessel');
      const lots = await writer.read<{ total: number }>("SELECT count(*)::INTEGER AS total FROM inventory.lot WHERE kind <> 'bottled'");
      expect(wines[0]?.total).toBe(8);
      expect(vessels[0]?.total).toBe(30);
      expect(lots[0]?.total).toBe(24);
      const bottled = await writer.read<{ products: number; lots: number; moves: number; units: number; fiscal: number }>(`
        SELECT
          (SELECT count(*)::INTEGER FROM catalog.product WHERE kind = 'wine' AND is_active AND format_id IS NOT NULL) AS products,
          (SELECT count(*)::INTEGER FROM inventory.lot WHERE kind = 'bottled') AS lots,
          (SELECT count(*)::INTEGER FROM inventory.stock_move WHERE product_state = 'packaged_labeled') AS moves,
          (SELECT min(qty_units)::INTEGER FROM inventory.stock_move WHERE product_state = 'packaged_labeled') AS units,
          (SELECT count(*)::INTEGER FROM inventory.fiscal_move WHERE product_class = 'packaged') AS fiscal
      `);
      expect(bottled[0]?.products).toBeGreaterThan(0);
      expect(bottled[0]?.lots).toBe(bottled[0]?.products);
      expect(bottled[0]?.moves).toBe(bottled[0]?.products);
      expect(bottled[0]?.units).toBe(120);
      expect(bottled[0]?.fiscal).toBe(bottled[0]?.products);
      const zones = await writer.read<{ code: string }>('SELECT code FROM cellar.zone ORDER BY code');
      expect(zones.map((row) => row.code)).toEqual(['BOT', 'ELAB', 'EXT', 'SALA']);
      expect(Number(placedOnce[0]?.total)).toBeGreaterThan(10);
      const unplaced = await writer.read<{ total: number }>(`
        SELECT count(*)::INTEGER AS total
        FROM cellar.vessel v
        WHERE v.code IN ('INOX-002', 'INOX-012', 'FERM-006', 'BAR-002', 'DAM-002')
          AND NOT EXISTS (SELECT 1 FROM cellar.plan_position p WHERE p.vessel_id = v.id)
      `);
      expect(Number(unplaced[0]?.total)).toBe(5);
      const rooms = await writer.read<{ zone: string; kind: string; total: number }>(`
        SELECT z.code AS zone, v.kind, count(*)::INTEGER AS total
        FROM cellar.plan_position p
        JOIN cellar.zone z ON z.id = p.zone_id
        JOIN cellar.vessel v ON v.id = p.vessel_id
        GROUP BY z.code, v.kind
      `);
      const count = (zone: string, kind: string) => rooms.find((row) => row.zone === zone && row.kind === kind)?.total ?? 0;
      expect(count('ELAB', 'tank_storage')).toBeGreaterThan(0);
      expect(count('ELAB', 'tank_fermenter')).toBeGreaterThan(0);
      expect(count('SALA', 'barrel')).toBeGreaterThan(0);
      expect(count('EXT', 'demijohn')).toBeGreaterThan(0);
      const niche = await writer.read<{ total: number }>(`
        SELECT count(*)::INTEGER AS total
        FROM cellar.holder h
        WHERE h.code = 'NICH-01'
          AND NOT EXISTS (SELECT 1 FROM cellar.plan_position p WHERE p.holder_id = h.id)
      `);
      expect(Number(niche[0]?.total)).toBe(1);
    } finally {
      await client.close?.();
    }
  });

  it('se niega en producción y contra Timbal', async () => {
    const client = await createLocalClient(':memory:');
    try {
      const writer = createWriter(client);
      await expect(seedDemo(writer, { nodeEnv: 'production', dbMode: 'local' })).rejects.toThrow(/production/);
      await expect(seedDemo(writer, { nodeEnv: 'development', dbMode: 'timbal' })).rejects.toThrow(/timbal/i);
    } finally {
      await client.close?.();
    }
  });
});

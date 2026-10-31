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
      const second = await seedDemo(writer, config);
      expect(first.contacts).toBe(150);
      expect(second.contacts).toBe(first.contacts);
      const wines = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM catalog.wine');
      const vessels = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM cellar.vessel');
      const lots = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM inventory.lot');
      expect(wines[0]?.total).toBe(8);
      expect(vessels[0]?.total).toBe(30);
      expect(lots[0]?.total).toBe(24);
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

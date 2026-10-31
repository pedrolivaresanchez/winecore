import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../db/migrate';
import { createLocalClient } from '../../src/core/db/local';

const baseSql = `
CREATE SCHEMA core;
CREATE TABLE core.schema_migration (
  file VARCHAR PRIMARY KEY,
  sha256 VARCHAR NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.marker (id INTEGER);
`;

describe('migrate', () => {
  it('falla si cambia un fichero ya aplicado', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'winecore-migrate-'));
    const client = await createLocalClient(':memory:');
    try {
      await writeFile(join(dir, '0001_a.sql'), baseSql);
      await migrate(client, { dir });
      const again = await migrate(client, { dir });
      expect(again.pending).toEqual([]);

      await writeFile(join(dir, '0001_a.sql'), `${baseSql}\n-- cambio\n`);
      let caught: unknown;
      try {
        await migrate(client, { dir });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('0001_a.sql');
    } finally {
      await client.close?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('el simulacro no aplica la migración pendiente', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'winecore-migrate-'));
    const client = await createLocalClient(':memory:');
    try {
      await writeFile(join(dir, '0001_a.sql'), baseSql);
      await migrate(client, { dir });
      await writeFile(join(dir, '0002_b.sql'), 'CREATE TABLE core.marker2 (id INTEGER);\n');
      const pending = await migrate(client, { dir, dryRun: true });
      expect(pending.pending).toEqual(['0002_b.sql']);
      let missing = false;
      try {
        await client.query('SELECT * FROM core.marker2');
      } catch {
        missing = true;
      }
      expect(missing).toBe(true);
    } finally {
      await client.close?.();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

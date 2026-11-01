import { describe, expect, it } from 'bun:test';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from '../../db/migrate';
import { createLocalClient } from '../../src/core/db/local';
import { createWriter } from '../../src/core/db/writer';
import { contextForMachine } from '../../src/mcp/context';

const migrations = join(import.meta.dir, '../../db/migrations');
const PEDRO_OWNER = '01a1964b-983d-7287-9926-4014235bf55d';
const OTHER = '01a1964b-983d-7287-9926-4014235bf000';
const ALL = ['approve:*', 'count:*', 'deliver:*', 'issue:*', 'manage:*', 'operate:*', 'prepare:*', 'read:*', 'void:*', 'write:*'];

describe('0042: alcances del cliente MCP pedro-owner', () => {
  it('amplía sus alcances a todo sin tocar su token ni a otros clientes, y enciende los módulos', async () => {
    const before = await mkdtemp(join(tmpdir(), 'winecore-0042-'));
    const client = await createLocalClient(':memory:');
    try {
      for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql') && file < '0042')) {
        await copyFile(join(migrations, name), join(before, name));
      }
      await migrate(client, { dir: before });
      await client.query(`
        INSERT INTO core.api_client (id, code, role_code, description, scopes) VALUES
          ('${PEDRO_OWNER}', 'pedro-owner', 'agent', 'CVBOT de prueba', ['read:*', 'write:contacts']),
          ('${OTHER}', 'otro-cliente', 'mcp_client', 'Otro cliente', ['read:*'])
      `);
      await client.query(`
        INSERT INTO core.api_token (client_id, token_hash, prefix, expires_at)
        VALUES ('${PEDRO_OWNER}', sha256('token-sintetico')::BLOB, 'wc_agent_abc123', now() + INTERVAL 30 DAY)
      `);
      await client.query(`INSERT INTO core.module_state (module_key, enabled, changed_by) VALUES ('cellar', FALSE, 'prueba')`);
      const tokenBefore = await client.query(`SELECT * FROM core.api_token`);
      const clientsBefore = await client.query(`SELECT * FROM core.api_client ORDER BY code`);

      const applied = await migrate(client);
      expect(applied.pending[0]).toBe('0042_mcp_owner_scopes.sql');

      expect(await client.query(`SELECT * FROM core.api_token`)).toEqual(tokenBefore);
      expect(await client.query(`SELECT * FROM core.api_client ORDER BY code`)).toEqual(clientsBefore);

      const writer = createWriter(client);
      const input = { now: () => new Date(), webBaseUrl: '', requestId: 'test' };
      const owner = await contextForMachine(writer, PEDRO_OWNER, input);
      expect([...owner.client.scopes].sort()).toEqual([...new Set([...ALL, 'write:contacts'])].sort());
      const other = await contextForMachine(writer, OTHER, input);
      expect(other.client.scopes).toEqual(['read:*']);

      const modules = await client.query<{ module_key: string; enabled: boolean }>(`SELECT module_key, enabled FROM core.module_state ORDER BY module_key`);
      const state = Object.fromEntries(modules.map((row) => [row.module_key, row.enabled]));
      for (const key of ['contacts', 'catalog', 'sales', 'billing', 'purchasing', 'inventory', 'vineyard', 'finance']) {
        expect(state[key]).toBe(true);
      }
      expect(state.cellar).toBe(false);
    } finally {
      await client.close?.();
      await rm(before, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { createTimbalClient } from '../../src/core/db/timbal';
import { PENDING_TAX_ID, seedInputFromEnv } from '../../db/seed';
import { withoutApiPrefix } from '../../src/api-prefix';

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('gateway path prefix', () => {
  it('serves the same routes with and without /api', async () => {
    expect(new URL(withoutApiPrefix(new Request('http://x/api/v1/contacts?q=a')).url).pathname).toBe('/v1/contacts');
    expect(new URL(withoutApiPrefix(new Request('http://x/api')).url).pathname).toBe('/');
    expect(new URL(withoutApiPrefix(new Request('http://x/v1/contacts')).url).pathname).toBe('/v1/contacts');
    expect(new URL(withoutApiPrefix(new Request('http://x/apiary')).url).pathname).toBe('/apiary');
    const moved = withoutApiPrefix(new Request('http://x/api/v1/x', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } }));
    expect(moved.method).toBe('POST');
    expect(await moved.json()).toEqual({ a: 1 });
  });
});

describe('Knowledge Base client', () => {
  it('keeps the first line of the server message so domain codes can be mapped', async () => {
    const client = createTimbalClient({ host: 'api.timbal.ai', orgId: '122', kbId: '1', token: 't', fetchImpl: fakeFetch(422, { code: 'INVALID_QUERY', message: 'Invalid Input Error: WC024: saldo negativo\nLINE 1: SELECT secreto' }) });
    await expect(client.query('SELECT 1')).rejects.toThrow('Invalid Input Error: WC024: saldo negativo');
    await expect(client.query('SELECT 1')).rejects.not.toThrow('secreto');
  });

  it('returns NULL columns as null, as the local client does', async () => {
    const client = createTimbalClient({ host: 'api.timbal.ai', orgId: '122', kbId: '1', token: 't', fetchImpl: fakeFetch(200, { columns: [{ name: 'role_code', type: 'VARCHAR' }, { name: 'legal_entity_id', type: 'UUID' }], rows: [{ role_code: 'owner' }], truncated: false }) });
    expect(await client.query('SELECT 1')).toEqual([{ role_code: 'owner', legal_entity_id: null }]);
  });

  it('refuses a truncated result instead of silently missing rows', async () => {
    const client = createTimbalClient({ host: 'api.timbal.ai', orgId: '122', kbId: '1', token: 't', fetchImpl: fakeFetch(200, { rows: [{ i: 1 }], truncated: true }) });
    await expect(client.query('SELECT 1')).rejects.toThrow('truncado');
  });
});

describe('production seed input', () => {
  const base = { NODE_ENV: 'production', WINECORE_BOOTSTRAP_OWNER_EMAILS: 'Persona@Example.com' };

  it('requires the owners in production', () => {
    expect(() => seedInputFromEnv({ NODE_ENV: 'production', WINECORE_SEED_PO_TAX_ID: '00000000T', WINECORE_SEED_CVPO_TAX_ID: 'B00000000' })).toThrow('WINECORE_BOOTSTRAP_OWNER_EMAILS');
  });

  it('marks a missing tax id as pending only when explicitly allowed', () => {
    expect(() => seedInputFromEnv(base)).toThrow('WINECORE_SEED_PO_TAX_ID');
    const input = seedInputFromEnv({ ...base, WINECORE_SEED_ALLOW_PENDING_TAX_ID: 'true', WINECORE_SEED_CVPO_TAX_ID: 'B00000000' });
    expect(input.poTaxId).toBe(PENDING_TAX_ID);
    expect(input.cvpoTaxId).toBe('B00000000');
    expect(input.ownerEmails).toEqual(['persona@example.com']);
  });

  it('never creates the synthetic users outside development', async () => {
    const { seed } = await import('../../db/seed');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const { migrate } = await import('../../db/migrate');
    const client = { query: async (s: string) => (await connection.runAndReadAll(s)).getRowObjectsJson() as never[] };
    await migrate(client as never);
    await seed(client as never, seedInputFromEnv({ ...base, WINECORE_SEED_ALLOW_PENDING_TAX_ID: 'true' }));
    const users = await client.query("SELECT lower(email) AS e FROM core.app_user ORDER BY e");
    expect(users).toEqual([{ e: 'persona@example.com' }] as never);
  });
});

describe('writer and a stale aborted transaction', () => {
  it('clears it with ROLLBACK and retries the operation once', async () => {
    const { createWriter } = await import('../../src/core/db/writer');
    const { migrate } = await import('../../db/migrate');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const calls: string[] = [];
    let injected = false;
    let armed = false;
    const client = {
      query: async (s: string) => {
        calls.push(s.trim().split(/\s+/)[0] ?? '');
        if (armed && !injected && s.trimStart().startsWith('BEGIN TRANSACTION')) {
          injected = true;
          throw new Error('TransactionContext Error: Current transaction is aborted (please ROLLBACK)');
        }
        return (await connection.runAndReadAll(s)).getRowObjectsJson() as never[];
      },
    };
    await migrate(client as never);
    const writer = createWriter(client as never);
    await writer.tryAcquireLease();
    armed = true;
    await writer.withWrite({ type: 'system', id: 'test', requestId: 'r1' }, async (tx) => {
      tx.write("INSERT INTO core.setting (key, value, updated_by) VALUES ('t.retry', '1', 'test')");
    });
    const rows = (await connection.runAndReadAll("SELECT count(*)::INTEGER AS n FROM core.setting WHERE key = 't.retry'")).getRowObjectsJson();
    expect(rows[0]?.n).toBe(1);
    expect(calls).toContain('ROLLBACK');
  });
});

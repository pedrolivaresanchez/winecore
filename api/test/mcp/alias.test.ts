import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const ACCEPT = 'application/json, text/event-stream';

async function enableModules(ctx: TestApp, modules: readonly string[]) {
  await ctx.writer.withWrite({ type: 'system', id: 'mcp-alias-test', requestId: 'mcp-alias-test' }, async (tx) => {
    for (const key of modules) {
      tx.write(sql`
        INSERT INTO core.module_state (module_key, enabled, changed_by)
        VALUES (${key}, TRUE, ${'test'})
      `);
    }
  });
}

async function rpc(
  app: TestApp['app'],
  path: string,
  method: string,
  params: unknown = {},
  headers: Record<string, string> = {},
) {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { accept: ACCEPT, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) as Record<string, unknown> };
}

async function toolNames(app: TestApp['app'], path: string, headers: Record<string, string> = {}): Promise<string[]> {
  const list = await rpc(app, path, 'tools/list', {}, headers);
  expect(list.status).toBe(200);
  return ((list.body?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name).sort();
}

describe('/mcp (alias de /m2m/mcp para MCPServer service="api")', () => {
  test('con sesión de persona, tools/list sale filtrado por los permisos de esa persona y coincide con /m2m/mcp', async () => {
    const ctx = await createTestApp();
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      const owner = { 'x-dev-user': 'owner@winecore.test' };
      const cellar = { 'x-dev-user': 'bodega@winecore.test' };

      const ownerNames = await toolNames(ctx.app, '/mcp', owner);
      const cellarNames = await toolNames(ctx.app, '/mcp', cellar);

      expect(ownerNames).toContain('contacts_search');
      expect(ownerNames).toContain('system_whoami');
      expect(cellarNames).toContain('system_whoami');
      expect(cellarNames).not.toContain('contacts_search');
      expect(cellarNames.length).toBeLessThan(ownerNames.length);

      expect(await toolNames(ctx.app, '/m2m/mcp', owner)).toEqual(ownerNames);
      expect(await toolNames(ctx.app, '/m2m/mcp', cellar)).toEqual(cellarNames);
    } finally {
      await ctx.close();
    }
  });

  test('una llamada con la sesión de la persona se ejecuta como esa persona y queda auditada', async () => {
    const ctx = await createTestApp();
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      const cellar = { 'x-dev-user': 'bodega@winecore.test' };

      const whoami = await rpc(ctx.app, '/mcp', 'tools/call', { name: 'system_whoami', arguments: {} }, cellar);
      expect(whoami.status).toBe(200);
      const block = (whoami.body?.result as { content: { text: string }[] }).content[0];
      const who = JSON.parse(block?.text ?? '{}') as { on_behalf_of: { name: string } | null; roles: string[] };
      expect(who.on_behalf_of?.name).toBe('Bodega');

      const forbidden = await rpc(ctx.app, '/mcp', 'tools/call', { name: 'contacts_search', arguments: {} }, cellar);
      const result = forbidden.body?.result as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ code: 'WC_FORBIDDEN' });

      const audits = await ctx.writer.read<{ after: string }>(sql`
        SELECT CAST(after_data AS VARCHAR) AS after FROM audit.audit_log WHERE table_name = 'mcp.call'
      `);
      const trail = audits.map((row) => row.after).join('\n');
      expect(trail).toContain('"tool":"system_whoami"');
      expect(trail).toContain('"code":"WC_FORBIDDEN"');
    } finally {
      await ctx.close();
    }
  });

  test('en modo timbal acepta la sesión de Timbal (Bearer) de cada persona y sin credenciales responde 401', async () => {
    const emails = new Map([
      ['token-propietario', 'owner@winecore.test'],
      ['token-bodega', 'bodega@winecore.test'],
    ]);
    const asked: string[] = [];
    const ctx = await createTestApp({
      env: { AUTH_MODE: 'timbal', TIMBAL_ORG_ID: 'org-1', TIMBAL_PROJECT_ID: 'proj-1' },
      fetchImpl: async (input, init) => {
        asked.push(String(input));
        const header = new Headers(init?.headers).get('authorization') ?? '';
        const email = emails.get(header.replace(/^Bearer /, ''));
        if (!email) return new Response('{}', { status: 401 });
        return Response.json({ session: { user_email: email }, project: { id: 'proj-1' } });
      },
    });
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);

      const owner = await toolNames(ctx.app, '/mcp', { authorization: 'Bearer token-propietario' });
      const cellar = await toolNames(ctx.app, '/mcp', { authorization: 'Bearer token-bodega' });
      expect(owner).toContain('contacts_search');
      expect(cellar).not.toContain('contacts_search');
      expect(asked.every((url) => url === 'https://api.timbal.ai/me?project_id=proj-1')).toBe(true);

      const anonymous = await rpc(ctx.app, '/mcp', 'tools/list');
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toEqual({ code: 'WC_UNAUTHENTICATED', message: 'No autenticado' });

      const devHeader = await rpc(ctx.app, '/mcp', 'tools/list', {}, { 'x-dev-user': 'owner@winecore.test' });
      expect(devHeader.status).toBe(401);

      const unknown = await rpc(ctx.app, '/mcp', 'tools/list', {}, { authorization: 'Bearer token-ajeno' });
      expect(unknown.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  test('con API_BASE_PATH=/api queda en /api/mcp y comparte el límite por minuto con /api/m2m/mcp', async () => {
    const ctx = await createTestApp({ env: { API_BASE_PATH: '/api' }, mcpRatePerMinute: 2 });
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      expect((await rpc(ctx.app, '/mcp', 'tools/list')).status).toBe(404);

      expect((await rpc(ctx.app, '/api/mcp', 'tools/list')).status).toBe(200);
      expect((await rpc(ctx.app, '/api/m2m/mcp', 'tools/list')).status).toBe(200);
      const limited = await rpc(ctx.app, '/api/mcp', 'tools/list');
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: 'WC_RATE_LIMITED' });
    } finally {
      await ctx.close();
    }
  });
});

import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
interface StatusBody {
  tools: { name: string; title: string; kind: string }[];
}

async function enableModules(ctx: TestApp, modules: readonly string[]) {
  await ctx.writer.withWrite({ type: 'system', id: 'assistant-status-test', requestId: 'assistant-status-test' }, async (tx) => {
    for (const key of modules) {
      tx.write(sql`
        INSERT INTO core.module_state (module_key, enabled, changed_by)
        VALUES (${key}, TRUE, ${'test'})
      `);
    }
  });
}

function status(app: TestApp['app'], headers: Record<string, string> = {}, path = '/v1/assistant/status') {
  return app.handle(new Request(`http://localhost${path}`, { headers }));
}

describe('GET /v1/assistant/status', () => {
  test('devuelve nombre, título y tipo de las herramientas que esa persona puede usar, sin esquemas ni descripciones', async () => {
    const ctx = await createTestApp();
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      const owner = await status(ctx.app, { 'x-dev-user': 'owner@winecore.test' });
      expect(owner.status).toBe(200);
      const body = await owner.json() as StatusBody;
      const byName = new Map(body.tools.map((tool) => [tool.name, tool]));

      expect(byName.get('contacts_search')).toEqual({ name: 'contacts_search', title: expect.any(String), kind: 'read' });
      expect(byName.get('contacts_create_prepare')?.kind).toBe('prepare');
      expect(byName.get('contacts_create_commit')?.kind).toBe('commit');
      expect(byName.get('contacts_create_commit')?.title).toMatch(/confirmar/i);
      for (const tool of body.tools) expect(Object.keys(tool).sort()).toEqual(['kind', 'name', 'title']);
    } finally {
      await ctx.close();
    }
  });

  test('el catálogo sale filtrado por los permisos de cada persona, igual que tools/list de /mcp', async () => {
    const ctx = await createTestApp();
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      const names = async (user: string) => ((await (await status(ctx.app, { 'x-dev-user': user })).json()) as StatusBody).tools.map((tool) => tool.name).sort();
      const owner = await names('owner@winecore.test');
      const cellar = await names('bodega@winecore.test');
      expect(cellar).toContain('system_whoami');
      expect(cellar).not.toContain('contacts_search');
      expect(cellar.length).toBeLessThan(owner.length);

      const list = await ctx.app.handle(new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'x-dev-user': 'bodega@winecore.test' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }));
      const listed = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name).sort();
      expect(listed).toEqual(cellar);
    } finally {
      await ctx.close();
    }
  });

  test('sin sesión responde 401', async () => {
    const ctx = await createTestApp({
      env: { AUTH_MODE: 'timbal', TIMBAL_ORG_ID: 'org-1', TIMBAL_PROJECT_ID: 'proj-1' },
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    try {
      expect((await status(ctx.app)).status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  test('el chat propio y su configuración ya no existen: el asistente habla con /mcp desde Timbal', async () => {
    const ctx = await createTestApp();
    try {
      const chat = await ctx.app.handle(new Request('http://localhost/v1/assistant/chat', {
        method: 'POST',
        headers: { 'x-dev-user': 'owner@winecore.test', 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] }),
      }));
      expect(chat.status).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});

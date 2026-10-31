import { describe, expect, test } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

async function post(
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) as Record<string, unknown> };
}

describe('clientes MCP', () => {
  test('la lista trae el último uso y el nombre de la persona', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await ctx.writer.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM core.app_user WHERE email = ${'bodega@winecore.test'}
      `);
      const created = await post(ctx.app, '/v1/mcp/clients', {
        code: 'cvbot-sintetico',
        description: 'Cliente MCP de prueba',
        role_code: 'mcp_client',
        scopes: ['*.read'],
        on_behalf_of_user_id: cellar[0]?.id,
      });
      expect(created.status).toBe(201);
      const id = String(created.json?.id);
      const token = String(created.json?.token);
      const before = await ctx.app.handle(new Request('http://localhost/v1/mcp/clients'));
      const beforeBody = await before.json() as { items: Record<string, unknown>[] };
      const idle = beforeBody.items.find((item) => item.id === id);
      expect(idle?.last_used_at).toBeNull();
      expect(idle?.on_behalf_of_display_name).toBe('Bodega');

      const called = await post(ctx.app, '/m2m/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'system_whoami', arguments: {} },
      }, { authorization: `Bearer ${token}` });
      expect(called.status).toBe(200);

      const after = await ctx.app.handle(new Request('http://localhost/v1/mcp/clients'));
      const afterBody = await after.json() as { items: Record<string, unknown>[] };
      const used = afterBody.items.find((item) => item.id === id);
      expect(typeof used?.last_used_at).toBe('string');
      expect(String(used?.last_used_at).length).toBeGreaterThan(10);
      expect(used?.on_behalf_of_display_name).toBe('Bodega');
    } finally {
      await ctx.close();
    }
  });
});

import { describe, expect, test } from 'bun:test';

import { sha256Bytes } from '../../src/core/auth/stepup/crypto';
import { sql } from '../../src/core/db/sql';
import { MCP_RATE_PER_MINUTE, RateLimiter } from '../../src/mcp/rate';
import { createTestApp } from '../helpers';

const EMAIL = 'cliente.sintetico@example.com';

async function enableModules(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  modules: readonly string[],
) {
  await ctx.writer.withWrite(
    { type: 'system', id: 'mcp-test', requestId: 'mcp-test' },
    async (tx) => {
      for (const key of modules) {
        tx.write(sql`
          INSERT INTO core.module_state (module_key, enabled, changed_by)
          VALUES (${key}, TRUE, ${'test'})
        `);
      }
    },
  );
}

async function post(
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  let json: unknown = null;
  if (text.trim() !== '') {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = text;
    }
  }
  return { status: response.status, json, text };
}

function rpc(id: number, method: string, params: unknown) {
  return { jsonrpc: '2.0', id, method, params };
}

async function callTool(
  app: { handle: (request: Request) => Promise<Response> },
  name: string,
  args: unknown,
  token?: string,
  path = '/m2m/mcp',
) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await post(app, path, rpc(1, 'tools/call', { name, arguments: args }), headers);
  const body = response.json as {
    result?: { isError?: boolean; content?: { type: string; text: string }[] };
    code?: string;
  };
  const block = body.result?.content?.[0];
  const parsed = block?.type === 'text' ? JSON.parse(block.text) as Record<string, unknown> : null;
  return { status: response.status, error: body.result?.isError === true, code: body.code, data: parsed, raw: response.text };
}

describe('rate limiter', () => {
  test('allows 60 calls in a minute and blocks the next one', () => {
    expect(MCP_RATE_PER_MINUTE).toBe(60);
    const limiter = new RateLimiter();
    const start = Date.parse('2026-10-31T12:00:00.000Z');
    for (let i = 0; i < 60; i += 1) expect(limiter.allow('client', start + i)).toBe(true);
    expect(limiter.allow('client', start + 61)).toBe(false);
    expect(limiter.allow('client', start + 60_000)).toBe(true);
    expect(limiter.allow('other', start + 61)).toBe(true);
  });
});

describe('MCP HTTP', () => {
  test('mounts at /m2m/mcp and under the /api prefix', async () => {
    const plain = await createTestApp();
    try {
      const who = await callTool(plain.app, 'system_whoami', {});
      expect(who.status).toBe(200);
      expect(who.error).toBe(false);
      expect(typeof who.data?.client).toBe('string');
      const missing = await plain.app.handle(new Request('http://localhost/mcp', { method: 'POST' }));
      expect(missing.status).toBe(404);
    } finally {
      await plain.close();
    }

    const prefixed = await createTestApp({ env: { API_BASE_PATH: '/api' } });
    try {
      const who = await callTool(prefixed.app, 'system_whoami', {}, undefined, '/api/m2m/mcp');
      expect(who.status).toBe(200);
      expect(who.error).toBe(false);
      const bare = await callTool(prefixed.app, 'system_whoami', {});
      expect(bare.status).toBe(404);
    } finally {
      await prefixed.close();
    }
  });

  test('hashes the token, enforces scopes, confirmation, rate limit, audit and logs', async () => {
    const logs: string[] = [];
    let now = new Date('2026-10-31T12:00:00.000Z');
    const ctx = await createTestApp({
      log: (line) => logs.push(line),
      now: () => now,
      mcpRatePerMinute: 40,
    });
    try {
      await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
      const created = await post(ctx.app, '/v1/mcp/clients', {
        code: 'cvbot-sintetico',
        description: 'Cliente MCP de prueba',
        role_code: 'mcp_client',
        scopes: ['read:*', 'write:contacts'],
      });
      expect(created.status).toBe(201);
      const createdBody = created.json as { id: string; token: string; prefix: string };
      const token = createdBody.token;
      expect(token.startsWith('wc_mcp_')).toBe(true);
      expect(createdBody.prefix).toBe(token.slice(0, 'wc_mcp_'.length + 6));

      const stored = await ctx.writer.read<{ prefix: string }>(sql`
        SELECT prefix
        FROM core.api_token
        WHERE token_hash = ${sha256Bytes(token)}
      `);
      expect(stored[0]?.prefix).toBe(createdBody.prefix);
      const leaked = await ctx.writer.read<{ prefix: string; code: string }>(sql`
        SELECT t.prefix, c.code
        FROM core.api_token t
        JOIN core.api_client c ON c.id = t.client_id
      `);
      expect(JSON.stringify(leaked)).not.toContain(token);

      const listed = await ctx.app.handle(new Request('http://localhost/v1/mcp/clients'));
      const listText = await listed.text();
      expect(listText).not.toContain(token);
      expect(listText).toContain(createdBody.prefix);

      const denied = await callTool(ctx.app, 'contacts_search', { q: 'nada' }, token);
      expect(denied.error).toBe(false);
      const narrow = await post(ctx.app, '/v1/mcp/clients', {
        code: 'solo-stock',
        description: 'Solo existencias',
        role_code: 'mcp_client',
        scopes: ['inventory.read'],
      });
      const narrowToken = (narrow.json as { token: string }).token;
      const hidden = await post(ctx.app, '/m2m/mcp', rpc(2, 'tools/list', {}), {
        authorization: `Bearer ${narrowToken}`,
      });
      const names = ((hidden.json as { result: { tools: { name: string }[] } }).result.tools).map((tool) => tool.name);
      expect(names).not.toContain('contacts_search');
      expect(names).toContain('inventory_stock_at');
      expect(names.some((name) => /approve|issue|void|send|delete|module|role|secret/i.test(name))).toBe(false);
      const forbidden = await callTool(ctx.app, 'contacts_search', {}, narrowToken);
      expect(forbidden.error).toBe(true);
      expect(forbidden.data?.code).toBe('WC_FORBIDDEN');

      const cellar = await ctx.writer.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM core.app_user WHERE email = ${'bodega@winecore.test'}
      `);
      const behalf = await post(ctx.app, '/v1/mcp/clients', {
        code: 'en-nombre-bodega',
        description: 'Alcance amplio, persona de bodega',
        role_code: 'agent',
        scopes: ['read:*', 'write:contacts'],
        on_behalf_of_user_id: cellar[0]?.id,
      });
      const behalfToken = (behalf.json as { token: string }).token;
      const narrowed = await callTool(ctx.app, 'contacts_search', {}, behalfToken);
      expect(narrowed.error).toBe(true);
      expect(narrowed.data?.code).toBe('WC_FORBIDDEN');

      const prepared = await callTool(ctx.app, 'contacts_create_prepare', {
        kind: 'company',
        legal_name: 'Cliente Sintético Uno',
        country: 'US',
        tax_id: 'ACM12',
        email: EMAIL,
        is_customer: true,
      }, token);
      expect(prepared.error).toBe(false);
      const preview = prepared.data as {
        confirmation_token: string;
        expires_at: string;
        preview: { tax_id_masked: string; duplicates: unknown[] };
      };
      expect(preview.expires_at).toBe('2026-10-31T12:15:00.000Z');
      expect(preview.preview.tax_id_masked).toBe('****ACM12');
      expect(JSON.stringify(preview)).not.toContain(EMAIL);

      const committed = await callTool(ctx.app, 'contacts_create_commit', {
        confirmation_token: preview.confirmation_token,
        idempotency_key: 'alta-sintetica-01',
      }, token);
      expect(committed.error).toBe(false);
      const contactId = (committed.data as { contact_id: string }).contact_id;
      expect(contactId).toMatch(/^[0-9a-f-]{36}$/i);
      const replay = await callTool(ctx.app, 'contacts_create_commit', {
        confirmation_token: preview.confirmation_token,
        idempotency_key: 'alta-sintetica-01',
      }, token);
      expect(replay.data).toEqual(committed.data);
      const count = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM party.contact WHERE legal_name = ${'Cliente Sintético Uno'}
      `);
      expect(count[0]?.n).toBe('1');

      const other = await callTool(ctx.app, 'contacts_create_prepare', {
        kind: 'company',
        legal_name: 'Cliente Sintético Dos',
        country: 'US',
        tax_id: 'ACM99',
        is_customer: true,
      }, token);
      const otherToken = (other.data as { confirmation_token: string }).confirmation_token;
      const foreign = await callTool(ctx.app, 'contacts_create_commit', {
        confirmation_token: otherToken,
      }, narrowToken);
      expect(foreign.error).toBe(true);
      expect(foreign.data?.code).toBe('WC_FORBIDDEN');

      const third = await callTool(ctx.app, 'contacts_create_prepare', {
        kind: 'company',
        legal_name: 'Cliente Sintético Tres',
        country: 'US',
        is_customer: true,
      }, token);
      const thirdToken = (third.data as { confirmation_token: string }).confirmation_token;
      const rows = await ctx.writer.read<{ preview: unknown }>(sql`
        SELECT preview FROM ops.mcp_confirmation ORDER BY created_at DESC LIMIT 1
      `);
      const storedPreview = typeof rows[0]?.preview === 'string'
        ? JSON.parse(rows[0].preview) as { v: number; payload: { input: { legal_name: string } } }
        : rows[0]?.preview as { v: number; payload: { input: { legal_name: string } } };
      storedPreview.payload.input.legal_name = 'Nombre alterado';
      await ctx.writer.withWrite(
        { type: 'system', id: 'mcp-test', requestId: 'tamper' },
        async (tx) => {
          tx.write(sql`
            UPDATE ops.mcp_confirmation
            SET preview = ${sql.json(storedPreview)}
            WHERE token_hash = ${sha256Bytes(thirdToken)}
          `);
        },
      );
      const tampered = await callTool(ctx.app, 'contacts_create_commit', {
        confirmation_token: thirdToken,
      }, token);
      expect(tampered.error).toBe(true);
      expect(tampered.data?.code).toBe('WC_MCP_CONFIRMATION_INVALID');

      const fourth = await callTool(ctx.app, 'contacts_create_prepare', {
        kind: 'company',
        legal_name: 'Cliente Sintético Cuatro',
        country: 'US',
        is_customer: true,
      }, token);
      const fourthToken = (fourth.data as { confirmation_token: string }).confirmation_token;
      now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
      const expired = await callTool(ctx.app, 'contacts_create_commit', {
        confirmation_token: fourthToken,
      }, token);
      expect(expired.error).toBe(true);
      expect(expired.data?.code).toBe('WC_MCP_CONFIRMATION_INVALID');
      expect(String(expired.data?.message_es)).toContain('caducado');

      const burst = await createTestApp({ mcpRatePerMinute: 2, log: (line) => logs.push(line) });
      try {
        expect((await callTool(burst.app, 'system_whoami', {})).error).toBe(false);
        expect((await callTool(burst.app, 'system_whoami', {})).error).toBe(false);
        const limited = await callTool(burst.app, 'system_whoami', {});
        expect(limited.status).toBe(429);
        expect(limited.code).toBe('WC_RATE_LIMITED');
      } finally {
        await burst.close();
      }

      const audits = await ctx.writer.read<{ after: string }>(sql`
        SELECT CAST(after_data AS VARCHAR) AS after
        FROM audit.audit_log
        WHERE table_name = 'mcp.call'
      `);
      expect(audits.length).toBeGreaterThan(0);
      const auditText = audits.map((row) => row.after).join('\n');
      expect(auditText).not.toContain(token);
      expect(auditText).not.toContain(EMAIL);
      expect(auditText).not.toContain('ACM12');
      expect(auditText).toContain('contacts_create_commit');
      const logText = logs.join('\n');
      expect(logText).not.toContain(token);
      expect(logText).not.toContain(EMAIL);
      expect(logText).not.toContain('ACM12');
    } finally {
      await ctx.close();
    }
  });
});

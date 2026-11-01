import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import type { UserCtx } from '../../src/core/auth/permissions';
import { sql } from '../../src/core/db/sql';
import { contextForUser } from '../../src/mcp/context';
import { defineRestRead, defineRestWrite } from '../../src/mcp/rest';
import { callTool as callInProcess } from '../../src/mcp/server';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function post(app: TestApp['app'], path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, json: text.trim() === '' ? null : JSON.parse(text) as unknown };
}

async function mcp(app: TestApp['app'], method: string, params: unknown, options: { token?: string; path?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return post(app, options.path ?? '/m2m/mcp', { jsonrpc: '2.0', id: 1, method, params }, headers);
}

async function tool(app: TestApp['app'], name: string, args: unknown, options: { token?: string; path?: string } = {}) {
  const response = await mcp(app, 'tools/call', { name, arguments: args }, options);
  const body = response.json as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const block = body.result?.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Record<string, unknown> : {};
  return { error: body.result?.isError === true, data };
}

async function listed(app: TestApp['app'], path = '/m2m/mcp'): Promise<string[]> {
  const response = await mcp(app, 'tools/list', {}, { path });
  return ((response.json as { result: { tools: { name: string }[] } }).result.tools).map((item) => item.name);
}

async function newContact(app: TestApp['app'], legalName: string, base = ''): Promise<string> {
  const created = await post(app, `${base}/v1/contacts`, {
    kind: 'company',
    legal_name: legalName,
    country_code: 'ES',
    language: 'es',
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    vat_regime: 'general',
    payment_terms_days: 30,
  }, { 'idempotency-key': `test-${crypto.randomUUID()}` });
  expect(created.status).toBe(201);
  return (created.json as { id: string }).id;
}

async function owner(t: TestApp): Promise<UserCtx> {
  const rows = await t.writer.read<{ id: string; email: string; display_name: string }>(sql`
    SELECT id::VARCHAR AS id, email, display_name FROM core.app_user WHERE email = 'owner@winecore.test'
  `);
  const row = rows[0];
  if (!row) throw new Error('Falta el propietario de prueba');
  return { id: row.id, email: row.email, displayName: row.display_name, roles: [{ role: 'owner', legalEntityId: null, legalEntityCode: null }] };
}

describe('MCP sobre las rutas de la app', () => {
  test('lee, prepara y confirma como la persona, con If-Match y detección de cambios', async () => {
    const t = await createTestApp();
    try {
      const id = await newContact(t.app, 'Bodegas Sintéticas Puente SL');

      const list = await tool(t.app, 'contacts_list', { q: 'Puente' });
      expect(list.error).toBe(false);
      expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(id);

      const csv = await tool(t.app, 'contacts_export_csv', { q: 'Puente' });
      expect(csv.error).toBe(false);
      expect(csv.data.content_type).toBe('text/csv');
      expect(String(csv.data.text)).toContain('Bodegas Sintéticas Puente SL');

      const prepared = await tool(t.app, 'contacts_update_prepare', { id, changes: { trade_name: 'Puente', payment_terms_days: 60 } });
      expect(prepared.error).toBe(false);
      const preview = prepared.data.preview as { route: string; record: { legal_name: string }; changes: Record<string, unknown> };
      expect(preview.route).toBe(`PATCH /v1/contacts/${id}`);
      expect(preview.record.legal_name).toBe('Bodegas Sintéticas Puente SL');
      expect(preview.changes).toMatchObject({ legal_name: 'Bodegas Sintéticas Puente SL', trade_name: 'Puente', payment_terms_days: 60 });
      expect(String(prepared.data.summary_es)).toContain('Bodegas Sintéticas Puente SL');

      const before = await t.app.handle(new Request(`http://localhost/v1/contacts/${id}`));
      expect(((await before.json()) as { trade_name: string | null }).trade_name).toBeNull();

      const committed = await tool(t.app, 'contacts_update_commit', { confirmation_token: prepared.data.confirmation_token });
      expect(committed.error).toBe(false);
      expect(committed.data.trade_name).toBe('Puente');
      expect(committed.data.payment_terms_days).toBe(60);
      expect((committed.data.links as { web: string }).web.endsWith(`/contactos/${id}`)).toBe(true);

      const audit = await t.writer.read<{ request_id: string; actor_type: string }>(sql`
        SELECT request_id, actor_type FROM audit.audit_log
        WHERE table_name = 'party.contact' AND row_id = ${id} AND action = 'UPDATE'
      `);
      expect(audit.some((row) => row.request_id.startsWith('mcp.') && row.actor_type === 'user')).toBe(true);

      const stale = await tool(t.app, 'contacts_update_prepare', { id, changes: { notes: 'Llamar por la mañana' } });
      await post(t.app, `/v1/contacts/${id}/archive`, {});
      const refused = await tool(t.app, 'contacts_update_commit', { confirmation_token: stale.data.confirmation_token });
      expect(refused.error).toBe(true);
      expect(refused.data.code).toBe('WC_MCP_PREVIEW_STALE');

      const invalid = await tool(t.app, 'contacts_update_prepare', { id, changes: { payment_terms_days: 999 } });
      expect(invalid.error).toBe(true);
      expect(invalid.data.code).toBe('WC_VALIDATION');
    } finally {
      await t.close();
    }
  });

  test('un cliente sin persona representada no usa las herramientas de la app; en nombre de alguien, sí', async () => {
    const t = await createTestApp();
    try {
      const alone = await post(t.app, '/v1/mcp/clients', {
        code: 'sin-persona',
        description: 'Cliente sin persona',
        role_code: 'mcp_client',
        scopes: ['read:*'],
      });
      const aloneToken = (alone.json as { token: string }).token;
      const refused = await tool(t.app, 'contacts_list', {}, { token: aloneToken });
      expect(refused.error).toBe(true);
      expect(refused.data.code).toBe('WC_FORBIDDEN');

      const me = await owner(t);
      const behalf = await post(t.app, '/v1/mcp/clients', {
        code: 'en-nombre-del-propietario',
        description: 'Cliente en nombre del propietario',
        role_code: 'agent',
        scopes: ['read:*', 'write:*'],
        on_behalf_of_user_id: me.id,
      });
      const behalfToken = (behalf.json as { token: string }).token;
      const allowed = await tool(t.app, 'contacts_list', {}, { token: behalfToken });
      expect(allowed.error).toBe(false);
    } finally {
      await t.close();
    }
  });

  test('listado compacto, por módulos y pasarela de búsqueda', async () => {
    const t = await createTestApp({ env: { API_BASE_PATH: '/api' } });
    try {
      const full = await listed(t.app, '/api/m2m/mcp');
      expect(full).toContain('contacts_list');
      expect(full).toContain('contacts_search');

      const compact = await listed(t.app, '/api/m2m/mcp?tools=compact');
      expect(compact).toContain('contacts_search');
      expect(compact).toContain('system_tools_search');
      expect(compact).toContain('system_tool_run');
      expect(compact).not.toContain('contacts_list');

      const contactsOnly = await listed(t.app, '/api/m2m/mcp?toolsets=contacts');
      expect(contactsOnly).toContain('contacts_list');
      expect(contactsOnly).toContain('system_whoami');
      expect(contactsOnly).not.toContain('catalog_formats_list');

      const found = await tool(t.app, 'system_tools_search', { q: 'añadir dirección' }, { path: '/api/m2m/mcp' });
      expect(found.error).toBe(false);
      const names = (found.data.items as { name: string; commit?: string }[]);
      expect(names.map((item) => item.name)).toContain('contacts_address_add_prepare');
      expect(names.find((item) => item.name === 'contacts_address_add_prepare')?.commit).toBe('contacts_address_add_commit');

      const id = await newContact(t.app, 'Distribuciones Sintéticas Pasarela SA', '/api');
      const run = await tool(t.app, 'system_tool_run', { name: 'contacts_detail_get', arguments: { id } }, { path: '/api/m2m/mcp' });
      expect(run.error).toBe(false);
      expect(run.data.legal_name).toBe('Distribuciones Sintéticas Pasarela SA');
    } finally {
      await t.close();
    }
  });

  test('sube un fichero en base64 y lo descarga igual', async () => {
    const t = await createTestApp();
    try {
      const id = await newContact(t.app, 'Corchos Sintéticos Adjunto SL');
      const me = await owner(t);
      const ctx = await contextForUser(t.writer, me, {
        now: () => new Date(),
        webBaseUrl: '',
        requestId: 'test-bridge',
        rest: { handle: (request) => t.app.handle(request), basePath: '' },
      });
      const upload = defineRestWrite({
        name: 'test_attachment_upload',
        module: 'system',
        scope: 'contacts.write',
        title: 'Subir adjunto',
        description: 'Prueba',
        input: z.object({ table: z.string(), row_id: z.string(), role: z.string(), file_base64: z.string(), filename: z.string(), content_type: z.string() }),
        route: 'POST /v1/attachments',
        upload: { field: 'file', formFields: ['table', 'row_id', 'role'] },
      });
      const download = defineRestRead({
        name: 'test_attachment_get',
        module: 'system',
        scope: 'contacts.read',
        title: 'Descargar adjunto',
        description: 'Prueba',
        input: z.object({ id: z.string() }),
        route: 'GET /v1/attachments/:id',
      });
      const tools = [upload, download];
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');
      const prepared = await callInProcess(ctx, 'test_attachment_upload_prepare', {
        table: 'party.contact',
        row_id: id,
        role: 'contract',
        file_base64: pdf.toString('base64'),
        filename: 'ficha.pdf',
        content_type: 'application/pdf',
      }, tools);
      expect(prepared.isError).not.toBe(true);
      const token = (prepared.structuredContent as { confirmation_token: string }).confirmation_token;
      const preview = (prepared.structuredContent as { preview: { changes: Record<string, unknown> } }).preview;
      expect(preview.changes).toEqual({ table: 'party.contact', row_id: id, role: 'contract', filename: 'ficha.pdf' });
      const committed = await callInProcess(ctx, 'test_attachment_upload_commit', { confirmation_token: token }, tools);
      expect(committed.isError ? JSON.stringify(committed.content) : 'ok').toBe('ok');
      const stored = committed.structuredContent as { id?: string; attachment_id?: string };
      const attachmentId = stored.attachment_id ?? stored.id;
      expect(typeof attachmentId).toBe('string');

      const fetched = await callInProcess(ctx, 'test_attachment_get', { id: attachmentId }, tools);
      expect(fetched.isError).not.toBe(true);
      const file = fetched.structuredContent as { content_type: string; base64: string; size_bytes: number };
      expect(file.content_type).toBe('application/pdf');
      expect(file.size_bytes).toBe(pdf.length);
      expect(Buffer.from(file.base64, 'base64').equals(pdf)).toBe(true);
    } finally {
      await t.close();
    }
  });
});

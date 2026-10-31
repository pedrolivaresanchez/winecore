import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

function headers(email?: string, json = false): Headers {
  const value = new Headers();
  if (json) value.set('content-type', 'application/json');
  if (email) value.set('x-dev-user', email);
  return value;
}

async function call(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: headers(email, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

describe('personas', () => {
  it('lista, invita, cambia roles y desactiva, y /v1/me incluye el id', async () => {
    const ctx = await createTestApp();
    try {
      const me = await call(ctx.app, 'GET', '/v1/me');
      const ownerRow = await ctx.writer.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM core.app_user WHERE email = ${'owner@winecore.test'}
      `);
      expect(me.body.id).toBe(ownerRow[0]?.id.toLowerCase());

      const listed = await call(ctx.app, 'GET', '/v1/users', undefined, 'admin@winecore.test');
      expect(listed.status).toBe(200);
      const people = listed.body.items as { id: string; email: string; display_name: string; roles: { role: string }[]; status: string }[];
      expect(people.some((person) => person.email === 'bodega@winecore.test' && person.display_name === 'Bodega')).toBe(true);
      expect(people.every((person) => person.id && person.status && person.roles.length > 0)).toBe(true);

      const denied = await call(ctx.app, 'GET', '/v1/users', undefined, 'bodega@winecore.test');
      expect(denied.status).toBe(403);
      const adminInvite = await call(ctx.app, 'POST', '/v1/users', {
        email: 'campo@winecore.test',
        display_name: 'Campo sintético',
        roles: [{ role: 'field' }],
      }, 'admin@winecore.test');
      expect(adminInvite.status).toBe(403);

      const invited = await call(ctx.app, 'POST', '/v1/users', {
        email: 'Campo@winecore.test',
        display_name: 'Campo sintético',
        roles: [{ role: 'field' }],
      });
      expect(invited.status).toBe(201);
      expect(invited.body).toMatchObject({
        email: 'campo@winecore.test',
        display_name: 'Campo sintético',
        status: 'active',
      });
      const roles = invited.body.roles as { role: string; legal_entity_id: string | null }[];
      expect(roles).toEqual([{ role: 'field', legal_entity_id: null, legal_entity_code: null }]);
      const duplicate = await call(ctx.app, 'POST', '/v1/users', {
        email: 'campo@winecore.test',
        display_name: 'Campo sintético',
        roles: [{ role: 'field' }],
      });
      expect(duplicate.status).toBe(422);

      const patched = await call(ctx.app, 'PATCH', `/v1/users/${String(invited.body.id)}`, {
        roles: [{ role: 'cellar' }, { role: 'field' }],
      });
      expect(patched.status).toBe(200);
      expect((patched.body.roles as { role: string }[]).map((role) => role.role).sort()).toEqual(['cellar', 'field']);

      const deactivated = await call(ctx.app, 'PATCH', `/v1/users/${String(invited.body.id)}`, {
        status: 'suspended',
      });
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.status).toBe('suspended');
      const login = await call(ctx.app, 'GET', '/v1/me', undefined, 'campo@winecore.test');
      expect(login.status).toBe(403);

      const ownerId = String(me.body.id);
      const last = await call(ctx.app, 'PATCH', `/v1/users/${ownerId}`, { status: 'revoked' });
      expect(last.status).toBe(422);
      expect(JSON.stringify(last.body)).toContain('propietario');

      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'core.app_user' AND row_id = ${String(invited.body.id)}
      `);
      expect(audit.map((row) => row.action)).toContain('INSERT');
      expect(audit.map((row) => row.action)).toContain('UPDATE');
    } finally {
      await ctx.close();
    }
  });
});

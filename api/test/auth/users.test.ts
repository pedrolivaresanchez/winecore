import { beforeEach, describe, expect, it } from 'bun:test';
import { clearAuthEphemeralState } from '../../src/core/auth/stepup/memory';
import { sql } from '../../src/core/db/sql';
import { authenticationResponse, createPasskey, registrationResponse, type SoftwarePasskey } from '../approvals-api/authenticator';
import { createTestApp } from '../helpers';

const ORIGIN = 'http://localhost:5173';
const REGISTER_PASSKEY = 'Registra una passkey en Ajustes > Seguridad';
const STEP_UP_MESSAGE = 'Falta una verificación reforzada reciente';

beforeEach(() => {
  clearAuthEphemeralState();
});

function clockAt(iso = '2026-10-31T12:00:00.000Z') {
  let ms = Date.parse(iso);
  return {
    now: () => new Date(ms),
    advance(delta: number) {
      ms += delta;
    },
  };
}

function headers(email?: string, json = false): Headers {
  const value = new Headers({ 'content-type': 'application/json' });
  if (!json) value.delete('content-type');
  if (email) value.set('x-dev-user', email);
  if (json) value.set('content-type', 'application/json');
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

async function ownerCall(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : JSON.parse(text) as Record<string, unknown>,
  };
}

async function registerPasskey(app: { handle: (request: Request) => Promise<Response> }) {
  await ownerCall(app, 'GET', '/v1/me');
  const options = await ownerCall(app, 'POST', '/v1/auth/passkeys/registration/options');
  expect(options.status).toBe(200);
  const passkey = createPasskey();
  const response = registrationResponse(
    passkey,
    options.body as unknown as Parameters<typeof registrationResponse>[1],
    ORIGIN,
  );
  const verified = await ownerCall(app, 'POST', '/v1/auth/passkeys/registration/verify', {
    response,
    label: 'Llave del propietario',
  });
  expect(verified.status).toBe(200);
  return passkey;
}

async function stepUp(app: { handle: (request: Request) => Promise<Response> }, passkey: SoftwarePasskey) {
  const options = await ownerCall(app, 'POST', '/v1/auth/step-up/options');
  expect(options.status).toBe(200);
  const passkeyOptions = (options.body as unknown as { passkey: Parameters<typeof authenticationResponse>[1] }).passkey;
  const assertion = authenticationResponse(passkey, passkeyOptions, ORIGIN);
  const verified = await ownerCall(app, 'POST', '/v1/auth/step-up/verify', { passkey_response: assertion });
  expect(verified.status).toBe(200);
}

const person = (email: string, role: string) => ({
  email,
  display_name: 'Persona sintética',
  roles: [{ role }],
});

describe('personas', () => {
  it('lista, invita un rol no privilegiado sin step-up y /v1/me incluye el id', async () => {
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
      expect(people.some((row) => row.email === 'bodega@winecore.test' && row.display_name === 'Bodega')).toBe(true);

      expect((await call(ctx.app, 'GET', '/v1/users', undefined, 'bodega@winecore.test')).status).toBe(403);
      expect((await call(ctx.app, 'POST', '/v1/users', person('campo@winecore.test', 'field'), 'admin@winecore.test')).status).toBe(403);

      const invited = await call(ctx.app, 'POST', '/v1/users', person('Campo@winecore.test', 'field'));
      expect(invited.status).toBe(201);
      expect(invited.body).toMatchObject({ email: 'campo@winecore.test', status: 'active' });
      expect(invited.body.roles).toEqual([{ role: 'field', legal_entity_id: null, legal_entity_code: null }]);
      const renamed = await call(ctx.app, 'PATCH', `/v1/users/${String(invited.body.id)}`, {
        display_name: 'Campo renombrado',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.display_name).toBe('Campo renombrado');

      const duplicate = await call(ctx.app, 'POST', '/v1/users', person('campo@winecore.test', 'field'));
      expect(duplicate.status).toBe(422);
      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log
        WHERE table_name = 'core.app_user' AND row_id = ${String(invited.body.id)}
      `);
      expect(audit.map((row) => row.action)).toContain('INSERT');
    } finally {
      await ctx.close();
    }
  });

  it('sin passkey, alta de owner o admin y el cambio de roles o la baja piden registrarla', async () => {
    const ctx = await createTestApp();
    try {
      const ownerInvite = await call(ctx.app, 'POST', '/v1/users', person('dueno@winecore.test', 'owner'));
      expect(ownerInvite.status).toBe(401);
      expect(ownerInvite.body.code).toBe('WC_STEP_UP_REQUIRED');
      expect(ownerInvite.body.message).toBe(REGISTER_PASSKEY);

      const adminInvite = await call(ctx.app, 'POST', '/v1/users', person('oficina@winecore.test', 'admin'));
      expect(adminInvite.status).toBe(401);
      expect(adminInvite.body.message).toBe(REGISTER_PASSKEY);

      const invited = await call(ctx.app, 'POST', '/v1/users', person('campo@winecore.test', 'field'));
      expect(invited.status).toBe(201);
      const id = String(invited.body.id);
      const roles = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { roles: [{ role: 'cellar' }] });
      expect(roles.status).toBe(401);
      expect(roles.body.code).toBe('WC_STEP_UP_REQUIRED');
      expect(roles.body.message).toBe(REGISTER_PASSKEY);
      const suspended = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { status: 'suspended' });
      expect(suspended.status).toBe(401);
      expect(suspended.body.message).toBe(REGISTER_PASSKEY);
      const revoked = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { status: 'revoked' });
      expect(revoked.status).toBe(401);
      expect(revoked.body.message).toBe(REGISTER_PASSKEY);
      const still = await call(ctx.app, 'GET', '/v1/users');
      const row = (still.body.items as { id: string; status: string; roles: { role: string }[] }[]).find((item) => item.id === id);
      expect(row?.status).toBe('active');
      expect(row?.roles.map((role) => role.role)).toEqual(['field']);
    } finally {
      await ctx.close();
    }
  });

  it('con passkey exige el step-up de aprobaciones y entonces permite roles, baja y alta privilegiada', async () => {
    const clock = clockAt();
    const ctx = await createTestApp({ now: () => clock.now() });
    try {
      const passkey = await registerPasskey(ctx.app);
      const invited = await call(ctx.app, 'POST', '/v1/users', person('campo@winecore.test', 'advisor'));
      expect(invited.status).toBe(201);
      const id = String(invited.body.id);

      const missing = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { roles: [{ role: 'cellar' }, { role: 'field' }] });
      expect(missing.status).toBe(401);
      expect(missing.body.code).toBe('WC_STEP_UP_REQUIRED');
      expect(missing.body.message).toBe(STEP_UP_MESSAGE);

      await stepUp(ctx.app, passkey);
      clock.advance(6 * 60 * 1000);
      const stale = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { status: 'suspended' });
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe('WC_STEP_UP_REQUIRED');
      expect(stale.body.message).toBe(STEP_UP_MESSAGE);

      await stepUp(ctx.app, passkey);
      const patched = await call(ctx.app, 'PATCH', `/v1/users/${id}`, {
        roles: [{ role: 'cellar' }, { role: 'field' }],
      });
      expect(patched.status).toBe(200);
      expect((patched.body.roles as { role: string }[]).map((role) => role.role).sort()).toEqual(['cellar', 'field']);
      const deactivated = await call(ctx.app, 'PATCH', `/v1/users/${id}`, { status: 'revoked' });
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.status).toBe('revoked');
      expect((await call(ctx.app, 'GET', '/v1/me', undefined, 'campo@winecore.test')).status).toBe(403);

      const me = await call(ctx.app, 'GET', '/v1/me');
      const last = await call(ctx.app, 'PATCH', `/v1/users/${String(me.body.id)}`, { status: 'suspended' });
      expect(last.status).toBe(422);
      expect(JSON.stringify(last.body)).toContain('propietario');

      const admin = await call(ctx.app, 'POST', '/v1/users', person('oficina@winecore.test', 'admin'));
      expect(admin.status).toBe(201);
      expect((admin.body.roles as { role: string }[])[0]?.role).toBe('admin');
      const owner = await call(ctx.app, 'POST', '/v1/users', person('socia@winecore.test', 'owner'));
      expect(owner.status).toBe(201);
      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'core.app_user' AND row_id = ${id}
      `);
      expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['INSERT', 'UPDATE']));
    } finally {
      await ctx.close();
    }
  });
});

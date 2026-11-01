import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp } from '../helpers';
import { authenticationResponse, createPasskey, registrationResponse, type SoftwarePasskey } from './authenticator';
import { clearAuthEphemeralState } from '../../src/core/auth/stepup/memory';
import { decryptSecret, sha256Bytes } from '../../src/core/auth/stepup/crypto';
import { totpCode } from '../../src/core/auth/stepup/totp';
import { openApprovalService } from '../../src/core/approvals/sql-store';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { newId } from '../../src/core/ids';
import type { ApprovalKind } from '../../src/core/approvals/types';

const ORIGIN = 'http://localhost:5173';
const API = 'http://localhost';
const PO = '019a0000-0000-7000-8000-000000000001';
const CVPO = '019a0000-0000-7000-8000-000000000002';
const OWNER = '019a0000-0000-7000-8000-000000000011';
const ADMIN = '019a0000-0000-7000-8000-000000000012';
const CELLAR = '019a0000-0000-7000-8000-000000000014';
const DATA_KEY = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt('0123456789abcdef'.slice((index * 2) % 16, (index * 2) % 16 + 2), 16));

beforeEach(() => {
  clearAuthEphemeralState();
});

function mutableClock(iso = '2026-10-31T12:00:00.000Z') {
  let ms = Date.parse(iso);
  return {
    now: () => new Date(ms),
    advance(delta: number) {
      ms += delta;
    },
  };
}

function ownerHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ 'content-type': 'application/json', ...extra });
}

function asUser(email: string): Headers {
  return ownerHeaders({ 'x-dev-user': email });
}

async function call(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  headers: Headers = ownerHeaders(),
) {
  const response = await app.handle(new Request(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? null : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed, headers: response.headers };
}

async function registerPasskey(
  app: { handle: (request: Request) => Promise<Response> },
  headers: Headers,
  label = 'Llave del propietario',
) {
  const options = await call(app, 'POST', '/v1/auth/passkeys/registration/options', undefined, headers);
  expect(options.status).toBe(200);
  const passkey = createPasskey();
  const response = registrationResponse(
    passkey,
    options.body as unknown as Parameters<typeof registrationResponse>[1],
    ORIGIN,
  );
  const verified = await call(app, 'POST', '/v1/auth/passkeys/registration/verify', { response, label }, headers);
  expect(verified.status).toBe(200);
  return { passkey, credential: verified.body?.credential as { id: string; kind: string; label: string } };
}

async function stepUpWithPasskey(
  app: { handle: (request: Request) => Promise<Response> },
  passkey: SoftwarePasskey,
  headers: Headers,
) {
  const options = await call(app, 'POST', '/v1/auth/step-up/options', undefined, headers);
  expect(options.status).toBe(200);
  const passkeyOptions = (options.body as unknown as { passkey: Parameters<typeof authenticationResponse>[1] }).passkey;
  const assertion = authenticationResponse(passkey, passkeyOptions, ORIGIN);
  return call(app, 'POST', '/v1/auth/step-up/verify', { passkey_response: assertion }, headers);
}

async function openApp(clock = mutableClock()) {
  const ctx = await createTestApp({ now: () => clock.now() });
  return { ...ctx, clock };
}

function actor(userId = OWNER) {
  return { type: 'user' as const, id: userId, requestId: 'test-approval' };
}

async function requestApproval(
  ctx: Awaited<ReturnType<typeof openApp>>,
  overrides: Partial<{
    kind: ApprovalKind;
    legalEntityId: string | null;
    requestedBy: string;
    payload: Record<string, unknown>;
  }> = {},
) {
  const service = await openApprovalService(ctx.writer, actor(), ctx.clock);
  return service.requestApproval({
    kind: overrides.kind ?? 'regulatory_submission',
    legalEntityId: overrides.legalEntityId === undefined ? PO : overrides.legalEntityId,
    subjectTable: 'regulatory.submission',
    subjectId: newId(),
    payload: overrides.payload ?? { destination: 'AEAT', litres: '18340', records: 12 },
    summary: 'Envío regulatorio de prueba',
    requestedBy: overrides.requestedBy ?? ADMIN,
  });
}

describe('passkeys y TOTP', () => {
  test('registra una passkey con una ceremonia real y la revoca', async () => {
    const ctx = await openApp();
    try {
      const { passkey, credential } = await registerPasskey(ctx.app, ownerHeaders());
      expect(credential.kind).toBe('passkey');
      expect(credential.label).toBe('Llave del propietario');
      const listed = await call(ctx.app, 'GET', '/v1/auth/credentials');
      expect(listed.status).toBe(200);
      const items = listed.body?.items as { id: string; kind: string; last_used_at: string | null }[];
      expect(items.map((item) => item.id)).toContain(credential.id);
      expect(items[0]?.last_used_at).toBeNull();
      const blocked = await call(ctx.app, 'POST', `/v1/auth/credentials/${credential.id}/revoke`);
      expect(blocked.status).toBe(401);
      expect(blocked.body?.code).toBe('WC_STEP_UP_REQUIRED');
      expect(blocked.body?.fields).toEqual({
        step_up: 'Hace falta una verificación reforzada de los últimos 5 minutos',
      });
      expect((await stepUpWithPasskey(ctx.app, passkey, ownerHeaders())).status).toBe(200);
      const revoked = await call(ctx.app, 'POST', `/v1/auth/credentials/${credential.id}/revoke`);
      expect(revoked.status).toBe(200);
      const after = await call(ctx.app, 'GET', '/v1/auth/credentials');
      expect(after.body?.items).toEqual([]);
      const missing = await call(ctx.app, 'POST', `/v1/auth/credentials/${credential.id}/revoke`);
      expect(missing.status).toBe(200);
      const foreign = await call(ctx.app, 'POST', `/v1/auth/credentials/${newId()}/revoke`, undefined, asUser('admin@winecore.test'));
      expect(foreign.status).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  test('da de alta TOTP, confirma, rechaza la repetición y no guarda el secreto en claro', async () => {
    const logs: string[] = [];
    const clock = mutableClock();
    const ctx = await createTestApp({ now: () => clock.now(), log: (line) => logs.push(line) });
    try {
      const enrolled = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      expect(enrolled.status).toBe(200);
      const url = String(enrolled.body?.otpauth_url);
      expect(url.startsWith('otpauth://totp/')).toBe(true);
      expect(url).toContain('algorithm=SHA1');
      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
      expect(url).toContain('issuer=WineCore');
      const secret = secretFromUrl(url);
      const code = totpCode(secret, clock.now());
      const confirmed = await call(ctx.app, 'POST', '/v1/auth/totp/confirm', { code });
      expect(confirmed.status).toBe(200);
      expect((confirmed.body?.credential as { kind: string }).kind).toBe('totp');
      const replay = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: code });
      expect(replay.status).toBe(401);
      expect(replay.body?.code).toBe('WC_VERIFY_FAILED');
      const rows = await ctx.writer.read<{ totp_secret_enc: string }>(`
        SELECT totp_secret_enc FROM core.user_credential WHERE kind = 'totp' AND revoked_at IS NULL
      `);
      const stored = Buffer.from(rows[0]?.totp_secret_enc ?? '', 'base64');
      expect(stored.toString('utf8').includes(base32Encode(secret))).toBe(false);
      const plain = decryptSecret(DATA_KEY, stored);
      expect(plain.length).toBe(20);
      expect(totpCode(plain, clock.now(), 1)).toBe(totpCode(secret, clock.now(), 1));
      plain.fill(0);
      const joined = logs.join('\n');
      expect(joined.includes('otpauth')).toBe(false);
      expect(joined.includes(base32Encode(secret))).toBe(false);
      expect(joined.includes(code)).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('acepta el paso anterior y el siguiente, y rechaza dos pasos', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const enrolled = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      const secret = secretFromUrl(String(enrolled.body?.otpauth_url));
      const previous = totpCode(secret, clock.now(), -1);
      const confirmed = await call(ctx.app, 'POST', '/v1/auth/totp/confirm', { code: previous });
      expect(confirmed.status).toBe(200);
      const current = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: totpCode(secret, clock.now(), 0) });
      expect(current.status).toBe(200);
      expect(typeof current.body?.stepped_up_at).toBe('string');
      expect(current.headers.get('set-cookie')).toContain('wc_stepup=');
      expect(current.headers.get('set-cookie')).toContain('HttpOnly');
      const ahead = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: totpCode(secret, clock.now(), 1) });
      expect(ahead.status).toBe(200);
      const outside = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: totpCode(secret, clock.now(), -2) });
      expect(outside.status).toBe(401);
      expect(outside.body?.code).toBe('WC_VERIFY_FAILED');
    } finally {
      await ctx.close();
    }
  });

  test('limita los intentos fallidos de TOTP', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const enrolled = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      const secret = secretFromUrl(String(enrolled.body?.otpauth_url));
      const good = totpCode(secret, clock.now());
      await call(ctx.app, 'POST', '/v1/auth/totp/confirm', { code: good });
      const wrong = unusedCode(secret, clock.now());
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: wrong });
        expect(failed.status).toBe(401);
      }
      clock.advance(30_000);
      const locked = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', {
        totp_code: totpCode(secret, clock.now()),
      });
      expect(locked.status).toBe(429);
      expect(locked.body?.code).toBe('WC_RATE_LIMITED');
      clock.advance(15 * 60 * 1000 + 1000);
      const again = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', {
        totp_code: totpCode(secret, clock.now()),
      });
      expect(again.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test('el reto de la passkey es de un solo uso y caduca', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const { passkey } = await registerPasskey(ctx.app, ownerHeaders());
      const options = await call(ctx.app, 'POST', '/v1/auth/step-up/options');
      const passkeyOptions = (options.body as unknown as { passkey: Parameters<typeof authenticationResponse>[1]; totp: boolean }).passkey;
      expect(options.body?.totp).toBe(false);
      const assertion = authenticationResponse(passkey, passkeyOptions, ORIGIN);
      const first = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { passkey_response: assertion });
      expect(first.status).toBe(200);
      const second = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { passkey_response: assertion });
      expect(second.status).toBe(401);
      expect(second.body?.code).toBe('WC_VERIFY_FAILED');

      const fresh = await call(ctx.app, 'POST', '/v1/auth/step-up/options');
      const stale = authenticationResponse(
        passkey,
        (fresh.body as unknown as { passkey: Parameters<typeof authenticationResponse>[1] }).passkey,
        ORIGIN,
      );
      clock.advance(121_000);
      const expired = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { passkey_response: stale });
      expect(expired.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  test('la primera credencial exige una sesión joven y las siguientes un step-up', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      await call(ctx.app, 'GET', '/v1/auth/credentials');
      await ctx.client.query(sql`
        UPDATE core.session
        SET created_at = ${new Date(clock.now().getTime() - 11 * 60_000)}
        WHERE user_id = CAST(${OWNER} AS UUID)
      `);
      const passkey = await call(ctx.app, 'POST', '/v1/auth/passkeys/registration/options');
      expect(passkey.status).toBe(401);
      expect(passkey.body?.code).toBe('WC_STEP_UP_REQUIRED');
      expect(passkey.body?.fields).toEqual({
        session: 'La primera credencial exige una sesión de menos de 10 minutos',
      });
      const totp = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      expect(totp.status).toBe(401);
      expect((totp.body?.fields as { session?: string }).session).toBeTruthy();

      await ctx.client.query(sql`
        UPDATE core.session
        SET created_at = ${clock.now()}
        WHERE user_id = CAST(${OWNER} AS UUID)
      `);
      const { passkey: key } = await registerPasskey(ctx.app, ownerHeaders(), 'Primera llave');
      const second = await call(ctx.app, 'POST', '/v1/auth/passkeys/registration/options');
      expect(second.status).toBe(401);
      expect(second.body?.fields).toEqual({
        step_up: 'Hace falta una verificación reforzada de los últimos 5 minutos',
      });
      const enroll = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      expect(enroll.status).toBe(401);
      expect((enroll.body?.fields as { step_up?: string }).step_up).toBeTruthy();

      expect((await stepUpWithPasskey(ctx.app, key, ownerHeaders())).status).toBe(200);
      const again = await call(ctx.app, 'POST', '/v1/auth/passkeys/registration/options');
      expect(again.status).toBe(200);
      const enrolled = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      expect(enrolled.status).toBe(200);
      const secret = secretFromUrl(String(enrolled.body?.otpauth_url));
      const confirmed = await call(ctx.app, 'POST', '/v1/auth/totp/confirm', {
        code: totpCode(secret, clock.now(), 1),
      });
      expect(confirmed.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test('renombra una credencial propia y deja auditoría sin material secreto', async () => {
    const ctx = await openApp();
    try {
      const { credential } = await registerPasskey(ctx.app, ownerHeaders());
      const renamed = await call(ctx.app, 'PATCH', `/v1/auth/credentials/${credential.id}`, {
        label: 'Llave del teléfono',
      });
      expect(renamed.status).toBe(200);
      expect((renamed.body?.credential as { label: string }).label).toBe('Llave del teléfono');
      const long = 'a'.repeat(61);
      const tooLong = await call(ctx.app, 'PATCH', `/v1/auth/credentials/${credential.id}`, { label: long });
      expect(tooLong.status).toBe(422);
      const empty = await call(ctx.app, 'PATCH', `/v1/auth/credentials/${credential.id}`, { label: '  ' });
      expect(empty.status).toBe(422);
      const exact = await call(ctx.app, 'PATCH', `/v1/auth/credentials/${credential.id}`, { label: 'b'.repeat(60) });
      expect(exact.status).toBe(200);
      const foreign = await call(ctx.app, 'PATCH', `/v1/auth/credentials/${credential.id}`, {
        label: 'Ajena',
      }, asUser('admin@winecore.test'));
      expect(foreign.status).toBe(404);
      const audit = await ctx.writer.read<{ before_data: unknown; after_data: unknown }>(sql`
        SELECT before_data, after_data
        FROM audit.audit_log
        WHERE table_name = 'core.user_credential' AND action = 'UPDATE' AND row_id = ${credential.id}
        ORDER BY id DESC
        LIMIT 1
      `);
      const after = JSON.stringify(audit[0]?.after_data ?? {});
      expect(after).toContain('bbbb');
      expect(after).not.toContain('public_key');
      expect(after).not.toContain('totp');
    } finally {
      await ctx.close();
    }
  });

  test('sin alta pendiente el TOTP no se confirma', async () => {
    const ctx = await openApp();
    try {
      const response = await call(ctx.app, 'POST', '/v1/auth/totp/confirm', { code: '123456' });
      expect(response.status).toBe(422);
      expect(response.body?.code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });
});

describe('aprobaciones', () => {
  test('aprobar la activación de reglas de facturación deja el conjunto activo', async () => {
    const ctx = await openApp();
    try {
      const { passkey } = await registerPasskey(ctx.app, ownerHeaders());
      const made = await call(ctx.app, 'POST', '/v1/billing-rules/sets', { notes: 'inicial' });
      expect(made.status).toBe(201);
      const setId = String(made.body?.id);
      const rules = await call(ctx.app, 'PUT', `/v1/billing-rules/sets/${setId}/rules`, {
        rules: [{ scope: 'default', issuing_entity_id: CVPO }],
      });
      expect(rules.status).toBe(200);
      const asked = await call(ctx.app, 'POST', `/v1/billing-rules/sets/${setId}/request-activation`, {});
      expect(asked.status).toBe(200);
      const stepped = await stepUpWithPasskey(ctx.app, passkey, ownerHeaders());
      expect(stepped.status).toBe(200);
      const decided = await call(ctx.app, 'POST', `/v1/approvals/${String(asked.body?.approval_request_id)}/decide`, {
        decision: 'approve',
        payload_sha256: asked.body?.payload_sha256,
      });
      expect(decided.status).toBe(200);
      const sets = await call(ctx.app, 'GET', '/v1/billing-rules/sets');
      const listed = (sets.body?.items as { id: string; status: string }[]).find((item) => item.id === setId);
      expect(listed?.status).toBe('active');
    } finally {
      await ctx.close();
    }
  });

  test('por defecto aprobar no pide passkey ni TOTP; el ajuste del propietario lo vuelve a exigir', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const settings = await call(ctx.app, 'GET', '/v1/approval-settings');
      expect(settings.status).toBe(200);
      expect(settings.body).toEqual({ require_step_up: false });

      const first = await requestApproval(ctx);
      const open = await call(ctx.app, 'GET', `/v1/approvals/${first.id}`);
      expect(open.status).toBe(200);
      const decided = await call(ctx.app, 'POST', `/v1/approvals/${first.id}/decide`, {
        decision: 'approve',
        payload_sha256: first.payloadSha256,
      });
      expect(decided.status).toBe(200);
      expect(decided.body?.status).toBe('approved');

      const forbidden = await call(ctx.app, 'PUT', '/v1/approval-settings', { require_step_up: true }, asUser('admin@winecore.test'));
      expect(forbidden.status).toBe(403);
      const invalid = await call(ctx.app, 'PUT', '/v1/approval-settings', { require_step_up: 'sí' });
      expect(invalid.status).toBe(422);
      const on = await call(ctx.app, 'PUT', '/v1/approval-settings', { require_step_up: true });
      expect(on.body).toEqual({ require_step_up: true });

      const second = await requestApproval(ctx);
      const blocked = await call(ctx.app, 'POST', `/v1/approvals/${second.id}/decide`, {
        decision: 'approve',
        payload_sha256: second.payloadSha256,
      });
      expect(blocked.status).toBe(401);
      expect(blocked.body?.code).toBe('WC_STEP_UP_REQUIRED');

      const off = await call(ctx.app, 'PUT', '/v1/approval-settings', { require_step_up: false });
      expect(off.body).toEqual({ require_step_up: false });
      const again = await call(ctx.app, 'POST', `/v1/approvals/${second.id}/decide`, {
        decision: 'approve',
        payload_sha256: second.payloadSha256,
      });
      expect(again.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test('exige verificación reciente, lista y muestra el detalle', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const enabled = await call(ctx.app, 'PUT', '/v1/approval-settings', { require_step_up: true });
      expect(enabled.status).toBe(200);
      const { passkey } = await registerPasskey(ctx.app, ownerHeaders());
      const approval = await requestApproval(ctx);
      const early = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(early.status).toBe(401);
      expect(early.body?.code).toBe('WC_STEP_UP_REQUIRED');

      const stepped = await stepUpWithPasskey(ctx.app, passkey, ownerHeaders());
      expect(stepped.status).toBe(200);
      clock.advance(6 * 60 * 1000);
      const stale = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(stale.status).toBe(401);
      expect(stale.body?.code).toBe('WC_STEP_UP_REQUIRED');

      const renewed = await stepUpWithPasskey(ctx.app, passkey, ownerHeaders());
      expect(renewed.status).toBe(200);
      const decided = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(decided.status).toBe(200);
      expect(decided.body?.status).toBe('approved');
      expect(decided.body?.can_decide).toBe(false);
      expect(decided.body?.approvals_count).toBe(1);
      expect(decided.body?.title).toBe('Envío regulatorio');
      expect((decided.body?.requested_by as { display_name: string }).display_name).toBe('Administración');

      const pending = await call(ctx.app, 'GET', '/v1/approvals?status=pending');
      expect((pending.body?.items as unknown[])).toEqual([]);
      const done = await call(ctx.app, 'GET', '/v1/approvals?status=decided');
      expect((done.body?.items as { id: string }[]).map((item) => item.id)).toContain(approval.id);
      const detail = await call(ctx.app, 'GET', `/v1/approvals/${approval.id}`);
      expect(detail.status).toBe(200);
      const display = detail.body?.payload_display as { label: string; value: string }[];
      expect(display).toContainEqual({ label: 'Litros', value: '18340' });
      expect(display).toContainEqual({ label: 'Destino', value: 'AEAT' });
      const decisions = detail.body?.decisions as {
        decision: string;
        step_up_method: string;
        decided_by: { display_name: string };
      }[];
      expect(decisions[0]?.decision).toBe('approve');
      expect(decisions[0]?.step_up_method).toBe('passkey');
      expect(decisions[0]?.decided_by.display_name).toBe('Propietario');
      const method = await ctx.writer.read<{ step_up_method: string }>(sql`
        SELECT step_up_method FROM ops.approval_decision WHERE request_id = CAST(${approval.id} AS UUID)
      `);
      expect(method[0]?.step_up_method).toBe('passkey');
    } finally {
      await ctx.close();
    }
  });

  test('decide con TOTP y guarda el método', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const enrolled = await call(ctx.app, 'POST', '/v1/auth/totp/enroll');
      const secret = secretFromUrl(String(enrolled.body?.otpauth_url));
      await call(ctx.app, 'POST', '/v1/auth/totp/confirm', { code: totpCode(secret, clock.now(), -1) });
      const stepped = await call(ctx.app, 'POST', '/v1/auth/step-up/verify', { totp_code: totpCode(secret, clock.now()) });
      expect(stepped.status).toBe(200);
      const approval = await requestApproval(ctx, { kind: 'cellar_loss' });
      const decided = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(decided.status).toBe(200);
      const method = await ctx.writer.read<{ step_up_method: string }>(sql`
        SELECT step_up_method FROM ops.approval_decision WHERE request_id = CAST(${approval.id} AS UUID)
      `);
      expect(method[0]?.step_up_method).toBe('totp');
      const detail = await call(ctx.app, 'GET', `/v1/approvals/${approval.id}`);
      const decisions = detail.body?.decisions as { step_up_method: string }[];
      expect(decisions[0]?.step_up_method).toBe('totp');
    } finally {
      await ctx.close();
    }
  });

  test('rechaza con motivo, el hash distinto y la segunda decisión', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      await putPolicy(ctx.app, { requires_step_up: false, allow_self_approval: true });
      const approval = await requestApproval(ctx, { requestedBy: OWNER });
      const short = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'reject',
        payload_sha256: approval.payloadSha256,
        note: 'corto',
      });
      expect(short.status).toBe(422);
      const mismatch = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: 'ab'.repeat(32),
      });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body?.code).toBe('WC040');
      const rejected = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'reject',
        payload_sha256: approval.payloadSha256,
        note: 'El cuadre de litros no cierra',
      });
      expect(rejected.status).toBe(200);
      expect(rejected.body?.status).toBe('rejected');
      const again = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(again.status).toBe(409);
      expect(again.body?.code).toBe('WC042');
    } finally {
      await ctx.close();
    }
  });

  test('caduca la solicitud y no deja decidirla después', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      await putPolicy(ctx.app, { requires_step_up: false, allow_self_approval: true });
      const approval = await requestApproval(ctx, { requestedBy: OWNER });
      clock.advance(25 * 60 * 60 * 1000);
      const expired = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(expired.status).toBe(409);
      expect(expired.body?.code).toBe('WC043');
      const second = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(second.status).toBe(409);
      expect(second.body?.code).toBe('WC042');
    } finally {
      await ctx.close();
    }
  });

  test('la misma persona no decide dos veces y un agente no puede decidir', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      await putPolicy(ctx.app, { min_approvals: 2, requires_step_up: false, allow_self_approval: true });
      const approval = await requestApproval(ctx, { requestedBy: OWNER });
      const first = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(first.status).toBe(200);
      expect(first.body?.status).toBe('pending');
      expect(first.body?.approvals_count).toBe(1);
      const duplicate = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body?.code).toBe('WC041');

      const approver = newId();
      await ctx.writer.withWrite(actor(), async (tx) => {
        tx.write(sql`
          INSERT INTO core.app_user (id, email, display_name, locale, status)
          VALUES (CAST(${approver} AS UUID), 'aprobador@winecore.test', 'Aprobador', 'es-ES', 'active')
        `);
        tx.write(sql`
          INSERT INTO core.user_role (id, user_id, role_code)
          VALUES (CAST(${newId()} AS UUID), CAST(${approver} AS UUID), 'approver')
        `);
      });
      const second = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      }, asUser('aprobador@winecore.test'));
      expect(second.status).toBe(200);
      expect(second.body?.status).toBe('approved');

      const other = await requestApproval(ctx);
      const agentToken = 'wc_agent_AbcdefMoreSecret99';
      const mcpToken = 'wc_mcp_AbcdefMoreSecret99';
      await insertMachine(ctx, 'agent', 'agente-prueba', agentToken);
      await insertMachine(ctx, 'mcp_client', 'cvbot', mcpToken);
      const agent = await call(ctx.app, 'POST', `/v1/approvals/${other.id}/decide`, {
        decision: 'approve',
        payload_sha256: other.payloadSha256,
      }, ownerHeaders({ authorization: `Bearer ${agentToken}` }));
      expect(agent.status).toBe(403);
      expect(agent.body?.code).toBe('WC_FORBIDDEN');
      const mcp = await call(ctx.app, 'POST', `/v1/approvals/${other.id}/decide`, {
        decision: 'approve',
        payload_sha256: other.payloadSha256,
      }, ownerHeaders({ authorization: `Bearer ${mcpToken}` }));
      expect(mcp.status).toBe(403);
      const untouched = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n
        FROM ops.approval_decision
        WHERE request_id = CAST(${other.id} AS UUID)
      `);
      expect(untouched[0]?.n).toBe(0);
      const listed = await call(ctx.app, 'GET', '/v1/approvals?status=all', undefined, ownerHeaders({
        authorization: `Bearer ${agentToken}`,
      }));
      expect(listed.status).toBe(200);
      const item = (listed.body?.items as { id: string; can_decide: boolean }[]).find((row) => row.id === other.id);
      expect(item?.can_decide).toBe(false);
      const unknown = await call(ctx.app, 'POST', `/v1/approvals/${other.id}/decide`, {
        decision: 'approve',
        payload_sha256: other.payloadSha256,
      }, ownerHeaders({ authorization: 'Bearer wc_agent_AbcdefNotReal999' }));
      expect(unknown.status).toBe(401);
      const credentials = await call(ctx.app, 'GET', '/v1/auth/credentials', undefined, ownerHeaders({
        authorization: `Bearer ${mcpToken}`,
      }));
      expect(credentials.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  test('el solicitante no se aprueba salvo que la política lo permita', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      await putPolicy(ctx.app, { requires_step_up: false, allow_self_approval: false });
      const approval = await requestApproval(ctx, { requestedBy: OWNER });
      const denied = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(denied.status).toBe(403);
      expect(denied.body?.code).toBe('WC_FORBIDDEN');
      await putPolicy(ctx.app, { requires_step_up: false, allow_self_approval: true });
      const allowed = await call(ctx.app, 'POST', `/v1/approvals/${approval.id}/decide`, {
        decision: 'approve',
        payload_sha256: approval.payloadSha256,
      });
      expect(allowed.status).toBe(200);
      expect(allowed.body?.status).toBe('approved');
    } finally {
      await ctx.close();
    }
  });

  test('bodega no decide y administración sí decide un mensaje a terceros', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const regulatory = await requestApproval(ctx);
      const hidden = await call(ctx.app, 'GET', '/v1/approvals?status=pending', undefined, asUser('bodega@winecore.test'));
      expect((hidden.body?.items as unknown[])).toEqual([]);
      const own = await requestApproval(ctx, { requestedBy: CELLAR, kind: 'regulatory_submission' });
      const seen = await call(ctx.app, 'GET', `/v1/approvals/${own.id}`, undefined, asUser('bodega@winecore.test'));
      expect(seen.status).toBe(200);
      expect(seen.body?.can_decide).toBe(false);
      const denied = await call(ctx.app, 'POST', `/v1/approvals/${own.id}/decide`, {
        decision: 'approve',
        payload_sha256: own.payloadSha256,
      }, asUser('bodega@winecore.test'));
      expect(denied.status).toBe(403);

      const message = await requestApproval(ctx, { kind: 'third_party_message', requestedBy: OWNER });
      const admin = await call(ctx.app, 'POST', `/v1/approvals/${message.id}/decide`, {
        decision: 'approve',
        payload_sha256: message.payloadSha256,
      }, asUser('admin@winecore.test'));
      expect(admin.status).toBe(200);
      expect(admin.body?.status).toBe('approved');
      void regulatory;
    } finally {
      await ctx.close();
    }
  });

  test('filtra por tipo y entidad y pagina con cursor', async () => {
    const ctx = await openApp();
    try {
      await requestApproval(ctx, { kind: 'emcs_submission', legalEntityId: CVPO });
      await requestApproval(ctx, { kind: 'edi_submission', legalEntityId: PO });
      const emcs = await call(ctx.app, 'GET', '/v1/approvals?status=pending&kind=emcs_submission&entity=CVPO');
      expect(emcs.status).toBe(200);
      expect(emcs.body?.total).toBe(1);
      expect((emcs.body?.items as { kind: string; legal_entity_code: string }[])[0]?.kind).toBe('emcs_submission');
      expect((emcs.body?.items as { legal_entity_code: string }[])[0]?.legal_entity_code).toBe('CVPO');
      const values: string[] = [];
      for (let index = 0; index < 51; index += 1) {
        const id = `019a0000-0000-7000-8100-${(index + 1).toString(16).padStart(12, '0')}`;
        values.push(sql`(
          CAST(${id} AS UUID),
          'invoice_batch_issue',
          CAST(${PO} AS UUID),
          'billing.invoice',
          CAST(${PO} AS UUID),
          ${'cd'.repeat(32)},
          ${`Lote de facturas ${index.toString().padStart(2, '0')}`},
          ${sql.json({ records: index })},
          'pending',
          ${OWNER},
          ${new Date(Date.parse('2026-10-31T12:00:00.000Z') + index * 1000)},
          ${new Date('2026-11-02T12:00:00.000Z')}
        )`);
      }
      await ctx.client.query(`
        INSERT INTO ops.approval_request (
          id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
          summary, details, status, requested_by, requested_at, expires_at
        ) VALUES ${values.join(',\n')}
      `);
      const first = await call(ctx.app, 'GET', '/v1/approvals?status=pending&kind=invoice_batch_issue');
      expect(first.body?.total).toBe(51);
      expect((first.body?.items as unknown[]).length).toBe(50);
      expect(typeof first.body?.next_cursor).toBe('string');
      const second = await call(ctx.app, 'GET', `/v1/approvals?status=pending&kind=invoice_batch_issue&cursor=${first.body?.next_cursor}`);
      expect((second.body?.items as { summary: string }[])).toHaveLength(1);
      expect(second.body?.next_cursor).toBeNull();
      const bad = await call(ctx.app, 'GET', '/v1/approvals?cursor=no-es-un-cursor');
      expect(bad.status).toBe(422);

      const short = await call(ctx.app, 'GET', '/v1/approvals?status=pending&kind=invoice_batch_issue&limit=20');
      expect((short.body?.items as unknown[]).length).toBe(20);
      expect(short.body?.total).toBe(51);
      const shortNext = await call(ctx.app, 'GET', `/v1/approvals?status=pending&kind=invoice_batch_issue&limit=20&cursor=${short.body?.next_cursor}`);
      expect((shortNext.body?.items as { id: string }[]).map((item) => item.id)).toEqual(
        (first.body?.items as { id: string }[]).slice(20, 40).map((item) => item.id),
      );
      expect((await call(ctx.app, 'GET', '/v1/approvals?limit=101')).status).toBe(422);
      expect((await call(ctx.app, 'GET', '/v1/approvals?limit=0')).status).toBe(422);

      await ctx.client.query(`
        UPDATE ops.approval_request SET requested_by = '${ADMIN}'
        WHERE id = CAST('019a0000-0000-7000-8100-000000000001' AS UUID)
      `);
      const ownerMine = await call(ctx.app, 'GET', '/v1/approvals?status=all&kind=invoice_batch_issue&mine=true&limit=100');
      expect(ownerMine.body?.total).toBe(50);
      const adminMine = await call(ctx.app, 'GET', '/v1/approvals?status=all&kind=invoice_batch_issue&mine=true', undefined, asUser('admin@winecore.test'));
      expect(adminMine.status).toBe(200);
      expect((adminMine.body?.items as { id: string }[]).map((item) => item.id)).toEqual(['019a0000-0000-7000-8100-000000000001']);
      expect((await call(ctx.app, 'GET', '/v1/approvals?mine=si')).status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  test('el consumo es compare-and-set y la entidad debe existir', async () => {
    const clock = mutableClock();
    const ctx = await openApp(clock);
    try {
      const early = await openApprovalService(ctx.writer, actor(), clock);
      await expect(early.requestApproval({
        kind: 'module_toggle',
        legalEntityId: '019a0000-0000-7000-8000-0000000000ff',
        subjectTable: 'core.module_state',
        subjectId: newId(),
        payload: { module: 'cellar', enabled: false },
        summary: 'Desactivar el módulo de bodega',
        requestedBy: OWNER,
      })).rejects.toMatchObject({ code: 'WC_VALIDATION' });

      await putPolicy(ctx.app, { kind: 'module_toggle', requires_step_up: false, allow_self_approval: true, allowed_roles: ['owner'] });
      const service = await openApprovalService(ctx.writer, actor(), clock);
      const approval = await requestApproval(ctx, { kind: 'module_toggle', requestedBy: OWNER });
      await service.decide({
        requestId: approval.id,
        decision: 'approve',
        payloadSha256: approval.payloadSha256,
        actor: {
          userId: OWNER,
          roles: [{ role: 'owner', legalEntityId: null }],
          kind: 'user',
          stepUpAt: null,
        },
      });
      const consumed = await service.consume({ requestId: approval.id, payloadSha256: approval.payloadSha256 });
      expect(consumed.status).toBe('consumed');
      await expect(service.consume({
        requestId: approval.id,
        payloadSha256: approval.payloadSha256,
      })).rejects.toMatchObject({ code: 'WC_ALREADY_CONSUMED' });

      const other = await requestApproval(ctx, { kind: 'module_toggle', requestedBy: OWNER });
      await service.decide({
        requestId: other.id,
        decision: 'approve',
        payloadSha256: other.payloadSha256,
        actor: {
          userId: OWNER,
          roles: [{ role: 'owner', legalEntityId: null }],
          kind: 'user',
          stepUpAt: null,
        },
      });
      const raced = await Promise.allSettled([
        service.consume({ requestId: other.id, payloadSha256: other.payloadSha256 }),
        service.consume({ requestId: other.id, payloadSha256: other.payloadSha256 }),
      ]);
      const codes = raced.map((result) => result.status === 'fulfilled' ? 'ok' : (result.reason as DomainError).code);
      expect(codes.filter((code) => code === 'ok')).toHaveLength(1);
      expect(codes.filter((code) => code === 'WC_ALREADY_CONSUMED')).toHaveLength(1);

      const pending = await requestApproval(ctx, { kind: 'module_toggle', requestedBy: OWNER });
      await expect(service.decide({
        requestId: pending.id,
        decision: 'approve',
        payloadSha256: pending.payloadSha256,
        actor: {
          userId: '019a0000-0000-7000-8000-00000000abcd',
          roles: [{ role: 'owner', legalEntityId: null }],
          kind: 'user',
          stepUpAt: clock.now().toISOString(),
        },
      })).rejects.toMatchObject({ code: 'WC_VALIDATION' });
    } finally {
      await ctx.close();
    }
  });
});

describe('políticas', () => {
  test('solo el propietario las lee y las cambia, con auditoría', async () => {
    const ctx = await openApp();
    try {
      const admin = await call(ctx.app, 'GET', '/v1/approval-policies', undefined, asUser('admin@winecore.test'));
      expect(admin.status).toBe(403);
      const listed = await call(ctx.app, 'GET', '/v1/approval-policies');
      expect(listed.status).toBe(200);
      const items = listed.body?.items as PolicyItem[];
      expect(items).toHaveLength(14);
      const third = items.find((item) => item.kind === 'third_party_message');
      expect(third?.requires_step_up).toBe(false);
      expect(third?.allow_self_approval).toBe(true);
      expect(third?.validity_hours).toBe(24);
      const organic = items.find((item) => item.kind === 'organic_report');
      expect(organic?.allow_self_approval).toBe(false);
      expect(organic?.allowed_roles).toEqual(['owner']);

      const denied = await call(ctx.app, 'PUT', '/v1/approval-policies/regulatory_submission', policyBody(), asUser('asesor@winecore.test'));
      expect(denied.status).toBe(403);
      const machineRole = await call(ctx.app, 'PUT', '/v1/approval-policies/regulatory_submission', policyBody({
        allowed_roles: ['agent'],
      }));
      expect(machineRole.status).toBe(422);
      const empty = await call(ctx.app, 'PUT', '/v1/approval-policies/regulatory_submission', policyBody({
        allowed_roles: [],
      }));
      expect(empty.status).toBe(422);
      const saved = await call(ctx.app, 'PUT', '/v1/approval-policies/regulatory_submission', policyBody({
        min_approvals: 2,
        validity_hours: 48,
        allow_self_approval: false,
      }));
      expect(saved.status).toBe(200);
      expect(saved.body?.min_approvals).toBe(2);
      expect(saved.body?.validity_hours).toBe(48);
      expect(typeof saved.body?.id).toBe('string');
      const updatedAgain = await call(ctx.app, 'PUT', '/v1/approval-policies/regulatory_submission', policyBody({
        min_approvals: 3,
        validity_hours: 48,
        allow_self_approval: false,
      }));
      expect(updatedAgain.status).toBe(200);
      expect(updatedAgain.body?.id).toBe(saved.body?.id);
      expect(updatedAgain.body?.min_approvals).toBe(3);
      const again = await call(ctx.app, 'GET', '/v1/approval-policies');
      const updated = (again.body?.items as PolicyItem[]).find((item) => item.kind === 'regulatory_submission');
      expect(updated?.min_approvals).toBe(3);
      expect(updated?.id).toBe(saved.body?.id);
      const audit = await ctx.writer.read<{ action: string }>(`
        SELECT action FROM audit.audit_log WHERE table_name = 'ops.approval_policy'
      `);
      expect(audit.map((row) => row.action)).toContain('INSERT');
      expect(audit.map((row) => row.action)).toContain('UPDATE');
      const chain = await call(ctx.app, 'POST', '/v1/audit/verify');
      expect(chain.status).toBe(200);
      expect(chain.body).toEqual({ intact: true, first_broken_id: null });
    } finally {
      await ctx.close();
    }
  });
});

interface PolicyItem {
  id: string | null;
  kind: string;
  allowed_roles: string[];
  min_approvals: number;
  requires_step_up: boolean;
  validity_hours: number;
  allow_self_approval: boolean;
}

function policyBody(overrides: Record<string, unknown> = {}) {
  return {
    allowed_roles: ['owner', 'approver'],
    min_approvals: 1,
    requires_step_up: true,
    validity_hours: 24,
    allow_self_approval: false,
    ...overrides,
  };
}

async function putPolicy(
  app: { handle: (request: Request) => Promise<Response> },
  overrides: Record<string, unknown> & { kind?: string },
) {
  const kind = overrides.kind ?? 'regulatory_submission';
  const { kind: _kind, ...rest } = overrides;
  const response = await call(app, 'PUT', `/v1/approval-policies/${kind}`, policyBody(rest));
  expect(response.status).toBe(200);
  return response;
}

async function insertMachine(
  ctx: Awaited<ReturnType<typeof openApp>>,
  role: 'agent' | 'mcp_client',
  code: string,
  token: string,
) {
  const prefix = role === 'agent' ? 'wc_agent_Abcdef' : 'wc_mcp_Abcdef';
  await ctx.writer.withWrite(actor('test-machine'), async (tx) => {
    const clientId = newId();
    tx.write(sql`
      INSERT INTO core.api_client (id, code, role_code, description, scopes)
      VALUES (
        CAST(${clientId} AS UUID),
        ${code},
        ${role},
        'Cliente de prueba',
        ${['read:*']}::VARCHAR[]
      )
    `);
    tx.write(sql`
      INSERT INTO core.api_token (id, client_id, token_hash, prefix, expires_at)
      VALUES (
        CAST(${newId()} AS UUID),
        CAST(${clientId} AS UUID),
        ${sha256Bytes(token)},
        ${prefix},
        ${new Date('2027-12-31T00:00:00.000Z')}
      )
    `);
  });
}

function secretFromUrl(url: string): Uint8Array {
  const secret = new URL(url).searchParams.get('secret');
  if (!secret) throw new Error('falta el secreto de prueba');
  return base32Decode(secret);
}

function unusedCode(secret: Uint8Array, at: Date): string {
  const banned = new Set([-1, 0, 1].map((offset) => totpCode(secret, at, offset)));
  for (let value = 0; value < 1_000_000; value += 1) {
    const code = value.toString().padStart(6, '0');
    if (!banned.has(code)) return code;
  }
  throw new Error('sin código libre');
}

function base32Decode(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let current = 0;
  const out: number[] = [];
  for (const char of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('base32');
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

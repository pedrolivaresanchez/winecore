import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { requestIdFor, sessionOf } from '../auth/guard';
import type { Config } from '../config';
import type { StepUpMethod } from '../core/approvals/types';
import { issueChallenge, takeChallenge } from '../core/auth/stepup/challenges';
import { STEP_UP_WINDOW_MS } from '../core/approvals/policy';
import { sql } from '../core/db/sql';
import {
  commitFactorUse,
  credentialState,
  insertPasskey,
  insertTotp,
  listActiveCredentials,
  listPasskeys,
  listTotp,
  renameOwnedCredential,
  revokeOwnedCredential,
} from '../core/auth/stepup/credentials';
import { randomToken, requireDataKey } from '../core/auth/stepup/crypto';
import { assertWithinRateLimit, rateBucket, recordAuthFailure, recordAuthSuccess } from '../core/auth/stepup/rate-limit';
import { LOGIN_SESSION_MAX_AGE_MS, loginCreatedAt, readStepUp, sessionHash, stepUpCookie } from '../core/auth/stepup/session';
import {
  beginTotpEnrollment,
  dropPendingTotp,
  matchTotp,
  pendingTotpSecret,
} from '../core/auth/stepup/totp';
import {
  authenticationOptions,
  registrationOptions,
  verifyAssertion,
  verifyRegistration,
} from '../core/auth/stepup/webauthn';
import type { Actor, Writer } from '../core/db/writer';
import { domainError, DomainError } from '../core/errors';

export interface HttpDeps {
  config: Config;
  writer: Writer;
  now: () => Date;
}

interface HeaderSink {
  headers: Record<string, string | number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function passkeyRegistrationOptions(deps: HttpDeps, request: Request, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  await assertMayRegister(deps, request, user.id, now);
  assertWithinRateLimit(rateBucket('passkey-register', user.id), now);
  const existing = await listPasskeys(deps.writer, user.id);
  const options = await registrationOptions({
    config: deps.config,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    excludeCredentialIds: existing.map((row) => row.credentialId),
  });
  issueChallenge(user.id, 'registration', options.challenge, now);
  return options;
}

export async function verifyPasskeyRegistration(deps: HttpDeps, request: Request, set: HeaderSink, payload: unknown) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  await assertMayRegister(deps, request, user.id, now);
  const bucket = rateBucket('passkey-register', user.id);
  assertWithinRateLimit(bucket, now);
  const body = objectBody(payload);
  const label = requiredLabel(body.label);
  const response = body.response;
  if (!response || typeof response !== 'object') {
    throw domainError('WC_VALIDATION', { response: 'Falta la respuesta de la passkey' });
  }
  const challenge = takeChallenge(user.id, 'registration', now);
  if (!challenge) {
    recordAuthFailure(bucket, now);
    throw domainError('WC_VERIFY_FAILED');
  }
  try {
    const verified = await verifyRegistration({
      config: deps.config,
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
    });
    const credential = await insertPasskey(deps.writer, actorOf(request, user.id), {
      userId: user.id,
      label,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      at: now,
    });
    recordAuthSuccess(bucket);
    return { credential: { id: credential.id, kind: credential.kind, label: credential.label, created_at: credential.created_at } };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'WC_VERIFY_FAILED') recordAuthFailure(bucket, now);
    throw error;
  }
}

export async function listCredentials(deps: HttpDeps, request: Request, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  const items = await listActiveCredentials(deps.writer, user.id);
  return { items };
}

export async function revokeCredential(deps: HttpDeps, request: Request, id: string, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  const state = await credentialState(deps.writer, user.id, id);
  if (state === 'missing') throw domainError('WC_NOT_FOUND');
  await assertRecentStepUp(deps, request, user.id, deps.now());
  if (state === 'revoked') return {};
  const revoked = await revokeOwnedCredential(deps.writer, actorOf(request, user.id), user.id, id, deps.now());
  if (!revoked) throw domainError('WC_NOT_FOUND');
  return {};
}

export async function renameCredential(deps: HttpDeps, request: Request, id: string, payload: unknown, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  const body = objectBody(payload);
  const label = requiredLabel(body.label, 60);
  const credential = await renameOwnedCredential(deps.writer, actorOf(request, user.id), user.id, id, label);
  if (!credential) throw domainError('WC_NOT_FOUND');
  return { credential };
}

export async function enrollTotp(deps: HttpDeps, request: Request, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  await assertMayRegister(deps, request, user.id, now);
  requireDataKey(deps.config);
  const otpauthUrl = beginTotpEnrollment(user.id, user.email, now);
  return { otpauth_url: otpauthUrl };
}

export async function confirmTotp(deps: HttpDeps, request: Request, set: HeaderSink, payload: unknown) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  await assertMayRegister(deps, request, user.id, now);
  const bucket = rateBucket('totp-confirm', user.id);
  assertWithinRateLimit(bucket, now);
  const body = objectBody(payload);
  const code = totpCodeField(body.code);
  const secret = pendingTotpSecret(user.id, now);
  if (!secret) throw domainError('WC_VALIDATION', { code: 'No hay un alta de TOTP pendiente' });
  const match = matchTotp(secret, code, now, 0);
  if (!match || match.replay) {
    recordAuthFailure(bucket, now);
    throw domainError('WC_VERIFY_FAILED');
  }
  const dataKey = requireDataKey(deps.config);
  const credential = await insertTotp(deps.writer, actorOf(request, user.id), {
    userId: user.id,
    secret,
    dataKey,
    at: now,
    initialCount: match.step,
  });
  dropPendingTotp(user.id);
  recordAuthSuccess(bucket);
  return { credential: { id: credential.id, kind: credential.kind, label: credential.label, created_at: credential.created_at } };
}

export async function stepUpOptions(deps: HttpDeps, request: Request, set: HeaderSink) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  assertWithinRateLimit(rateBucket('step-up', user.id), now);
  const passkeys = await listPasskeys(deps.writer, user.id);
  const dataKey = deps.config.dataKey;
  const totpRows = dataKey ? await listTotp(deps.writer, user.id, dataKey) : [];
  const totp = totpRows.length > 0;
  for (const row of totpRows) row.secret.fill(0);
  for (const row of passkeys) row.publicKey.fill(0);
  if (passkeys.length === 0) return { passkey: null, totp };
  const passkey = await authenticationOptions({
    config: deps.config,
    credentialIds: passkeys.map((row) => row.credentialId),
  });
  issueChallenge(user.id, 'authentication', passkey.challenge, now);
  return { passkey, totp };
}

export async function stepUpVerify(deps: HttpDeps, request: Request, set: HeaderSink, payload: unknown) {
  noStore(set);
  const user = sessionOf(request);
  const now = deps.now();
  const bucket = rateBucket('step-up', user.id);
  assertWithinRateLimit(bucket, now);
  const body = objectBody(payload);
  const hasPasskey = body.passkey_response != null;
  const hasTotp = body.totp_code != null;
  if (hasPasskey === hasTotp) {
    throw domainError('WC_VALIDATION', { body: 'Indica la passkey o el código TOTP' });
  }
  try {
    if (hasPasskey) {
      await verifyPasskeyStepUp(deps, request, user.id, body.passkey_response, now);
    } else {
      await verifyTotpStepUp(deps, request, user.id, totpCodeField(body.totp_code, 'totp_code'), now);
    }
    recordAuthSuccess(bucket);
    const token = randomToken();
    set.headers['set-cookie'] = stepUpCookie(token, cookieSecure(deps.config));
    return { stepped_up_at: now.toISOString() };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'WC_VERIFY_FAILED') recordAuthFailure(bucket, now);
    throw error;
  }
}

async function verifyPasskeyStepUp(
  deps: HttpDeps,
  request: Request,
  userId: string,
  response: unknown,
  now: Date,
): Promise<void> {
  if (!response || typeof response !== 'object') {
    throw domainError('WC_VALIDATION', { passkey_response: 'Falta la respuesta de la passkey' });
  }
  const challenge = takeChallenge(userId, 'authentication', now);
  if (!challenge) throw domainError('WC_VERIFY_FAILED');
  const assertion = response as AuthenticationResponseJSON;
  const credentialId = typeof assertion.id === 'string' ? assertion.id : '';
  const passkeys = await listPasskeys(deps.writer, userId);
  const passkey = passkeys.find((row) => row.credentialId === credentialId);
  if (!passkey) {
    for (const row of passkeys) row.publicKey.fill(0);
    throw domainError('WC_VERIFY_FAILED');
  }
  try {
    const nextCount = await verifyAssertion({
      config: deps.config,
      response: assertion,
      expectedChallenge: challenge,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.signCount,
    });
    await commitFactorUse(deps.writer, actorOf(request, userId), {
      userId,
      credentialRowId: passkey.id,
      nextCount,
      at: now,
      method: 'passkey',
      sessionHash: sessionHash(deps.config, request, userId),
      ip: clientIp(request),
      userAgent: clientAgent(request),
    });
  } finally {
    for (const row of passkeys) row.publicKey.fill(0);
  }
}

async function verifyTotpStepUp(
  deps: HttpDeps,
  request: Request,
  userId: string,
  code: string,
  now: Date,
): Promise<void> {
  const dataKey = requireDataKey(deps.config);
  const factors = await listTotp(deps.writer, userId, dataKey);
  try {
    let chosen: { id: string; step: number } | null = null;
    for (const factor of factors) {
      const match = matchTotp(factor.secret, code, now, factor.signCount);
      if (!match || match.replay) continue;
      chosen = { id: factor.id, step: match.step };
      break;
    }
    if (!chosen) throw domainError('WC_VERIFY_FAILED');
    await commitFactorUse(deps.writer, actorOf(request, userId), {
      userId,
      credentialRowId: chosen.id,
      nextCount: chosen.step,
      at: now,
      method: 'totp' satisfies StepUpMethod,
      sessionHash: sessionHash(deps.config, request, userId),
      ip: clientIp(request),
      userAgent: clientAgent(request),
    });
  } finally {
    for (const factor of factors) factor.secret.fill(0);
  }
}

function actorOf(request: Request, userId: string): Actor {
  return { type: 'user', id: userId, requestId: requestIdFor(request) };
}

function cookieSecure(config: Config): boolean {
  return config.nodeEnv === 'production' || config.webauthnOrigin.startsWith('https:');
}

function noStore(set: HeaderSink): void {
  set.headers['cache-control'] = 'no-store';
}

function requiredLabel(value: unknown, max = 80): string {
  if (typeof value !== 'string') {
    throw domainError('WC_VALIDATION', { label: `La etiqueta debe tener entre 1 y ${max} caracteres` });
  }
  const label = value.trim();
  if (label.length < 1 || label.length > max || /[\u0000-\u001f]/.test(label)) {
    throw domainError('WC_VALIDATION', { label: `La etiqueta debe tener entre 1 y ${max} caracteres` });
  }
  return label;
}

const STEP_UP_NEEDED = 'Hace falta una verificación reforzada de los últimos 5 minutos';
const FRESH_SESSION_NEEDED = 'La primera credencial exige una sesión de menos de 10 minutos';

async function assertMayRegister(deps: HttpDeps, request: Request, userId: string, now: Date): Promise<void> {
  const active = await activeCredentials(deps, userId);
  if (active > 0) {
    await assertRecentStepUp(deps, request, userId, now);
    return;
  }
  const created = await loginCreatedAt(deps.writer, sessionHash(deps.config, request, userId));
  const age = created == null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(created);
  if (created == null || Number.isNaN(age) || age < 0 || age >= LOGIN_SESSION_MAX_AGE_MS) {
    throw domainError('WC_STEP_UP_REQUIRED', { session: FRESH_SESSION_NEEDED });
  }
}

async function assertRecentStepUp(deps: HttpDeps, request: Request, userId: string, now: Date): Promise<void> {
  const step = await readStepUp(deps.writer, userId, sessionHash(deps.config, request, userId));
  const age = step == null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(step.at);
  if (step == null || Number.isNaN(age) || age < 0 || age > STEP_UP_WINDOW_MS) {
    throw domainError('WC_STEP_UP_REQUIRED', { step_up: STEP_UP_NEEDED });
  }
}

async function activeCredentials(deps: HttpDeps, userId: string): Promise<number> {
  const rows = await deps.writer.read<{ n: unknown }>(sql`
    SELECT count(*) AS n
    FROM core.user_credential
    WHERE user_id = CAST(${userId} AS UUID) AND revoked_at IS NULL
  `);
  const count = Number(rows[0]?.n ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function totpCodeField(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'El código debe tener 6 dígitos' });
  }
  return value;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError('WC_VALIDATION');
  return value as Record<string, unknown>;
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (/^[0-9a-fA-F:.]{3,64}$/.test(forwarded)) return forwarded;
  return null;
}

function clientAgent(request: Request): string | null {
  const agent = request.headers.get('user-agent')?.replace(/[\u0000-\u001f]/g, '').trim() ?? '';
  if (agent === '') return null;
  return agent.slice(0, 300);
}

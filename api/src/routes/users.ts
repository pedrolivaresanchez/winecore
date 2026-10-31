import { requestIdFor, sessionOf } from '../auth/guard';
import { STEP_UP_WINDOW_MS } from '../core/approvals/policy';
import {
  findDirectoryUser,
  inviteNeedsStepUp,
  inviteUser,
  listUsers,
  parseInvite,
  parsePatch,
  patchNeedsStepUp,
  patchUser,
} from '../core/auth/users';
import { listPasskeys } from '../core/auth/stepup/credentials';
import { readStepUp, sessionHash } from '../core/auth/stepup/session';
import type { Config } from '../config';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';

const REGISTER_PASSKEY = 'Registra una passkey en Ajustes > Seguridad';

export async function getUsers(writer: Writer, request: Request) {
  const user = sessionOf(request);
  if (!canManageDirectory(user.roles)) throw domainError('WC_FORBIDDEN');
  const items = await listUsers(writer);
  return { items };
}

export async function postUser(writer: Writer, config: Config, request: Request, now: Date) {
  const user = sessionOf(request);
  if (!user.roles.some((role) => role.role === 'owner')) throw domainError('WC_FORBIDDEN');
  const body = await jsonBody(request);
  const input = parseInvite(body);
  if (inviteNeedsStepUp(input.roles)) await assertOwnerPasskey(writer, config, request, user.id, now);
  return inviteUser(
    writer,
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'alta de persona' },
    input,
  );
}

export async function patchUserRoute(writer: Writer, config: Config, request: Request, id: string, now: Date) {
  const user = sessionOf(request);
  if (!user.roles.some((role) => role.role === 'owner')) throw domainError('WC_FORBIDDEN');
  const body = await jsonBody(request);
  const input = parsePatch(body);
  const current = await findDirectoryUser(writer, id);
  if (current && patchNeedsStepUp(current, input)) {
    await assertOwnerPasskey(writer, config, request, user.id, now);
  }
  return patchUser(
    writer,
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'cambio de persona' },
    id,
    input,
    now,
  );
}

/**
 * Misma verificación que las aprobaciones: passkey reciente (≤ 5 min) en la sesión.
 * Sin passkey registrada, el mismo código WC_STEP_UP_REQUIRED indica Ajustes > Seguridad.
 */
async function assertOwnerPasskey(
  writer: Writer,
  config: Config,
  request: Request,
  userId: string,
  now: Date,
): Promise<void> {
  const passkeys = await listPasskeys(writer, userId);
  for (const row of passkeys) row.publicKey.fill(0);
  if (passkeys.length === 0) {
    throw domainError('WC_STEP_UP_REQUIRED', { passkey: REGISTER_PASSKEY }, REGISTER_PASSKEY);
  }
  const step = await readStepUp(writer, userId, sessionHash(config, request, userId));
  const age = step == null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(step.at);
  if (step?.method !== 'passkey' || !Number.isFinite(age) || age < 0 || age > STEP_UP_WINDOW_MS) {
    throw domainError('WC_STEP_UP_REQUIRED');
  }
}

function canManageDirectory(roles: { role: string }[]): boolean {
  return roles.some((role) => role.role === 'owner' || role.role === 'admin');
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo no es JSON' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo no es un objeto' });
  }
  return parsed as Record<string, unknown>;
}

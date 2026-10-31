import { requestIdFor, sessionOf } from '../auth/guard';
import { inviteUser, listUsers, parseInvite, parsePatch, patchUser } from '../core/auth/users';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';

// docs/07-arquitectura.md no aplica la verificación reforzada a users.manage.
// UI-37 pide passkey al cambiar roles o dar de baja; no hay política de step-up para esta acción.
export async function getUsers(writer: Writer, request: Request) {
  const user = sessionOf(request);
  if (!canManageDirectory(user.roles)) throw domainError('WC_FORBIDDEN');
  const items = await listUsers(writer);
  return { items };
}

export async function postUser(writer: Writer, request: Request) {
  const user = sessionOf(request);
  if (!user.roles.some((role) => role.role === 'owner')) throw domainError('WC_FORBIDDEN');
  const body = await jsonBody(request);
  const input = parseInvite(body);
  const created = await inviteUser(
    writer,
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'alta de persona' },
    input,
  );
  return created;
}

export async function patchUserRoute(writer: Writer, request: Request, id: string, now: Date) {
  const user = sessionOf(request);
  if (!user.roles.some((role) => role.role === 'owner')) throw domainError('WC_FORBIDDEN');
  const body = await jsonBody(request);
  const input = parsePatch(body);
  return patchUser(
    writer,
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'cambio de persona' },
    id,
    input,
    now,
  );
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

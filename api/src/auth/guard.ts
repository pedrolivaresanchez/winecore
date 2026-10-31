import { can, isOwner, isRoleCode, type Permission, type UserCtx } from '../core/auth/permissions';
import { domainError, DomainError, errorBody } from '../core/errors';
import type { Writer } from '../core/db/writer';
import { sql } from '../core/db/sql';
import { newId } from '../core/ids';
import type { Config } from '../config';
import type { TimbalAuth } from './timbal';

export interface GuardDeps {
  config: Config;
  writer: Writer;
  timbalAuth: TimbalAuth;
}

interface GuardState {
  request: Request;
  set: { status?: number | string };
}

const requestIds = new WeakMap<Request, string>();
const sessions = new WeakMap<Request, UserCtx | DomainError>();

export function requestIdFor(request: Request): string {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const header = request.headers.get('x-request-id');
  const requestId = header && /^[A-Za-z0-9._:-]{1,80}$/.test(header) ? header : newId();
  requestIds.set(request, requestId);
  return requestId;
}

export function sessionOf(request: Request): UserCtx {
  const session = sessions.get(request);
  if (!session || session instanceof DomainError) throw domainError('WC_UNAUTHENTICATED');
  return session;
}

export function requireUser(deps: GuardDeps) {
  return async (context: GuardState) => {
    const session = await loadSession(deps, context.request);
    if (session instanceof DomainError) return reject(context.set, session);
  };
}

export function requirePermission(deps: GuardDeps, permission: Permission) {
  return async (context: GuardState) => {
    const session = await loadSession(deps, context.request);
    if (session instanceof DomainError) return reject(context.set, session);
    if (!can(session, permission)) return reject(context.set, domainError('WC_FORBIDDEN'));
  };
}

export function requireOwner(deps: GuardDeps) {
  return async (context: GuardState) => {
    const session = await loadSession(deps, context.request);
    if (session instanceof DomainError) return reject(context.set, session);
    if (!isOwner(session)) return reject(context.set, domainError('WC_FORBIDDEN'));
  };
}

function reject(set: GuardState['set'], error: DomainError) {
  set.status = error.httpStatus;
  return errorBody(error);
}

async function loadSession(deps: GuardDeps, request: Request): Promise<UserCtx | DomainError> {
  const cached = sessions.get(request);
  if (cached) return cached;
  const session = await resolveSession(deps, request);
  sessions.set(request, session);
  return session;
}

async function resolveSession(deps: GuardDeps, request: Request): Promise<UserCtx | DomainError> {
  const email = await emailFrom(deps, request);
  if (email instanceof DomainError) return email;
  const user = await findActiveUser(deps.writer, email);
  if (user) return user;
  try {
    await deps.writer.withWrite(
      {
        type: 'system',
        id: 'auth',
        requestId: requestIdFor(request),
        reason: 'acceso denegado',
      },
      async (tx) => {
        tx.audit({
          table: 'core.app_user',
          rowId: email,
          action: 'auth.denied',
          before: null,
          after: { email },
        });
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'WRITER_LEASE_LOST') throw error;
  }
  return domainError('WC_NO_ACCESS');
}

async function emailFrom(deps: GuardDeps, request: Request): Promise<string | DomainError> {
  if (deps.config.authMode === 'dev') {
    const override = request.headers.get('x-dev-user')?.trim();
    return (override && override.length > 0 ? override : deps.config.devUserEmail).toLowerCase();
  }
  const token = bearerOrCookie(request);
  if (!token) return domainError('WC_UNAUTHENTICATED');
  const email = await deps.timbalAuth.emailFor(token);
  if (!email) return domainError('WC_UNAUTHENTICATED');
  return email.toLowerCase();
}

function bearerOrCookie(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    return token === '' ? null : token;
  }
  return readCookie(request.headers.get('cookie'), 'timbal_access_token');
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

async function findActiveUser(writer: Writer, email: string): Promise<UserCtx | null> {
  const users = await writer.read<{
    id: string;
    email: string;
    display_name: string;
    status: string;
  }>(sql`
    SELECT id, email, display_name, status
    FROM core.app_user
    WHERE lower(email) = ${email}
  `);
  const user = users[0];
  if (!user || user.status !== 'active') return null;
  const roles = await writer.read<{
    role_code: string;
    legal_entity_id: string | null;
    legal_entity_code: string | null;
  }>(sql`
    SELECT r.role_code, r.legal_entity_id, e.code AS legal_entity_code
    FROM core.user_role r
    LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE r.user_id = CAST(${user.id} AS UUID) AND r.revoked_at IS NULL
  `);
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    roles: roles.flatMap((row) =>
      isRoleCode(row.role_code)
        ? [{
            role: row.role_code,
            legalEntityId: row.legal_entity_id,
            legalEntityCode: row.legal_entity_code,
          }]
        : [],
    ),
  };
}

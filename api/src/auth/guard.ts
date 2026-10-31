import { createHash } from 'node:crypto';
import { can, isOwner, isRoleCode, type Permission, type UserCtx } from '../core/auth/permissions';
import { domainError, DomainError, errorBody } from '../core/errors';
import type { Writer } from '../core/db/writer';
import { sql } from '../core/db/sql';
import { sha256Hex } from '../core/hash';
import { newId } from '../core/ids';
import type { Config } from '../config';
import { ensureLoginSession, sessionHash } from '../core/auth/stepup/session';
import { devAuthEnabled } from './policy';
import type { TimbalAuth } from './timbal';

const GUARD_MARK = Symbol.for('winecore.guard');

export function isAuthGuard(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as { [GUARD_MARK]?: boolean })[GUARD_MARK] === true;
}

function guard<T extends (state: GuardState) => Promise<unknown>>(fn: T): T {
  Object.defineProperty(fn, GUARD_MARK, { value: true });
  return fn;
}

export interface GuardDeps {
  config: Config;
  writer: Writer;
  timbalAuth: TimbalAuth;
  now?: () => Date;
}

interface GuardState {
  request: Request;
  set: { status?: number | string };
}

const requestIds = new WeakMap<Request, string>();
const sessions = new WeakMap<Request, UserCtx | DomainError>();

export interface MachinePrincipal {
  kind: 'agent' | 'machine';
  id: string;
  code: string;
  roleCode: 'agent' | 'mcp_client';
}

const machines = new WeakMap<Request, MachinePrincipal>();

export function machineOf(request: Request): MachinePrincipal | null {
  return machines.get(request) ?? null;
}

function machineBearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token.startsWith('wc_') || token.length > 200) return null;
  return token;
}

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
  return guard(async ({ request, set }: GuardState) => {
    const blocked = await rejectMachine(deps, request, set);
    if (blocked) return blocked;
    const session = await loadSession(deps, request);
    if (session instanceof DomainError) return reject(set, session);
    await rememberLogin(deps, request, session);
  });
}

/** Humano autenticado o cliente de máquina (`Authorization: Bearer wc_…`). */
export function requireUserOrMachine(deps: GuardDeps) {
  return guard(async (context: GuardState) => {
    if (!machineBearer(context.request)) {
      const session = await loadSession(deps, context.request);
      if (session instanceof DomainError) return reject(context.set, session);
      await rememberLogin(deps, context.request, session);
      return;
    }
    const machine = await rememberMachine(deps, context.request);
    if (machine instanceof DomainError) return reject(context.set, machine);
  });
}

async function rejectMachine(
  deps: GuardDeps,
  request: Request,
  set: GuardState['set'],
): Promise<unknown> {
  if (!machineBearer(request)) return undefined;
  const machine = await rememberMachine(deps, request);
  if (machine instanceof DomainError) return reject(set, machine);
  return reject(set, domainError('WC_FORBIDDEN'));
}

async function rememberMachine(
  deps: GuardDeps,
  request: Request,
): Promise<MachinePrincipal | DomainError> {
  const existing = machines.get(request);
  if (existing) return existing;
  const token = machineBearer(request);
  if (!token) return domainError('WC_UNAUTHENTICATED');
  const found = await lookupMachine(deps.writer, token);
  if (found instanceof DomainError) return found;
  machines.set(request, found);
  return found;
}

async function lookupMachine(writer: Writer, token: string): Promise<MachinePrincipal | DomainError> {
  const hash = createHash('sha256').update(token, 'utf8').digest();
  const rows = await writer.read<{ id: string; code: string; role_code: string }>(sql`
    SELECT c.id, c.code, c.role_code
    FROM core.api_token t
    JOIN core.api_client c ON c.id = t.client_id
    WHERE t.token_hash = ${hash}
      AND t.revoked_at IS NULL
      AND c.revoked_at IS NULL
      AND t.expires_at > now()
  `);
  const row = rows[0];
  if (!row) return domainError('WC_UNAUTHENTICATED');
  if (row.role_code !== 'agent' && row.role_code !== 'mcp_client') return domainError('WC_UNAUTHENTICATED');
  return {
    kind: row.role_code === 'agent' ? 'agent' : 'machine',
    id: row.id,
    code: row.code,
    roleCode: row.role_code,
  };
}

export function requirePermission(deps: GuardDeps, permission: Permission) {
  return guard(async ({ request, set }: GuardState) => {
    const blocked = await rejectMachine(deps, request, set);
    if (blocked) return blocked;
    const session = await loadSession(deps, request);
    if (session instanceof DomainError) return reject(set, session);
    await rememberLogin(deps, request, session);
    if (!can(session, permission)) return reject(set, domainError('WC_FORBIDDEN'));
  });
}

export function requireOwner(deps: GuardDeps) {
  return guard(async ({ request, set }: GuardState) => {
    const blocked = await rejectMachine(deps, request, set);
    if (blocked) return blocked;
    const session = await loadSession(deps, request);
    if (session instanceof DomainError) return reject(set, session);
    await rememberLogin(deps, request, session);
    if (!isOwner(session)) return reject(set, domainError('WC_FORBIDDEN'));
  });
}

async function rememberLogin(deps: GuardDeps, request: Request, user: UserCtx): Promise<void> {
  try {
    await ensureLoginSession(
      deps.writer,
      { type: 'user', id: user.id, requestId: requestIdFor(request) },
      {
        userId: user.id,
        hash: sessionHash(deps.config, request, user.id),
        at: (deps.now ?? (() => new Date()))(),
      },
    );
  } catch (error) {
    // During a deploy the previous instance keeps the writer lease for up to a minute; the session
    // record is retried on the next request, so reads must not fail meanwhile.
    if (!(error instanceof DomainError) || error.code !== 'WRITER_LEASE_LOST') throw error;
  }
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
        const emailSha256 = sha256Hex(email);
        tx.audit({
          table: 'core.app_user',
          rowId: emailSha256,
          action: 'auth.denied',
          before: null,
          after: { email_sha256: emailSha256 },
        });
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'WRITER_LEASE_LOST') throw error;
  }
  return domainError('WC_NO_ACCESS');
}

async function emailFrom(deps: GuardDeps, request: Request): Promise<string | DomainError> {
  if (devAuthEnabled(deps.config)) {
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

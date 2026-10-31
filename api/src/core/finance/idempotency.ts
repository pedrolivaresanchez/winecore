import { bodyHash } from '../party/contacts';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import type { UserCtx } from '../auth/permissions';

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

export function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128) {
    throw domainError('WC_VALIDATION', { 'idempotency-key': 'La clave debe tener entre 8 y 128 caracteres' });
  }
  return key;
}

export function requestHash(body: unknown): string {
  return bodyHash(body);
}

export function actorOf(user: UserCtx, request: Request) {
  return {
    type: 'user' as const,
    id: user.id,
    requestId: request.headers.get('x-request-id') ?? newId(),
  };
}

export async function storedResponse(
  tx: Tx,
  userId: string,
  key: string,
): Promise<{ hash: string; status: number; body: unknown } | null> {
  const rows = await tx.read<{ request_sha256: string; status_code: number | string; response: unknown }>(sql`
    SELECT request_sha256, status_code, response
    FROM ops.idempotency_key
    WHERE principal = ${`user:${userId}`} AND key = ${key}
  `);
  const row = rows[0];
  if (!row) return null;
  return { hash: String(row.request_sha256), status: Number(row.status_code), body: row.response };
}

export function replay(
  stored: { hash: string; status: number; body: unknown } | null,
  hash: string,
): { status: number; body: unknown } | null {
  if (!stored) return null;
  if (stored.hash !== hash) throw domainError('WC_IDEMPOTENCY_MISMATCH');
  return { status: stored.status, body: stored.body };
}

export function remember(
  tx: Tx,
  userId: string,
  key: string,
  hash: string,
  route: string,
  status: number,
  body: unknown,
  now: Date,
): void {
  tx.write(sql`
    INSERT INTO ops.idempotency_key (key, principal, route, request_sha256, status_code, response, created_at)
    VALUES (
      ${key},
      ${`user:${userId}`},
      ${route},
      ${hash},
      ${status},
      ${sql.json(body)},
      ${now}
    )
  `);
}

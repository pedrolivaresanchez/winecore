import { randomBytes } from 'node:crypto';

import { requestIdFor, sessionOf } from '../auth/guard';
import { sha256Bytes } from '../core/auth/stepup/crypto';
import { sql } from '../core/db/sql';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { newId } from '../core/ids';

const CODE = /^[a-z][a-z0-9-]{2,40}$/;
const SCOPE = /^[a-z*][a-z0-9_.*:-]{0,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_DAYS = 90;

interface CreateBody {
  code: string;
  description: string;
  role_code: 'agent' | 'mcp_client';
  scopes: string[];
  on_behalf_of_user_id: string | null;
}

export async function listMcpClients(writer: Writer) {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT c.id::VARCHAR AS id, c.code, c.role_code, c.description, c.scopes,
           c.on_behalf_of_user_id::VARCHAR AS on_behalf_of_user_id,
           c.created_at, c.revoked_at,
           t.prefix, t.expires_at AS token_expires_at
    FROM core.api_client c
    LEFT JOIN core.api_token t
      ON t.client_id = c.id AND t.revoked_at IS NULL AND t.expires_at > now()
    ORDER BY c.created_at, c.code
  `);
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      role_code: String(row.role_code),
      description: String(row.description),
      scopes: asScopes(row.scopes),
      on_behalf_of_user_id: row.on_behalf_of_user_id ? String(row.on_behalf_of_user_id) : null,
      created_at: iso(row.created_at),
      revoked_at: row.revoked_at == null ? null : iso(row.revoked_at),
      token_prefix: row.prefix == null ? null : String(row.prefix),
      token_expires_at: row.token_expires_at == null ? null : iso(row.token_expires_at),
    })),
  };
}

export async function createMcpClient(writer: Writer, request: Request, now: Date) {
  const body = await readBody(request);
  const user = sessionOf(request);
  const issued = issueToken();
  const id = newId();
  const expires = new Date(now.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
  await writer.withWrite(
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'alta de cliente MCP' },
    async (tx) => {
      const taken = await tx.read<{ id: string }>(sql`SELECT id FROM core.api_client WHERE code = ${body.code}`);
      if (taken.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
      if (body.on_behalf_of_user_id) {
        const people = await tx.read<{ id: string }>(sql`
          SELECT id FROM core.app_user
          WHERE id = CAST(${body.on_behalf_of_user_id} AS UUID) AND status = 'active'
        `);
        if (people.length === 0) throw domainError('WC_VALIDATION', { on_behalf_of_user_id: 'La persona no existe' });
      }
      tx.write(behalfInsert(id, body, now));
      tx.write(sql`
        INSERT INTO core.api_token (id, client_id, token_hash, prefix, created_at, expires_at)
        VALUES (
          CAST(${newId()} AS UUID),
          CAST(${id} AS UUID),
          ${sha256Bytes(issued.token)},
          ${issued.prefix},
          ${now},
          ${expires}
        )
      `);
      tx.audit({
        table: 'core.api_client',
        rowId: id,
        action: 'INSERT',
        before: null,
        after: { id, code: body.code, role_code: body.role_code, scopes: body.scopes },
      });
    },
  );
  return {
    status: 201 as const,
    body: {
      id,
      code: body.code,
      role_code: body.role_code,
      description: body.description,
      scopes: body.scopes,
      on_behalf_of_user_id: body.on_behalf_of_user_id,
      prefix: issued.prefix,
      expires_at: expires.toISOString(),
      token: issued.token,
    },
  };
}

export async function rotateMcpClient(writer: Writer, request: Request, id: string, now: Date) {
  assertUuid(id);
  const user = sessionOf(request);
  const issued = issueToken();
  const expires = new Date(now.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
  await writer.withWrite(
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'rotación de token MCP' },
    async (tx) => {
      const rows = await tx.read<{ revoked_at: string | null }>(sql`
        SELECT revoked_at FROM core.api_client WHERE id = CAST(${id} AS UUID)
      `);
      const row = rows[0];
      if (!row) throw domainError('WC_NOT_FOUND');
      if (row.revoked_at != null) throw domainError('WC_VALIDATION', { id: 'El cliente está revocado' });
      tx.write(sql`
        UPDATE core.api_token
        SET revoked_at = ${now}
        WHERE client_id = CAST(${id} AS UUID) AND revoked_at IS NULL
      `);
      tx.write(sql`
        INSERT INTO core.api_token (id, client_id, token_hash, prefix, created_at, expires_at)
        VALUES (
          CAST(${newId()} AS UUID),
          CAST(${id} AS UUID),
          ${sha256Bytes(issued.token)},
          ${issued.prefix},
          ${now},
          ${expires}
        )
      `);
      tx.audit({
        table: 'core.api_token',
        rowId: id,
        action: 'UPDATE',
        before: null,
        after: { client_id: id, prefix: issued.prefix, rotated: true },
      });
    },
  );
  return {
    id,
    prefix: issued.prefix,
    expires_at: expires.toISOString(),
    token: issued.token,
  };
}

export async function revokeMcpClient(writer: Writer, request: Request, id: string, now: Date) {
  assertUuid(id);
  const user = sessionOf(request);
  await writer.withWrite(
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'revocación de cliente MCP' },
    async (tx) => {
      const rows = await tx.read<{ id: string }>(sql`
        SELECT id FROM core.api_client WHERE id = CAST(${id} AS UUID) AND revoked_at IS NULL
      `);
      if (!rows[0]) throw domainError('WC_NOT_FOUND');
      tx.write(sql`
        UPDATE core.api_client SET revoked_at = ${now} WHERE id = CAST(${id} AS UUID)
      `);
      tx.write(sql`
        UPDATE core.api_token
        SET revoked_at = ${now}
        WHERE client_id = CAST(${id} AS UUID) AND revoked_at IS NULL
      `);
      tx.audit({
        table: 'core.api_client',
        rowId: id,
        action: 'UPDATE',
        before: { revoked_at: null },
        after: { id, revoked_at: now.toISOString() },
      });
    },
  );
  return { id, revoked_at: now.toISOString() };
}

function behalfInsert(id: string, body: CreateBody, now: Date): string {
  if (body.on_behalf_of_user_id) {
    return sql`
      INSERT INTO core.api_client (
        id, code, role_code, description, scopes, on_behalf_of_user_id, created_at
      ) VALUES (
        CAST(${id} AS UUID),
        ${body.code},
        ${body.role_code},
        ${body.description},
        ${body.scopes}::VARCHAR[],
        CAST(${body.on_behalf_of_user_id} AS UUID),
        ${now}
      )
    `;
  }
  return sql`
    INSERT INTO core.api_client (id, code, role_code, description, scopes, created_at)
    VALUES (
      CAST(${id} AS UUID),
      ${body.code},
      ${body.role_code},
      ${body.description},
      ${body.scopes}::VARCHAR[],
      ${now}
    )
  `;
}

function issueToken(): { token: string; prefix: string } {
  const visible = randomChars(6);
  const secret = randomBytes(32).toString('base64url');
  const prefix = `wc_mcp_${visible}`;
  return { prefix, token: `${prefix}${secret}` };
}

function randomChars(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length] ?? 'A';
  return out;
}

async function readBody(request: Request): Promise<CreateBody> {
  const raw = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  const body = parsed as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!CODE.test(code)) fields.code = 'Usa minúsculas, de 3 a 41 caracteres';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length < 3 || description.length > 200) fields.description = 'Debe tener entre 3 y 200 caracteres';
  const role = body.role_code === undefined ? 'mcp_client' : body.role_code;
  if (role !== 'agent' && role !== 'mcp_client') fields.role_code = 'Debe ser agent o mcp_client';
  const scopes = Array.isArray(body.scopes) ? body.scopes : null;
  if (!scopes || scopes.length < 1 || scopes.length > 32 || scopes.some((scope) => typeof scope !== 'string' || !SCOPE.test(scope))) {
    fields.scopes = 'Indica de 1 a 32 alcances';
  }
  let behalf: string | null = null;
  if (body.on_behalf_of_user_id != null && body.on_behalf_of_user_id !== '') {
    if (typeof body.on_behalf_of_user_id !== 'string' || !UUID.test(body.on_behalf_of_user_id)) {
      fields.on_behalf_of_user_id = 'Debe ser un UUID';
    } else {
      behalf = body.on_behalf_of_user_id.toLowerCase();
    }
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    code,
    description,
    role_code: role === 'agent' ? 'agent' : 'mcp_client',
    scopes: (scopes ?? []).map((scope) => String(scope)),
    on_behalf_of_user_id: behalf,
  };
}

function assertUuid(id: string): void {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
}

function asScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      return [];
    }
  }
  return [];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

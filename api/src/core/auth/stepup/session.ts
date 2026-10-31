import type { Config } from '../../../config';
import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import type { Writer } from '../../db/writer';
import { sha256Bytes } from './crypto';
import type { StepUpMethod } from '../../approvals/types';

const SESSION_HOURS = 12;

export function sessionHash(config: Config, request: Request, userId: string): Uint8Array {
  if (config.authMode === 'dev') {
    const email = (request.headers.get('x-dev-user') ?? config.devUserEmail).trim().toLowerCase();
    return sha256Bytes(`dev\n${userId}\n${email}`);
  }
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token !== '') return sha256Bytes(`bearer\n${userId}\n${token}`);
  }
  return sha256Bytes(`cookie\n${userId}\n${cookieValue(request, 'timbal_access_token') ?? ''}`);
}

export async function readStepUp(
  writer: Writer,
  userId: string,
  hash: Uint8Array,
): Promise<{ at: string; method: StepUpMethod } | null> {
  const rows = await writer.read<{ step_up_at: string | null; step_up_method: string | null }>(sql`
    SELECT step_up_at, step_up_method
    FROM core.session
    WHERE user_id = CAST(${userId} AS UUID)
      AND token_hash = ${hash}
      AND revoked_at IS NULL
  `);
  const row = rows[0];
  if (!row?.step_up_at) return null;
  if (row.step_up_method !== 'passkey' && row.step_up_method !== 'totp') return null;
  return { at: iso(row.step_up_at), method: row.step_up_method };
}

export async function writeStepUp(tx: Tx, input: {
  userId: string;
  hash: Uint8Array;
  at: Date;
  method: StepUpMethod;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const existing = await tx.read<{ id: string; step_up_at: string | null; step_up_method: string | null }>(sql`
    SELECT id, step_up_at, step_up_method
    FROM core.session
    WHERE token_hash = ${input.hash}
  `);
  const expiresAt = new Date(input.at.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  const row = existing[0];
  if (!row) {
    const id = newId();
    tx.write(sql`
      INSERT INTO core.session (
        id, user_id, token_hash, created_at, expires_at, last_seen_at,
        step_up_at, step_up_method, ip, user_agent
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.userId} AS UUID),
        ${input.hash},
        ${input.at},
        ${expiresAt},
        ${input.at},
        ${input.at},
        ${input.method},
        ${input.ip},
        ${input.userAgent}
      )
    `);
    tx.audit({
      table: 'core.session',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { step_up_method: input.method, step_up_at: input.at.toISOString() },
    });
    return;
  }
  tx.write(sql`
    UPDATE core.session
    SET expires_at = ${expiresAt},
        last_seen_at = ${input.at},
        step_up_at = ${input.at},
        step_up_method = ${input.method},
        ip = ${input.ip},
        user_agent = ${input.userAgent},
        revoked_at = NULL
    WHERE id = CAST(${row.id} AS UUID)
  `);
  tx.audit({
    table: 'core.session',
    rowId: row.id,
    action: 'UPDATE',
    before: { step_up_method: row.step_up_method, step_up_at: row.step_up_at },
    after: { step_up_method: input.method, step_up_at: input.at.toISOString() },
  });
}

export function stepUpCookie(token: string, secure: boolean): string {
  const parts = [`wc_stepup=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=300'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
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

function iso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

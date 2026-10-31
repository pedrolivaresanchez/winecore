import { domainError } from '../../errors';
import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Actor, Writer } from '../../db/writer';
import type { StepUpMethod } from '../../approvals/types';
import { blobBytes, decryptSecret, encryptSecret } from './crypto';
import { writeStepUp } from './session';

export interface CredentialView {
  id: string;
  kind: 'passkey' | 'totp';
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface PasskeyRecord {
  id: string;
  credentialId: string;
  publicKey: Uint8Array;
  signCount: number;
}

export interface TotpRecord {
  id: string;
  secret: Uint8Array;
  signCount: number;
}

export async function listActiveCredentials(writer: Writer, userId: string): Promise<CredentialView[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, kind, label, created_at, last_used_at
    FROM core.user_credential
    WHERE user_id = CAST(${userId} AS UUID) AND revoked_at IS NULL
    ORDER BY created_at DESC, id DESC
  `);
  return rows.flatMap((row) => {
    const view = toView(row);
    return view ? [view] : [];
  });
}

export async function listPasskeys(writer: Writer, userId: string): Promise<PasskeyRecord[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, credential_id, public_key, sign_count
    FROM core.user_credential
    WHERE user_id = CAST(${userId} AS UUID)
      AND kind = 'passkey'
      AND revoked_at IS NULL
  `);
  const records: PasskeyRecord[] = [];
  for (const row of rows) {
    const credentialId = text(row.credential_id);
    const publicKey = blobBytes(row.public_key);
    if (!credentialId || !publicKey) continue;
    records.push({
      id: text(row.id) ?? '',
      credentialId,
      publicKey,
      signCount: asInt(row.sign_count),
    });
  }
  return records.filter((row) => row.id !== '');
}

export async function listTotp(writer: Writer, userId: string, dataKey: Uint8Array): Promise<TotpRecord[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, totp_secret_enc, sign_count
    FROM core.user_credential
    WHERE user_id = CAST(${userId} AS UUID)
      AND kind = 'totp'
      AND revoked_at IS NULL
  `);
  const records: TotpRecord[] = [];
  for (const row of rows) {
    const id = text(row.id);
    const encrypted = blobBytes(row.totp_secret_enc);
    if (!id || !encrypted) continue;
    records.push({ id, secret: decryptSecret(dataKey, encrypted), signCount: asInt(row.sign_count) });
  }
  return records;
}

export async function insertPasskey(
  writer: Writer,
  actor: Actor,
  input: { userId: string; label: string; credentialId: string; publicKey: Uint8Array; counter: number; at: Date },
): Promise<CredentialView> {
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO core.user_credential (
        id, user_id, kind, label, credential_id, public_key, sign_count, created_at
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.userId} AS UUID),
        'passkey',
        ${input.label},
        ${input.credentialId},
        ${input.publicKey},
        ${input.counter},
        ${input.at}
      )
    `);
    tx.audit({
      table: 'core.user_credential',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { kind: 'passkey', label: input.label },
    });
  });
  return { id, kind: 'passkey', label: input.label, created_at: input.at.toISOString(), last_used_at: null };
}

export async function insertTotp(
  writer: Writer,
  actor: Actor,
  input: { userId: string; secret: Uint8Array; dataKey: Uint8Array; at: Date; initialCount: number },
): Promise<CredentialView> {
  const id = newId();
  const encrypted = encryptSecret(input.dataKey, input.secret);
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO core.user_credential (
        id, user_id, kind, label, totp_secret_enc, sign_count, created_at
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.userId} AS UUID),
        'totp',
        'TOTP',
        ${encrypted},
        ${input.initialCount},
        ${input.at}
      )
    `);
    tx.audit({
      table: 'core.user_credential',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { kind: 'totp', label: 'TOTP' },
    });
  });
  return { id, kind: 'totp', label: 'TOTP', created_at: input.at.toISOString(), last_used_at: null };
}

export async function revokeOwnedCredential(
  writer: Writer,
  actor: Actor,
  userId: string,
  credentialId: string,
  at: Date,
): Promise<boolean> {
  const rows = await writer.read<{ id: string; revoked_at: string | null }>(sql`
    SELECT id, revoked_at
    FROM core.user_credential
    WHERE id = CAST(${credentialId} AS UUID) AND user_id = CAST(${userId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return false;
  if (row.revoked_at) return true;
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE core.user_credential
      SET revoked_at = ${at}
      WHERE id = CAST(${credentialId} AS UUID)
        AND user_id = CAST(${userId} AS UUID)
        AND revoked_at IS NULL
    `);
    tx.audit({
      table: 'core.user_credential',
      rowId: credentialId,
      action: 'UPDATE',
      before: { revoked_at: null },
      after: { revoked_at: at.toISOString() },
    });
  });
  return true;
}

/**
 * Records factor use and the step-up timestamp in one writer transaction.
 * Re-reads the counter so a replay cannot pass twice.
 */
export async function commitFactorUse(
  writer: Writer,
  actor: Actor,
  input: {
    userId: string;
    credentialRowId: string;
    nextCount: number;
    at: Date;
    method: StepUpMethod;
    sessionHash: Uint8Array;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ sign_count: unknown; revoked_at: string | null }>(sql`
      SELECT sign_count, revoked_at
      FROM core.user_credential
      WHERE id = CAST(${input.credentialRowId} AS UUID)
        AND user_id = CAST(${input.userId} AS UUID)
    `);
    const row = rows[0];
    if (!row || row.revoked_at) throw domainError('WC_VERIFY_FAILED');
    const stored = asInt(row.sign_count);
    if (input.method === 'totp') {
      if (input.nextCount <= stored) throw domainError('WC_VERIFY_FAILED');
    } else if ((input.nextCount > 0 || stored > 0) && input.nextCount <= stored) {
      throw domainError('WC_VERIFY_FAILED');
    }
    tx.write(sql`
      UPDATE core.user_credential
      SET sign_count = ${input.nextCount}, last_used_at = ${input.at}
      WHERE id = CAST(${input.credentialRowId} AS UUID)
        AND user_id = CAST(${input.userId} AS UUID)
        AND revoked_at IS NULL
    `);
    tx.audit({
      table: 'core.user_credential',
      rowId: input.credentialRowId,
      action: 'UPDATE',
      before: { sign_count: stored },
      after: { sign_count: input.nextCount, last_used_at: input.at.toISOString() },
    });
    await writeStepUp(tx, {
      userId: input.userId,
      hash: input.sessionHash,
      at: input.at,
      method: input.method,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}

function toView(row: Record<string, unknown>): CredentialView | null {
  const id = text(row.id);
  const kind = row.kind === 'passkey' || row.kind === 'totp' ? row.kind : null;
  const label = text(row.label);
  const created = text(row.created_at);
  if (!id || !kind || !label || !created) return null;
  return {
    id,
    kind,
    label,
    created_at: asIso(created),
    last_used_at: row.last_used_at == null ? null : asIso(String(row.last_used_at)),
  };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

function asInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function asIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

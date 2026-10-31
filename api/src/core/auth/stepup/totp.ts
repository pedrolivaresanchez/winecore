import { createHmac, randomBytes } from 'node:crypto';
import { base32Encode, sameText } from './crypto';

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const PENDING_MS = 10 * 60 * 1000;

export interface TotpMatch {
  step: number;
  replay: boolean;
}

interface PendingTotp {
  secret: Uint8Array;
  expiresAt: number;
}

const pending = new Map<string, PendingTotp>();

export function clearPendingTotp(): void {
  for (const row of pending.values()) row.secret.fill(0);
  pending.clear();
}

export function beginTotpEnrollment(userId: string, email: string, now: Date): string {
  const previous = pending.get(userId);
  if (previous) previous.secret.fill(0);
  const secret = randomBytes(20);
  pending.set(userId, { secret, expiresAt: now.getTime() + PENDING_MS });
  const label = encodeURIComponent(`WineCore:${email}`);
  const issuer = encodeURIComponent('WineCore');
  const encoded = base32Encode(secret);
  return `otpauth://totp/${label}?secret=${encoded}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

export function pendingTotpSecret(userId: string, now: Date): Uint8Array | null {
  const row = pending.get(userId);
  if (!row) return null;
  if (row.expiresAt <= now.getTime()) {
    row.secret.fill(0);
    pending.delete(userId);
    return null;
  }
  return row.secret;
}

export function dropPendingTotp(userId: string): void {
  const row = pending.get(userId);
  if (!row) return;
  row.secret.fill(0);
  pending.delete(userId);
}

/** RFC 6238, SHA-1, 6 digits, 30 s. `stepOffset` is added to the current counter. */
export function totpCode(secret: Uint8Array, at: Date, stepOffset = 0): string {
  const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS) + stepOffset;
  return hotp(secret, counter);
}

/**
 * Accepts the current counter and ±1. `replay` is true when the code matches a
 * counter that has already been accepted (`lastStep`).
 */
export function matchTotp(secret: Uint8Array, code: string, at: Date, lastStep: number): TotpMatch | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (step < 0) continue;
    if (!sameText(hotp(secret, step), code)) continue;
    return { step, replay: step <= lastStep };
  }
  return null;
}

function hotp(secret: Uint8Array, counter: number): string {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    ((mac[offset] ?? 0) & 0x7f) << 24 |
    ((mac[offset + 1] ?? 0) & 0xff) << 16 |
    ((mac[offset + 2] ?? 0) & 0xff) << 8 |
    ((mac[offset + 3] ?? 0) & 0xff);
  return (binary % 1_000_000).toString().padStart(DIGITS, '0');
}

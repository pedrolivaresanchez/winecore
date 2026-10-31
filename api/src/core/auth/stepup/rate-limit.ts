/**
 * Intentos fallidos de verificación, en memoria de este proceso.
 * Es a propósito: WineCore tiene un solo escritor (ADR 002). En un despliegue
 * el contador vuelve a cero y los retos pendientes se pierden; la persona reintenta.
 */
import { domainError } from '../../errors';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Bucket {
  failures: number;
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();

export function clearRateLimits(): void {
  buckets.clear();
}

export function assertWithinRateLimit(bucket: string, now: Date): void {
  const row = buckets.get(bucket);
  if (!row) return;
  if (row.lockedUntil > now.getTime()) throw domainError('WC_RATE_LIMITED');
  if (row.lockedUntil !== 0) buckets.delete(bucket);
}

export function recordAuthFailure(bucket: string, now: Date): void {
  const row = buckets.get(bucket) ?? { failures: 0, lockedUntil: 0 };
  row.failures += 1;
  if (row.failures >= MAX_FAILURES) row.lockedUntil = now.getTime() + LOCKOUT_MS;
  buckets.set(bucket, row);
}

export function recordAuthSuccess(bucket: string): void {
  buckets.delete(bucket);
}

export function rateBucket(scope: 'step-up' | 'totp-confirm' | 'passkey-register', userId: string): string {
  return `${scope}:${userId}`;
}

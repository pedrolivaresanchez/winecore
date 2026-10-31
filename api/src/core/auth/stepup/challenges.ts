/**
 * Retos WebAuthn de un solo uso, en memoria de este proceso.
 * Es a propósito: WineCore tiene un solo escritor (ADR 002). En un despliegue
 * se pierden los retos pendientes y la persona vuelve a pedir opciones.
 */
const TTL_MS = 120_000;

type Purpose = 'registration' | 'authentication';

interface Challenge {
  challenge: string;
  expiresAt: number;
}

const challenges = new Map<string, Challenge>();

function key(userId: string, purpose: Purpose): string {
  return `${purpose}:${userId}`;
}

export function clearChallenges(): void {
  challenges.clear();
}

/** Replaces any previous challenge for this user and purpose. */
export function issueChallenge(userId: string, purpose: Purpose, challenge: string, now: Date): void {
  challenges.set(key(userId, purpose), { challenge, expiresAt: now.getTime() + TTL_MS });
}

/** Single-use. Expired and unknown challenges return null. */
export function takeChallenge(userId: string, purpose: Purpose, now: Date): string | null {
  const id = key(userId, purpose);
  const row = challenges.get(id);
  if (!row) return null;
  challenges.delete(id);
  if (row.expiresAt <= now.getTime()) return null;
  return row.challenge;
}

export const CHALLENGE_TTL_MS = TTL_MS;

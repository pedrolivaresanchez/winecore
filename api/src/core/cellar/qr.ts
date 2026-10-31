import { randomBytes } from 'node:crypto';

const PREFIX = 'wcqr_';

/** Random token that satisfies `cellar.vessel.qr_token` (`^[A-Za-z0-9_-]{16,64}$`). */
export function newQrToken(): string {
  return PREFIX + randomBytes(16).toString('base64url');
}

/** True only for tokens this API mints. Anything else is a foreign QR. */
export function isWinecoreQr(token: string): boolean {
  return token.length >= 16 && token.length <= 64 && /^wcqr_[A-Za-z0-9_-]{11,59}$/.test(token);
}

export function qrPayload(token: string): string {
  return `winecore:vessel:${token}`;
}

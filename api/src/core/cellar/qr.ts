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

/** URL a phone camera can open. `publicUrl` is `APP_PUBLIC_URL` without a trailing slash. */
export function qrPayload(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/q/${token}`;
}

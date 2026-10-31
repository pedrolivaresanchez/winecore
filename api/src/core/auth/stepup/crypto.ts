import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { domainError, DomainError } from '../../errors';
import type { Config } from '../../../config';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function sha256Bytes(value: string): Uint8Array {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function randomToken(bytes = 32): string {
  return Buffer.from(randomBytes(bytes)).toString('base64url');
}

export function requireDataKey(config: Config): Uint8Array {
  if (!config.dataKey || config.dataKey.length !== 32) {
    throw new DomainError('WC_INTERNAL', 500, 'Error interno');
  }
  return config.dataKey;
}

/** AES-256-GCM. Layout: 12-byte IV, ciphertext, 16-byte tag. */
export function encryptSecret(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return concat(iv, cipher.update(plain), cipher.final(), cipher.getAuthTag());
}

export function decryptSecret(key: Uint8Array, payload: Uint8Array): Uint8Array {
  if (payload.length <= IV_BYTES + TAG_BYTES) throw domainError('WC_VERIFY_FAILED');
  const iv = payload.slice(0, IV_BYTES);
  const tag = payload.slice(payload.length - TAG_BYTES);
  const body = payload.slice(IV_BYTES, payload.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return concat(decipher.update(body), decipher.final());
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw domainError('WC_VERIFY_FAILED');
  }
}

export function blobBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'string' && value.length > 0) {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  return null;
}

export function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

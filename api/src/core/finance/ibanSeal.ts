import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { domainError } from '../errors';
import { isValidIban, normalizeIban } from '../party/iban';

export function sealIban(plain: string, key: Uint8Array): Uint8Array {
  const iban = normalizeIban(plain);
  if (!isValidIban(iban)) throw domainError('WC_VALIDATION', { iban: 'El IBAN no es válido' });
  if (key.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(iban, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([iv, tag, data]));
}

export function openIban(sealed: Uint8Array, key: Uint8Array): string {
  if (key.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes');
  const buf = Buffer.from(sealed);
  if (buf.length < 29) throw domainError('WC_VALIDATION', { iban: 'El IBAN guardado no se puede leer' });
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    if (!isValidIban(plain)) throw new Error('iban');
    return normalizeIban(plain);
  } catch {
    throw domainError('WC_VALIDATION', { iban: 'El IBAN guardado no se puede leer' });
  }
}

export function bytesOfBlob(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string' && value.length > 0) return new Uint8Array(Buffer.from(value, 'base64'));
  return null;
}

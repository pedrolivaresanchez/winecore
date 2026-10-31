import { createCipheriv, randomBytes } from 'node:crypto';
import { ibanLast4, isValidIban, normalizeIban } from '../../src/core/party/iban';

export function dataKeyFromEnv(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.WINECORE_DATA_KEY?.trim() ?? '';
  if (raw === '') return null;
  const buffer = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buffer.length !== 32) throw new Error('DATA_KEY');
  return buffer;
}

export function sealIban(raw: string, key: Buffer | null): { enc: Uint8Array | null; last4: string | null; warning: string | null } {
  const text = raw.trim();
  if (text === '') return { enc: null, last4: null, warning: null };
  if (!isValidIban(text)) return { enc: null, last4: null, warning: 'INVALID_IBAN' };
  if (!key) return { enc: null, last4: null, warning: 'IBAN_KEY_MISSING' };
  const normalized = normalizeIban(text);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(normalized, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: Buffer.concat([iv, tag, body]), last4: ibanLast4(normalized), warning: null };
}

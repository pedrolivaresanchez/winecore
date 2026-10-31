declare module 'node:crypto' {
  interface Sha256Hash {
    update(data: string, encoding: 'utf8'): Sha256Hash;
    update(data: Uint8Array): Sha256Hash;
    digest(encoding: 'hex'): string;
    digest(): Uint8Array;
  }
  export function createHash(algorithm: 'sha256'): Sha256Hash;
  export function randomUUID(): string;

  interface Hmac {
    update(data: Uint8Array): Hmac;
    digest(): Uint8Array;
  }
  export function createHmac(algorithm: 'sha1', key: Uint8Array): Hmac;

  interface AesCipher {
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
    getAuthTag(): Uint8Array;
  }
  interface AesDecipher {
    setAuthTag(tag: Uint8Array): void;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  }
  export function createCipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array): AesCipher;
  export function createDecipheriv(algorithm: 'aes-256-gcm', key: Uint8Array, iv: Uint8Array): AesDecipher;
  export function randomBytes(size: number): Uint8Array;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;

  export interface EcJsonWebKey {
    x?: string;
    y?: string;
  }
  export interface EcKeyObject {
    export(options: { format: 'jwk' }): EcJsonWebKey;
  }
  export function generateKeyPairSync(
    type: 'ec',
    options: { namedCurve: 'prime256v1' },
  ): { publicKey: EcKeyObject; privateKey: EcKeyObject };
  export function sign(algorithm: 'sha256', data: Uint8Array, key: EcKeyObject): Uint8Array;
}

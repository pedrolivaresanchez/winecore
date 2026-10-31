declare module 'node:crypto' {
  interface Sha256Hash {
    update(data: string, encoding: 'utf8'): Sha256Hash;
    update(data: Uint8Array): Sha256Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Sha256Hash;
  export function randomUUID(): string;
}

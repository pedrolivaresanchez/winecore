/**
 * Software WebAuthn authenticator for tests. ES256, attestation "none".
 * Signs with node:crypto so @simplewebauthn/server verifies a real ceremony.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type EcKeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export interface SoftwarePasskey {
  credentialId: Uint8Array;
  privateKey: EcKeyObject;
  signCount: number;
}

export function createPasskey(): SoftwarePasskey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { credentialId: randomBytes(16), privateKey, signCount: 0 };
}

export function registrationResponse(
  passkey: SoftwarePasskey,
  options: PublicKeyCredentialCreationOptionsJSON,
  origin: string,
): RegistrationResponseJSON {
  const rpId = options.rp.id ?? '';
  const coseKey = coseEs256(passkey.privateKey);
  const auth = authenticatorData({
    rpIdHash: sha256(utf8(rpId)),
    flags: UP | UV | AT,
    signCount: passkey.signCount,
    credentialId: passkey.credentialId,
    coseKey,
  });
  const attestation = cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(auth)],
  ]);
  const id = base64url(passkey.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientDataJson({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin,
      }),
      attestationObject: base64url(attestation),
      transports: ['internal'],
    },
  };
}

export function authenticationResponse(
  passkey: SoftwarePasskey,
  options: PublicKeyCredentialRequestOptionsJSON,
  origin: string,
): AuthenticationResponseJSON {
  passkey.signCount += 1;
  const rpId = options.rpId ?? '';
  const auth = authenticatorData({
    rpIdHash: sha256(utf8(rpId)),
    flags: UP | UV,
    signCount: passkey.signCount,
  });
  const clientData = utf8(JSON.stringify({
    type: 'webauthn.get',
    challenge: options.challenge,
    origin,
    crossOrigin: false,
  }));
  const signed = concat(auth, sha256(clientData));
  const signature = sign('sha256', signed, passkey.privateKey);
  const id = base64url(passkey.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64url(clientData),
      authenticatorData: base64url(auth),
      signature: base64url(signature),
    },
  };
}

function clientDataJson(value: { type: string; challenge: string; origin: string }): string {
  return base64url(utf8(JSON.stringify({ ...value, crossOrigin: false })));
}

function authenticatorData(input: {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credentialId?: Uint8Array;
  coseKey?: Uint8Array;
}): Uint8Array {
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, input.signCount);
  const parts: Uint8Array[] = [input.rpIdHash, Uint8Array.of(input.flags), counter];
  if (input.credentialId && input.coseKey) {
    const length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, input.credentialId.length);
    parts.push(new Uint8Array(16), length, input.credentialId, input.coseKey);
  }
  return concat(...parts);
}

function coseEs256(privateKey: EcKeyObject): Uint8Array {
  const jwk = privateKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('La clave pública no tiene coordenadas');
  return cborMap([
    [cborInt(1), cborInt(2)],
    [cborInt(3), cborInt(-7)],
    [cborInt(-1), cborInt(1)],
    [cborInt(-2), cborBytes(base64urlDecode(jwk.x))],
    [cborInt(-3), cborBytes(base64urlDecode(jwk.y))],
  ]);
}

function sha256(data: Uint8Array): Uint8Array {
  return createHash('sha256').update(data).digest();
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64url(data: Uint8Array): string {
  return Buffer.from(data).toString('base64url');
}

function base64urlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
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

function cborHead(major: number, value: number): Uint8Array {
  if (value < 24) return Uint8Array.of((major << 5) | value);
  if (value < 256) return Uint8Array.of((major << 5) | 24, value);
  if (value < 65536) return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff);
  const out = new Uint8Array(5);
  out[0] = (major << 5) | 26;
  new DataView(out.buffer).setUint32(1, value);
  return out;
}

function cborInt(value: number): Uint8Array {
  if (value >= 0) return cborHead(0, value);
  return cborHead(1, -1 - value);
}

function cborBytes(value: Uint8Array): Uint8Array {
  return concat(cborHead(2, value.length), value);
}

function cborText(value: string): Uint8Array {
  const bytes = utf8(value);
  return concat(cborHead(3, bytes.length), bytes);
}

function cborMap(pairs: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  return concat(cborHead(5, pairs.length), ...pairs.flatMap(([key, value]) => [key, value]));
}

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Config } from '../../../config';
import { DomainError, domainError } from '../../errors';

const ES256 = -7;

export interface VerifiedPasskey {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
}

export async function registrationOptions(input: {
  config: Config;
  userId: string;
  email: string;
  displayName: string;
  excludeCredentialIds: readonly string[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.config.webauthnRpName,
    rpID: input.config.webauthnRpId,
    userName: input.email,
    userDisplayName: input.displayName,
    userID: new TextEncoder().encode(input.userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    supportedAlgorithmIDs: [ES256],
    timeout: 120_000,
    excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
  });
}

export async function authenticationOptions(input: {
  config: Config;
  credentialIds: readonly string[];
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.config.webauthnRpId,
    userVerification: 'required',
    timeout: 120_000,
    allowCredentials: input.credentialIds.map((id) => ({ id })),
  });
}

export async function verifyRegistration(input: {
  config: Config;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}): Promise<VerifiedPasskey> {
  try {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.config.webauthnOrigin,
      expectedRPID: input.config.webauthnRpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: [ES256],
    });
    if (!result.verified) throw domainError('WC_VERIFY_FAILED');
    return {
      credentialId: result.registrationInfo.credential.id,
      publicKey: Uint8Array.from(result.registrationInfo.credential.publicKey),
      counter: result.registrationInfo.credential.counter,
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw domainError('WC_VERIFY_FAILED');
  }
}

export async function verifyAssertion(input: {
  config: Config;
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
}): Promise<number> {
  try {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.config.webauthnOrigin,
      expectedRPID: input.config.webauthnRpId,
      requireUserVerification: true,
      credential: {
        id: input.credentialId,
        publicKey: bytesCopy(input.publicKey),
        counter: input.counter,
      },
    });
    if (!result.verified) throw domainError('WC_VERIFY_FAILED');
    return result.authenticationInfo.newCounter;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw domainError('WC_VERIFY_FAILED');
  }
}

function bytesCopy(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

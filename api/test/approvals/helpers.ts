import { expect } from 'bun:test';

import { DomainError, domainError, type ErrorCode } from '../../src/core/errors';

export async function expectError(promise: Promise<unknown>, code: ErrorCode): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const expected = domainError(code);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(expected.httpStatus);
    expect(error.message).toBe(expected.message);
    return error;
  }
  throw new Error(`expected ${code}`);
}

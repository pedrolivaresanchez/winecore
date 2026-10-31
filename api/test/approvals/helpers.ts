import { expect } from 'bun:test';

import { ApprovalError, type ApprovalErrorCode } from '../../src/core/approvals/types';

const HTTP: Record<ApprovalErrorCode, number> = {
  WC002: 500,
  WC040: 409,
  WC041: 409,
  WC042: 409,
  WC043: 409,
  WC_FORBIDDEN: 403,
  WC_STEP_UP_REQUIRED: 401,
  WC_VALIDATION: 422,
  WC_NOT_FOUND: 404,
  WC_NOT_APPROVED: 409,
  WC_ALREADY_CONSUMED: 409,
};

export async function expectError(
  promise: Promise<unknown>,
  code: ApprovalErrorCode,
  message?: string,
): Promise<ApprovalError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ApprovalError)) throw error;
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(HTTP[code]);
    if (message !== undefined) expect(error.message).toBe(message);
    return error;
  }
  throw new Error(`expected ${code}`);
}

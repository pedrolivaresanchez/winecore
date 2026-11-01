import { DomainError, domainError, isErrorCode } from '../errors';

export interface IssueItem {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export function issue(code: string, message: string, field?: string): IssueItem {
  return field ? { code, message, field } : { code, message };
}

export function raiseIssue(item: IssueItem): never {
  const fields = item.field ? { [item.field]: item.message } : undefined;
  if (isErrorCode(item.code)) {
    const base = domainError(item.code, fields);
    throw new DomainError(item.code, base.httpStatus, item.message, fields, item.details);
  }
  throw new DomainError(item.code, 422, item.message, fields, item.details);
}

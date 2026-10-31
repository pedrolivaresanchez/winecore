import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { createBankAccount, listBankAccounts } from '../core/finance/bankAccounts';

export function postBankAccount(writer: Writer, request: Request) {
  return createBankAccount(writer, sessionOf(request), request);
}

export function getBankAccounts(writer: Writer, request: Request) {
  return listBankAccounts(writer, sessionOf(request), request);
}

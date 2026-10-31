import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { confirmLine, ignoreLine, importStatement, listSuggestions } from '../core/finance/statements';

export function postBankStatement(writer: Writer, request: Request) {
  return importStatement(writer, sessionOf(request), request);
}

export function getBankStatementSuggestions(writer: Writer, request: Request, id: string) {
  return listSuggestions(writer, sessionOf(request), id);
}

export function postBankStatementConfirm(writer: Writer, request: Request, id: string, lineId: string) {
  return confirmLine(writer, sessionOf(request), request, id, lineId);
}

export function postBankStatementIgnore(writer: Writer, request: Request, id: string, lineId: string) {
  return ignoreLine(writer, sessionOf(request), request, id, lineId);
}

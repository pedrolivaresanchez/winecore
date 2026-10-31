import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import {
  createRemittance,
  downloadRemittanceFile,
  generateRemittanceFile,
  getRemittance,
  listRemittances,
  markRemittanceSubmitted,
  requestRemittanceApproval,
} from '../core/finance/remittances';

export function postRemittance(writer: Writer, request: Request) {
  return createRemittance(writer, sessionOf(request), request);
}

export function getRemittances(writer: Writer, request: Request) {
  return listRemittances(writer, sessionOf(request), request);
}

export function getRemittanceById(writer: Writer, request: Request, id: string) {
  return getRemittance(writer, sessionOf(request), id);
}

export function postRemittanceApproval(writer: Writer, request: Request, id: string) {
  return requestRemittanceApproval(writer, sessionOf(request), request, id);
}

export function postRemittanceFile(writer: Writer, request: Request, id: string) {
  return generateRemittanceFile(writer, sessionOf(request), request, id);
}

export function getRemittanceFile(writer: Writer, request: Request, id: string) {
  return downloadRemittanceFile(writer, sessionOf(request), id);
}

export function postRemittanceSubmitted(writer: Writer, request: Request, id: string) {
  return markRemittanceSubmitted(writer, sessionOf(request), request, id);
}

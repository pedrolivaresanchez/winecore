import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { createPayment, getPayment, listPayments, reversePayment } from '../core/finance/payments';

export function postPayment(writer: Writer, request: Request) {
  return createPayment(writer, sessionOf(request), request);
}

export function getPaymentById(writer: Writer, request: Request, id: string) {
  return getPayment(writer, sessionOf(request), id);
}

export function getPayments(writer: Writer, request: Request) {
  return listPayments(writer, sessionOf(request), request);
}

export function postPaymentReverse(writer: Writer, request: Request, id: string) {
  return reversePayment(writer, sessionOf(request), request, id);
}

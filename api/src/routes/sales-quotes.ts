import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { actorOf } from '../core/sales/db';
import {
  acceptQuote,
  createQuote,
  getQuote,
  listQuotes,
  patchQuote,
  quotePdf,
  quoteToOrder,
  rejectQuote,
  sendQuote,
} from '../core/sales/quotes';

export function getQuotes(writer: Writer, request: Request) {
  sessionOf(request);
  return listQuotes(writer, request);
}

export function getQuoteById(writer: Writer, request: Request, id: string) {
  sessionOf(request);
  return getQuote(writer, id);
}

export function postQuote(writer: Writer, request: Request) {
  return createQuote(writer, request);
}

export function postQuoteSend(writer: Writer, request: Request, id: string) {
  return sendQuote(writer, request, id);
}

export function postQuoteToOrder(writer: Writer, request: Request, id: string) {
  return quoteToOrder(writer, request, id);
}

export function patchQuoteById(writer: Writer, request: Request, id: string) {
  return patchQuote(writer, request, id);
}

export function postQuoteAccept(writer: Writer, request: Request, id: string) {
  return acceptQuote(writer, request, id);
}

export function postQuoteReject(writer: Writer, request: Request, id: string) {
  return rejectQuote(writer, request, id);
}

export function getQuotePdf(writer: Writer, request: Request, id: string) {
  return quotePdf(writer, request, id);
}

void actorOf;
void sessionOf;

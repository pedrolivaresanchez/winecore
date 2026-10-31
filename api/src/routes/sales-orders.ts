import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { actorOf, asRecord, fail, optionalText, pathId, readJson } from '../core/sales/db';
import { createDeliveryNote } from '../core/sales/delivery';
import {
  cancelSalesOrder,
  closeSalesOrder,
  confirmSalesOrder,
  createSalesOrder,
  getSalesOrder,
  listSalesOrders,
  orderIdempotency,
  patchSalesOrder,
  setEntityException,
} from '../core/sales/orders';
import { quotePrice, priceJson } from '../core/sales/pricing';
import { loadCustomer } from '../core/sales/db';
import { Decimal } from 'decimal.js';
import { businessDate } from '../core/time';

export function getOrders(writer: Writer, request: Request) {
  sessionOf(request);
  return listSalesOrders(writer, request);
}

export function getOrder(writer: Writer, request: Request, id: string) {
  sessionOf(request);
  return getSalesOrder(writer, id);
}

export async function postOrder(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const idem = orderIdempotency(request, raw, user.id);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, (tx) => createSalesOrder(tx, actor, raw, idem));
}

export async function patchOrder(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const orderId = pathId(id);
  return writer.withWrite(actorOf(user, request), (tx) => patchSalesOrder(tx, orderId, raw));
}

export async function postConfirm(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const orderId = pathId(id);
  return writer.withWrite(actorOf(user, request), (tx) => confirmSalesOrder(tx, actorOf(user, request), orderId));
}

export async function postCancel(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return writer.withWrite(actorOf(user, request), (tx) => cancelSalesOrder(tx, actorOf(user, request), pathId(id), reason));
}

export async function postClose(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return writer.withWrite(actorOf(user, request), (tx) => closeSalesOrder(tx, pathId(id), reason));
}

export async function postException(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  const entityId = typeof body.legal_entity_id === 'string' ? body.legal_entity_id.trim().toLowerCase() : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return writer.withWrite(
    actorOf(user, request, reason),
    (tx) => setEntityException(tx, actorOf(user, request, reason), pathId(id), entityId, reason),
  );
}

export async function postOrderDelivery(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  body.sales_order_id = pathId(id);
  if (!body.kind) body.kind = 'sale';
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const created = await createDeliveryNote(tx, actorOf(user, request), body);
    return { status: 201, body: created };
  });
}

export async function getPriceQuote(writer: Writer, request: Request) {
  sessionOf(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customer_id') ?? '';
  const productId = url.searchParams.get('product_id') ?? '';
  const qty = url.searchParams.get('qty') ?? '1';
  const date = url.searchParams.get('date') ?? businessDate(new Date());
  return writer.withWrite({ type: 'system', id: 'sales-price', requestId: 'sales-price' }, async (tx) => {
    const customer = await loadCustomer(tx, customerId);
    const quantity = new Decimal(qty);
    if (!quantity.isFinite() || quantity.lte(0)) fail('La cantidad no es válida', { qty });
    const hit = await quotePrice(tx, {
      productId,
      quantity,
      date,
      priceListId: customer.default_price_list_id,
      channel: customer.default_channel ?? 'direct',
    });
    return { product_id: productId, currency: 'EUR', ...priceJson(hit) };
  });
}

void optionalText;

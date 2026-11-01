import { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { DomainError, domainError } from '../errors';
import type { ProductState, StockMove } from '../inventory/types';
import { toMadridOffsetString, businessDate } from '../time';
import {
  asRecord,
  assertEntity,
  assignNumber,
  boolOf,
  dateOf,
  decOf,
  fail,
  idOf,
  idOrNull,
  loadCustomer,
  loadLocation,
  loadProduct,
  newRowId,
  optionalText,
  parseDecimal,
  parseIncoterm,
  pathId,
  priceText,
  qtyText,
  textOf,
  throwIf,
  UUID_RE,
} from './db';
import { outbox } from './db';
import { entityByCode, onHand, reversalOf, stockMove, writeStockMove, assertPhysical, type MoveDraft } from './moves';
import { quotePrice } from './pricing';
import type { ProductRow } from './db';

const KINDS = new Set(['sale', 'consignment', 'transfer', 'return', 'sample']);

type NoteLine = {
  id: string;
  line_no: number;
  order_line_id: string | null;
  product_id: string;
  lot_id: string | null;
  description: string;
  quantity: string;
  unit_price: string | null;
  discount_pct: string;
  tax_code: string | null;
};

export async function issueDeliveryNote(tx: Tx, input: { id: string; actor: Actor }): Promise<Record<string, unknown>> {
  const note = await loadNote(tx, input.id);
  if (String(note.status) === 'cancelled') throw domainError('WC060');
  if (String(note.status) !== 'draft') throw domainError('WC060');
  const lines = await loadLines(tx, input.id);
  if (lines.length === 0) fail('El albarán no tiene líneas');
  const now = new Date();
  const occurredAt = toMadridOffsetString(now);
  const issueDate = businessDate(now);
  await assertOrderRemaining(tx, input.id, lines);
  await assertReturnAllowed(tx, note, lines);
  const planned = await planMoves(tx, note, lines, occurredAt, input.actor.id);
  await assertPhysical(tx, planned);
  const settlements = await planSettlements(tx, note, lines, planned, issueDate, occurredAt);
  const taken = await assignNumber(tx, idOf(note.legal_entity_id), 'delivery_note', now);
  tx.write(sql`
    UPDATE sales.delivery_note SET
      status = 'issued', number = ${taken.number}, series_id = CAST(${taken.seriesId} AS UUID),
      issue_date = CAST(${issueDate} AS DATE), updated_at = ${now}
    WHERE id = CAST(${input.id} AS UUID) AND status = 'draft'
  `);
  for (const move of planned) writeStockMove(tx, move, now);
  for (const line of settlements) writeSettlement(tx, line);
  tx.audit({
    table: 'sales.delivery_note',
    rowId: input.id,
    action: 'UPDATE',
    before: { status: 'draft', number: null },
    after: { status: 'issued', number: taken.number, issue_date: issueDate },
  });
  await syncOrder(tx, idOrNull(note.sales_order_id), { noteId: input.id, lines, effect: 'issue' });
  outbox(tx, 'sales.delivery_note.issued', 'sales.delivery_note', input.id, idOf(note.legal_entity_id), {
    delivery_note_id: input.id,
    number: taken.number,
    kind: String(note.kind),
    moves: planned.map((move) => ({ move_type: move.move_type, lot_id: move.lot_id, qty_units: move.qty_units, owner_entity_id: move.owner_entity_id })),
  });
  return presentNote({ ...note, status: 'issued', number: taken.number, series_id: taken.seriesId, issue_date: issueDate }, lines);
}

export async function dispatch(tx: Tx, input: { id: string; actor: Actor; trackingRef?: string | null; carrierContactId?: string | null }): Promise<Record<string, unknown>> {
  const note = await loadNote(tx, input.id);
  if (String(note.status) === 'cancelled') throw domainError('WC060');
  if (String(note.status) !== 'issued') fail('Solo se expide un albarán emitido', { status: String(note.status) });
  if (await needsEad(tx, note) && !idOrNull(note.emcs_document_id)) throw domainError('WC_REG_EAD_REQUIRED');
  const now = new Date();
  tx.write(sql`
    UPDATE sales.delivery_note SET
      status = 'shipped', shipped_at = ${now},
      tracking_ref = ${input.trackingRef ?? textOf(note.tracking_ref)},
      carrier_contact_id = CASE WHEN ${input.carrierContactId ?? null} IS NULL
        THEN carrier_contact_id ELSE CAST(${input.carrierContactId ?? null} AS UUID) END,
      updated_at = ${now}
    WHERE id = CAST(${input.id} AS UUID)
  `);
  tx.audit({ table: 'sales.delivery_note', rowId: input.id, action: 'UPDATE', before: { status: 'issued' }, after: { status: 'shipped' } });
  return presentNote({
    ...note,
    status: 'shipped',
    shipped_at: now.toISOString(),
    tracking_ref: input.trackingRef ?? textOf(note.tracking_ref),
  }, await loadLines(tx, input.id));
}

export async function markDelivered(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const note = await loadNote(tx, id);
  if (String(note.status) !== 'shipped') fail('Solo se entrega un albarán expedido', { status: String(note.status) });
  const now = new Date();
  tx.write(sql`
    UPDATE sales.delivery_note SET status = 'delivered', delivered_at = ${now}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({ table: 'sales.delivery_note', rowId: id, action: 'UPDATE', before: { status: 'shipped' }, after: { status: 'delivered' } });
  return presentNote({ ...note, status: 'delivered', delivered_at: now.toISOString() }, await loadLines(tx, id));
}

export async function voidDelivery(tx: Tx, actor: Actor, id: string, reason: string): Promise<Record<string, unknown>> {
  if (reason.trim().length < 3) fail('El motivo es obligatorio', { reason: 'Obligatorio' });
  const note = await loadNote(tx, id);
  const status = String(note.status);
  if (status === 'cancelled') throw domainError('WC060');
  if (status === 'shipped' || status === 'delivered') {
    throw new DomainError('WC060', 409, 'El albarán ya ha salido; la corrección es una devolución');
  }
  if (status === 'draft') return cancelDraft(tx, id, reason);
  if (await hasIssuedInvoice(tx, id)) {
    throw new DomainError('WC060', 409, 'El albarán ya está facturado');
  }
  const now = new Date();
  const occurredAt = toMadridOffsetString(now);
  const originals = await loadNoteMoves(tx, id);
  const reversals = originals.map((move) => reversalOf(move, occurredAt, actor.id));
  await assertPhysical(tx, reversals);
  await assertSettlementsOpen(tx, id);
  for (const move of reversals) writeStockMove(tx, move, now);
  tx.write(sql`
    DELETE FROM billing.intercompany_settlement_line
    WHERE source_table = 'sales.delivery_note_line'
      AND source_id IN (SELECT id FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID))
  `);
  tx.write(sql`
    UPDATE sales.delivery_note
    SET status = 'cancelled', cancelled_reason = ${reason.trim()}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'sales.delivery_note',
    rowId: id,
    action: 'UPDATE',
    before: { status },
    after: { status: 'cancelled', cancelled_reason: reason.trim() },
  });
  await syncOrder(tx, idOrNull(note.sales_order_id), { noteId: id, lines: await loadLines(tx, id), effect: 'void' });
  return presentNote({ ...note, status: 'cancelled', cancelled_reason: reason.trim() }, await loadLines(tx, id));
}

async function cancelDraft(tx: Tx, id: string, reason: string): Promise<Record<string, unknown>> {
  const note = await loadNote(tx, id);
  const now = new Date();
  const taken = textOf(note.number)
    ? { number: String(note.number), seriesId: idOf(note.series_id) }
    : await assignNumber(tx, idOf(note.legal_entity_id), 'delivery_note', now);
  const issueDate = note.issue_date == null ? businessDate(now) : dateOf(note.issue_date);
  tx.write(sql`
    UPDATE sales.delivery_note
    SET status = 'cancelled', number = ${taken.number}, series_id = CAST(${taken.seriesId} AS UUID),
        issue_date = CAST(${issueDate} AS DATE), cancelled_reason = ${reason.trim()}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID) AND status = 'draft'
  `);
  tx.audit({ table: 'sales.delivery_note', rowId: id, action: 'UPDATE', before: { status: 'draft' }, after: { status: 'cancelled', number: taken.number } });
  return presentNote({
    ...note,
    status: 'cancelled',
    number: taken.number,
    series_id: taken.seriesId,
    issue_date: issueDate,
    cancelled_reason: reason.trim(),
  }, await loadLines(tx, id));
}

export async function createDeliveryNote(tx: Tx, actor: Actor, raw: unknown): Promise<Record<string, unknown>> {
  const body = asRecord(raw);
  const fields: Record<string, string> = {};
  const kind = typeof body.kind === 'string' ? body.kind : 'sale';
  if (!KINDS.has(kind)) fields.kind = 'Tipo de albarán no válido';
  const fromId = bodyId(body.from_location_id, 'from_location_id', fields);
  const toId = body.to_location_id == null || body.to_location_id === '' ? null : bodyId(body.to_location_id, 'to_location_id', fields);
  const customerId = body.customer_id == null || body.customer_id === '' ? null : bodyId(body.customer_id, 'customer_id', fields);
  const orderId = body.sales_order_id == null || body.sales_order_id === '' ? null : bodyId(body.sales_order_id, 'sales_order_id', fields);
  const entityInput = body.legal_entity_id == null || body.legal_entity_id === '' ? null : bodyId(body.legal_entity_id, 'legal_entity_id', fields);
  const channel = typeof body.channel === 'string' ? body.channel : null;
  const incoterm = parseIncoterm(body.incoterm, 'incoterm', fields);
  const notes = optionalText(body.notes, 'notes', fields, 2000);
  throwIf(fields);
  if (!fromId) fail('La ubicación de origen es obligatoria', { from_location_id: 'Obligatorio' });
  const from = await loadLocation(tx, fromId);
  if (!from.is_active) fail('La ubicación de origen no está activa', { from_location_id: fromId });
  if (toId) {
    if (toId === fromId) fail('El destino debe ser distinto del origen', { to_location_id: toId });
    const to = await loadLocation(tx, toId);
    if (!to.is_active) fail('La ubicación de destino no está activa', { to_location_id: toId });
  }
  if ((kind === 'consignment' || kind === 'transfer' || kind === 'return') && !toId) {
    fail('Este albarán necesita ubicación de destino', { to_location_id: 'Obligatorio' });
  }
  let entityId = entityInput;
  let resolvedCustomer = customerId;
  let resolvedChannel = channel;
  if (orderId) {
    const order = await loadOrder(tx, orderId);
    const orderStatus = String(order.status);
    if (orderStatus !== 'confirmed' && orderStatus !== 'partially_delivered') {
      fail('El pedido no admite albarán', { status: orderStatus });
    }
    entityId = idOf(order.legal_entity_id);
    resolvedCustomer = idOf(order.customer_id);
    resolvedChannel = String(order.channel);
  }
  if (!entityId) entityId = from.controlling_entity_id;
  await assertEntity(tx, entityId);
  if ((kind === 'sale' || kind === 'sample') && !resolvedCustomer) fail('El cliente es obligatorio', { customer_id: 'Obligatorio' });
  if (resolvedCustomer) {
    const customer = await loadCustomer(tx, resolvedCustomer);
    if (kind === 'sale' && !customer.is_customer) fail('El contacto no es cliente', { customer_id: resolvedCustomer });
  }
  const parsed = parseDeliveryLines(body.lines);
  const id = newRowId();
  const now = new Date();
  const valued = parsed.some((line) => line.unitPrice != null) || orderId != null;
  tx.write(sql`
    INSERT INTO sales.delivery_note (
      id, legal_entity_id, kind, status, customer_id, sales_order_id, channel, from_location_id,
      to_location_id, ship_to, incoterm, is_valued, notes, created_by, created_at, updated_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${entityId} AS UUID), ${kind}, 'draft',
      CASE WHEN ${resolvedCustomer} IS NULL THEN NULL ELSE CAST(${resolvedCustomer} AS UUID) END,
      CASE WHEN ${orderId} IS NULL THEN NULL ELSE CAST(${orderId} AS UUID) END,
      ${resolvedChannel}, CAST(${fromId} AS UUID),
      CASE WHEN ${toId} IS NULL THEN NULL ELSE CAST(${toId} AS UUID) END,
      ${body.ship_to && typeof body.ship_to === 'object' ? sql.json(body.ship_to) : null},
      ${incoterm}, ${valued}, ${notes}, ${actor.id}, ${now}, ${now}
    )
  `);
  const stored = await insertLines(tx, id, parsed, orderId);
  tx.audit({ table: 'sales.delivery_note', rowId: id, action: 'INSERT', before: null, after: { kind, legal_entity_id: entityId, from_location_id: fromId } });
  return presentNote({
    id,
    number: null,
    kind,
    status: 'draft',
    invoicing_status: 'not_invoiced',
    legal_entity_id: entityId,
    customer_id: resolvedCustomer,
    sales_order_id: orderId,
    channel: resolvedChannel,
    issue_date: null,
    from_location_id: fromId,
    to_location_id: toId,
    ship_to: body.ship_to && typeof body.ship_to === 'object' ? body.ship_to : null,
    incoterm,
    is_valued: valued,
    tracking_ref: null,
    shipped_at: null,
    delivered_at: null,
    cancelled_reason: null,
    notes,
  }, stored);
}

export async function createReturn(tx: Tx, actor: Actor, sourceId: string, raw: unknown): Promise<Record<string, unknown>> {
  const body = asRecord(raw);
  const toId = typeof body.to_location_id === 'string' ? body.to_location_id.trim().toLowerCase() : '';
  if (!UUID_RE.test(toId)) fail('La ubicación de destino es obligatoria', { to_location_id: 'Obligatorio' });
  const source = await loadNote(tx, sourceId);
  if (!['issued', 'shipped', 'delivered'].includes(String(source.status))) {
    fail('Solo se devuelve un albarán emitido', { status: String(source.status) });
  }
  const sourceLines = await loadLines(tx, sourceId);
  const requested = parseReturnLines(body.lines);
  const link: Record<string, string> = {};
  const newLines: ParsedLine[] = [];
  for (const item of requested) {
    const sourceLine = sourceLines.find((line) => line.id === item.lineId);
    if (!sourceLine) fail('La línea no pertenece al albarán', { line_id: item.lineId });
    const already = await returnedQty(tx, sourceId, item.lineId);
    const left = decOf(sourceLine.quantity).minus(already);
    if (item.quantity.gt(left)) fail('La cantidad devuelta supera lo entregado', { quantity: qtyText(item.quantity) });
    const id = newRowId();
    link[id] = sourceLine.id;
    newLines.push({
      id,
      orderLineId: null,
      productId: sourceLine.product_id,
      lotId: sourceLine.lot_id,
      description: sourceLine.description,
      quantity: item.quantity,
      unitPrice: sourceLine.unit_price == null ? null : decOf(sourceLine.unit_price),
      discountPct: decOf(sourceLine.discount_pct),
      taxCode: sourceLine.tax_code,
    });
  }
  let fromId = idOf(source.from_location_id);
  if (fromId === toId) {
    const virtual = await tx.read<{ id: unknown }>(sql`
      SELECT id FROM inventory.location WHERE kind = 'customer_virtual' AND is_active LIMIT 1
    `);
    if (!virtual[0]) fail('Falta una ubicación virtual de cliente para la devolución');
    fromId = idOf(virtual[0].id);
  }
  const notes = JSON.stringify({
    source_delivery_note_id: sourceId,
    user_notes: optionalText(body.notes, 'notes', {}, 2000),
    lines: link,
  });
  return createDeliveryNote(tx, actor, {
    kind: 'return',
    customer_id: idOrNull(source.customer_id),
    sales_order_id: null,
    legal_entity_id: idOf(source.legal_entity_id),
    channel: textOf(source.channel),
    from_location_id: fromId,
    to_location_id: toId,
    notes,
    lines: newLines.map((line) => ({
      id: line.id,
      product_id: line.productId,
      lot_id: line.lotId,
      description: line.description,
      quantity: qtyText(line.quantity),
      unit_price: line.unitPrice ? priceText(line.unitPrice) : null,
      discount_pct: line.discountPct.toFixed(2),
      tax_code: line.taxCode,
    })),
  });
}

export async function patchDelivery(tx: Tx, id: string, raw: unknown): Promise<Record<string, unknown>> {
  const note = await loadNote(tx, id);
  if (String(note.status) !== 'draft') throw domainError('WC060');
  const body = asRecord(raw);
  if (body.lines != null) {
    const parsed = parseDeliveryLines(body.lines);
    const previous = await loadLines(tx, id);
    tx.write(sql`DELETE FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID)`);
    for (const line of previous) {
      tx.audit({ table: 'sales.delivery_note_line', rowId: line.id, action: 'DELETE', before: line, after: null });
    }
    const stored = await insertLines(tx, id, parsed, idOrNull(note.sales_order_id));
    return presentNote(note, stored);
  }
  return presentNote(note, await loadLines(tx, id));
}

export async function markNotInvoiceable(tx: Tx, id: string, reason: string): Promise<Record<string, unknown>> {
  if (reason.trim().length < 3) fail('El motivo es obligatorio', { reason: 'Obligatorio' });
  const note = await loadNote(tx, id);
  if (!['issued', 'shipped', 'delivered'].includes(String(note.status))) fail('El albarán no está emitido');
  const now = new Date();
  const notes = textOf(note.notes) ? `${textOf(note.notes)}\nSin facturar: ${reason.trim()}` : `Sin facturar: ${reason.trim()}`;
  tx.write(sql`
    UPDATE sales.delivery_note
    SET invoicing_status = 'not_invoiceable', notes = ${notes}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({ table: 'sales.delivery_note', rowId: id, action: 'UPDATE', before: { invoicing_status: String(note.invoicing_status) }, after: { invoicing_status: 'not_invoiceable', reason: reason.trim() } });
  return presentNote({ ...note, invoicing_status: 'not_invoiceable', notes }, await loadLines(tx, id));
}

export async function getDelivery(writer: Writer, id: string): Promise<Record<string, unknown>> {
  return noteView(writer, pathId(id));
}

export async function listDeliveries(writer: Writer, request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const limit = clamp(url.searchParams.get('limit'));
  const kind = url.searchParams.get('kind');
  const status = url.searchParams.get('status');
  const invoiced = url.searchParams.get('invoiced');
  const cursor = url.searchParams.get('cursor');
  const customer = url.searchParams.get('customer_id');
  const entity = await entityFilter(writer, url.searchParams.get('entity'));
  const filters = ['TRUE'];
  if (entity) filters.push(`legal_entity_id = CAST(${sql`${entity}`} AS UUID)`);
  if (customer && UUID_RE.test(customer)) filters.push(`customer_id = CAST(${sql`${customer}`} AS UUID)`);
  if (kind) filters.push(`kind = ${sql`${kind}`}`);
  if (status) filters.push(`status = ${sql`${status}`}`);
  if (invoiced === 'true') filters.push(`invoicing_status = 'invoiced'`);
  if (invoiced === 'false') filters.push(`invoicing_status IN ('not_invoiced', 'partially_invoiced')`);
  if (invoiced === 'not_invoiceable') filters.push(`invoicing_status = 'not_invoiceable'`);
  if (cursor && UUID_RE.test(cursor)) filters.push(`id < CAST(${sql`${cursor}`} AS UUID)`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT id FROM sales.delivery_note WHERE ${filters.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}
  `);
  const page = rows.length > limit ? rows.slice(0, limit) : rows;
  const items = [];
  for (const row of page) items.push(await noteView(writer, idOf(row.id)));
  const last = page[page.length - 1];
  return { items, next_cursor: rows.length > limit && last ? idOf(last.id) : null };
}

export async function uninvoicedLines(writer: Writer): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT l.id AS line_id, l.delivery_note_id, n.number, n.kind, n.status, n.legal_entity_id,
           n.customer_id, n.issue_date, n.invoicing_status, l.line_no, l.product_id, l.lot_id,
           l.description, l.quantity, l.unit_price, l.tax_code, l.order_line_id,
           COALESCE((
             SELECT sum(il.quantity) FROM billing.invoice_line il
             JOIN billing.invoice i ON i.id = il.invoice_id
             WHERE il.delivery_note_line_id = l.id AND i.status = 'issued'
           ), 0) AS invoiced_quantity
    FROM sales.delivery_note_line l
    JOIN sales.delivery_note n ON n.id = l.delivery_note_id
    WHERE n.status IN ('issued', 'shipped', 'delivered')
      AND n.invoicing_status <> 'not_invoiceable'
      AND n.kind IN ('sale', 'consignment', 'sample')
    ORDER BY n.issue_date, n.number, l.line_no
  `);
  const items = rows.flatMap((row) => {
    const quantity = decOf(row.quantity);
    const invoiced = decOf(row.invoiced_quantity);
    const remaining = quantity.minus(invoiced);
    if (remaining.lte(0)) return [];
    return [{
      line_id: idOf(row.line_id),
      delivery_note_id: idOf(row.delivery_note_id),
      number: textOf(row.number),
      kind: String(row.kind),
      status: String(row.status),
      legal_entity_id: idOf(row.legal_entity_id),
      customer_id: idOrNull(row.customer_id),
      issue_date: row.issue_date == null ? null : dateOf(row.issue_date),
      invoicing_status: String(row.invoicing_status),
      line_no: Number(row.line_no),
      product_id: idOf(row.product_id),
      lot_id: idOrNull(row.lot_id),
      description: String(row.description),
      quantity: quantity.toFixed(3),
      invoiced_quantity: invoiced.toFixed(3),
      remaining_quantity: remaining.toFixed(3),
      unit_price: row.unit_price == null ? null : priceText(decOf(row.unit_price)),
      tax_code: textOf(row.tax_code),
      order_line_id: idOrNull(row.order_line_id),
    }];
  });
  return { items, total: items.length };
}

async function planMoves(tx: Tx, note: Record<string, unknown>, lines: NoteLine[], occurredAt: string, actorId: string): Promise<StockMove[]> {
  const kind = String(note.kind);
  const fromId = idOf(note.from_location_id);
  const toId = idOrNull(note.to_location_id);
  const seller = idOf(note.legal_entity_id);
  const planned: StockMove[] = [];
  for (const line of lines) {
    const product = await loadProduct(tx, line.product_id);
    if (!product.is_active) fail('El producto no está activo', { product_id: line.product_id });
    if (product.requires_lot && !line.lot_id) {
      throw new DomainError('WC_VALIDATION', 422, `Indica el lote de la línea ${line.line_no}`, {
        [`lines.${line.line_no}.lot_id`]: `Indica el lote de la línea ${line.line_no}`,
      });
    }
    if (line.lot_id) await assertLot(tx, line.lot_id, product);
    if (!product.is_stock_tracked) continue;
    const state = stateOf(product);
    if (!state) continue;
    const units = unitsOf(decOf(line.quantity));
    const nominal = product.nominal_volume_ml;
    const absVolume = signedVolume(units, nominal, state);
    if (kind === 'return') {
      if (!toId) fail('La devolución necesita destino');
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'return_in', location_id: toId, owner_entity_id: seller, product_state: state,
        qty_units: units, volume_ml: absVolume,
      })));
      continue;
    }
    const owner = await chooseOwner(tx, { kind, seller, fromId, lotId: line.lot_id, productId: line.product_id, state, units });
    if (owner.transferOwnership) {
      const codes = await entityByCode(tx);
      const buyer = codes.get('CVPO');
      if (!buyer) fail('No existe la entidad CVPO');
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'ownership_out', location_id: fromId, owner_entity_id: owner.ownerId, product_state: state,
        qty_units: -units, volume_ml: -absVolume,
      })));
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'ownership_in', location_id: fromId, owner_entity_id: buyer, product_state: state,
        qty_units: units, volume_ml: absVolume,
      })));
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'delivery_out', location_id: fromId, owner_entity_id: buyer, product_state: state,
        qty_units: -units, volume_ml: -absVolume,
      })));
    } else {
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'delivery_out', location_id: fromId, owner_entity_id: owner.ownerId, product_state: state,
        qty_units: -units, volume_ml: -absVolume,
      })));
    }
    if (kind === 'consignment' || kind === 'transfer') {
      if (!toId) fail('El traspaso necesita destino');
      const movedOwner = owner.transferOwnership ? (await entityByCode(tx)).get('CVPO') ?? owner.ownerId : owner.ownerId;
      planned.push(stockMove(idOf(note.id), occurredAt, actorId, draft(line, {
        move_type: 'transfer_in', location_id: toId, owner_entity_id: movedOwner, product_state: state,
        qty_units: units, volume_ml: absVolume,
      })));
    }
  }
  return planned;
}

function draft(line: NoteLine, partial: Omit<MoveDraft, 'lot_id' | 'product_id' | 'source_line_id'>): MoveDraft {
  return { ...partial, lot_id: line.lot_id, product_id: line.product_id, source_line_id: line.id };
}

async function chooseOwner(
  tx: Tx,
  input: { kind: string; seller: string; fromId: string; lotId: string | null; productId: string; state: string; units: number },
): Promise<{ ownerId: string; transferOwnership: boolean }> {
  const key = { locationId: input.fromId, ownerId: input.seller, lotId: input.lotId, productId: input.productId, state: input.state };
  if (await onHand(tx, key) >= input.units) return { ownerId: input.seller, transferOwnership: false };
  const codes = await entityByCode(tx);
  const po = codes.get('PO');
  const cvpo = codes.get('CVPO');
  if (input.kind === 'sale' && input.seller === cvpo && po) {
    const poKey = { ...key, ownerId: po };
    if (await onHand(tx, poKey) >= input.units) return { ownerId: po, transferOwnership: true };
  }
  if (input.kind !== 'sale' && input.kind !== 'sample' && po) {
    if (await onHand(tx, { ...key, ownerId: po }) >= input.units) return { ownerId: po, transferOwnership: false };
  }
  const lot = input.lotId ? await codeOf(tx, 'inventory.lot', input.lotId) : '—';
  const location = await codeOf(tx, 'inventory.location', input.fromId);
  throw new DomainError('WC024', 422, `No hay existencias suficientes del lote ${lot} en ${location}`, {
    lot_id: input.lotId ?? '',
    location_id: input.fromId,
  });
}

async function codeOf(tx: Tx, table: 'inventory.lot' | 'inventory.location', id: string): Promise<string> {
  const rows = await tx.read<{ code: string }>(sql`SELECT code FROM ${sql.raw(table)} WHERE id = CAST(${id} AS UUID)`);
  return rows[0] ? String(rows[0].code) : id.slice(0, 8);
}

type SettlementDraft = {
  lineId: string;
  productId: string;
  lotId: string | null;
  quantity: string;
  base: string;
  discount: string;
  unitPrice: string;
  unitCost: string | null;
  belowCost: boolean;
  occurredAt: string;
  sellerId: string;
  buyerId: string;
  tariffId: string | null;
};

async function planSettlements(
  tx: Tx,
  note: Record<string, unknown>,
  lines: NoteLine[],
  planned: StockMove[],
  issueDate: string,
  occurredAt: string,
): Promise<SettlementDraft[]> {
  const ownership = planned.filter((move) => move.move_type === 'ownership_out');
  if (ownership.length === 0) return [];
  const codes = await entityByCode(tx);
  const seller = codes.get('PO');
  const buyer = codes.get('CVPO');
  if (!seller || !buyer) throw domainError('WC_IC_NO_TARIFF');
  const tariffs = await tx.read<Record<string, unknown>>(sql`
    SELECT id, discount_pct, base_price_list_id
    FROM catalog.intercompany_tariff
    WHERE seller_entity_id = CAST(${seller} AS UUID)
      AND buyer_entity_id = CAST(${buyer} AS UUID)
      AND status = 'active'
      AND valid_from <= CAST(${issueDate} AS DATE)
      AND (valid_to IS NULL OR valid_to > CAST(${issueDate} AS DATE))
    ORDER BY valid_from DESC
    LIMIT 1
  `);
  const tariff = tariffs[0];
  if (!tariff) throw domainError('WC_IC_NO_TARIFF');
  const discount = decOf(tariff.discount_pct);
  const drafts: SettlementDraft[] = [];
  for (const move of ownership) {
    const line = lines.find((item) => item.id === move.source_line_id);
    if (!line) continue;
    let hit;
    try {
      hit = await quotePrice(tx, {
        productId: line.product_id,
        quantity: decOf(line.quantity),
        date: issueDate,
        priceListId: idOf(tariff.base_price_list_id),
        channel: 'intercompany',
      });
    } catch {
      throw domainError('WC_IC_NO_TARIFF');
    }
    const unitPrice = hit.unitPrice.mul(new Decimal(1).minus(discount.div(100))).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    const costs = await tx.read<{ unit_cost: unknown }>(sql`
      SELECT unit_cost FROM catalog.standard_cost
      WHERE product_id = CAST(${line.product_id} AS UUID) AND valid_from <= CAST(${issueDate} AS DATE)
      ORDER BY valid_from DESC LIMIT 1
    `);
    const unitCost = costs[0] ? decOf(costs[0].unit_cost) : null;
    drafts.push({
      lineId: line.id,
      productId: line.product_id,
      lotId: line.lot_id,
      quantity: decOf(line.quantity).toFixed(3),
      base: priceText(hit.unitPrice),
      discount: discount.toFixed(2),
      unitPrice: unitPrice.toFixed(6),
      unitCost: unitCost ? priceText(unitCost) : null,
      belowCost: unitCost ? unitPrice.lt(unitCost) : false,
      occurredAt,
      sellerId: seller,
      buyerId: buyer,
      tariffId: idOf(tariff.id),
    });
  }
  void note;
  return drafts;
}

function writeSettlement(tx: Tx, line: SettlementDraft): void {
  const bounds = monthBounds(line.occurredAt.slice(0, 10));
  const settlementId = newRowId();
  tx.write(sql`
    INSERT INTO billing.intercompany_settlement (
      id, seller_entity_id, buyer_entity_id, period_start, period_end, status, tariff_id
    )
    SELECT CAST(${settlementId} AS UUID), CAST(${line.sellerId} AS UUID), CAST(${line.buyerId} AS UUID),
           CAST(${bounds.start} AS DATE), CAST(${bounds.end} AS DATE), 'open',
           CASE WHEN ${line.tariffId} IS NULL THEN NULL ELSE CAST(${line.tariffId} AS UUID) END
    WHERE NOT EXISTS (
      SELECT 1 FROM billing.intercompany_settlement
      WHERE seller_entity_id = CAST(${line.sellerId} AS UUID)
        AND buyer_entity_id = CAST(${line.buyerId} AS UUID)
        AND period_start = CAST(${bounds.start} AS DATE)
        AND status = 'open'
    )
  `);
  const lineId = newRowId();
  tx.write(sql`
    INSERT INTO billing.intercompany_settlement_line (
      id, settlement_id, source_table, source_id, product_id, lot_id, quantity,
      base_unit_price, discount_pct, unit_price, unit_cost, below_cost, occurred_at
    )
    SELECT CAST(${lineId} AS UUID), s.id, 'sales.delivery_note_line', CAST(${line.lineId} AS UUID),
           CAST(${line.productId} AS UUID),
           CASE WHEN ${line.lotId} IS NULL THEN NULL ELSE CAST(${line.lotId} AS UUID) END,
           CAST(${line.quantity} AS DECIMAL(14,3)),
           CAST(${line.base} AS DECIMAL(14,6)), CAST(${line.discount} AS DECIMAL(5,2)),
           CAST(${line.unitPrice} AS DECIMAL(14,6)),
           CASE WHEN ${line.unitCost} IS NULL THEN NULL ELSE CAST(${line.unitCost} AS DECIMAL(14,6)) END,
           ${line.belowCost}, CAST(${line.occurredAt} AS TIMESTAMPTZ)
    FROM billing.intercompany_settlement s
    WHERE s.seller_entity_id = CAST(${line.sellerId} AS UUID)
      AND s.buyer_entity_id = CAST(${line.buyerId} AS UUID)
      AND s.period_start = CAST(${bounds.start} AS DATE)
      AND s.status = 'open'
    ORDER BY s.created_at
    LIMIT 1
  `);
  tx.audit({
    table: 'billing.intercompany_settlement_line',
    rowId: lineId,
    action: 'INSERT',
    before: null,
    after: { source_id: line.lineId, quantity: line.quantity, unit_price: line.unitPrice, below_cost: line.belowCost },
  });
}

function monthBounds(iso: string): { start: string; end: string } {
  const [yearText, monthText] = iso.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${yearText}-${mm}-01`, end: `${yearText}-${mm}-${String(last).padStart(2, '0')}` };
}

async function assertReturnAllowed(tx: Tx, note: Record<string, unknown>, lines: NoteLine[]): Promise<void> {
  if (String(note.kind) !== 'return') return;
  const toId = idOrNull(note.to_location_id);
  if (!toId) return;
  const to = await loadLocation(tx, toId);
  if (!to.tax_warehouse_id) return;
  const link = returnLink(textOf(note.notes));
  const sourceIds = link ? Object.values(link.lines) : lines.map((line) => line.id);
  for (const lineId of sourceIds) {
    if (await lineInvoiced(tx, lineId)) {
      throw new DomainError('WC_VALIDATION', 422, 'Una devolución con el impuesto devengado no puede entrar en la fábrica', {
        to_location_id: toId,
      });
    }
  }
}

async function lineInvoiced(tx: Tx, lineId: string): Promise<boolean> {
  const rows = await tx.read(sql`
    SELECT i.id FROM billing.invoice_line il
    JOIN billing.invoice i ON i.id = il.invoice_id
    WHERE il.delivery_note_line_id = CAST(${lineId} AS UUID) AND i.status = 'issued'
  `);
  return Boolean(rows[0]);
}

async function assertOrderRemaining(tx: Tx, noteId: string, lines: NoteLine[]): Promise<void> {
  for (const line of lines) {
    if (!line.order_line_id) continue;
    const ordered = await tx.read<{ quantity: unknown }>(sql`
      SELECT quantity FROM sales.sales_order_line WHERE id = CAST(${line.order_line_id} AS UUID)
    `);
    const orderQty = ordered[0] ? decOf(ordered[0].quantity) : null;
    if (!orderQty) fail('La línea de pedido no existe', { order_line_id: line.order_line_id });
    const used = await deliveredQty(tx, line.order_line_id, noteId);
    if (decOf(line.quantity).plus(used).gt(orderQty)) fail('La cantidad supera lo pendiente del pedido', { quantity: line.quantity });
  }
}

async function deliveredQty(tx: Tx, orderLineId: string, exceptNoteId: string): Promise<Decimal> {
  const rows = await tx.read<{ quantity: unknown }>(sql`
    SELECT coalesce(sum(l.quantity), 0) AS quantity
    FROM sales.delivery_note_line l
    JOIN sales.delivery_note n ON n.id = l.delivery_note_id
    WHERE l.order_line_id = CAST(${orderLineId} AS UUID)
      AND n.id <> CAST(${exceptNoteId} AS UUID)
      AND n.status IN ('issued', 'shipped', 'delivered')
  `);
  return rows[0] ? decOf(rows[0].quantity) : new Decimal(0);
}

export async function syncOrder(
  tx: Tx,
  orderId: string | null,
  pending?: { noteId: string; lines: NoteLine[]; effect: 'issue' | 'void' },
): Promise<void> {
  if (!orderId) return;
  const orders = await tx.read<Record<string, unknown>>(sql`SELECT id, status FROM sales.sales_order WHERE id = CAST(${orderId} AS UUID)`);
  const order = orders[0];
  if (!order) return;
  const status = String(order.status);
  if (!['confirmed', 'partially_delivered', 'delivered'].includes(status)) return;
  const lines = await tx.read<Record<string, unknown>>(sql`
    SELECT id, quantity FROM sales.sales_order_line WHERE order_id = CAST(${orderId} AS UUID)
  `);
  let any = false;
  let all = lines.length > 0;
  for (const line of lines) {
    let used = await deliveredQty(tx, idOf(line.id), '00000000-0000-0000-0000-000000000000');
    const extra = pending?.lines.filter((item) => item.order_line_id === idOf(line.id))
      .reduce((acc, item) => acc.plus(decOf(item.quantity)), new Decimal(0)) ?? new Decimal(0);
    if (pending?.effect === 'issue') used = used.plus(extra);
    if (pending?.effect === 'void') used = used.minus(extra);
    if (used.gt(0)) any = true;
    if (used.lt(decOf(line.quantity))) all = false;
  }
  const next = all ? 'delivered' : any ? 'partially_delivered' : 'confirmed';
  if (next === status) return;
  const now = new Date();
  tx.write(sql`UPDATE sales.sales_order SET status = ${next}, updated_at = ${now} WHERE id = CAST(${orderId} AS UUID)`);
  tx.audit({ table: 'sales.sales_order', rowId: orderId, action: 'UPDATE', before: { status }, after: { status: next } });
}

async function needsEad(tx: Tx, note: Record<string, unknown>): Promise<boolean> {
  const kind = String(note.kind);
  if (kind === 'transfer' || kind === 'consignment' || kind === 'return') return false;
  if (String(note.channel) === 'export') return true;
  const ship = jsonRecord(note.ship_to);
  const shipCountry = typeof ship.country_code === 'string' ? ship.country_code.toUpperCase() : null;
  if (shipCountry && shipCountry !== 'ES') return true;
  const customerId = idOrNull(note.customer_id);
  if (!customerId) return false;
  const customer = await loadCustomer(tx, customerId);
  return customer.country_code.toUpperCase() !== 'ES';
}

async function hasIssuedInvoice(tx: Tx, noteId: string): Promise<boolean> {
  const rows = await tx.read(sql`
    SELECT i.id FROM billing.invoice_line il
    JOIN billing.invoice i ON i.id = il.invoice_id
    JOIN sales.delivery_note_line l ON l.id = il.delivery_note_line_id
    WHERE l.delivery_note_id = CAST(${noteId} AS UUID) AND i.status = 'issued'
  `);
  return Boolean(rows[0]);
}

async function assertSettlementsOpen(tx: Tx, noteId: string): Promise<void> {
  const rows = await tx.read<{ status: string }>(sql`
    SELECT s.status
    FROM billing.intercompany_settlement_line l
    JOIN billing.intercompany_settlement s ON s.id = l.settlement_id
    JOIN sales.delivery_note_line d ON d.id = l.source_id
    WHERE d.delivery_note_id = CAST(${noteId} AS UUID)
  `);
  if (rows.some((row) => String(row.status) !== 'open')) {
    fail('La liquidación del periodo ya no está abierta');
  }
}

async function loadNoteMoves(tx: Tx, noteId: string): Promise<StockMove[]> {
  const { loadStockMoves } = await import('../inventory/service/rows');
  const where = `source_table = 'sales.delivery_note' AND source_id = CAST(${sql`${noteId}`} AS UUID) AND move_type <> 'reversal'`;
  const moves = await loadStockMoves(tx, where);
  return moves.sort((left, right) => {
    if (left.occurred_at !== right.occurred_at) return left.occurred_at < right.occurred_at ? 1 : -1;
    return (right.id ?? '').localeCompare(left.id ?? '');
  });
}

async function loadNote(db: Pick<Tx, 'read'>, id: string): Promise<Record<string, unknown>> {
  const rows = await db.read<Record<string, unknown>>(sql`SELECT * FROM sales.delivery_note WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function loadLines(db: Pick<Tx, 'read'>, id: string): Promise<NoteLine[]> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, line_no, order_line_id, product_id, lot_id, description, quantity, unit_price, discount_pct, tax_code
    FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID) ORDER BY line_no
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    line_no: Number(row.line_no),
    order_line_id: idOrNull(row.order_line_id),
    product_id: idOf(row.product_id),
    lot_id: idOrNull(row.lot_id),
    description: String(row.description),
    quantity: decOf(row.quantity).toFixed(3),
    unit_price: row.unit_price == null ? null : priceText(decOf(row.unit_price)),
    discount_pct: decOf(row.discount_pct).toFixed(2),
    tax_code: textOf(row.tax_code),
  }));
}

async function loadOrder(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const rows = await tx.read<Record<string, unknown>>(sql`SELECT * FROM sales.sales_order WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function noteView(db: Pick<Tx, 'read'>, id: string): Promise<Record<string, unknown>> {
  return presentNote(await loadNote(db, id), await loadLines(db, id));
}

function presentNote(note: Record<string, unknown>, lines: NoteLine[]): Record<string, unknown> {
  const link = returnLink(textOf(note.notes));
  return {
    id: idOf(note.id),
    number: textOf(note.number),
    kind: String(note.kind),
    status: String(note.status),
    invoicing_status: String(note.invoicing_status),
    legal_entity_id: idOf(note.legal_entity_id),
    customer_id: idOrNull(note.customer_id),
    sales_order_id: idOrNull(note.sales_order_id),
    channel: textOf(note.channel),
    issue_date: note.issue_date == null ? null : dateOf(note.issue_date),
    from_location_id: idOf(note.from_location_id),
    to_location_id: idOrNull(note.to_location_id),
    ship_to: note.ship_to ?? null,
    incoterm: textOf(note.incoterm),
    is_valued: boolOf(note.is_valued),
    tracking_ref: textOf(note.tracking_ref),
    shipped_at: note.shipped_at == null ? null : String(note.shipped_at),
    delivered_at: note.delivered_at == null ? null : String(note.delivered_at),
    cancelled_reason: textOf(note.cancelled_reason),
    source_delivery_note_id: link?.source_delivery_note_id ?? null,
    notes: link ? link.user_notes : textOf(note.notes),
    lines,
  };
}

type ParsedLine = {
  id?: string;
  orderLineId: string | null;
  productId: string;
  lotId: string | null;
  description: string | null;
  quantity: Decimal;
  unitPrice: Decimal | null;
  discountPct: Decimal;
  taxCode: string | null;
};

function parseDeliveryLines(raw: unknown): ParsedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('Hace falta al menos una línea', { lines: 'Obligatorio' });
  return raw.map((item, index) => {
    const fields: Record<string, string> = {};
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!row) fail('Línea no válida');
    const prefix = `lines.${index}`;
    const productId = row.product_id == null || row.product_id === '' ? null : bodyId(row.product_id, `${prefix}.product_id`, fields);
    const orderLineId = row.order_line_id == null || row.order_line_id === '' ? null : bodyId(row.order_line_id, `${prefix}.order_line_id`, fields);
    const lotId = row.lot_id == null || row.lot_id === '' ? null : bodyId(row.lot_id, `${prefix}.lot_id`, fields);
    const quantity = parseDecimal(row.quantity, `${prefix}.quantity`, fields, true);
    const unitPrice = row.unit_price == null || row.unit_price === '' ? null : parseDecimal(row.unit_price, `${prefix}.unit_price`, fields, true);
    const discount = row.discount_pct == null || row.discount_pct === '' ? new Decimal(0) : parseDecimal(row.discount_pct, `${prefix}.discount_pct`, fields, true);
    const description = optionalText(row.description, `${prefix}.description`, fields, 250);
    const taxCode = row.tax_code == null || row.tax_code === '' ? null : (typeof row.tax_code === 'string' ? row.tax_code : null);
    const id = typeof row.id === 'string' && UUID_RE.test(row.id) ? row.id.toLowerCase() : undefined;
    if (quantity && quantity.lte(0)) fields[`${prefix}.quantity`] = 'La cantidad debe ser mayor que cero';
    if (!productId && !orderLineId) fields[`${prefix}.product_id`] = 'El producto es obligatorio';
    throwIf(fields);
    if (!quantity || !discount) fail('Línea no válida');
    return { id, orderLineId, productId: productId ?? '', lotId, description, quantity, unitPrice, discountPct: discount, taxCode };
  });
}

async function insertLines(tx: Tx, noteId: string, lines: ParsedLine[], orderId: string | null): Promise<NoteLine[]> {
  const stored: NoteLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    let productId = line.productId;
    let description = line.description;
    let unitPrice = line.unitPrice;
    let discount = line.discountPct;
    let taxCode = line.taxCode;
    if (line.orderLineId) {
      const rows = await tx.read<Record<string, unknown>>(sql`
        SELECT product_id, description, unit_price, discount_pct, tax_code, order_id
        FROM sales.sales_order_line WHERE id = CAST(${line.orderLineId} AS UUID)
      `);
      const row = rows[0];
      if (!row) fail('La línea de pedido no existe', { order_line_id: line.orderLineId });
      if (orderId && idOf(row.order_id) !== orderId) fail('La línea no pertenece al pedido');
      productId = idOf(row.product_id);
      description = description ?? String(row.description);
      unitPrice = unitPrice ?? decOf(row.unit_price);
      discount = line.discountPct.eq(0) ? decOf(row.discount_pct) : line.discountPct;
      taxCode = taxCode ?? String(row.tax_code);
    }
    if (!productId) fail('El producto es obligatorio');
    const product = await loadProduct(tx, productId);
    description = description ?? product.name;
    const id = line.id ?? newRowId();
    tx.write(sql`
      INSERT INTO sales.delivery_note_line (
        id, delivery_note_id, line_no, order_line_id, product_id, lot_id, description,
        quantity, unit_price, discount_pct, tax_code
      ) VALUES (
        CAST(${id} AS UUID), CAST(${noteId} AS UUID), ${index + 1},
        CASE WHEN ${line.orderLineId} IS NULL THEN NULL ELSE CAST(${line.orderLineId} AS UUID) END,
        CAST(${productId} AS UUID),
        CASE WHEN ${line.lotId} IS NULL THEN NULL ELSE CAST(${line.lotId} AS UUID) END,
        ${description}, CAST(${qtyText(line.quantity)} AS DECIMAL(14,3)),
        CASE WHEN ${unitPrice == null ? null : priceText(unitPrice)} IS NULL THEN NULL
             ELSE CAST(${unitPrice == null ? '0' : priceText(unitPrice)} AS DECIMAL(14,6)) END,
        CAST(${discount.toFixed(2)} AS DECIMAL(5,2)), ${taxCode}
      )
    `);
    tx.audit({
      table: 'sales.delivery_note_line',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { delivery_note_id: noteId, line_no: index + 1, product_id: productId, lot_id: line.lotId, quantity: qtyText(line.quantity) },
    });
    stored.push({
      id,
      line_no: index + 1,
      order_line_id: line.orderLineId,
      product_id: productId,
      lot_id: line.lotId,
      description,
      quantity: qtyText(line.quantity),
      unit_price: unitPrice == null ? null : priceText(unitPrice),
      discount_pct: discount.toFixed(2),
      tax_code: taxCode,
    });
  }
  return stored;
}

async function assertLot(tx: Tx, lotId: string, product: ProductRow): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, wine_id, status FROM inventory.lot WHERE id = CAST(${lotId} AS UUID)
  `);
  const lot = rows[0];
  if (!lot) fail('El lote no existe', { lot_id: lotId });
  if (String(lot.status) === 'closed') fail('El lote está cerrado', { lot_id: lotId });
  const wineId = idOrNull(lot.wine_id);
  if (product.wine_id && wineId && wineId !== product.wine_id) fail('El lote no corresponde al vino', { lot_id: lotId });
}

function stateOf(product: ProductRow): ProductState | null {
  if (!product.is_stock_tracked) return null;
  if (product.kind === 'wine') return 'packaged_labeled';
  if (product.kind === 'bulk_wine') return 'wine';
  if (product.kind === 'service' || product.kind === 'gift_card') return null;
  return 'goods';
}

function unitsOf(quantity: Decimal): number {
  if (!quantity.isInteger()) fail('La cantidad de stock debe ser un número entero de unidades');
  const value = quantity.toNumber();
  if (!Number.isSafeInteger(value) || value <= 0) fail('La cantidad de stock debe ser un número entero de unidades');
  return value;
}

function signedVolume(units: number, nominal: number | null, state: ProductState): number {
  if (state === 'goods') return 0;
  if (nominal == null || nominal <= 0) fail('El formato no tiene volumen nominal');
  return units * nominal;
}

function parseReturnLines(raw: unknown): { lineId: string; quantity: Decimal }[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('Hace falta al menos una línea', { lines: 'Obligatorio' });
  return raw.map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!row) fail('Línea no válida');
    const lineId = typeof row.line_id === 'string' ? row.line_id.trim().toLowerCase() : '';
    if (!UUID_RE.test(lineId)) fail('La línea no es válida', { line_id: 'Identificador no válido' });
    const quantity = parseDecimal(row.quantity, 'quantity', {}, true);
    if (!quantity || quantity.lte(0)) fail('La cantidad debe ser mayor que cero', { quantity: 'Obligatorio' });
    return { lineId, quantity };
  });
}

async function returnedQty(tx: Tx, sourceId: string, lineId: string): Promise<Decimal> {
  const rows = await tx.read<{ notes: unknown; id: unknown; status: string }>(sql`
    SELECT id, notes, status FROM sales.delivery_note WHERE kind = 'return' AND status <> 'cancelled'
  `);
  let total = new Decimal(0);
  for (const row of rows) {
    const link = returnLink(textOf(row.notes));
    if (!link || link.source_delivery_note_id !== sourceId) continue;
    const match = Object.entries(link.lines).find(([, source]) => source === lineId);
    if (!match) continue;
    const [returnLineId] = match;
    const qty = await tx.read<{ quantity: unknown }>(sql`
      SELECT quantity FROM sales.delivery_note_line WHERE id = CAST(${returnLineId} AS UUID)
    `);
    if (qty[0] && ['issued', 'shipped', 'delivered', 'draft'].includes(String(row.status))) {
      total = total.plus(decOf(qty[0].quantity));
    }
  }
  return total;
}

type ReturnLink = { source_delivery_note_id: string; user_notes: string | null; lines: Record<string, string> };

function returnLink(notes: string | null): ReturnLink | null {
  if (!notes || !notes.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(notes) as Partial<ReturnLink>;
    if (!parsed || typeof parsed.source_delivery_note_id !== 'string' || !parsed.lines) return null;
    return {
      source_delivery_note_id: parsed.source_delivery_note_id,
      user_notes: parsed.user_notes ?? null,
      lines: parsed.lines,
    };
  } catch {
    return null;
  }
}

function bodyId(value: unknown, field: string, fields: Record<string, string>): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    fields[field] = 'Identificador no válido';
    return null;
  }
  return value.trim().toLowerCase();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

async function entityFilter(writer: Writer, raw: string | null): Promise<string | null> {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (UUID_RE.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z][A-Za-z0-9_]{1,15}$/.test(value)) {
    throw domainError('WC_VALIDATION', { entity: 'Entidad no válida' });
  }
  const rows = await writer.read<{ id: unknown }>(sql`
    SELECT id FROM core.legal_entity WHERE code = ${value.toUpperCase()}
  `);
  const id = rows[0]?.id;
  if (!id) throw domainError('WC_VALIDATION', { entity: 'La entidad no existe' });
  return idOf(id);
}

function clamp(value: string | null): number {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

export function deliveryPathId(id: string): string {
  return pathId(id);
}

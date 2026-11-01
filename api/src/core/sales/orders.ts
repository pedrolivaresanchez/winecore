import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { businessDate } from '../time';
import {
  asRecord,
  assertActiveEntity,
  assertChannel,
  assertEntity,
  assignNumber,
  dateOf,
  decOf,
  fail,
  hashBody,
  idOf,
  idOrNull,
  loadCustomer,
  loadProduct,
  newRowId,
  optionalId,
  optionalText,
  parseDate,
  parseIncoterm,
  pathId,
  priceText,
  qtyText,
  outbox,
  taxRateOf,
  textOf,
  throwIf,
  UUID_RE,
} from './db';
import { parseCustomerReferences } from '../pdf/ship-to';
import { parseCommercialLines, resolveLinePrice, type CommercialLineInput } from './pricing';
import { draftEntity, resolutionJson, resolveIssuingEntity } from './rules';
import { priceTotals, type PricedLine } from './totals';

const SOURCES = new Set(['manual', 'edi', 'web', 'mcp', 'import']);
const ROUTE = 'POST /v1/sales-orders';

type OrderLine = {
  id: string;
  line_no: number;
  product_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  tax_code: string;
  external_line_ref: string | null;
  unit: string | null;
};

type Idem = { principal: string; key: string; hash: string };

export async function createSalesOrder(
  tx: Tx,
  actor: Actor,
  raw: unknown,
  idempotency?: Idem | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (idempotency) {
    const prior = await tx.read<{ request_sha256: string; status_code: unknown; response: unknown }>(sql`
      SELECT request_sha256, status_code, response
      FROM ops.idempotency_key
      WHERE principal = ${idempotency.principal} AND key = ${idempotency.key}
    `);
    const stored = prior[0];
    if (stored) {
      if (stored.request_sha256 !== idempotency.hash) throw domainError('WC_IDEMPOTENCY_MISMATCH');
      return { status: Number(stored.status_code), body: jsonValue(stored.response) as Record<string, unknown> };
    }
  }
  const input = await parseOrderBody(tx, raw, true);
  const id = newRowId();
  const now = new Date();
  const customer = await loadCustomer(tx, input.customerId);
  if (!customer.is_customer) fail('El contacto no es cliente', { customer_id: input.customerId });
  await assertChannel(tx, input.channel);
  const trace = await chosenEntityTrace(tx, actor, input, now);
  if (input.externalRef) {
    const dup = await tx.read(sql`
      SELECT id FROM sales.sales_order
      WHERE source = ${input.source} AND external_ref = ${input.externalRef}
    `);
    if (dup[0]) fail('La referencia externa ya existe en este origen', { external_ref: input.externalRef });
  }
  const priced = await priceOrderLines(tx, input.lines, input.orderDate, customer.default_price_list_id, input.channel);
  const totals = priceTotals(priced.totals);
  tx.write(sql`
    INSERT INTO sales.sales_order (
      id, status, invoicing_status, source, channel, customer_id, customer_order_ref,
      customer_department, customer_cost_center, external_ref, order_date, requested_date,
      ship_to, incoterm, quote_id, billing_rule_trace, currency, notes, customer_references,
      subtotal, tax_total, total, created_by, created_at, updated_at
    ) VALUES (
      CAST(${id} AS UUID), 'draft', 'not_invoiced', ${input.source}, ${input.channel},
      CAST(${input.customerId} AS UUID), ${input.customerOrderRef}, ${input.department},
      ${input.costCenter}, ${input.externalRef}, CAST(${input.orderDate} AS DATE),
      CASE WHEN ${input.requestedDate} IS NULL THEN NULL ELSE CAST(${input.requestedDate} AS DATE) END,
      ${input.shipTo ? sql.json(input.shipTo) : null}, ${input.incoterm},
      CASE WHEN ${input.quoteId} IS NULL THEN NULL ELSE CAST(${input.quoteId} AS UUID) END,
      ${trace ? sql.json(trace) : null}, 'EUR', ${input.notes}, ${input.customerReferences},
      CAST(${totals.subtotal} AS DECIMAL(14,2)), CAST(${totals.tax_total} AS DECIMAL(14,2)),
      CAST(${totals.total} AS DECIMAL(14,2)), ${actor.id}, ${now}, ${now}
    )
  `);
  const lines = insertOrderLines(tx, id, priced.rows);
  tx.audit({
    table: 'sales.sales_order',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      customer_id: input.customerId,
      channel: input.channel,
      source: input.source,
      total: totals.total,
      ...(trace ? { exception: trace.exception } : {}),
    },
  });
  const body = await presentOrder(tx, {
    id,
    number: null,
    status: 'draft',
    invoicing_status: 'not_invoiced',
    legal_entity_id: null,
    source: input.source,
    channel: input.channel,
    customer_id: input.customerId,
    customer_order_ref: input.customerOrderRef,
    customer_department: input.department,
    customer_cost_center: input.costCenter,
    external_ref: input.externalRef,
    order_date: input.orderDate,
    requested_date: input.requestedDate,
    ship_to: input.shipTo,
    incoterm: input.incoterm,
    quote_id: input.quoteId,
    billing_rule_set_id: null,
    billing_rule_id: null,
    billing_rule_trace: trace,
    currency: 'EUR',
    notes: input.notes,
    customer_references: input.customerReferences,
    subtotal: totals.subtotal,
    tax_total: totals.tax_total,
    total: totals.total,
  }, lines, true);
  if (idempotency) {
    tx.write(sql`
      INSERT INTO ops.idempotency_key (key, principal, route, request_sha256, status_code, response, created_at)
      VALUES (${idempotency.key}, ${idempotency.principal}, ${ROUTE}, ${idempotency.hash}, 201, ${sql.json(body)}, ${now})
    `);
  }
  return { status: 201, body };
}

export async function patchSalesOrder(tx: Tx, id: string, raw: unknown): Promise<Record<string, unknown>> {
  const order = await loadOrder(tx, id);
  assertDraft(order);
  const input = await parseOrderBody(tx, raw, false);
  const customer = await loadCustomer(tx, input.customerId);
  if (!customer.is_customer) fail('El contacto no es cliente', { customer_id: input.customerId });
  await assertChannel(tx, input.channel);
  const priced = await priceOrderLines(tx, input.lines, input.orderDate, customer.default_price_list_id, input.channel);
  const totals = priceTotals(priced.totals);
  const now = new Date();
  const previous = await loadLines(tx, id);
  if (previous.length !== priced.rows.length) {
    fail('No se pueden añadir o quitar líneas; cancela el pedido y crea otro', { lines: String(priced.rows.length) });
  }
  const lines = updateOrderLines(tx, previous, priced.rows);
  const sets = [
    sql`customer_order_ref = ${input.customerOrderRef}`,
    sql`customer_department = ${input.department}`,
    sql`customer_cost_center = ${input.costCenter}`,
    sql`external_ref = ${input.externalRef}`,
    sql`order_date = CAST(${input.orderDate} AS DATE)`,
    sql`requested_date = CASE WHEN ${input.requestedDate} IS NULL THEN NULL ELSE CAST(${input.requestedDate} AS DATE) END`,
    sql`ship_to = ${input.shipTo ? sql.json(input.shipTo) : null}`,
    sql`incoterm = ${input.incoterm}`,
    sql`notes = ${input.notes}`,
    sql`customer_references = ${input.customerReferences}`,
    sql`subtotal = CAST(${totals.subtotal} AS DECIMAL(14,2))`,
    sql`tax_total = CAST(${totals.tax_total} AS DECIMAL(14,2))`,
    sql`total = CAST(${totals.total} AS DECIMAL(14,2))`,
    sql`updated_at = ${now}`,
  ];
  if (input.customerId !== idOf(order.customer_id)) {
    sets.push(sql`customer_id = CAST(${input.customerId} AS UUID)`);
  }
  if (input.channel !== String(order.channel)) {
    sets.push(sql`channel = ${input.channel}`);
  }
  tx.write(`UPDATE sales.sales_order SET ${sets.join(', ')} WHERE id = CAST(${sql`${id}`} AS UUID) AND status = 'draft'`);
  tx.audit({ table: 'sales.sales_order', rowId: id, action: 'UPDATE', before: { status: 'draft' }, after: { total: totals.total, channel: input.channel } });
  return presentOrder(tx, {
    ...order,
    channel: input.channel,
    customer_id: input.customerId,
    customer_order_ref: input.customerOrderRef,
    customer_department: input.department,
    customer_cost_center: input.costCenter,
    external_ref: input.externalRef,
    order_date: input.orderDate,
    requested_date: input.requestedDate,
    ship_to: input.shipTo,
    incoterm: input.incoterm,
    notes: input.notes,
    customer_references: input.customerReferences,
    subtotal: totals.subtotal,
    tax_total: totals.tax_total,
    total: totals.total,
  }, lines, true);
}

export async function confirmSalesOrder(tx: Tx, actor: Actor, id: string): Promise<Record<string, unknown>> {
  const order = await loadOrder(tx, id);
  assertDraft(order);
  const lines = await loadLines(tx, id);
  if (lines.length === 0) fail('El pedido no tiene líneas');
  const channel = String(order.channel);
  const customerId = idOf(order.customer_id);
  if (channel === 'eci_edi') {
    if (!textOf(order.customer_department) || !textOf(order.customer_cost_center)) {
      fail('El pedido de El Corte Inglés necesita departamento y centro de coste');
    }
    for (const line of lines) {
      const product = await loadProduct(tx, line.product_id);
      if (!product.gtin) fail(`Producto no identificado en la línea ${line.line_no}`, { [`lines.${line.line_no}`]: 'Producto no identificado' });
    }
  }
  const ship = jsonOf(order.ship_to);
  const country = typeof ship.country_code === 'string' ? ship.country_code.toUpperCase() : null;
  if (country && country !== 'ES' && !textOf(order.incoterm)) {
    fail('El Incoterm es obligatorio fuera de España', { incoterm: 'Obligatorio' });
  }
  const trace = jsonOf(order.billing_rule_trace);
  const exception = trace.exception;
  const override = overrideOf(exception);
  if (override) await assertEntity(tx, override);
  const resolved = await resolveIssuingEntity(tx, {
    customerId,
    channel,
    bootstrap: { actorId: actor.id, entityId: override },
  });
  const entityId = override ?? resolved.entityId;
  const now = new Date();
  const taken = await assignNumber(tx, entityId, 'sales_order', now);
  const fullTrace = { ...resolved.trace, exception: exception ?? null };
  tx.write(sql`
    UPDATE sales.sales_order SET
      status = 'confirmed',
      legal_entity_id = CAST(${entityId} AS UUID),
      series_id = CAST(${taken.seriesId} AS UUID),
      number = ${taken.number},
      billing_rule_set_id = CAST(${resolved.ruleSetId} AS UUID),
      billing_rule_id = CAST(${resolved.ruleId} AS UUID),
      billing_rule_trace = ${sql.json(fullTrace)},
      updated_at = ${now}
    WHERE id = CAST(${id} AS UUID) AND status = 'draft'
  `);
  outbox(tx, 'sales.order.confirmed', 'sales.sales_order', id, entityId, {
    order_id: id,
    number: taken.number,
    legal_entity_id: entityId,
    rule_id: resolved.ruleId,
    matched_scope: resolved.matchedScope,
  });
  tx.audit({
    table: 'sales.sales_order',
    rowId: id,
    action: 'UPDATE',
    before: { status: 'draft' },
    after: { status: 'confirmed', number: taken.number, legal_entity_id: entityId, billing_rule_id: resolved.ruleId },
  });
  return presentOrder(tx, {
    ...order,
    status: 'confirmed',
    legal_entity_id: entityId,
    series_id: taken.seriesId,
    number: taken.number,
    billing_rule_set_id: resolved.ruleSetId,
    billing_rule_id: resolved.ruleId,
    billing_rule_trace: fullTrace,
  }, lines, false);
}

export async function cancelSalesOrder(tx: Tx, actor: Actor, id: string, reason: string): Promise<Record<string, unknown>> {
  if (reason.trim().length < 3) fail('El motivo es obligatorio', { reason: 'Obligatorio' });
  const order = await loadOrder(tx, id);
  const status = String(order.status);
  if (status !== 'draft' && status !== 'confirmed') fail('El pedido no se puede cancelar', { status });
  const issued = await tx.read(sql`
    SELECT id FROM sales.delivery_note
    WHERE sales_order_id = CAST(${id} AS UUID) AND status IN ('issued', 'shipped', 'delivered')
  `);
  if (issued[0]) fail('Hay albaranes emitidos; no se puede cancelar el pedido');
  const now = new Date();
  const notes = appendNote(textOf(order.notes), `Cancelado: ${reason.trim()}`);
  let next: Record<string, unknown> = { ...order, status: 'cancelled', notes };
  if (status === 'draft') {
    const exception = jsonOf(order.billing_rule_trace).exception;
    const override = overrideOf(exception);
    if (override) await assertEntity(tx, override);
    const resolved = await resolveIssuingEntity(tx, {
      customerId: idOf(order.customer_id),
      channel: String(order.channel),
      bootstrap: { actorId: actor.id, entityId: override },
    });
    const entityId = override ?? resolved.entityId;
    const taken = await assignNumber(tx, entityId, 'sales_order', now);
    const trace = { ...resolved.trace, exception: exception ?? null };
    next = {
      ...next,
      number: taken.number,
      series_id: taken.seriesId,
      legal_entity_id: entityId,
      billing_rule_set_id: resolved.ruleSetId,
      billing_rule_id: resolved.ruleId,
      billing_rule_trace: trace,
    };
    tx.write(sql`
      UPDATE sales.sales_order SET
        status = 'cancelled', number = ${taken.number}, series_id = CAST(${taken.seriesId} AS UUID),
        legal_entity_id = CAST(${entityId} AS UUID),
        billing_rule_set_id = CAST(${resolved.ruleSetId} AS UUID),
        billing_rule_id = CAST(${resolved.ruleId} AS UUID),
        billing_rule_trace = ${sql.json(trace)},
        notes = ${notes}, updated_at = ${now}
      WHERE id = CAST(${id} AS UUID)
    `);
  } else {
    tx.write(sql`
      UPDATE sales.sales_order SET status = 'cancelled', notes = ${notes}, updated_at = ${now}
      WHERE id = CAST(${id} AS UUID)
    `);
  }
  tx.audit({
    table: 'sales.sales_order',
    rowId: id,
    action: 'UPDATE',
    before: { status },
    after: { status: 'cancelled', reason: reason.trim() },
  });
  return presentOrder(tx, next, await loadLines(tx, id), false);
}

export async function closeSalesOrder(tx: Tx, id: string, reason: string): Promise<Record<string, unknown>> {
  if (reason.trim().length < 3) fail('El motivo es obligatorio', { reason: 'Obligatorio' });
  const order = await loadOrder(tx, id);
  if (String(order.status) !== 'partially_delivered') fail('Solo se cierra un pedido parcialmente servido', { status: String(order.status) });
  const notes = appendNote(textOf(order.notes), `Cierre del resto: ${reason.trim()}`);
  const now = new Date();
  tx.write(sql`
    UPDATE sales.sales_order SET status = 'closed', notes = ${notes}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({ table: 'sales.sales_order', rowId: id, action: 'UPDATE', before: { status: 'partially_delivered' }, after: { status: 'closed', reason: reason.trim() } });
  return presentOrder(tx, { ...order, status: 'closed', notes }, await loadLines(tx, id), false);
}

function overrideOf(exception: unknown): string | null {
  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) return null;
  const override = (exception as { legal_entity_id?: unknown }).legal_entity_id;
  return typeof override === 'string' ? override : null;
}

/** Entidad elegida al crear: si no es la de las reglas, queda como la excepción de `setEntityException`. */
async function chosenEntityTrace(
  tx: Tx,
  actor: Actor,
  input: OrderInput,
  now: Date,
): Promise<{ exception: Record<string, unknown> } | null> {
  if (!input.legalEntityId) return null;
  await assertActiveEntity(tx, input.legalEntityId);
  const { rule } = await draftEntity(tx, {
    customerId: input.customerId,
    channel: input.channel,
    actorId: actor.id,
    entityId: input.legalEntityId,
  });
  if (rule?.entityId === input.legalEntityId) return null;
  const chosen = rule ? 'Entidad elegida al crear el pedido' : 'Entidad elegida a mano sin reglas activas';
  return {
    exception: {
      legal_entity_id: input.legalEntityId,
      reason: input.quoteId ? 'Entidad del presupuesto' : chosen,
      at: now.toISOString(),
      by: actor.id,
    },
  };
}

export async function setEntityException(tx: Tx, actor: Actor, id: string, entityId: string, reason: string): Promise<Record<string, unknown>> {
  if (reason.trim().length < 5) fail('El motivo de la excepción es obligatorio', { reason: 'Obligatorio' });
  const order = await loadOrder(tx, id);
  assertDraft(order);
  await assertEntity(tx, entityId);
  const trace = jsonOf(order.billing_rule_trace);
  const next = { ...trace, exception: { legal_entity_id: entityId, reason: reason.trim(), at: new Date().toISOString(), by: actor.id } };
  const now = new Date();
  tx.write(sql`
    UPDATE sales.sales_order
    SET billing_rule_trace = ${sql.json(next)}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID) AND status = 'draft'
  `);
  tx.audit({
    table: 'sales.sales_order',
    rowId: id,
    action: 'UPDATE',
    before: { billing_rule_trace: trace },
    after: { exception: next.exception },
  });
  return presentOrder(tx, { ...order, billing_rule_trace: next }, await loadLines(tx, id), true);
}

export async function getSalesOrder(writer: Writer, id: string): Promise<Record<string, unknown>> {
  return orderView(writer, pathId(id));
}

export async function listSalesOrders(writer: Writer, request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get('limit'));
  const status = url.searchParams.get('status');
  const entity = url.searchParams.get('entity');
  const channel = url.searchParams.get('channel');
  const cursor = url.searchParams.get('cursor');
  const customer = url.searchParams.get('customer_id');
  const filters = ['TRUE'];
  if (status) filters.push(`status = ${sql`${status}`}`);
  if (entity && UUID_RE.test(entity)) filters.push(`legal_entity_id = CAST(${sql`${entity}`} AS UUID)`);
  if (customer && UUID_RE.test(customer)) filters.push(`customer_id = CAST(${sql`${customer}`} AS UUID)`);
  if (channel) filters.push(`channel = ${sql`${channel}`}`);
  if (cursor) filters.push(`id < CAST(${sql`${cursor}`} AS UUID)`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT * FROM sales.sales_order
    WHERE ${filters.join(' AND ')}
    ORDER BY id DESC
    LIMIT ${limit + 1}
  `);
  const page = rows.length > limit ? rows.slice(0, limit) : rows;
  const items = [];
  for (const row of page) items.push(await orderView(writer, idOf(row.id), false));
  const last = page[page.length - 1];
  return { items, next_cursor: rows.length > limit && last ? idOf(last.id) : null };
}

export async function orderView(db: Pick<Tx, 'read'>, id: string, withPreview = true): Promise<Record<string, unknown>> {
  return presentOrder(db, await loadOrder(db, id), await loadLines(db, id), withPreview);
}

async function presentOrder(
  db: Pick<Tx, 'read'>,
  order: Record<string, unknown>,
  lines: OrderLine[],
  withPreview: boolean,
): Promise<Record<string, unknown>> {
  const entityId = idOrNull(order.legal_entity_id);
  let entityCode: string | null = null;
  if (entityId) {
    const codes = await db.read<{ code: string }>(sql`SELECT code FROM core.legal_entity WHERE id = CAST(${entityId} AS UUID)`);
    entityCode = codes[0] ? String(codes[0].code) : null;
  }
  let preview: Record<string, unknown> | null = null;
  if (withPreview && String(order.status) === 'draft') {
    try {
      preview = resolutionJson(await resolveIssuingEntity(db as Tx, {
        customerId: idOf(order.customer_id),
        channel: String(order.channel),
      }));
    } catch {
      preview = null;
    }
  }
  const trace = jsonOf(order.billing_rule_trace);
  return {
    id: idOf(order.id),
    number: textOf(order.number),
    status: String(order.status),
    invoicing_status: String(order.invoicing_status),
    legal_entity_id: entityId,
    entity_code: entityCode,
    source: String(order.source),
    channel: String(order.channel),
    customer_id: idOf(order.customer_id),
    customer_order_ref: textOf(order.customer_order_ref),
    customer_department: textOf(order.customer_department),
    customer_cost_center: textOf(order.customer_cost_center),
    external_ref: textOf(order.external_ref),
    order_date: dateOf(order.order_date),
    requested_date: order.requested_date == null ? null : dateOf(order.requested_date),
    ship_to: order.ship_to ?? null,
    incoterm: textOf(order.incoterm),
    quote_id: idOrNull(order.quote_id),
    billing_rule_set_id: idOrNull(order.billing_rule_set_id),
    billing_rule_id: idOrNull(order.billing_rule_id),
    billing_rule_trace: order.billing_rule_trace ?? null,
    rule_label: labelFromTrace(trace, entityCode),
    issuing_preview: preview,
    currency: String(order.currency),
    notes: textOf(order.notes),
    customer_references: textOf(order.customer_references),
    subtotal: decOf(order.subtotal).toFixed(2),
    tax_total: decOf(order.tax_total).toFixed(2),
    total: decOf(order.total).toFixed(2),
    lines,
  };
}

function labelFromTrace(trace: Record<string, unknown>, entityCode: string | null): string | null {
  if (typeof trace.label === 'string' && trace.label.length > 0) return trace.label;
  const version = trace.version;
  const winner = trace.winner;
  if (typeof version !== 'number' || typeof winner !== 'string') return entityCode;
  if (winner === 'customer') return `Regla: cliente (v${version})`;
  if (winner === 'channel') return `Regla: canal (v${version})`;
  if (winner === 'default') return `Regla: por defecto (v${version})`;
  return entityCode;
}

async function loadOrder(db: Pick<Tx, 'read'>, id: string): Promise<Record<string, unknown>> {
  const rows = await db.read<Record<string, unknown>>(sql`SELECT * FROM sales.sales_order WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function loadLines(db: Pick<Tx, 'read'>, id: string): Promise<OrderLine[]> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, line_no, product_id, description, quantity, unit_price, discount_pct, tax_code, external_line_ref, unit
    FROM sales.sales_order_line WHERE order_id = CAST(${id} AS UUID) ORDER BY line_no
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    line_no: Number(row.line_no),
    product_id: idOf(row.product_id),
    description: String(row.description),
    quantity: decOf(row.quantity).toFixed(3),
    unit_price: priceText(decOf(row.unit_price)),
    discount_pct: decOf(row.discount_pct).toFixed(2),
    tax_code: String(row.tax_code),
    external_line_ref: textOf(row.external_line_ref),
    unit: textOf(row.unit),
  }));
}

function assertDraft(order: Record<string, unknown>): void {
  if (String(order.status) !== 'draft') fail('Solo se edita un pedido en borrador', { status: String(order.status) });
}

type OrderInput = {
  customerId: string;
  legalEntityId: string | null;
  channel: string;
  source: string;
  orderDate: string;
  requestedDate: string | null;
  department: string | null;
  costCenter: string | null;
  customerOrderRef: string | null;
  externalRef: string | null;
  shipTo: Record<string, unknown> | null;
  incoterm: string | null;
  notes: string | null;
  customerReferences: string | null;
  quoteId: string | null;
  lines: CommercialLineInput[];
};

async function parseOrderBody(tx: Tx, raw: unknown, creating: boolean): Promise<OrderInput> {
  const body = asRecord(raw);
  if (!creating && 'legal_entity_id' in body && body.legal_entity_id != null) {
    fail('La entidad se cambia con una excepción', { legal_entity_id: 'No editable' });
  }
  const fields: Record<string, string> = {};
  const legalEntityId = creating ? optionalId(body.legal_entity_id, 'legal_entity_id', fields) : null;
  const customerId = typeof body.customer_id === 'string' ? body.customer_id.trim().toLowerCase() : '';
  if (!/^[0-9a-f-]{36}$/.test(customerId)) fields.customer_id = 'Identificador no válido';
  const channel = typeof body.channel === 'string' ? body.channel : '';
  if (!channel) fields.channel = 'El canal es obligatorio';
  const source = body.source == null || body.source === '' ? 'manual' : body.source;
  if (typeof source !== 'string' || !SOURCES.has(source)) fields.source = 'Origen no válido';
  const orderDate = parseDate(body.order_date, 'order_date', fields, false) ?? businessDate(new Date());
  const requestedDate = parseDate(body.requested_date, 'requested_date', fields, false);
  const department = optionalText(body.customer_department, 'customer_department', fields, 80);
  const costCenter = optionalText(body.customer_cost_center, 'customer_cost_center', fields, 80);
  const customerOrderRef = optionalText(body.customer_order_ref, 'customer_order_ref', fields, 80);
  const externalRef = optionalText(body.external_ref, 'external_ref', fields, 80);
  const incoterm = parseIncoterm(body.incoterm, 'incoterm', fields);
  const notes = optionalText(body.notes, 'notes', fields, 2000);
  let customerReferences: string | null = null;
  try {
    customerReferences = parseCustomerReferences(body.customer_references);
  } catch (error) {
    if (error instanceof DomainError) Object.assign(fields, error.fields ?? { customer_references: error.message });
    else throw error;
  }
  const quoteId = body.quote_id == null || body.quote_id === '' ? null : (typeof body.quote_id === 'string' ? body.quote_id.trim().toLowerCase() : '');
  if (quoteId === '') fields.quote_id = 'Identificador no válido';
  let shipTo: Record<string, unknown> | null = null;
  if (body.ship_to != null) {
    if (typeof body.ship_to !== 'object' || Array.isArray(body.ship_to)) fields.ship_to = 'Debe ser un objeto';
    else shipTo = body.ship_to as Record<string, unknown>;
  }
  throwIf(fields);
  const lines = parseCommercialLines(body.lines);
  void tx;
  return {
    customerId,
    legalEntityId,
    channel,
    source: String(source),
    orderDate,
    requestedDate,
    department,
    costCenter,
    customerOrderRef,
    externalRef,
    shipTo,
    incoterm,
    notes,
    customerReferences,
    quoteId,
    lines,
  };
}

async function priceOrderLines(tx: Tx, lines: CommercialLineInput[], date: string, priceListId: string | null, channel: string) {
  const rows = [];
  const totals: PricedLine[] = [];
  for (const line of lines) {
    const price = await resolveLinePrice(tx, line, date, priceListId, channel);
    const rate = await taxRateOf(tx, price.taxCode);
    rows.push({ line, price });
    totals.push({ quantity: line.quantity, unitPrice: price.unitPrice, discountPct: line.discountPct, taxCode: price.taxCode, taxRate: rate });
  }
  return { rows, totals };
}

function updateOrderLines(
  tx: Tx,
  previous: OrderLine[],
  rows: { line: CommercialLineInput; price: { unitPrice: import('decimal.js').Decimal; taxCode: string; description: string } }[],
): OrderLine[] {
  return rows.map((entry, index) => {
    const current = previous[index];
    if (!current) fail('Línea no válida');
    const unchanged = current.product_id === entry.line.productId
      && decOf(current.quantity).eq(entry.line.quantity)
      && decOf(current.unit_price).eq(entry.price.unitPrice)
      && decOf(current.discount_pct).eq(entry.line.discountPct)
      && current.tax_code === entry.price.taxCode
      && current.unit === entry.line.unit;
    if (unchanged) {
      return { ...current, description: entry.price.description };
    }
    tx.write(sql`
      UPDATE sales.sales_order_line SET
        product_id = CAST(${entry.line.productId} AS UUID),
        description = ${entry.price.description},
        quantity = CAST(${qtyText(entry.line.quantity)} AS DECIMAL(14,3)),
        unit_price = CAST(${priceText(entry.price.unitPrice)} AS DECIMAL(14,6)),
        discount_pct = CAST(${entry.line.discountPct.toFixed(2)} AS DECIMAL(5,2)),
        tax_code = ${entry.price.taxCode},
        unit = ${entry.line.unit}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit({
      table: 'sales.sales_order_line',
      rowId: current.id,
      action: 'UPDATE',
      before: current,
      after: { product_id: entry.line.productId, quantity: qtyText(entry.line.quantity) },
    });
    return {
      ...current,
      product_id: entry.line.productId,
      description: entry.price.description,
      quantity: qtyText(entry.line.quantity),
      unit_price: priceText(entry.price.unitPrice),
      discount_pct: entry.line.discountPct.toFixed(2),
      tax_code: entry.price.taxCode,
      unit: entry.line.unit,
    };
  });
}

function insertOrderLines(
  tx: Tx,
  orderId: string,
  rows: { line: CommercialLineInput; price: { unitPrice: import('decimal.js').Decimal; taxCode: string; description: string } }[],
): OrderLine[] {
  return rows.map((entry, index) => {
    const id = newRowId();
    tx.write(sql`
      INSERT INTO sales.sales_order_line (
        id, order_id, line_no, product_id, description, quantity, unit_price, discount_pct, tax_code, unit
      ) VALUES (
        CAST(${id} AS UUID), CAST(${orderId} AS UUID), ${index + 1}, CAST(${entry.line.productId} AS UUID),
        ${entry.price.description}, CAST(${qtyText(entry.line.quantity)} AS DECIMAL(14,3)),
        CAST(${priceText(entry.price.unitPrice)} AS DECIMAL(14,6)),
        CAST(${entry.line.discountPct.toFixed(2)} AS DECIMAL(5,2)), ${entry.price.taxCode}, ${entry.line.unit}
      )
    `);
    tx.audit({
      table: 'sales.sales_order_line',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { order_id: orderId, line_no: index + 1, product_id: entry.line.productId, quantity: qtyText(entry.line.quantity) },
    });
    return {
      id,
      line_no: index + 1,
      product_id: entry.line.productId,
      description: entry.price.description,
      quantity: qtyText(entry.line.quantity),
      unit_price: priceText(entry.price.unitPrice),
      discount_pct: entry.line.discountPct.toFixed(2),
      tax_code: entry.price.taxCode,
      external_line_ref: null,
      unit: entry.line.unit,
    };
  });
}

function appendNote(current: string | null, extra: string): string {
  return current ? `${current}\n${extra}` : extra;
}

function jsonOf(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function jsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

export function orderIdempotency(request: Request, raw: unknown, userId: string): Idem {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128) {
    throw domainError('WC_VALIDATION', { 'idempotency-key': 'La clave debe tener entre 8 y 128 caracteres' });
  }
  return { principal: `user:${userId}`, key, hash: hashBody(raw) };
}

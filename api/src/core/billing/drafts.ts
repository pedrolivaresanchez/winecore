import { Decimal } from 'decimal.js';
import { can, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Actor, Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { computeInvoice, InvoiceCalculationError } from './compute';
import {
  decimalOf,
  flag,
  idOf,
  isUuid,
  mergeRectification,
  pick,
  scale,
  seriesDocType,
  text,
  today,
} from './format';
import { DomainError } from '../errors';
import { sameVersion } from '../party/contacts';
import {
  findDefaultSeries,
  loadCustomer,
  loadEntity,
  loadHeader,
  loadLines,
  loadSeries,
  loadTaxCodes,
  seriesFits,
  type CustomerView,
  type EntityView,
  type SeriesView,
} from './readModel';
import {
  isRectificationType,
  loadTargets,
  parseRectSources,
  rectificationRows,
  substitutionIssues,
  type RectRow,
  type RectSource,
} from './rectify';
import { raiseIssue } from './issues';
import type { TaxCode } from './taxCodes';
import { assertEditable } from './wc080';

const PAYMENTS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'stripe', 'other']);
const INCOTERMS = new Set(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);

interface ManualLine {
  productId: string;
  description: string | null;
  quantity: Decimal;
  unitPrice: Decimal | null;
  discountPct: Decimal;
  taxCode: string | null;
  lotId: string | null;
  lotCode: string | null;
  deliveryNoteLineId: string | null;
  orderLineId: string | null;
}

interface CreateInput {
  legalEntityId: string | null;
  customerId: string | null;
  seriesId: string | null;
  invoiceType: string;
  rectificationKind: 'S' | 'I' | null;
  channel: string | null;
  description: string | null;
  language: 'es' | 'en' | null;
  paymentTermsDays: number | null;
  paymentMethod: string | null;
  operationDate: string | null;
  issueDate: string | null;
  notes: string | null;
  incoterm: string | null;
  fromDeliveryNotes: string[] | null;
  fromOrder: string | null;
  lines: ManualLine[] | null;
  rectifies: RectSource[] | null;
  reason: string | null;
  noPhysicalReturn: boolean | null;
  returnDeliveryNote: string | null;
}

interface BuiltLine {
  id: string;
  lineNo: number;
  productId: string;
  sku: string;
  description: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: Decimal;
  unit: string;
  unitPrice: Decimal;
  discountPct: Decimal;
  lineBase: Decimal;
  taxCode: string;
  deliveryNoteLineId: string | null;
  orderLineId: string | null;
}

interface Built {
  id: string;
  entity: EntityView;
  customer: CustomerView;
  series: SeriesView | null;
  invoiceType: string;
  rectificationKind: 'S' | 'I' | null;
  channel: string | null;
  description: string;
  language: 'es' | 'en';
  notes: string | null;
  incoterm: string | null;
  paymentMethod: string | null;
  paymentTermsDays: number;
  operationDate: string | null;
  issueDate: string | null;
  currency: string;
  lines: BuiltLine[];
  rectRows: RectRow[];
  subtotal: string | null;
  taxTotal: string | null;
  surchargeTotal: string | null;
  withholdingTotal: string | null;
  total: string | null;
  mentions: string[];
  salesOrderId: string | null;
  ruleSetId: string | null;
  ruleId: string | null;
  ruleTrace: Record<string, unknown> | null;
  legacyRefs: Record<string, unknown>;
}

export async function createDraft(
  tx: Tx,
  raw: unknown,
  actor: Actor,
  user: UserCtx,
  now: Date,
): Promise<string> {
  const input = parseCreate(raw);
  const built = await buildNew(tx, input, now);
  if (!can(user, 'billing.write', built.entity.id)) throw domainError('WC_FORBIDDEN');
  insertInvoice(tx, built, actor, now);
  insertLines(tx, built);
  insertRects(tx, built.id, built.rectRows);
  return built.id;
}

export async function updateDraft(
  tx: Tx,
  id: string,
  raw: unknown,
  actor: Actor,
  user: UserCtx,
  ifMatch: string | null,
  now: Date,
): Promise<void> {
  const current = await loadHeader(tx, id);
  assertEditable(current.status);
  if (!ifMatch || !sameVersion(current.updatedAt, ifMatch)) throw domainError('WC_STALE_VERSION');
  if (!can(user, 'billing.write', current.legalEntityId)) throw domainError('WC_FORBIDDEN');
  const patch = parsePatch(raw);
  const built = await buildUpdate(tx, current, patch, now);
  if (!can(user, 'billing.write', built.entity.id)) throw domainError('WC_FORBIDDEN');
  updateHeader(tx, current, built, now);
  if (patch.lines) {
    const previous = await loadLines(tx, id);
    for (const line of previous) {
      tx.audit({
        table: 'billing.invoice_line',
        rowId: line.id,
        action: 'DELETE',
        before: { line_no: line.lineNo, description: line.description },
        after: null,
      });
    }
    tx.write(sql`DELETE FROM billing.invoice_line WHERE invoice_id = CAST(${id} AS UUID)`);
    insertLines(tx, built);
  }
}

export async function discardDraft(
  tx: Tx,
  id: string,
  actor: Actor,
  user: UserCtx,
  reason: string | null,
  now: Date,
): Promise<void> {
  const current = await loadHeader(tx, id);
  assertEditable(current.status);
  if (!can(user, 'billing.write', current.legalEntityId)) throw domainError('WC_FORBIDDEN');
  const legacy = { ...current.legacyRefs, discard_reason: reason };
  tx.write(sql`
    UPDATE billing.invoice
    SET status = 'discarded', legacy_refs = ${sql.json(legacy)}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: id.toLowerCase(),
    action: 'UPDATE',
    before: { status: current.status },
    after: { status: 'discarded', discard_reason: reason },
  });
  void actor;
}

async function buildNew(tx: Tx, input: CreateInput, now: Date): Promise<Built> {
  const sourced = await sourceLines(tx, input, null);
  const customerId = input.customerId ?? sourced.customerId;
  if (!customerId) throw domainError('WC_VALIDATION', { customer_id: 'El cliente es obligatorio' });
  const customer = await requireCustomer(tx, customerId);
  if (sourced.customerId && sourced.customerId !== customer.id) {
    throw domainError('WC_VALIDATION', { customer_id: 'El cliente no coincide con el documento de origen' });
  }
  const channel = input.channel ?? sourced.channel ?? customer.defaultChannel;
  if (channel) await assertChannel(tx, channel);
  const rule = await resolveRule(tx, customer.id, channel);
  const entityId = input.legalEntityId ?? sourced.entityId ?? (rule?.entityId ?? null);
  if (!entityId) throw domainError('WC_INV_ENTITY');
  const entity = await requireEntity(tx, entityId);
  if (sourced.entityId && sourced.entityId !== entity.id) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no coincide con el documento de origen' });
  }
  if (!entity.active) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no está activa' });
  const manual = input.lines ?? [];
  const draftLines = [...sourced.lines, ...manual];
  const priceOn = input.issueDate ?? input.operationDate ?? today(now);
  const enriched = await enrichLines(tx, draftLines, customer, priceOn, input.rectificationKind);
  const targets = input.rectifies ? await loadTargets(tx, input.rectifies) : [];
  assertRectificationEntity(input, entity.taxId, entity.id, targets);
  const year = Number((input.issueDate ?? today(now)).slice(0, 4));
  const series = await chooseSeries(tx, input.seriesId, entity.id, seriesDocType(input.invoiceType), year);
  const terms = input.paymentTermsDays ?? customer.paymentTermsDays;
  const language = input.language ?? (customer.language === 'en' ? 'en' : 'es');
  const description = input.description ?? (input.rectificationKind ? 'Rectificación' : 'Venta de vino');
  assertDescription(description);
  const priced = applyTotals(enriched, await loadTaxCodes(tx), terms, priceOn, language);
  if (input.rectificationKind && (!input.reason || input.reason.trim().length === 0)) {
    throw domainError('WC_INV_RECTIFICATION_REF', { reason: 'El motivo es obligatorio' });
  }
  if (input.rectificationKind === 'S') {
    const missing = substitutionIssues(targets);
    const first = missing[0];
    if (first) raiseIssue(first);
  }
  const rectRows = input.rectificationKind ? rectificationRows(input.rectificationKind, input.reason ?? '', targets) : [];
  return {
    id: newId(),
    entity,
    customer,
    series,
    invoiceType: input.invoiceType,
    rectificationKind: input.rectificationKind,
    channel,
    description,
    language,
    notes: input.notes,
    incoterm: input.incoterm,
    paymentMethod: input.paymentMethod ?? customer.paymentMethod,
    paymentTermsDays: terms,
    operationDate: input.operationDate,
    issueDate: input.issueDate,
    currency: /^[A-Z]{3}$/.test(customer.currency) ? customer.currency : 'EUR',
    lines: priced.lines,
    rectRows,
    subtotal: priced.subtotal,
    taxTotal: priced.taxTotal,
    surchargeTotal: priced.surchargeTotal,
    withholdingTotal: priced.withholdingTotal,
    total: priced.total,
    mentions: priced.mentions,
    salesOrderId: sourced.salesOrderId,
    ruleSetId: rule && rule.entityId === entity.id ? rule.ruleSetId : null,
    ruleId: rule && rule.entityId === entity.id ? rule.ruleId : null,
    ruleTrace: rule ? { scope: rule.scope, rule_id: rule.ruleId, explicit: input.legalEntityId != null } : null,
    legacyRefs: mergeRectification(holdedRefs(input.rectifies), {
      noPhysicalReturn: input.noPhysicalReturn,
      returnDeliveryNote: input.returnDeliveryNote,
    }),
  };
}

async function buildUpdate(
  tx: Tx,
  current: Awaited<ReturnType<typeof loadHeader>>,
  patch: Patch,
  now: Date,
): Promise<Built> {
  const customer = await requireCustomer(tx, patch.customerId ?? current.customerId ?? '');
  const entity = await requireEntity(tx, patch.legalEntityId ?? current.legalEntityId);
  const channel = patch.channel === undefined ? current.channel : patch.channel;
  if (channel) await assertChannel(tx, channel);
  const issueDate = patch.issueDate === undefined ? current.issueDate : patch.issueDate;
  const operationDate = patch.operationDate === undefined ? current.operationDate : patch.operationDate;
  const year = Number((issueDate ?? today(now)).slice(0, 4));
  const docType = seriesDocType(current.invoiceType);
  const series = patch.seriesId === undefined
    ? await keptSeries(tx, current.seriesId, entity.id, docType, year)
    : await chooseSeries(tx, patch.seriesId, entity.id, docType, year);
  const terms = patch.paymentTermsDays === undefined
    ? current.paymentTermsDays ?? customer.paymentTermsDays
    : patch.paymentTermsDays;
  const language = patch.language ?? (current.language === 'en' ? 'en' : 'es');
  const description = patch.description ?? current.description;
  assertDescription(description);
  const priceOn = issueDate ?? operationDate ?? today(now);
  const sourceLines = patch.lines ?? (await loadLines(tx, current.id)).map((line) => ({
    productId: line.productId ?? '',
    description: line.description,
    quantity: decimalOf(line.quantity),
    unitPrice: decimalOf(line.unitPrice),
    discountPct: decimalOf(line.discountPct),
    taxCode: line.taxCode,
    lotId: line.lotId,
    lotCode: line.lotCode,
    deliveryNoteLineId: line.deliveryNoteLineId,
    orderLineId: line.orderLineId,
  }));
  if (patch.lines) {
    for (const line of sourceLines) {
      if (!isUuid(line.productId)) throw domainError('WC_VALIDATION', { product_id: 'El producto es obligatorio' });
    }
  }
  const enriched = await enrichLines(tx, sourceLines.filter((line) => isUuid(line.productId)), customer, priceOn, current.rectificationKind);
  const priced = applyTotals(enriched, await loadTaxCodes(tx), terms, priceOn, language);
  const physical = physicalReturnOf(current, patch);
  const keptIds = patch.lines ? null : await loadLines(tx, current.id);
  if (keptIds) {
    priced.lines.forEach((line, index) => {
      const previous = keptIds[index];
      if (previous) line.id = previous.id;
    });
  }
  return {
    id: current.id,
    entity,
    customer,
    series,
    invoiceType: current.invoiceType,
    rectificationKind: current.rectificationKind,
    channel,
    description,
    language,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    incoterm: patch.incoterm === undefined ? current.incoterm : patch.incoterm,
    paymentMethod: patch.paymentMethod === undefined ? current.paymentMethod : patch.paymentMethod,
    paymentTermsDays: terms,
    operationDate,
    issueDate,
    currency: current.currency,
    lines: priced.lines,
    rectRows: [],
    subtotal: priced.subtotal,
    taxTotal: priced.taxTotal,
    surchargeTotal: priced.surchargeTotal,
    withholdingTotal: priced.withholdingTotal,
    total: priced.total,
    mentions: priced.mentions,
    salesOrderId: current.salesOrderId,
    ruleSetId: null,
    ruleId: null,
    ruleTrace: null,
    legacyRefs: mergeRectification(current.legacyRefs, physical),
  };
}

interface Priced {
  lines: BuiltLine[];
  subtotal: string | null;
  taxTotal: string | null;
  surchargeTotal: string | null;
  withholdingTotal: string | null;
  total: string | null;
  mentions: string[];
}

function applyTotals(
  lines: BuiltLine[],
  taxCodes: Map<string, TaxCode>,
  terms: number,
  issueDate: string,
  language: 'es' | 'en',
): Priced {
  if (lines.length === 0) {
    return {
      lines,
      subtotal: null,
      taxTotal: null,
      surchargeTotal: null,
      withholdingTotal: null,
      total: null,
      mentions: [],
    };
  }
  const mentions = new Set<string>();
  const prepared = lines.map((line) => {
    const tax = taxCodes.get(line.taxCode);
    if (!tax) throw domainError('WC_VALIDATION', { tax_code: `El código de impuesto ${line.taxCode} no existe` });
    const mention = language === 'en' ? tax.legalMentionEn : tax.legalMentionEs;
    if (mention) mentions.add(mention);
    return { qty: line.quantity, unitPrice: line.unitPrice, discountPct: line.discountPct, taxCode: tax };
  });
  let computed;
  try {
    computed = computeInvoice({ lines: prepared, paymentTerms: { days: [terms] }, issueDate });
  } catch (error) {
    if (error instanceof InvoiceCalculationError) {
      throw new DomainError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
  computed.lines.forEach((line, index) => {
    const target = lines[index];
    if (target) target.lineBase = line.lineBase;
  });
  return {
    lines,
    subtotal: money.toString(computed.subtotal),
    taxTotal: money.toString(computed.taxTotal),
    surchargeTotal: money.toString(computed.surchargeTotal),
    withholdingTotal: money.toString(computed.withholdingTotal),
    total: money.toString(computed.totalToPay),
    mentions: [...mentions],
  };
}

async function enrichLines(
  tx: Tx,
  lines: readonly ManualLine[],
  customer: CustomerView,
  priceOn: string,
  kind: 'S' | 'I' | null,
): Promise<BuiltLine[]> {
  const built: BuiltLine[] = [];
  let lineNo = 1;
  for (const line of lines) {
    const product = await loadProductRow(tx, line.productId);
    if (!product.active) throw domainError('WC_VALIDATION', { product_id: 'El producto no está activo' });
    if (kind !== 'I' && line.quantity.isNeg()) {
      throw domainError('WC_VALIDATION', { quantity: 'La cantidad negativa solo vale en una rectificativa por diferencias' });
    }
    const quantity = scale(line.quantity, 3);
    if (quantity.isZero()) throw domainError('WC_VALIDATION', { quantity: 'La cantidad no puede ser cero' });
    const discount = scale(line.discountPct, 2);
    if (discount.isNeg() || discount.gt('100')) {
      throw domainError('WC_VALIDATION', { discount_pct: 'El descuento debe estar entre 0 y 100' });
    }
    const unitPrice = line.unitPrice
      ? scale(line.unitPrice, 6)
      : await unitPriceOf(tx, product.id, customer.defaultPriceListId, priceOn, quantity.abs());
    if (unitPrice.isNeg()) throw domainError('WC_VALIDATION', { unit_price: 'El precio no puede ser negativo' });
    const taxCode = line.taxCode ?? product.defaultTaxCode;
    if (!taxCode) throw domainError('WC_VALIDATION', { tax_code: 'Indica el código de impuesto' });
    const lot = await lotOf(tx, line.lotId);
    const description = (line.description ?? product.name).trim();
    if (description.length < 1 || description.length > 250) {
      throw domainError('WC_VALIDATION', { description: 'La descripción de la línea debe tener entre 1 y 250 caracteres' });
    }
    built.push({
      id: newId(),
      lineNo,
      productId: product.id,
      sku: product.sku,
      description,
      lotId: lot?.id ?? null,
      lotCode: lot?.code ?? line.lotCode,
      quantity,
      unit: product.unit,
      unitPrice,
      discountPct: discount,
      lineBase: decimalOf('0'),
      taxCode,
      deliveryNoteLineId: line.deliveryNoteLineId,
      orderLineId: line.orderLineId,
    });
    lineNo += 1;
  }
  return built;
}

async function unitPriceOf(
  tx: Tx,
  productId: string,
  priceListId: string | null,
  on: string,
  qty: Decimal,
): Promise<Decimal> {
  let listId = priceListId;
  if (!listId) {
    const lists = await tx.read<{ id: unknown; tax_included: unknown }>(sql`
      SELECT id, tax_included FROM catalog.price_list WHERE code = 'final' AND is_active LIMIT 1
    `);
    const list = lists[0];
    if (!list) throw domainError('WC_INV_PRICE', { product_id: 'No hay precio para el producto' });
    if (flag(list.tax_included)) {
      throw domainError('WC_INV_PRICE', { product_id: 'La tarifa tiene el IVA incluido y no hay regla para sacar la base' });
    }
    listId = idOf(list.id);
  } else {
    const lists = await tx.read<{ tax_included: unknown }>(sql`
      SELECT tax_included FROM catalog.price_list WHERE id = CAST(${listId} AS UUID)
    `);
    if (flag(lists[0]?.tax_included)) {
      throw domainError('WC_INV_PRICE', { product_id: 'La tarifa tiene el IVA incluido y no hay regla para sacar la base' });
    }
  }
  const rows = await tx.read<{ unit_price: unknown }>(sql`
    SELECT i.unit_price
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    WHERE i.product_id = CAST(${productId} AS UUID)
      AND v.price_list_id = CAST(${listId} AS UUID)
      AND v.status = 'active'
      AND v.valid_from <= CAST(${on} AS DATE)
      AND (v.valid_to IS NULL OR v.valid_to > CAST(${on} AS DATE))
      AND i.min_qty <= ${qty}
    ORDER BY i.min_qty DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_INV_PRICE', { product_id: 'No hay precio para el producto' });
  return scale(decimalOf(row.unit_price), 6);
}

async function sourceLines(tx: Tx, input: CreateInput, exceptInvoiceId: string | null): Promise<{
  lines: ManualLine[];
  customerId: string | null;
  entityId: string | null;
  channel: string | null;
  salesOrderId: string | null;
}> {
  if (input.fromDeliveryNotes && input.fromOrder) {
    throw domainError('WC_VALIDATION', { from_delivery_notes: 'Indica albaranes o un pedido, no los dos' });
  }
  if (input.fromDeliveryNotes) return linesFromNotes(tx, input.fromDeliveryNotes, exceptInvoiceId);
  if (input.fromOrder) return linesFromOrder(tx, input.fromOrder);
  return { lines: [], customerId: null, entityId: null, channel: null, salesOrderId: null };
}

async function linesFromNotes(tx: Tx, ids: readonly string[], exceptInvoiceId: string | null): Promise<{
  lines: ManualLine[];
  customerId: string | null;
  entityId: string | null;
  channel: string | null;
  salesOrderId: string | null;
}> {
  const lines: ManualLine[] = [];
  let customerId: string | null = null;
  let entityId: string | null = null;
  let channel: string | null = null;
  let salesOrderId: string | null = null;
  for (const id of ids) {
    const notes = await tx.read(sql`SELECT * FROM sales.delivery_note WHERE id = CAST(${id} AS UUID)`);
    const note = notes[0];
    if (!note) throw domainError('WC_NOT_FOUND');
    const status = String(note.status);
    if (!['issued', 'shipped', 'delivered'].includes(status)) {
      throw domainError('WC_VALIDATION', { from_delivery_notes: 'El albarán no está emitido' });
    }
    if (String(note.invoicing_status) === 'invoiced') {
      throw domainError('WC_INV_ALREADY_INVOICED');
    }
    const noteCustomer = note.customer_id == null ? null : idOf(note.customer_id);
    const noteEntity = idOf(note.legal_entity_id);
    if (customerId && noteCustomer && customerId !== noteCustomer) {
      throw domainError('WC_VALIDATION', { from_delivery_notes: 'Los albaranes no son del mismo cliente' });
    }
    if (entityId && entityId !== noteEntity) {
      throw domainError('WC_VALIDATION', { from_delivery_notes: 'Los albaranes no son de la misma entidad' });
    }
    customerId = noteCustomer ?? customerId;
    entityId = noteEntity;
    channel = channel ?? text(note.channel);
    salesOrderId = salesOrderId ?? (note.sales_order_id == null ? null : idOf(note.sales_order_id));
    const noteLines = await tx.read(sql`
      SELECT * FROM sales.delivery_note_line
      WHERE delivery_note_id = CAST(${id} AS UUID)
      ORDER BY line_no
    `);
    for (const row of noteLines) {
      await assertLineFree(tx, idOf(row.id), exceptInvoiceId);
      const lotId = row.lot_id == null ? null : idOf(row.lot_id);
      const lot = await lotOf(tx, lotId);
      lines.push({
        productId: idOf(row.product_id),
        description: String(row.description),
        quantity: decimalOf(row.quantity),
        unitPrice: row.unit_price == null ? null : decimalOf(row.unit_price),
        discountPct: decimalOf(row.discount_pct ?? 0),
        taxCode: text(row.tax_code),
        lotId,
        lotCode: lot?.code ?? null,
        deliveryNoteLineId: idOf(row.id),
        orderLineId: row.order_line_id == null ? null : idOf(row.order_line_id),
      });
    }
  }
  return { lines, customerId, entityId, channel, salesOrderId };
}

async function assertLineFree(tx: Tx, lineId: string, exceptInvoiceId: string | null): Promise<void> {
  const rows = await tx.read<{ status: unknown }>(sql`
    SELECT i.status
    FROM billing.invoice_line l
    JOIN billing.invoice i ON i.id = l.invoice_id
    WHERE l.delivery_note_line_id = CAST(${lineId} AS UUID)
      AND i.status IN ('draft', 'pending_approval', 'issued')
      AND (${exceptInvoiceId} IS NULL OR i.id <> CAST(${exceptInvoiceId} AS UUID))
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return;
  if (String(row.status) === 'issued') throw domainError('WC_INV_ALREADY_INVOICED');
  throw new DomainError('WC_INV_ALREADY_INVOICED', 409, 'El albarán ya está incluido en otro borrador');
}

async function linesFromOrder(tx: Tx, orderId: string): Promise<{
  lines: ManualLine[];
  customerId: string | null;
  entityId: string | null;
  channel: string | null;
  salesOrderId: string | null;
}> {
  const orders = await tx.read(sql`SELECT * FROM sales.sales_order WHERE id = CAST(${orderId} AS UUID)`);
  const order = orders[0];
  if (!order) throw domainError('WC_NOT_FOUND');
  if (String(order.status) === 'cancelled') {
    throw domainError('WC_VALIDATION', { from_order: 'El pedido está cancelado' });
  }
  const rows = await tx.read(sql`
    SELECT * FROM sales.sales_order_line WHERE order_id = CAST(${orderId} AS UUID) ORDER BY line_no
  `);
  return {
    customerId: idOf(order.customer_id),
    entityId: order.legal_entity_id == null ? null : idOf(order.legal_entity_id),
    channel: text(order.channel),
    salesOrderId: orderId.toLowerCase(),
    lines: rows.map((row) => ({
      productId: idOf(row.product_id),
      description: String(row.description),
      quantity: decimalOf(row.quantity),
      unitPrice: decimalOf(row.unit_price),
      discountPct: decimalOf(row.discount_pct ?? 0),
      taxCode: text(row.tax_code),
      lotId: null,
      lotCode: null,
      deliveryNoteLineId: null,
      orderLineId: idOf(row.id),
    })),
  };
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  defaultTaxCode: string | null;
  active: boolean;
}

async function loadProductRow(tx: Tx, id: string): Promise<ProductRow> {
  if (!isUuid(id)) throw domainError('WC_VALIDATION', { product_id: 'Identificador no válido' });
  const rows = await tx.read(sql`
    SELECT id, sku, name, unit, default_tax_code, is_active
    FROM catalog.product WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { product_id: 'El producto no existe' });
  return {
    id: idOf(row.id),
    sku: String(row.sku),
    name: String(row.name),
    unit: String(row.unit),
    defaultTaxCode: text(row.default_tax_code),
    active: flag(row.is_active),
  };
}

async function lotOf(tx: Tx, id: string | null): Promise<{ id: string; code: string } | null> {
  if (!id) return null;
  if (!isUuid(id)) throw domainError('WC_VALIDATION', { lot_id: 'Identificador no válido' });
  const rows = await tx.read<{ id: unknown; code: unknown }>(sql`
    SELECT id, code FROM inventory.lot WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { lot_id: 'El lote no existe' });
  return { id: idOf(row.id), code: String(row.code) };
}

async function requireCustomer(tx: Tx, id: string): Promise<CustomerView> {
  const customer = await loadCustomer(tx, id);
  if (!customer) throw domainError('WC_VALIDATION', { customer_id: 'El cliente no existe' });
  return customer;
}

async function requireEntity(tx: Tx, id: string): Promise<EntityView> {
  const entity = await loadEntity(tx, id);
  if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  return entity;
}

/**
 * Sin serie elegida, la de por defecto del año si existe. Si la entidad aún no tiene numeración
 * fiscal, el borrador queda sin serie y se elige al emitir.
 */
async function chooseSeries(
  tx: Tx,
  explicitId: string | null,
  entityId: string,
  docType: string,
  year: number,
): Promise<SeriesView | null> {
  if (!explicitId) return findDefaultSeries(tx, entityId, docType, year);
  const series = await loadSeries(tx, explicitId);
  if (!seriesFits(series, entityId, docType, year)) throw domainError('WC_INV_SERIES');
  return series;
}

async function keptSeries(
  tx: Tx,
  currentId: string | null,
  entityId: string,
  docType: string,
  year: number,
): Promise<SeriesView | null> {
  const current = currentId ? await loadSeries(tx, currentId) : null;
  return seriesFits(current, entityId, docType, year) ? current : findDefaultSeries(tx, entityId, docType, year);
}

interface RuleHit {
  ruleSetId: string;
  ruleId: string;
  entityId: string;
  scope: string;
}

async function resolveRule(tx: Tx, customerId: string, channel: string | null): Promise<RuleHit | null> {
  const rows = await tx.read(sql`
    SELECT r.rule_set_id, r.id AS rule_id, r.issuing_entity_id, r.scope
    FROM billing.billing_rule r
    JOIN billing.billing_rule_set s ON s.id = r.rule_set_id AND s.status = 'active'
    WHERE (r.scope = 'customer' AND r.customer_id = CAST(${customerId} AS UUID))
       OR (r.scope = 'channel' AND r.channel = ${channel})
       OR r.scope = 'default'
    ORDER BY CASE r.scope WHEN 'customer' THEN 1 WHEN 'channel' THEN 2 ELSE 3 END
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    ruleSetId: idOf(row.rule_set_id),
    ruleId: idOf(row.rule_id),
    entityId: idOf(row.issuing_entity_id),
    scope: String(row.scope),
  };
}

function assertRectificationEntity(
  input: CreateInput,
  entityTaxId: string,
  entityId: string,
  targets: Awaited<ReturnType<typeof loadTargets>>,
): void {
  if (!input.rectificationKind) return;
  for (const target of targets) {
    if (target.legalEntityId && target.legalEntityId !== entityId) {
      throw domainError('WC_VALIDATION', { legal_entity_id: 'La rectificativa se emite con la misma entidad que la factura original' });
    }
    if (!target.invoiceId && target.issuerTaxId !== entityTaxId) {
      throw domainError('WC_VALIDATION', { rectifies: 'El NIF de la factura de Holded no es el de la entidad que rectifica' });
    }
  }
}

function holdedRefs(sources: RectSource[] | null): Record<string, unknown> {
  const holded = (sources ?? [])
    .filter((source) => source.legacy)
    .map((source) => ({
      issuer_tax_id: source.legacy?.issuerTaxId,
      number: source.legacy?.number,
      issue_date: source.legacy?.issueDate,
      base: source.legacy?.base,
      quota: source.legacy?.quota,
      surcharge: source.legacy?.surcharge,
    }));
  return holded.length > 0 ? { holded } : {};
}

async function assertChannel(tx: Tx, code: string): Promise<void> {
  if (!/^[a-z_]{2,20}$/.test(code)) throw domainError('WC_VALIDATION', { channel: 'Canal no válido' });
  const rows = await tx.read(sql`SELECT code FROM sales.channel WHERE code = ${code} AND is_active LIMIT 1`);
  if (!rows[0]) throw domainError('WC_VALIDATION', { channel: 'El canal no existe' });
}

function assertDescription(description: string): void {
  if (description.length < 1 || description.length > 500) {
    throw domainError('WC_VALIDATION', { description: 'La descripción debe tener entre 1 y 500 caracteres' });
  }
}

function insertInvoice(tx: Tx, built: Built, actor: Actor, now: Date): void {
  tx.write(sql`
    INSERT INTO billing.invoice (
      id, legal_entity_id, series_id, status, invoice_type, rectification_kind,
      issue_date, operation_date, customer_id, channel, sales_order_id,
      billing_rule_set_id, billing_rule_id, billing_rule_trace, currency, language,
      description, legal_mentions, notes, incoterm, subtotal, tax_total, surcharge_total,
      withholding_total, total, payment_method, payment_terms_days, legacy_refs,
      created_by, created_at, updated_at
    ) VALUES (
      CAST(${built.id} AS UUID),
      CAST(${built.entity.id} AS UUID),
      CAST(${built.series?.id ?? null} AS UUID),
      'draft',
      ${built.invoiceType},
      ${built.rectificationKind},
      CAST(${built.issueDate} AS DATE),
      CAST(${built.operationDate} AS DATE),
      CAST(${built.customer.id} AS UUID),
      ${built.channel},
      CAST(${built.salesOrderId} AS UUID),
      CAST(${built.ruleSetId} AS UUID),
      CAST(${built.ruleId} AS UUID),
      ${built.ruleTrace ? sql.json(built.ruleTrace) : null},
      ${built.currency},
      ${built.language},
      ${built.description},
      ${built.mentions},
      ${built.notes},
      ${built.incoterm},
      ${built.subtotal == null ? null : decimalOf(built.subtotal)},
      ${built.taxTotal == null ? null : decimalOf(built.taxTotal)},
      ${built.surchargeTotal == null ? null : decimalOf(built.surchargeTotal)},
      ${built.withholdingTotal == null ? null : decimalOf(built.withholdingTotal)},
      ${built.total == null ? null : decimalOf(built.total)},
      ${built.paymentMethod},
      ${built.paymentTermsDays},
      ${sql.json(built.legacyRefs)},
      ${actor.id},
      ${now},
      ${now}
    )
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: built.id,
    action: 'INSERT',
    before: null,
    after: {
      status: 'draft',
      invoice_type: built.invoiceType,
      legal_entity_id: built.entity.id,
      customer_id: built.customer.id,
      series_id: built.series?.id ?? null,
      total: built.total,
    },
  });
}

function insertLines(tx: Tx, built: Built): void {
  for (const line of built.lines) {
    tx.write(sql`
      INSERT INTO billing.invoice_line (
        id, invoice_id, line_no, product_id, sku, description, lot_id, lot_code,
        quantity, unit, unit_price, discount_pct, line_base, tax_code,
        delivery_note_line_id, order_line_id
      ) VALUES (
        CAST(${line.id} AS UUID),
        CAST(${built.id} AS UUID),
        ${line.lineNo},
        CAST(${line.productId} AS UUID),
        ${line.sku},
        ${line.description},
        CAST(${line.lotId} AS UUID),
        ${line.lotCode},
        ${line.quantity},
        ${line.unit},
        ${line.unitPrice},
        ${line.discountPct},
        ${line.lineBase},
        ${line.taxCode},
        CAST(${line.deliveryNoteLineId} AS UUID),
        CAST(${line.orderLineId} AS UUID)
      )
    `);
    tx.audit({
      table: 'billing.invoice_line',
      rowId: line.id,
      action: 'INSERT',
      before: null,
      after: { invoice_id: built.id, line_no: line.lineNo, line_base: money.toString(line.lineBase) },
    });
  }
}

function insertRects(tx: Tx, invoiceId: string, rows: readonly RectRow[]): void {
  for (const row of rows) {
    const id = newId();
    tx.write(sql`
      INSERT INTO billing.invoice_rectification (
        id, rectifying_invoice_id, rectified_invoice_id, rectified_number, rectified_issue_date,
        rectified_issuer_tax_id, relation, base_rectified, quota_rectified, surcharge_rectified, reason
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${invoiceId} AS UUID),
        CAST(${row.rectifiedInvoiceId} AS UUID),
        ${row.number},
        CAST(${row.issueDate} AS DATE),
        ${row.issuerTaxId},
        'rectified',
        ${row.baseRectified == null ? null : decimalOf(row.baseRectified)},
        ${row.quotaRectified == null ? null : decimalOf(row.quotaRectified)},
        ${row.surchargeRectified == null ? null : decimalOf(row.surchargeRectified)},
        ${row.reason}
      )
    `);
    tx.audit({
      table: 'billing.invoice_rectification',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { rectifying_invoice_id: invoiceId, rectified_number: row.number },
    });
  }
}

function updateHeader(tx: Tx, before: Awaited<ReturnType<typeof loadHeader>>, built: Built, now: Date): void {
  tx.write(sql`
    UPDATE billing.invoice SET
      legal_entity_id = CAST(${built.entity.id} AS UUID),
      series_id = CAST(${built.series?.id ?? null} AS UUID),
      customer_id = CAST(${built.customer.id} AS UUID),
      channel = ${built.channel},
      issue_date = CAST(${built.issueDate} AS DATE),
      operation_date = CAST(${built.operationDate} AS DATE),
      language = ${built.language},
      description = ${built.description},
      legal_mentions = ${built.mentions},
      notes = ${built.notes},
      incoterm = ${built.incoterm},
      subtotal = ${built.subtotal == null ? null : decimalOf(built.subtotal)},
      tax_total = ${built.taxTotal == null ? null : decimalOf(built.taxTotal)},
      surcharge_total = ${built.surchargeTotal == null ? null : decimalOf(built.surchargeTotal)},
      withholding_total = ${built.withholdingTotal == null ? null : decimalOf(built.withholdingTotal)},
      total = ${built.total == null ? null : decimalOf(built.total)},
      payment_method = ${built.paymentMethod},
      payment_terms_days = ${built.paymentTermsDays},
      legacy_refs = ${sql.json(built.legacyRefs)},
      updated_at = ${now}
    WHERE id = CAST(${built.id} AS UUID)
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: built.id,
    action: 'UPDATE',
    before: { customer_id: before.customerId, total: before.total, series_id: before.seriesId },
    after: { customer_id: built.customer.id, total: built.total, series_id: built.series?.id ?? null },
  });
}

interface Patch {
  legalEntityId?: string;
  customerId?: string;
  seriesId?: string | null;
  channel?: string | null;
  description?: string;
  language?: 'es' | 'en';
  paymentTermsDays?: number;
  paymentMethod?: string | null;
  operationDate?: string | null;
  issueDate?: string | null;
  notes?: string | null;
  incoterm?: string | null;
  lines?: ManualLine[];
  noPhysicalReturn?: boolean | null;
  returnDeliveryNote?: string | null;
}

function parseCreate(raw: unknown): CreateInput {
  const body = objectBody(raw);
  const invoiceType = text(pick(body, 'invoice_type', 'invoiceType')) ?? 'F1';
  if (invoiceType !== 'F1' && !isRectificationType(invoiceType)) {
    throw domainError('WC_VALIDATION', { invoice_type: 'El tipo debe ser F1 o R1, R2, R3 o R4' });
  }
  const kindRaw = text(pick(body, 'rectification_kind', 'rectificationKind'));
  const rectifiesRaw = pick(body, 'rectifies');
  const rectifies = rectifiesRaw == null ? null : parseRectSources(rectifiesRaw);
  let rectificationKind: 'S' | 'I' | null = null;
  if (isRectificationType(invoiceType)) {
    if (kindRaw !== 'S' && kindRaw !== 'I') {
      throw domainError('WC_VALIDATION', { rectification_kind: 'Indica diferencias (I) o sustitución (S)' });
    }
    if (!rectifies) throw domainError('WC_INV_RECTIFICATION_REF');
    rectificationKind = kindRaw;
  } else if (kindRaw || rectifies) {
    throw domainError('WC_VALIDATION', { invoice_type: 'Una factura completa no lleva datos de rectificativa' });
  }
  const fromNotes = uuidList(pick(body, 'from_delivery_notes', 'fromDeliveryNotes'), 'from_delivery_notes');
  const fromOrderRaw = text(pick(body, 'from_order', 'fromOrder'));
  if (fromOrderRaw && !isUuid(fromOrderRaw)) throw domainError('WC_VALIDATION', { from_order: 'Identificador no válido' });
  const physical = physicalReturnInput(body, rectificationKind != null, null);
  return {
    legalEntityId: optionalUuid(pick(body, 'legal_entity_id', 'legalEntityId'), 'legal_entity_id'),
    customerId: optionalUuid(pick(body, 'customer_id', 'customerId'), 'customer_id'),
    seriesId: optionalUuid(pick(body, 'series_id', 'seriesId'), 'series_id'),
    invoiceType,
    rectificationKind,
    channel: optionalShort(pick(body, 'channel'), 'channel'),
    description: optionalShort(pick(body, 'description'), 'description'),
    language: optionalLanguage(pick(body, 'language')),
    paymentTermsDays: optionalTerms(pick(body, 'payment_terms_days', 'paymentTermsDays')),
    paymentMethod: optionalPayment(pick(body, 'payment_method', 'paymentMethod')),
    operationDate: optionalDay(pick(body, 'operation_date', 'operationDate'), 'operation_date'),
    issueDate: optionalDay(pick(body, 'issue_date', 'issueDate'), 'issue_date'),
    notes: optionalShort(pick(body, 'notes'), 'notes'),
    incoterm: optionalIncoterm(pick(body, 'incoterm')),
    fromDeliveryNotes: fromNotes,
    fromOrder: fromOrderRaw ? fromOrderRaw.toLowerCase() : null,
    lines: parseLines(pick(body, 'lines')),
    rectifies,
    reason: optionalShort(pick(body, 'reason'), 'reason'),
    noPhysicalReturn: physical.noPhysicalReturn,
    returnDeliveryNote: physical.returnDeliveryNote,
  };
}

function parsePatch(raw: unknown): Patch {
  const body = objectBody(raw);
  const patch: Patch = {};
  if (pick(body, 'legal_entity_id', 'legalEntityId') !== undefined) {
    const id = optionalUuid(pick(body, 'legal_entity_id', 'legalEntityId'), 'legal_entity_id');
    if (!id) throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
    patch.legalEntityId = id;
  }
  if (pick(body, 'customer_id', 'customerId') !== undefined) {
    const id = optionalUuid(pick(body, 'customer_id', 'customerId'), 'customer_id');
    if (!id) throw domainError('WC_VALIDATION', { customer_id: 'Identificador no válido' });
    patch.customerId = id;
  }
  if (pick(body, 'series_id', 'seriesId') !== undefined) {
    patch.seriesId = optionalUuid(pick(body, 'series_id', 'seriesId'), 'series_id');
  }
  if (pick(body, 'channel') !== undefined) patch.channel = optionalShort(pick(body, 'channel'), 'channel');
  if (pick(body, 'description') !== undefined) {
    const description = optionalShort(pick(body, 'description'), 'description');
    if (!description) throw domainError('WC_VALIDATION', { description: 'La descripción es obligatoria' });
    patch.description = description;
  }
  if (pick(body, 'language') !== undefined) {
    const language = optionalLanguage(pick(body, 'language'));
    if (!language) throw domainError('WC_VALIDATION', { language: 'Debe ser es o en' });
    patch.language = language;
  }
  if (pick(body, 'payment_terms_days', 'paymentTermsDays') !== undefined) {
    const terms = optionalTerms(pick(body, 'payment_terms_days', 'paymentTermsDays'));
    if (terms == null) throw domainError('WC_VALIDATION', { payment_terms_days: 'Debe ser un entero entre 0 y 180' });
    patch.paymentTermsDays = terms;
  }
  if (pick(body, 'payment_method', 'paymentMethod') !== undefined) {
    patch.paymentMethod = optionalPayment(pick(body, 'payment_method', 'paymentMethod'));
  }
  if (pick(body, 'operation_date', 'operationDate') !== undefined) {
    patch.operationDate = optionalDay(pick(body, 'operation_date', 'operationDate'), 'operation_date');
  }
  if (pick(body, 'issue_date', 'issueDate') !== undefined) {
    patch.issueDate = optionalDay(pick(body, 'issue_date', 'issueDate'), 'issue_date');
  }
  if (pick(body, 'notes') !== undefined) patch.notes = optionalShort(pick(body, 'notes'), 'notes');
  if (pick(body, 'incoterm') !== undefined) patch.incoterm = optionalIncoterm(pick(body, 'incoterm'));
  if (pick(body, 'lines') !== undefined) {
    const lines = parseLines(pick(body, 'lines'));
    patch.lines = lines ?? [];
  }
  if (pick(body, 'no_physical_return', 'noPhysicalReturn') !== undefined) {
    patch.noPhysicalReturn = optionalBool(pick(body, 'no_physical_return', 'noPhysicalReturn'), 'no_physical_return');
  }
  if (pick(body, 'return_delivery_note', 'returnDeliveryNote') !== undefined) {
    patch.returnDeliveryNote = optionalReturnNote(pick(body, 'return_delivery_note', 'returnDeliveryNote'));
  }
  return patch;
}

function physicalReturnOf(
  current: { invoiceType: string; noPhysicalReturn: boolean | null; returnDeliveryNote: string | null },
  patch: Patch,
): { noPhysicalReturn: boolean | null; returnDeliveryNote: string | null } {
  const touched = patch.noPhysicalReturn !== undefined || patch.returnDeliveryNote !== undefined;
  if (!isRectificationType(current.invoiceType)) {
    if (touched) {
      throw domainError('WC_VALIDATION', { no_physical_return: 'Solo una rectificativa indica si hay devolución física' });
    }
    return { noPhysicalReturn: null, returnDeliveryNote: null };
  }
  return combinePhysicalReturn(
    patch.noPhysicalReturn === undefined ? current.noPhysicalReturn : patch.noPhysicalReturn,
    patch.returnDeliveryNote === undefined ? current.returnDeliveryNote : patch.returnDeliveryNote,
  );
}

function physicalReturnInput(
  body: Record<string, unknown>,
  rectification: boolean,
  current: { noPhysicalReturn: boolean | null; returnDeliveryNote: string | null } | null,
): { noPhysicalReturn: boolean | null; returnDeliveryNote: string | null } {
  const flagValue = pick(body, 'no_physical_return', 'noPhysicalReturn');
  const noteValue = pick(body, 'return_delivery_note', 'returnDeliveryNote');
  const touched = flagValue !== undefined || noteValue !== undefined;
  if (!rectification) {
    if (touched) {
      throw domainError('WC_VALIDATION', { no_physical_return: 'Solo una rectificativa indica si hay devolución física' });
    }
    return { noPhysicalReturn: null, returnDeliveryNote: null };
  }
  const flag = flagValue === undefined ? current?.noPhysicalReturn ?? null : optionalBool(flagValue, 'no_physical_return');
  const note = noteValue === undefined ? current?.returnDeliveryNote ?? null : optionalReturnNote(noteValue);
  return combinePhysicalReturn(flag, note);
}

function combinePhysicalReturn(
  flag: boolean | null,
  note: string | null,
): { noPhysicalReturn: boolean | null; returnDeliveryNote: string | null } {
  if (flag === true && note) {
    throw domainError('WC_VALIDATION', { return_delivery_note: 'Sin devolución física no admite albarán de devolución' });
  }
  const noPhysicalReturn = note && flag == null ? false : flag;
  return { noPhysicalReturn, returnDeliveryNote: note };
}

function optionalBool(value: unknown, field: string): boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  throw domainError('WC_VALIDATION', { [field]: 'Debe ser sí o no' });
}

function optionalReturnNote(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { return_delivery_note: 'Debe ser texto' });
  const trimmed = value.trim();
  if (trimmed.length > 80) throw domainError('WC_VALIDATION', { return_delivery_note: 'El albarán de devolución es demasiado largo' });
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    throw domainError('WC_VALIDATION', { return_delivery_note: 'No puede contener saltos de línea' });
  }
  return trimmed;
}

function parseLines(value: unknown): ManualLine[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw domainError('WC_VALIDATION', { lines: 'Las líneas deben ser una lista' });
  return value.map((item, index) => parseLine(item, index));
}

function parseLine(value: unknown, index: number): ManualLine {
  const field = `lines.${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Línea no válida' });
  }
  const body = value as Record<string, unknown>;
  const productId = text(pick(body, 'product_id', 'productId'));
  if (!productId || !isUuid(productId)) throw domainError('WC_VALIDATION', { [`${field}.product_id`]: 'El producto es obligatorio' });
  const quantity = requiredDecimal(pick(body, 'quantity', 'qty'), `${field}.quantity`);
  const priceRaw = pick(body, 'unit_price', 'unitPrice');
  const lotId = optionalUuid(pick(body, 'lot_id', 'lotId'), `${field}.lot_id`);
  const lotCode = optionalShort(pick(body, 'lot_code', 'lotCode'), `${field}.lot_code`);
  return {
    productId: productId.toLowerCase(),
    description: optionalShort(pick(body, 'description'), `${field}.description`),
    quantity,
    unitPrice: priceRaw == null || priceRaw === '' ? null : requiredDecimal(priceRaw, `${field}.unit_price`),
    discountPct: pick(body, 'discount_pct', 'discountPct') == null
      ? decimalOf('0')
      : requiredDecimal(pick(body, 'discount_pct', 'discountPct'), `${field}.discount_pct`),
    taxCode: optionalShort(pick(body, 'tax_code', 'taxCode'), `${field}.tax_code`),
    lotId,
    lotCode,
    deliveryNoteLineId: optionalUuid(pick(body, 'delivery_note_line_id'), `${field}.delivery_note_line_id`),
    orderLineId: optionalUuid(pick(body, 'order_line_id'), `${field}.order_line_id`),
  };
}

function objectBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  return raw as Record<string, unknown>;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  return value.toLowerCase();
}

function uuidList(value: unknown, field: string): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0) throw domainError('WC_VALIDATION', { [field]: 'Indica al menos un identificador' });
  return value.map((item) => {
    if (typeof item !== 'string' || !isUuid(item)) throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
    return item.toLowerCase();
  });
}

function optionalShort(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Debe ser texto' });
  const trimmed = value.trim();
  if (trimmed.length > 2000) throw domainError('WC_VALIDATION', { [field]: 'El texto es demasiado largo' });
  return trimmed;
}

function optionalLanguage(value: unknown): 'es' | 'en' | null {
  if (value == null || value === '') return null;
  if (value !== 'es' && value !== 'en') throw domainError('WC_VALIDATION', { language: 'Debe ser es o en' });
  return value;
}

function optionalTerms(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 180) {
    throw domainError('WC_VALIDATION', { payment_terms_days: 'Debe ser un entero entre 0 y 180' });
  }
  return value;
}

function optionalPayment(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !PAYMENTS.has(value)) {
    throw domainError('WC_VALIDATION', { payment_method: 'Forma de pago no válida' });
  }
  return value;
}

function optionalDay(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Usa la fecha AAAA-MM-DD' });
  }
  return value;
}

function optionalIncoterm(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !INCOTERMS.has(value)) {
    throw domainError('WC_VALIDATION', { incoterm: 'Incoterm no válido' });
  }
  return value;
}

function requiredDecimal(value: unknown, field: string): Decimal {
  try {
    return decimalOf(value);
  } catch {
    throw domainError('WC_VALIDATION', { [field]: 'Importe no válido' });
  }
}

import { sessionOf } from '../../auth/guard';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { businessDate } from '../time';
import {
  actorOf,
  asRecord,
  assertActiveEntity,
  assertChannel,
  assignNumber,
  boolOf,
  dateOf,
  decOf,
  fail,
  idOf,
  loadCustomer,
  newRowId,
  optionalId,
  optionalText,
  parseDate,
  parseIncoterm,
  pathId,
  priceText,
  qtyText,
  readJson,
  taxRateOf,
  textOf,
  throwIf,
  UUID_RE,
} from './db';
import { createSalesOrder } from './orders';
import { parseCommercialLines, resolveLinePrice } from './pricing';
import { renderQuotePdf } from './proforma';
import { draftEntity, previewIssuingEntity } from './rules';
import { priceTotals, type PricedLine } from './totals';

type ReadDb = Pick<Tx, 'read'>;

type QuoteLine = {
  id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  tax_code: string;
};

async function loadQuote(tx: ReadDb, id: string): Promise<Record<string, unknown>> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT * FROM sales.quote WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function loadQuoteLines(tx: ReadDb, id: string): Promise<QuoteLine[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, line_no, product_id, description, quantity, unit_price, discount_pct, tax_code
    FROM sales.quote_line WHERE quote_id = CAST(${id} AS UUID) ORDER BY line_no
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    line_no: Number(row.line_no),
    product_id: row.product_id == null ? null : idOf(row.product_id),
    description: String(row.description),
    quantity: decOf(row.quantity).toFixed(3),
    unit_price: priceText(decOf(row.unit_price)),
    discount_pct: decOf(row.discount_pct).toFixed(2),
    tax_code: String(row.tax_code),
  }));
}

function quoteJson(row: Record<string, unknown>, lines: QuoteLine[]): Record<string, unknown> {
  return {
    id: idOf(row.id),
    legal_entity_id: idOf(row.legal_entity_id),
    series_id: row.series_id == null ? null : idOf(row.series_id),
    number: textOf(row.number),
    status: String(row.status),
    customer_id: idOf(row.customer_id),
    channel: String(row.channel),
    issue_date: row.issue_date == null ? null : dateOf(row.issue_date),
    valid_until: row.valid_until == null ? null : dateOf(row.valid_until),
    currency: String(row.currency),
    language: String(row.language),
    is_proforma: boolOf(row.is_proforma),
    incoterm: textOf(row.incoterm),
    notes: textOf(row.notes),
    subtotal: decOf(row.subtotal).toFixed(2),
    tax_total: decOf(row.tax_total).toFixed(2),
    total: decOf(row.total).toFixed(2),
    lines,
  };
}

export async function listQuotes(writer: Writer, request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.get('cursor');
  const rows = await writer.read<Record<string, unknown>>(cursor
    ? sql`SELECT * FROM sales.quote WHERE id < CAST(${cursor} AS UUID) ORDER BY id DESC LIMIT ${limit + 1}`
    : sql`SELECT * FROM sales.quote ORDER BY id DESC LIMIT ${limit + 1}`);
  const page = rows.length > limit ? rows.slice(0, limit) : rows;
  const items = [];
  for (const row of page) items.push(quoteJson(row, await loadQuoteLines(writer, idOf(row.id))));
  const last = page[page.length - 1];
  return { items, next_cursor: rows.length > limit && last ? idOf(last.id) : null };
}

export async function getQuote(writer: Writer, id: string): Promise<Record<string, unknown>> {
  const quoteId = pathId(id);
  const row = await loadQuote(writer, quoteId);
  return quoteJson(row, await loadQuoteLines(writer, quoteId));
}

export async function createQuote(writer: Writer, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = sessionOf(request);
  const raw = asRecord(await readJson(request));
  const fields: Record<string, string> = {};
  const customerId = typeof raw.customer_id === 'string' ? raw.customer_id.trim().toLowerCase() : '';
  if (!/^[0-9a-f-]{36}$/.test(customerId)) fields.customer_id = 'Identificador no válido';
  const channel = typeof raw.channel === 'string' ? raw.channel : '';
  const language = raw.language == null || raw.language === '' ? 'es' : raw.language;
  if (language !== 'es' && language !== 'en') fields.language = 'El idioma debe ser es o en';
  const isProforma = raw.is_proforma === true;
  const incoterm = parseIncoterm(raw.incoterm, 'incoterm', fields);
  const notes = optionalText(raw.notes, 'notes', fields, 2000);
  const validUntil = parseDate(raw.valid_until, 'valid_until', fields, false);
  const explicitEntity = optionalId(raw.legal_entity_id, 'legal_entity_id', fields);
  const lines = Array.isArray(raw.lines) ? raw.lines : null;
  if (!lines) fields.lines = 'Hace falta al menos una línea';
  throwIf(fields);
  if (!lines) fail('Hace falta al menos una línea');
  const parsed = parseCommercialLines(lines);
  const actor = actorOf(user, request);
  const id = newRowId();
  const now = new Date();
  const issueDate = businessDate(now);
  const body = await writer.withWrite(actor, async (tx) => {
    if (!channel) fail('El canal es obligatorio', { channel: 'Obligatorio' });
    await assertChannel(tx, channel);
    const customer = await loadCustomer(tx, customerId);
    if (!customer.is_customer) fail('El contacto no es cliente', { customer_id: customerId });
    if (explicitEntity) await assertActiveEntity(tx, explicitEntity);
    const { entityId, rule } = await draftEntity(tx, { customerId, channel, actorId: actor.id, entityId: explicitEntity });
    const priced = await priceQuoteLines(tx, parsed, issueDate, customer.default_price_list_id, channel);
    const totals = priceTotals(priced.totals);
    tx.write(sql`
      INSERT INTO sales.quote (
        id, legal_entity_id, status, customer_id, channel, currency, language, is_proforma,
        incoterm, notes, valid_until, subtotal, tax_total, total, created_by, created_at, updated_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${entityId} AS UUID), 'draft', CAST(${customerId} AS UUID),
        ${channel}, 'EUR', ${language}, ${isProforma}, ${incoterm}, ${notes},
        CASE WHEN ${validUntil} IS NULL THEN NULL ELSE CAST(${validUntil} AS DATE) END,
        CAST(${totals.subtotal} AS DECIMAL(14,2)), CAST(${totals.tax_total} AS DECIMAL(14,2)),
        CAST(${totals.total} AS DECIMAL(14,2)), ${actor.id}, ${now}, ${now}
      )
    `);
    const lines = insertQuoteLines(tx, id, priced.rows);
    tx.audit({
      table: 'sales.quote',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        customer_id: customerId,
        channel,
        is_proforma: isProforma,
        legal_entity_id: entityId,
        total: totals.total,
        ...(rule === null
          ? { entity_choice: 'manual', rule_id: null }
          : entityId === rule.entityId ? {} : { rule_entity_id: rule.entityId, rule_id: rule.ruleId }),
      },
    });
    return quoteJson({
      id,
      legal_entity_id: entityId,
      series_id: null,
      number: null,
      status: 'draft',
      customer_id: customerId,
      channel,
      issue_date: null,
      valid_until: validUntil,
      currency: 'EUR',
      language,
      is_proforma: isProforma,
      incoterm,
      notes,
      subtotal: totals.subtotal,
      tax_total: totals.tax_total,
      total: totals.total,
    }, lines);
  });
  return { status: 201, body };
}

async function priceQuoteLines(
  tx: Tx,
  lines: ReturnType<typeof parseCommercialLines>,
  date: string,
  priceListId: string | null,
  channel: string,
): Promise<{ rows: { line: ReturnType<typeof parseCommercialLines>[number]; price: Awaited<ReturnType<typeof resolveLinePrice>> }[]; totals: PricedLine[] }> {
  const rows = [];
  const totals: PricedLine[] = [];
  for (const line of lines) {
    const price = await resolveLinePrice(tx, line, date, priceListId, channel);
    const rate = await taxRateOf(tx, price.taxCode);
    rows.push({ line, price });
    totals.push({
      quantity: line.quantity,
      unitPrice: price.unitPrice,
      discountPct: line.discountPct,
      taxCode: price.taxCode,
      taxRate: rate,
    });
  }
  return { rows, totals };
}

function insertQuoteLines(
  tx: Tx,
  quoteId: string,
  rows: { line: ReturnType<typeof parseCommercialLines>[number]; price: Awaited<ReturnType<typeof resolveLinePrice>> }[],
): QuoteLine[] {
  return rows.map((entry, index) => {
    const id = newRowId();
    tx.write(sql`
      INSERT INTO sales.quote_line (
        id, quote_id, line_no, product_id, description, quantity, unit_price, discount_pct, tax_code
      ) VALUES (
        CAST(${id} AS UUID), CAST(${quoteId} AS UUID), ${index + 1}, CAST(${entry.line.productId} AS UUID),
        ${entry.price.description}, CAST(${qtyText(entry.line.quantity)} AS DECIMAL(14,3)),
        CAST(${priceText(entry.price.unitPrice)} AS DECIMAL(14,6)),
        CAST(${entry.line.discountPct.toFixed(2)} AS DECIMAL(5,2)), ${entry.price.taxCode}
      )
    `);
    tx.audit({
      table: 'sales.quote_line',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { quote_id: quoteId, line_no: index + 1, product_id: entry.line.productId, quantity: qtyText(entry.line.quantity) },
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
    };
  });
}

export async function sendQuote(writer: Writer, request: Request, id: string): Promise<Record<string, unknown>> {
  const user = sessionOf(request);
  const quoteId = pathId(id);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, async (tx) => {
    const row = await loadQuote(tx, quoteId);
    const lines = await loadQuoteLines(tx, quoteId);
    const numbered = await ensureNumber(tx, row, 'sent');
    return quoteJson({ ...row, ...numbered, status: 'sent' }, lines);
  });
}

async function ensureNumber(tx: Tx, row: Record<string, unknown>, status: string): Promise<{ number: string; series_id: string; issue_date: string }> {
  if (String(row.status) === 'converted') fail('El presupuesto ya se convirtió en pedido');
  if (String(row.status) === 'rejected' || String(row.status) === 'expired') fail('El presupuesto está cerrado');
  const now = new Date();
  let number = textOf(row.number);
  let seriesId = row.series_id == null ? null : idOf(row.series_id);
  if (!number || !seriesId) {
    const docType = boolOf(row.is_proforma) ? 'proforma' : 'quote';
    const taken = await assignNumber(tx, idOf(row.legal_entity_id), docType, now);
    number = taken.number;
    seriesId = taken.seriesId;
  }
  const issueDate = row.issue_date == null ? businessDate(now) : dateOf(row.issue_date);
  tx.write(sql`
    UPDATE sales.quote
    SET status = ${status}, number = ${number},
        series_id = CAST(${seriesId} AS UUID),
        issue_date = CAST(${issueDate} AS DATE), updated_at = ${now}
    WHERE id = CAST(${idOf(row.id)} AS UUID)
  `);
  tx.audit({
    table: 'sales.quote',
    rowId: idOf(row.id),
    action: 'UPDATE',
    before: { status: String(row.status), number: textOf(row.number) },
    after: { status, number },
  });
  return { number, series_id: seriesId, issue_date: issueDate };
}

export async function quoteToOrder(writer: Writer, request: Request, id: string): Promise<{ status: number; body: unknown }> {
  const user = sessionOf(request);
  const quoteId = pathId(id);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, async (tx) => {
    const row = await loadQuote(tx, quoteId);
    if (String(row.status) === 'converted') fail('El presupuesto ya se convirtió en pedido');
    if (String(row.status) === 'rejected' || String(row.status) === 'expired') fail('El presupuesto está cerrado');
    await ensureNumber(tx, row, 'converted');
    const lines = await loadQuoteLines(tx, quoteId);
    const fresh = row;
    const order = await createSalesOrder(tx, actor, {
      customer_id: idOf(fresh.customer_id),
      legal_entity_id: idOf(fresh.legal_entity_id),
      channel: String(fresh.channel),
      source: 'manual',
      order_date: businessDate(new Date()),
      incoterm: textOf(fresh.incoterm),
      notes: textOf(fresh.notes),
      quote_id: quoteId,
      lines: lines.map((line) => ({
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_pct: line.discount_pct,
        tax_code: line.tax_code,
        description: line.description,
        price_reason: 'Precio del presupuesto',
      })),
    });
    return order;
  });
}

export async function quotePdf(writer: Writer, request: Request, id: string): Promise<Response> {
  sessionOf(request);
  const quote = await getQuote(writer, id);
  const { bytes, filename } = await renderQuotePdf(writer, quote);
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` },
  });
}

export async function acceptQuote(writer: Writer, request: Request, id: string): Promise<Record<string, unknown>> {
  return transitQuote(writer, request, id, 'accepted');
}

export async function rejectQuote(writer: Writer, request: Request, id: string): Promise<Record<string, unknown>> {
  const body = await readOptionalJson(request);
  const reason = reasonOf(body);
  return transitQuote(writer, request, id, 'rejected', reason);
}

async function transitQuote(
  writer: Writer,
  request: Request,
  id: string,
  target: 'accepted' | 'rejected',
  reason: string | null = null,
): Promise<Record<string, unknown>> {
  const user = sessionOf(request);
  const quoteId = pathId(id);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, async (tx) => {
    const row = await loadQuote(tx, quoteId);
    const status = String(row.status);
    if (status === target) return quoteJson(row, await loadQuoteLines(tx, quoteId));
    if (status === 'converted') fail('El presupuesto ya se convirtió en pedido');
    if (status !== 'draft' && status !== 'sent') {
      fail(target === 'accepted'
        ? 'Solo se puede aceptar un presupuesto en borrador o enviado'
        : 'Solo se puede rechazar un presupuesto en borrador o enviado');
    }
    const lines = await loadQuoteLines(tx, quoteId);
    const numbered = await ensureNumber(tx, row, target);
    if (reason) {
      tx.audit({
        table: 'sales.quote',
        rowId: quoteId,
        action: 'UPDATE',
        before: { status },
        after: { status: target, reason },
      });
    }
    return quoteJson({ ...row, ...numbered, status: target }, lines);
  });
}

export async function patchQuote(writer: Writer, request: Request, id: string): Promise<Record<string, unknown>> {
  const user = sessionOf(request);
  const quoteId = pathId(id);
  const raw = asRecord(await readJson(request));
  const actor = actorOf(user, request);
  const reading: Tx = {
    read: (statement) => writer.read(statement),
    write() {
      throw domainError('WC_VALIDATION');
    },
    audit() {
      throw domainError('WC_VALIDATION');
    },
  };
  const plan = await prepareQuotePatch(reading, quoteId, raw);
  if (!plan) {
    const row = await loadQuote(writer, quoteId);
    return quoteJson(row, await loadQuoteLines(writer, quoteId));
  }
  // DuckDB no puede cambiar la clave foránea channel mientras el presupuesto tiene líneas.
  if (plan.channelChanged) {
    await writer.withWrite(actor, async (tx) => {
      dropQuoteLines(tx, quoteId, plan.previousLines);
    });
  }
  return writer.withWrite(actor, async (tx) => {
    const now = new Date();
    if (plan.channelChanged) {
      tx.write(sql`
        UPDATE sales.quote SET
          legal_entity_id = CAST(${plan.entityId} AS UUID),
          customer_id = CAST(${plan.customerId} AS UUID),
          channel = ${plan.channel},
          language = ${plan.language},
          is_proforma = ${plan.isProforma},
          incoterm = ${plan.incoterm},
          notes = ${plan.notes},
          valid_until = CASE WHEN ${plan.validUntil} IS NULL THEN NULL ELSE CAST(${plan.validUntil} AS DATE) END,
          subtotal = CAST(${plan.subtotal} AS DECIMAL(14,2)),
          tax_total = CAST(${plan.taxTotal} AS DECIMAL(14,2)),
          total = CAST(${plan.total} AS DECIMAL(14,2)),
          updated_at = ${now}
        WHERE id = CAST(${quoteId} AS UUID) AND status = 'draft'
      `);
    } else {
      tx.write(sql`
        UPDATE sales.quote SET
          legal_entity_id = CAST(${plan.entityId} AS UUID),
          customer_id = CAST(${plan.customerId} AS UUID),
          language = ${plan.language},
          is_proforma = ${plan.isProforma},
          incoterm = ${plan.incoterm},
          notes = ${plan.notes},
          valid_until = CASE WHEN ${plan.validUntil} IS NULL THEN NULL ELSE CAST(${plan.validUntil} AS DATE) END,
          subtotal = CAST(${plan.subtotal} AS DECIMAL(14,2)),
          tax_total = CAST(${plan.taxTotal} AS DECIMAL(14,2)),
          total = CAST(${plan.total} AS DECIMAL(14,2)),
          updated_at = ${now}
        WHERE id = CAST(${quoteId} AS UUID) AND status = 'draft'
      `);
    }
    if (plan.priced && !plan.channelChanged) dropQuoteLines(tx, quoteId, plan.previousLines);
    const lines = plan.priced
      ? insertQuoteLines(tx, quoteId, plan.priced.rows)
      : plan.previousLines;
    tx.audit({
      table: 'sales.quote',
      rowId: quoteId,
      action: 'UPDATE',
      before: { status: 'draft', customer_id: plan.beforeCustomerId, channel: plan.beforeChannel, total: plan.beforeTotal },
      after: { status: 'draft', customer_id: plan.customerId, channel: plan.channel, total: plan.total },
    });
    return quoteJson({
      ...plan.row,
      legal_entity_id: plan.entityId,
      customer_id: plan.customerId,
      channel: plan.channel,
      language: plan.language,
      is_proforma: plan.isProforma,
      incoterm: plan.incoterm,
      notes: plan.notes,
      valid_until: plan.validUntil,
      subtotal: plan.subtotal,
      tax_total: plan.taxTotal,
      total: plan.total,
    }, lines);
  });
}

type PricedRows = Awaited<ReturnType<typeof priceQuoteLines>>;

async function prepareQuotePatch(tx: Tx, quoteId: string, raw: Record<string, unknown>) {
  const row = await loadQuote(tx, quoteId);
  if (String(row.status) !== 'draft') fail('Solo se puede editar un presupuesto en borrador');
  const currentLines = await loadQuoteLines(tx, quoteId);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
  const fields: Record<string, string> = {};
  let customerId = idOf(row.customer_id);
  if (has('customer_id')) {
    const next = typeof raw.customer_id === 'string' ? raw.customer_id.trim().toLowerCase() : '';
    if (!UUID_RE.test(next)) fields.customer_id = 'Identificador no válido';
    else customerId = next;
  }
  let channel = String(row.channel);
  if (has('channel')) {
    channel = typeof raw.channel === 'string' ? raw.channel.trim() : '';
    if (!channel) fields.channel = 'El canal es obligatorio';
  }
  let language = String(row.language);
  if (has('language')) {
    language = raw.language == null || raw.language === '' ? 'es' : String(raw.language);
    if (language !== 'es' && language !== 'en') fields.language = 'El idioma debe ser es o en';
  }
  let isProforma = boolOf(row.is_proforma);
  if (has('is_proforma')) {
    if (typeof raw.is_proforma !== 'boolean') fields.is_proforma = 'Debe ser verdadero o falso';
    else isProforma = raw.is_proforma;
  }
  let incoterm = textOf(row.incoterm);
  if (has('incoterm')) incoterm = parseIncoterm(raw.incoterm, 'incoterm', fields);
  let notes = textOf(row.notes);
  if (has('notes')) notes = optionalText(raw.notes, 'notes', fields, 2000);
  let validUntil = row.valid_until == null ? null : dateOf(row.valid_until);
  if (has('valid_until')) validUntil = parseDate(raw.valid_until, 'valid_until', fields, false);
  if (has('lines') && !Array.isArray(raw.lines)) fields.lines = 'Hace falta al menos una línea';
  throwIf(fields);

  const customerChanged = customerId !== idOf(row.customer_id);
  const channelChanged = channel !== String(row.channel);
  const replaceLines = has('lines');
  const reprice = replaceLines || customerChanged || channelChanged;
  if (!reprice && !has('language') && !has('is_proforma') && !has('incoterm') && !has('notes') && !has('valid_until')) {
    return null;
  }

  let entityId = idOf(row.legal_entity_id);
  let priceListId: string | null = null;
  if (reprice) {
    if (channelChanged || replaceLines) await assertChannel(tx, channel);
    const customer = await loadCustomer(tx, customerId);
    if (!customer.is_customer) fail('El contacto no es cliente', { customer_id: customerId });
    priceListId = customer.default_price_list_id;
    if (customerChanged || channelChanged) {
      const resolved = await previewIssuingEntity(tx, { customerId, channel });
      if (resolved) entityId = resolved.entityId;
    }
  }

  let subtotal = decOf(row.subtotal).toFixed(2);
  let taxTotal = decOf(row.tax_total).toFixed(2);
  let total = decOf(row.total).toFixed(2);
  let priced: PricedRows | null = null;
  if (reprice) {
    const commercial = replaceLines
      ? parseCommercialLines(raw.lines)
      : currentLines.map((line) => {
          if (!line.product_id) fail('La línea no tiene producto', { lines: 'Producto obligatorio' });
          return {
            productId: line.product_id,
            quantity: decOf(line.quantity),
            discountPct: decOf(line.discount_pct),
            unitPrice: null,
            priceReason: null,
            taxCode: line.tax_code,
            description: line.description,
          };
        });
    priced = await priceQuoteLines(tx, commercial, businessDate(new Date()), priceListId, channel);
    const totals = priceTotals(priced.totals);
    subtotal = totals.subtotal;
    taxTotal = totals.tax_total;
    total = totals.total;
  }

  return {
    row,
    previousLines: currentLines,
    priced,
    channelChanged,
    entityId,
    customerId,
    channel,
    language,
    isProforma,
    incoterm,
    notes,
    validUntil,
    subtotal,
    taxTotal,
    total,
    beforeCustomerId: idOf(row.customer_id),
    beforeChannel: String(row.channel),
    beforeTotal: decOf(row.total).toFixed(2),
  };
}

function dropQuoteLines(tx: Tx, quoteId: string, lines: QuoteLine[]): void {
  for (const line of lines) {
    tx.write(sql`DELETE FROM sales.quote_line WHERE id = CAST(${line.id} AS UUID)`);
    tx.audit({
      table: 'sales.quote_line',
      rowId: line.id,
      action: 'DELETE',
      before: { quote_id: quoteId, line_no: line.line_no, product_id: line.product_id },
      after: null,
    });
  }
}

function reasonOf(body: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, 'reason') || body.reason == null || body.reason === '') return null;
  if (typeof body.reason !== 'string') fail('El motivo debe tener entre 3 y 500 caracteres', { reason: 'No válido' });
  const reason = body.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    fail('El motivo debe tener entre 3 y 500 caracteres', { reason: 'No válido' });
  }
  return reason;
}

async function readOptionalJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

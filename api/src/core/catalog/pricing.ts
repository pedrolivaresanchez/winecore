import { Decimal } from 'decimal.js';
import { payloadSha256 } from '../approvals/canonical';
import { loadApprovalPolicies } from '../approvals/policy-store';
import { approvalServiceOn } from '../approvals/sql-store';
import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import {
  FieldBag,
  PriceDecimal,
  boolValue,
  dateValue,
  decimalValue,
  hasKey,
  isUuid,
  readObject,
  rejectUnknown,
  requireUuid,
  scale,
  textValue,
} from './fields';
import { activeParam, asCount, cursorParam, limitParam, pageOf } from './query';
import { asBool, asNullableString, asString } from './rows';

/**
 * `POST .../request-activation` abre una aprobación `tariff_activation` ligada
 * al hash de la tabla de precios. La versión sigue en borrador hasta que esa
 * aprobación se consume (`executeTariffActivation`).
 */

const LIST_CODE = /^(?:final|distributor|shop|custom-[a-z0-9-]{2,30})$/;
const LIST_FIELDS = ['code', 'name', 'currency', 'tax_included', 'is_active'] as const;
const LIST_PATCH = ['name', 'currency', 'tax_included', 'is_active'] as const;
const VERSION_FIELDS = ['valid_from', 'valid_to', 'notes'] as const;
const ITEM_FIELDS = ['product_id', 'min_qty', 'unit_price'] as const;

const CHANNEL_LIST: Record<string, string> = {
  direct: 'final',
  distributor: 'distributor',
  horeca: 'final',
  eci_edi: 'distributor',
  web: 'shop',
  fair: 'final',
  cellar_shop: 'shop',
  export: 'final',
  institutional: 'final',
  intercompany: 'distributor',
};

export interface PriceList {
  id: string;
  code: string;
  name: string;
  currency: string;
  tax_included: boolean;
  is_active: boolean;
}

export interface PriceItem {
  id: string;
  version_id: string;
  product_id: string;
  min_qty: string;
  unit_price: string;
}

export interface PriceVersion {
  id: string;
  price_list_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: string;
  notes: string | null;
  approval_request_id: string | null;
  activated_at: string | null;
  created_by: string;
  created_at: string;
  items: PriceItem[];
}

export interface DateRange {
  valid_from: string;
  valid_to: string | null;
}

export interface PriceQuote {
  unitPrice: Decimal;
  minQty: Decimal;
  priceListVersionId: string;
  priceListId: string;
  priceListCode: string;
  currency: string;
}

interface Reader {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
}

export function rangesOverlap(left: DateRange, right: DateRange): boolean {
  const leftStartsBeforeRightEnds = right.valid_to === null || left.valid_from < right.valid_to;
  const rightStartsBeforeLeftEnds = left.valid_to === null || right.valid_from < left.valid_to;
  return leftStartsBeforeRightEnds && rightStartsBeforeLeftEnds;
}

export async function priceFor(
  db: Reader,
  input: { customerId: string; productId: string; qty: Decimal; date: string },
): Promise<PriceQuote> {
  if (!(input.qty instanceof Decimal) || !input.qty.isFinite()) {
    throw domainError('WC_VALIDATION', { qty: 'Cantidad no válida' });
  }
  if (!isUuid(input.customerId)) throw domainError('WC_VALIDATION', { customer_id: 'Identificador no válido' });
  if (!isUuid(input.productId)) throw domainError('WC_VALIDATION', { product_id: 'Identificador no válido' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw domainError('WC_VALIDATION', { date: 'Fecha no válida' });
  const contacts = await db.read<{
    id: string;
    default_channel: string | null;
    default_price_list_id: string | null;
    archived_at: string | null;
  }>(sql`
    SELECT id, default_channel, default_price_list_id, archived_at
    FROM party.contact
    WHERE id = CAST(${input.customerId} AS UUID)
  `);
  const contact = contacts[0];
  if (!contact) throw domainError('WC_NOT_FOUND');
  if (contact.archived_at != null) throw domainError('WC_VALIDATION', { customer_id: 'El contacto está archivado' });
  const products = await db.read<{ id: string }>(sql`
    SELECT id FROM catalog.product WHERE id = CAST(${input.productId} AS UUID)
  `);
  if (products.length === 0) throw domainError('WC_NOT_FOUND');
  const list = await resolveList(db, contact);
  const versions = await db.read<{ id: string }>(sql`
    SELECT id
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${list.id} AS UUID)
      AND status = 'active'
      AND valid_from <= CAST(${input.date} AS DATE)
      AND (valid_to IS NULL OR valid_to > CAST(${input.date} AS DATE))
    ORDER BY valid_from DESC, version DESC
    LIMIT 1
  `);
  const versionId = versions[0]?.id;
  if (!versionId) {
    throw domainError('WC_VALIDATION', { product_id: 'No hay un precio vigente para este producto' });
  }
  const items = await db.read<{ min_qty_text: string; unit_price_text: string }>(sql`
    SELECT CAST(min_qty AS VARCHAR) AS min_qty_text, CAST(unit_price AS VARCHAR) AS unit_price_text
    FROM catalog.price_list_item
    WHERE version_id = CAST(${versionId} AS UUID)
      AND product_id = CAST(${input.productId} AS UUID)
      AND min_qty <= ${input.qty}
    ORDER BY min_qty DESC
    LIMIT 1
  `);
  const item = items[0];
  if (!item) throw domainError('WC_VALIDATION', { product_id: 'No hay un precio vigente para este producto' });
  return {
    unitPrice: new PriceDecimal(item.unit_price_text),
    minQty: new PriceDecimal(item.min_qty_text),
    priceListVersionId: versionId,
    priceListId: list.id,
    priceListCode: list.code,
    currency: list.currency,
  };
}

export function tariffPayload(version: PriceVersion) {
  const items = [...version.items]
    .map((item) => ({
      product_id: item.product_id,
      min_qty: item.min_qty,
      unit_price: item.unit_price,
    }))
    .sort((left, right) => left.product_id.localeCompare(right.product_id) || left.min_qty.localeCompare(right.min_qty));
  return {
    price_list_id: version.price_list_id,
    version_id: version.id,
    version: version.version,
    valid_from: version.valid_from,
    valid_to: version.valid_to,
    items,
  };
}

export async function requestVersionActivation(
  writer: Writer,
  actor: Actor,
  priceListId: string,
  versionParam: string,
): Promise<{ approval_request_id: string; payload_sha256: string; status: 'pending'; version_status: 'draft' }> {
  requireUuid(priceListId);
  const versionNo = parseVersionParam(versionParam);
  const list = await requireList(writer, priceListId);
  const policies = await loadApprovalPolicies(writer);
  return writer.withWrite(actor, async (tx) => {
    const version = await versionWithItems(tx, priceListId, versionNo);
    if (version.status !== 'draft') {
      throw domainError('WC_VALIDATION', { status: 'Solo se activa un borrador' });
    }
    const payload = tariffPayload(version);
    const request = await approvalServiceOn(tx, policies).requestApproval({
      kind: 'tariff_activation',
      legalEntityId: null,
      subjectTable: 'catalog.price_list_version',
      subjectId: version.id,
      payload,
      summary: `Activar tarifa ${list.code} v${version.version}`,
      requestedBy: actor.id,
    });
    tx.write(sql`
      UPDATE catalog.price_list_version
      SET approval_request_id = CAST(${request.id} AS UUID)
      WHERE id = CAST(${version.id} AS UUID) AND status = 'draft'
    `);
    tx.audit({
      table: 'catalog.price_list_version',
      rowId: version.id,
      action: 'UPDATE',
      before: { approval_request_id: version.approval_request_id },
      after: { approval_request_id: request.id, status: 'draft' },
    });
    return {
      approval_request_id: request.id,
      payload_sha256: request.payloadSha256,
      status: 'pending' as const,
      version_status: 'draft' as const,
    };
  });
}

/** Consume la aprobación `tariff_activation` y, en la misma escritura, activa la versión. */
export async function executeTariffActivation(
  writer: Writer,
  actor: Actor,
  priceListId: string,
  versionParam: string,
): Promise<{ approval_request_id: string; status: 'active' }> {
  requireUuid(priceListId);
  const versionNo = parseVersionParam(versionParam);
  const policies = await loadApprovalPolicies(writer);
  return writer.withWrite(actor, async (tx) => {
    const version = await versionWithItems(tx, priceListId, versionNo);
    if (version.status !== 'draft') {
      throw domainError('WC_VALIDATION', { status: 'Solo se activa un borrador' });
    }
    if (!version.approval_request_id) throw domainError('WC_NOT_APPROVED');
    const hash = payloadSha256(tariffPayload(version));
    await approvalServiceOn(tx, policies).consume({
      requestId: version.approval_request_id,
      payloadSha256: hash,
    });
    await activateVersion(tx, version.id);
    return { approval_request_id: version.approval_request_id, status: 'active' as const };
  });
}

async function versionWithItems(tx: Tx, priceListId: string, versionNo: number): Promise<PriceVersion> {
  const version = await readVersionByNumber(tx, priceListId, versionNo);
  if (!version) throw domainError('WC_NOT_FOUND');
  const grouped = await loadItems(tx, [version.id]);
  version.items = grouped.get(version.id) ?? [];
  return version;
}

export async function activateVersion(tx: Tx, versionId: string): Promise<void> {
  requireUuid(versionId);
  const current = await readVersion(tx, versionId);
  if (!current) throw domainError('WC_NOT_FOUND');
  if (current.status !== 'draft') {
    throw domainError('WC_VALIDATION', { status: 'Solo se activa un borrador' });
  }
  const others = await tx.read<Record<string, unknown>>(sql`
    SELECT id, price_list_id, version, CAST(valid_from AS VARCHAR) AS valid_from,
           CAST(valid_to AS VARCHAR) AS valid_to, status, notes, approval_request_id,
           activated_at, created_by, created_at
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${current.price_list_id} AS UUID)
      AND status = 'active'
      AND id <> CAST(${versionId} AS UUID)
  `);
  const clips: PriceVersion[] = [];
  for (const row of others) {
    const other = toVersion(row, []);
    if (!rangesOverlap(current, other)) continue;
    if (other.valid_to === null && other.valid_from < current.valid_from) {
      clips.push(other);
      continue;
    }
    throw domainError('WC_VALIDATION', {
      valid_from: `Solapa con la versión ${other.version}`,
      valid_to: `Solapa con la versión ${other.version}`,
    });
  }
  const now = new Date();
  for (const other of clips) {
    tx.write(sql`
      UPDATE catalog.price_list_version
      SET valid_to = CAST(${current.valid_from} AS DATE)
      WHERE id = CAST(${other.id} AS UUID) AND status = 'active'
    `);
    tx.audit({
      table: 'catalog.price_list_version',
      rowId: other.id,
      action: 'UPDATE',
      before: auditVersion(other),
      after: { ...auditVersion(other), valid_to: current.valid_from },
    });
  }
  tx.write(sql`
    UPDATE catalog.price_list_version
    SET status = 'active', activated_at = ${now}
    WHERE id = CAST(${versionId} AS UUID) AND status = 'draft'
  `);
  tx.audit({
    table: 'catalog.price_list_version',
    rowId: versionId,
    action: 'UPDATE',
    before: auditVersion(current),
    after: { ...auditVersion(current), status: 'active', activated_at: now.toISOString() },
  });
}

export async function listPriceLists(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const active = activeParam(url);
  const filters = ['TRUE'];
  if (active !== null) filters.push(sql`is_active = ${active}`);
  if (cursor) filters.push(sql`(code > ${cursor.k} OR (code = ${cursor.k} AND id > CAST(${cursor.id} AS UUID)))`);
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total FROM catalog.price_list WHERE ${active === null ? 'TRUE' : sql`is_active = ${active}`}
  `);
  const rows = await writer.read(`
    SELECT id, code, name, currency, tax_included, is_active
    FROM catalog.price_list
    WHERE ${filters.join(' AND ')}
    ORDER BY code, id
    LIMIT ${limit + 1}
  `);
  return pageOf(rows.map(toList), limit, asCount(totalRows[0]?.total), (row) => row.code);
}

export async function createPriceList(writer: Writer, actor: Actor, body: unknown): Promise<PriceList> {
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, LIST_FIELDS, errors);
  const state = parseList(input, null, errors);
  errors.fail();
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read(sql`SELECT id FROM catalog.price_list WHERE code = ${state.code}`);
    if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
    tx.write(sql`
      INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
      VALUES (CAST(${id} AS UUID), ${state.code}, ${state.name}, ${state.currency}, ${state.tax_included}, ${state.is_active})
    `);
    tx.audit({ table: 'catalog.price_list', rowId: id, action: 'INSERT', before: null, after: { id, ...state } });
  });
  return requireList(writer, id);
}

export async function updatePriceList(writer: Writer, actor: Actor, id: string, body: unknown): Promise<PriceList> {
  requireUuid(id);
  const input = readObject(body);
  const current = await requireList(writer, id);
  const errors = new FieldBag();
  rejectUnknown(input, LIST_PATCH, errors);
  if (Object.keys(input).length === 0) errors.add('body', 'Nada que actualizar');
  const state = parseList(input, current, errors);
  errors.fail();
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE catalog.price_list SET
        name = ${state.name},
        currency = ${state.currency},
        tax_included = ${state.tax_included},
        is_active = ${state.is_active}
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'catalog.price_list',
      rowId: id,
      action: 'UPDATE',
      before: current,
      after: { ...current, ...state },
    });
  });
  return requireList(writer, id);
}

export async function listVersions(writer: Writer, request: Request, priceListId: string) {
  requireUuid(priceListId, 'id');
  await requireList(writer, priceListId);
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const filters = [sql`price_list_id = CAST(${priceListId} AS UUID)`];
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total FROM catalog.price_list_version WHERE ${filters.join(' AND ')}
  `);
  const listed = [...filters];
  if (cursor) {
    const version = Number(cursor.k);
    if (!Number.isInteger(version)) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
    listed.push(sql`(version < ${version} OR (version = ${version} AND id < CAST(${cursor.id} AS UUID)))`);
  }
  const rows = await writer.read(`
    SELECT id, price_list_id, version, CAST(valid_from AS VARCHAR) AS valid_from,
           CAST(valid_to AS VARCHAR) AS valid_to, status, notes, approval_request_id,
           activated_at, created_by, created_at
    FROM catalog.price_list_version
    WHERE ${listed.join(' AND ')}
    ORDER BY version DESC, id DESC
    LIMIT ${limit + 1}
  `);
  const page = pageOf(rows.map((row) => toVersion(row, [])), limit, asCount(totalRows[0]?.total), (row) => String(row.version));
  const grouped = await loadItems(writer, page.items.map((item) => item.id));
  for (const version of page.items) version.items = grouped.get(version.id) ?? [];
  return page;
}

export async function createVersion(writer: Writer, actor: Actor, priceListId: string, body: unknown): Promise<PriceVersion> {
  requireUuid(priceListId, 'id');
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, VERSION_FIELDS, errors);
  const validFrom = hasKey(input, 'valid_from') ? dateValue(input.valid_from, 'valid_from', errors) : null;
  if (!hasKey(input, 'valid_from')) errors.add('valid_from', 'Obligatorio');
  const validTo = pickOptionalDate(input, 'valid_to', errors);
  const notes = hasKey(input, 'notes')
    ? textValue(input.notes, 'notes', errors, { max: 4000 })
    : null;
  if (validFrom && validTo && validTo <= validFrom) errors.add('valid_to', 'La fecha fin debe ser posterior al inicio');
  errors.fail();
  const list = await requireList(writer, priceListId);
  if (!list.is_active) throw domainError('WC_VALIDATION', { price_list_id: 'La tarifa no está activa' });
  const from = validFrom ?? '';
  let createdVersion = 0;
  await writer.withWrite(actor, async (tx) => {
    const maxRows = await tx.read<{ version: unknown }>(sql`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM catalog.price_list_version
      WHERE price_list_id = CAST(${priceListId} AS UUID)
    `);
    createdVersion = Number(maxRows[0]?.version ?? 0) + 1;
    const id = newId();
    const now = new Date();
    tx.write(sql`
      INSERT INTO catalog.price_list_version (
        id, price_list_id, version, valid_from, valid_to, status, notes, created_by, created_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${priceListId} AS UUID), ${createdVersion},
        CAST(${from} AS DATE), CAST(${validTo} AS DATE), 'draft', ${notes}, ${actor.id}, ${now}
      )
    `);
    tx.audit({
      table: 'catalog.price_list_version',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        id,
        price_list_id: priceListId,
        version: createdVersion,
        valid_from: from,
        valid_to: validTo,
        status: 'draft',
        notes,
        created_by: actor.id,
        created_at: now.toISOString(),
      },
    });
    const source = await sourceVersion(tx, priceListId);
    if (source) {
      const items = await tx.read<Record<string, unknown>>(sql`
        SELECT product_id, CAST(min_qty AS VARCHAR) AS min_qty, CAST(unit_price AS VARCHAR) AS unit_price
        FROM catalog.price_list_item
        WHERE version_id = CAST(${source} AS UUID)
      `);
      for (const item of items) {
        const itemId = newId();
        const minQty = new PriceDecimal(String(item.min_qty));
        const unitPrice = new PriceDecimal(String(item.unit_price));
        tx.write(sql`
          INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
          VALUES (
            CAST(${itemId} AS UUID), CAST(${id} AS UUID), CAST(${String(item.product_id)} AS UUID),
            ${minQty}, ${unitPrice}
          )
        `);
        tx.audit({
          table: 'catalog.price_list_item',
          rowId: itemId,
          action: 'INSERT',
          before: null,
          after: {
            id: itemId,
            version_id: id,
            product_id: String(item.product_id),
            min_qty: scale(item.min_qty, 3),
            unit_price: scale(item.unit_price, 4),
          },
        });
      }
    }
  });
  return requireVersion(writer, priceListId, createdVersion);
}

export async function replaceItems(
  writer: Writer,
  actor: Actor,
  priceListId: string,
  versionParam: string,
  body: unknown,
): Promise<PriceVersion> {
  requireUuid(priceListId, 'id');
  const versionNo = parseVersionParam(versionParam);
  await requireList(writer, priceListId);
  const existing = await requireVersion(writer, priceListId, versionNo);
  if (existing.status !== 'draft') throw domainError('WC050');
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, ['items'], errors);
  if (!Array.isArray(input.items)) errors.add('items', 'Se esperaba una lista');
  const items = Array.isArray(input.items) ? parseItems(input.items, errors) : [];
  errors.fail();
  await assertProducts(writer, items);
  await writer.withWrite(actor, async (tx) => {
    const fresh = await readVersionByNumber(tx, priceListId, versionNo);
    if (!fresh) throw domainError('WC_NOT_FOUND');
    if (fresh.status !== 'draft') throw domainError('WC050');
    const previous = await tx.read<Record<string, unknown>>(sql`
      SELECT id, version_id, product_id, CAST(min_qty AS VARCHAR) AS min_qty, CAST(unit_price AS VARCHAR) AS unit_price
      FROM catalog.price_list_item
      WHERE version_id = CAST(${fresh.id} AS UUID)
    `);
    tx.write(sql`DELETE FROM catalog.price_list_item WHERE version_id = CAST(${fresh.id} AS UUID)`);
    for (const row of previous) {
      tx.audit({
        table: 'catalog.price_list_item',
        rowId: String(row.id),
        action: 'DELETE',
        before: toItem(row),
        after: null,
      });
    }
    for (const item of items) {
      const itemId = newId();
      tx.write(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES (
          CAST(${itemId} AS UUID), CAST(${fresh.id} AS UUID), CAST(${item.product_id} AS UUID),
          ${new PriceDecimal(item.min_qty)}, ${new PriceDecimal(item.unit_price)}
        )
      `);
      tx.audit({
        table: 'catalog.price_list_item',
        rowId: itemId,
        action: 'INSERT',
        before: null,
        after: { id: itemId, version_id: fresh.id, ...item },
      });
    }
  });
  return requireVersion(writer, priceListId, versionNo);
}

export async function quoteFromRequest(writer: Writer, request: Request): Promise<{
  unit_price: string;
  min_qty: string;
  price_list_version_id: string;
  price_list_id: string;
  code: string;
  currency: string;
}> {
  const url = new URL(request.url);
  const errors = new FieldBag();
  const customerId = url.searchParams.get('customer_id');
  const productId = url.searchParams.get('product_id');
  const qtyRaw = url.searchParams.get('qty');
  const dateRaw = url.searchParams.get('date');
  if (!customerId) errors.add('customer_id', 'Obligatorio');
  if (!productId) errors.add('product_id', 'Obligatorio');
  if (!qtyRaw) errors.add('qty', 'Obligatorio');
  const qty = qtyRaw ? decimalValue(qtyRaw, 'qty', errors, { scale: 3, min: '0', exclusiveMin: true }) : null;
  const date = dateRaw ? dateValue(dateRaw, 'date', errors) : businessDate(new Date());
  errors.fail();
  const quote = await priceFor(writer, {
    customerId: customerId ?? '',
    productId: productId ?? '',
    qty: qty ?? new PriceDecimal(0),
    date: date ?? businessDate(new Date()),
  });
  return {
    unit_price: quote.unitPrice.toDecimalPlaces(4).toFixed(4),
    min_qty: quote.minQty.toDecimalPlaces(3).toFixed(3),
    price_list_version_id: quote.priceListVersionId,
    price_list_id: quote.priceListId,
    code: quote.priceListCode,
    currency: quote.currency,
  };
}

async function resolveList(
  db: Reader,
  contact: { default_channel: string | null; default_price_list_id: string | null },
): Promise<PriceList> {
  if (contact.default_price_list_id) {
    const rows = await db.read<Record<string, unknown>>(sql`
      SELECT id, code, name, currency, tax_included, is_active
      FROM catalog.price_list
      WHERE id = CAST(${contact.default_price_list_id} AS UUID)
    `);
    const list = rows[0] ? toList(rows[0]) : null;
    if (!list) throw domainError('WC_VALIDATION', { customer_id: 'La tarifa del cliente no existe' });
    if (!list.is_active) throw domainError('WC_VALIDATION', { customer_id: 'La tarifa del cliente no está activa' });
    return list;
  }
  const channel = contact.default_channel;
  if (channel && !(channel in CHANNEL_LIST)) {
    throw domainError('WC_VALIDATION', { customer_id: 'Canal sin tarifa' });
  }
  const code = channel ? CHANNEL_LIST[channel] ?? 'final' : 'final';
  const found = await listByCode(db, code);
  if (found) return found;
  if (code !== 'final') {
    const general = await listByCode(db, 'final');
    if (general) return general;
  }
  throw domainError('WC_VALIDATION', { customer_id: 'No hay tarifa aplicable' });
}

async function listByCode(db: Reader, code: string): Promise<PriceList | null> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, code, name, currency, tax_included, is_active
    FROM catalog.price_list
    WHERE code = ${code} AND is_active
  `);
  return rows[0] ? toList(rows[0]) : null;
}

async function sourceVersion(tx: Tx, priceListId: string): Promise<string | null> {
  const today = businessDate(new Date());
  const rows = await tx.read<{ id: string; valid_from: string; valid_to: string | null; version: unknown }>(sql`
    SELECT id, CAST(valid_from AS VARCHAR) AS valid_from, CAST(valid_to AS VARCHAR) AS valid_to, version
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${priceListId} AS UUID) AND status = 'active'
  `);
  const covering = rows.filter((row) => row.valid_from <= today && (row.valid_to == null || row.valid_to > today));
  const pool = covering.length > 0 ? covering : rows;
  const chosen = pool.sort((left, right) => Number(right.version) - Number(left.version))[0];
  return chosen?.id ?? null;
}

async function assertProducts(writer: Writer, items: { product_id: string }[]): Promise<void> {
  if (items.length === 0) return;
  const inList = items.map((item) => sql`CAST(${item.product_id} AS UUID)`).join(', ');
  const rows = await writer.read<{ id: string }>(`
    SELECT id FROM catalog.product WHERE id IN (${inList})
  `);
  const found = new Set(rows.map((row) => row.id.toLowerCase()));
  const missing = items.find((item) => !found.has(item.product_id.toLowerCase()));
  if (missing) throw domainError('WC_VALIDATION', { product_id: 'No existe' });
}

function parseItems(value: unknown[], errors: FieldBag): { product_id: string; min_qty: string; unit_price: string }[] {
  if (value.length > 2000) {
    errors.add('items', 'Demasiadas líneas');
    return [];
  }
  const seen = new Set<string>();
  const items: { product_id: string; min_qty: string; unit_price: string }[] = [];
  value.forEach((entry, index) => {
    const field = `items.${index}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.add(field, 'Se esperaba un objeto');
      return;
    }
    const row = entry as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (!(ITEM_FIELDS as readonly string[]).includes(key)) errors.add(`${field}.${key}`, 'Campo no reconocido');
    }
    const productId = typeof row.product_id === 'string' ? row.product_id.trim() : '';
    if (!isUuid(productId)) errors.add(`${field}.product_id`, 'Identificador no válido');
    const minQty = decimalValue(row.min_qty, `${field}.min_qty`, errors, { scale: 3, min: '0', exclusiveMin: true });
    const unitPrice = decimalValue(row.unit_price, `${field}.unit_price`, errors, { scale: 4, min: '0' });
    if (!productId || !minQty || !unitPrice) return;
    const canonicalQty = minQty.toDecimalPlaces(3).toFixed(3);
    const key = `${productId}|${canonicalQty}`;
    if (seen.has(key)) {
      errors.add(`${field}.min_qty`, 'Cantidad mínima repetida para el producto');
      return;
    }
    seen.add(key);
    items.push({
      product_id: productId,
      min_qty: canonicalQty,
      unit_price: unitPrice.toDecimalPlaces(4).toFixed(4),
    });
  });
  return items;
}

function parseList(input: Record<string, unknown>, current: PriceList | null, errors: FieldBag): Omit<PriceList, 'id'> {
  const code = current
    ? current.code
    : textValue(input.code, 'code', errors, { required: true, pattern: LIST_CODE, patternMessage: 'Código de tarifa no válido' }) ?? '';
  const name = textValue(hasKey(input, 'name') ? input.name : current?.name, 'name', errors, { required: true, min: 1, max: 120 }) ?? '';
  let currency = current?.currency ?? 'EUR';
  if (hasKey(input, 'currency')) {
    const parsed = textValue(input.currency, 'currency', errors, { required: true });
    if (parsed && parsed !== 'EUR') errors.add('currency', 'Solo EUR');
    currency = parsed === 'EUR' ? 'EUR' : currency;
  }
  const tax = hasKey(input, 'tax_included')
    ? (boolValue(input.tax_included, 'tax_included', errors) ?? false)
    : (current?.tax_included ?? false);
  const active = hasKey(input, 'is_active')
    ? (boolValue(input.is_active, 'is_active', errors) ?? true)
    : (current?.is_active ?? true);
  return { code, name, currency, tax_included: tax, is_active: active };
}

function pickOptionalDate(input: Record<string, unknown>, key: string, errors: FieldBag): string | null {
  if (!hasKey(input, key) || input[key] == null) return null;
  return dateValue(input[key], key, errors);
}

function parseVersionParam(value: string): number {
  if (!/^[1-9]\d{0,8}$/.test(value)) throw domainError('WC_VALIDATION', { version: 'Versión no válida' });
  return Number(value);
}

async function requireList(writer: Writer, id: string): Promise<PriceList> {
  const rows = await writer.read(sql`
    SELECT id, code, name, currency, tax_included, is_active
    FROM catalog.price_list
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toList(row);
}

async function requireVersion(writer: Writer, priceListId: string, version: number): Promise<PriceVersion> {
  const rows = await writer.read(sql`
    SELECT id, price_list_id, version, CAST(valid_from AS VARCHAR) AS valid_from,
           CAST(valid_to AS VARCHAR) AS valid_to, status, notes, approval_request_id,
           activated_at, created_by, created_at
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${priceListId} AS UUID) AND version = ${version}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const versionRow = toVersion(row, []);
  const grouped = await loadItems(writer, [versionRow.id]);
  versionRow.items = grouped.get(versionRow.id) ?? [];
  return versionRow;
}

async function readVersion(tx: Tx, id: string): Promise<PriceVersion | null> {
  const rows = await tx.read(sql`
    SELECT id, price_list_id, version, CAST(valid_from AS VARCHAR) AS valid_from,
           CAST(valid_to AS VARCHAR) AS valid_to, status, notes, approval_request_id,
           activated_at, created_by, created_at
    FROM catalog.price_list_version
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  return row ? toVersion(row, []) : null;
}

async function readVersionByNumber(tx: Tx, priceListId: string, version: number): Promise<PriceVersion | null> {
  const rows = await tx.read(sql`
    SELECT id, price_list_id, version, CAST(valid_from AS VARCHAR) AS valid_from,
           CAST(valid_to AS VARCHAR) AS valid_to, status, notes, approval_request_id,
           activated_at, created_by, created_at
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${priceListId} AS UUID) AND version = ${version}
  `);
  const row = rows[0];
  return row ? toVersion(row, []) : null;
}

async function loadItems(reader: Reader, versionIds: string[]): Promise<Map<string, PriceItem[]>> {
  const grouped = new Map<string, PriceItem[]>();
  if (versionIds.length === 0) return grouped;
  const inList = versionIds.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const rows = await reader.read(`
    SELECT id, version_id, product_id, CAST(min_qty AS VARCHAR) AS min_qty, CAST(unit_price AS VARCHAR) AS unit_price
    FROM catalog.price_list_item
    WHERE version_id IN (${inList})
    ORDER BY catalog.price_list_item.min_qty, product_id, id
  `);
  for (const row of rows) {
    const item = toItem(row);
    const bucket = grouped.get(item.version_id) ?? [];
    bucket.push(item);
    grouped.set(item.version_id, bucket);
  }
  return grouped;
}

function auditVersion(version: PriceVersion): Record<string, unknown> {
  const { items: _items, ...rest } = version;
  return rest;
}

function toList(row: Record<string, unknown>): PriceList {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    currency: asString(row.currency),
    tax_included: asBool(row.tax_included),
    is_active: asBool(row.is_active),
  };
}

function toVersion(row: Record<string, unknown>, items: PriceItem[]): PriceVersion {
  return {
    id: asString(row.id),
    price_list_id: asString(row.price_list_id),
    version: Number(row.version),
    valid_from: asString(row.valid_from),
    valid_to: asNullableString(row.valid_to),
    status: asString(row.status),
    notes: asNullableString(row.notes),
    approval_request_id: asNullableString(row.approval_request_id),
    activated_at: asNullableString(row.activated_at),
    created_by: asString(row.created_by),
    created_at: asString(row.created_at),
    items,
  };
}

function toItem(row: Record<string, unknown>): PriceItem {
  return {
    id: asString(row.id),
    version_id: asString(row.version_id),
    product_id: asString(row.product_id),
    min_qty: scale(row.min_qty, 3),
    unit_price: scale(row.unit_price, 4),
  };
}

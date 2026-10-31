import { Decimal } from 'decimal.js';
import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { isValidGtin } from '../shared/gs1';
import { newId } from '../ids';
import { businessDate } from '../time';
import {
  assertIfMatch,
  FieldBag,
  boolValue,
  decimalValue,
  enumValue,
  hasKey,
  intValue,
  isUuid,
  jsonObjectValue,
  readObject,
  rejectUnknown,
  requireUuid,
  scale,
  textValue,
} from './fields';
import { activeParam, asCount, cursorParam, flagParam, limitParam, pageOf } from './query';
import { asBool, asJsonObject, asNullableInt, asNullableString, asString } from './rows';

const KINDS = [
  'wine', 'bulk_wine', 'packaging_material', 'oenological_product',
  'merchandise', 'service', 'gift_card', 'other',
] as const;
const UNITS = ['ud', 'l', 'kg', 'h', 'month', 'service'] as const;
const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const NC = /^[0-9]{8}$/;
const ACCOUNT = /^7[0-9]{2,7}$/;
const EXCISE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const MISSING = new Set(['gtin', 'nc_code', 'silicie']);
const FIELDS = [
  'sku', 'name', 'name_en', 'kind', 'wine_id', 'vintage', 'format_id', 'unit',
  'gtin', 'gtin_case', 'nc_code', 'excise_product_key', 'alcohol_pct',
  'default_tax_code', 'sales_account', 'is_stock_tracked', 'requires_lot',
  'is_active', 'legacy_refs',
] as const;

const PRODUCT_SELECT = `
  p.id, p.sku, p.name, p.name_en, p.kind, p.wine_id, p.vintage, p.format_id, p.unit,
  p.gtin, p.gtin_case, p.nc_code, p.excise_product_key,
  CAST(p.alcohol_pct AS VARCHAR) AS alcohol_pct,
  p.default_tax_code, p.sales_account, p.is_stock_tracked, p.requires_lot, p.is_active,
  p.legacy_refs, p.created_at, p.updated_at,
  CASE WHEN c.product_id = p.id THEN TRUE ELSE FALSE END AS is_gtin_current
`;

export interface Product {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  kind: string;
  wine_id: string | null;
  vintage: number | null;
  format_id: string | null;
  unit: string;
  gtin: string | null;
  gtin_case: string | null;
  nc_code: string | null;
  excise_product_key: string | null;
  alcohol_pct: string | null;
  default_tax_code: string | null;
  sales_account: string | null;
  is_stock_tracked: boolean;
  requires_lot: boolean;
  is_active: boolean;
  legacy_refs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  is_gtin_current: boolean;
}

interface ProductState {
  sku: string;
  name: string;
  name_en: string | null;
  kind: string;
  wine_id: string | null;
  vintage: number | null;
  format_id: string | null;
  unit: string;
  gtin: string | null;
  gtin_case: string | null;
  nc_code: string | null;
  excise_product_key: string | null;
  alcohol_pct: string | null;
  default_tax_code: string | null;
  sales_account: string | null;
  is_stock_tracked: boolean;
  requires_lot: boolean;
  is_active: boolean;
  legacy_refs: Record<string, unknown>;
}

export async function listProducts(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const filters = productFilters(url);
  const where = filters.join(' AND ');
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total FROM catalog.product p WHERE ${where}
  `);
  const listed = [...filters];
  if (cursor) {
    listed.push(sql`(p.sku > ${cursor.k} OR (p.sku = ${cursor.k} AND p.id > CAST(${cursor.id} AS UUID)))`);
  }
  const rows = await writer.read(`
    SELECT ${PRODUCT_SELECT}
    FROM catalog.product p
    LEFT JOIN catalog.gtin_current c ON c.gtin = p.gtin
    WHERE ${listed.join(' AND ')}
    ORDER BY p.sku, p.id
    LIMIT ${limit + 1}
  `);
  return pageOf(rows.map(toProduct), limit, asCount(totalRows[0]?.total), (row) => row.sku);
}

export async function getProduct(writer: Writer, id: string): Promise<Product> {
  requireUuid(id);
  const rows = await writer.read(`
    SELECT ${PRODUCT_SELECT}
    FROM catalog.product p
    LEFT JOIN catalog.gtin_current c ON c.gtin = p.gtin
    WHERE ${sql`p.id = CAST(${id} AS UUID)`}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toProduct(row);
}

export async function createProduct(writer: Writer, actor: Actor, body: unknown): Promise<Product> {
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  const state = parseProduct(input, null, errors);
  errors.fail();
  const id = newId();
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    await assertRefs(tx, state, null, errors);
    errors.fail();
    const taken = await tx.read<{ id: string }>(sql`SELECT id FROM catalog.product WHERE sku = ${state.sku}`);
    if (taken.length > 0) throw domainError('WC_VALIDATION', { sku: 'Ya existe' });
    await assertUnique(tx, id, state);
    insertProduct(tx, id, state, now);
  });
  return getProduct(writer, id);
}

export async function updateProduct(
  writer: Writer,
  actor: Actor,
  request: Request,
  id: string,
  body: unknown,
): Promise<Product> {
  requireUuid(id);
  const input = readObject(body);
  const current = await getProduct(writer, id);
  assertIfMatch(request, current.updated_at);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  if (Object.keys(input).length === 0) errors.add('body', 'Nada que actualizar');
  const state = parseProduct(input, current, errors);
  errors.fail();
  const now = new Date();
  try {
    await writer.withWrite(actor, async (tx) => {
      await assertIdentityLock(tx, id, current, state, errors);
      await assertRefs(tx, state, current, errors);
      errors.fail();
      await assertUnique(tx, id, state);
      await assertSku(tx, id, state.sku, current.sku);
      updateProductRow(tx, id, state, current, now);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('still referenced')) {
      throw domainError('WC_VALIDATION', { sku: 'No se puede cambiar porque ya está en uso' });
    }
    throw error;
  }
  return getProduct(writer, id);
}

export async function markGtinCurrent(writer: Writer, actor: Actor, id: string, body: unknown) {
  requireUuid(id);
  const product = await getProduct(writer, id);
  const input = body == null ? {} : readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, ['gtin'], errors);
  const gtin = hasKey(input, 'gtin')
    ? textValue(input.gtin, 'gtin', errors, { required: true })
    : product.gtin;
  if (!product.gtin) errors.add('gtin', 'El producto no tiene GTIN');
  if (gtin && product.gtin && gtin !== product.gtin) errors.add('gtin', 'Debe ser el GTIN del producto');
  if (gtin && !isValidGtin(gtin)) errors.add('gtin', 'El dígito de control no es válido');
  errors.fail();
  const chosen = gtin ?? product.gtin;
  if (!chosen) throw domainError('WC_VALIDATION', { gtin: 'El producto no tiene GTIN' });
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read<Record<string, unknown>>(sql`
      SELECT gtin, product_id, updated_by, updated_at
      FROM catalog.gtin_current
      WHERE gtin = ${chosen}
    `);
    const previous = existing[0] ? toGtin(existing[0]) : null;
    if (previous) {
      tx.write(sql`
        UPDATE catalog.gtin_current
        SET product_id = CAST(${id} AS UUID), updated_by = ${actor.id}, updated_at = ${now}
        WHERE gtin = ${chosen}
      `);
      tx.audit({
        table: 'catalog.gtin_current',
        rowId: chosen,
        action: 'UPDATE',
        before: previous,
        after: { gtin: chosen, product_id: id, updated_by: actor.id, updated_at: now.toISOString() },
      });
    } else {
      tx.write(sql`
        INSERT INTO catalog.gtin_current (gtin, product_id, updated_by, updated_at)
        VALUES (${chosen}, CAST(${id} AS UUID), ${actor.id}, ${now})
      `);
      tx.audit({
        table: 'catalog.gtin_current',
        rowId: chosen,
        action: 'INSERT',
        before: null,
        after: { gtin: chosen, product_id: id, updated_by: actor.id, updated_at: now.toISOString() },
      });
    }
  });
  const rows = await writer.read(sql`
    SELECT gtin, product_id, updated_by, updated_at
    FROM catalog.gtin_current
    WHERE gtin = ${chosen}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toGtin(row);
}

export async function listProductPrices(writer: Writer, request: Request, id: string) {
  requireUuid(id);
  await getProduct(writer, id);
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const today = businessDate(new Date());
  const filters = [
    sql`i.product_id = CAST(${id} AS UUID)`,
    sql`v.status = 'active'`,
    sql`v.valid_from <= CAST(${today} AS DATE)`,
    sql`(v.valid_to IS NULL OR v.valid_to > CAST(${today} AS DATE))`,
    sql`l.is_active`,
  ];
  const where = filters.join(' AND ');
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE ${where}
  `);
  const listed = [...filters];
  if (cursor) {
    listed.push(sql`(
      l.code > ${cursor.k}
      OR (l.code = ${cursor.k} AND i.id > CAST(${cursor.id} AS UUID))
    )`);
  }
  const rows = await writer.read(`
    SELECT i.id, i.version_id, i.product_id,
           CAST(i.min_qty AS VARCHAR) AS min_qty,
           CAST(i.unit_price AS VARCHAR) AS unit_price,
           v.version, CAST(v.valid_from AS VARCHAR) AS valid_from,
           CAST(v.valid_to AS VARCHAR) AS valid_to, v.status,
           l.id AS price_list_id, l.code, l.name, l.currency, l.tax_included
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE ${listed.join(' AND ')}
    ORDER BY l.code, i.id
    LIMIT ${limit + 1}
  `);
  return pageOf(rows.map(toPrice), limit, asCount(totalRows[0]?.total), (row) => row.code);
}

function productFilters(url: URL): string[] {
  const filters = ['TRUE'];
  const kind = url.searchParams.get('kind');
  if (kind) {
    if (!KINDS.includes(kind as (typeof KINDS)[number])) {
      throw domainError('WC_VALIDATION', { kind: 'Tipo no válido' });
    }
    filters.push(sql`p.kind = ${kind}`);
  }
  const wineId = url.searchParams.get('wine_id');
  if (wineId) {
    if (!isUuid(wineId)) throw domainError('WC_VALIDATION', { wine_id: 'Identificador no válido' });
    filters.push(sql`p.wine_id = CAST(${wineId} AS UUID)`);
  }
  const formatId = url.searchParams.get('format_id');
  if (formatId) {
    if (!isUuid(formatId)) throw domainError('WC_VALIDATION', { format_id: 'Identificador no válido' });
    filters.push(sql`p.format_id = CAST(${formatId} AS UUID)`);
  }
  const vintage = url.searchParams.get('vintage');
  if (vintage) {
    if (!/^\d{4}$/.test(vintage)) throw domainError('WC_VALIDATION', { vintage: 'Añada no válida' });
    const year = Number(vintage);
    if (year < 1990 || year > 2100) throw domainError('WC_VALIDATION', { vintage: 'La añada debe estar entre 1990 y 2100' });
    filters.push(sql`p.vintage = ${year}`);
  }
  const active = activeParam(url);
  if (active !== null) filters.push(sql`p.is_active = ${active}`);
  const organic = flagParam(url, 'organic');
  if (organic !== null) {
    filters.push(sql`
      EXISTS (
        SELECT 1 FROM catalog.wine w
        WHERE w.id = p.wine_id AND w.is_organic = ${organic}
      )
    `);
  }
  const missing = url.searchParams.get('missing');
  if (missing) {
    if (!MISSING.has(missing)) throw domainError('WC_VALIDATION', { missing: 'Usa gtin, nc_code o silicie' });
    if (missing === 'gtin') filters.push('p.gtin IS NULL');
    if (missing === 'nc_code') filters.push('p.nc_code IS NULL');
    if (missing === 'silicie') filters.push(`(p.excise_product_key IS NULL OR length(trim(p.excise_product_key)) = 0)`);
  }
  const gtin = url.searchParams.get('gtin');
  if (gtin) {
    if (!isValidGtin(gtin)) throw domainError('WC_VALIDATION', { gtin: 'GTIN no válido' });
    filters.push(sql`p.gtin = ${gtin}`);
  }
  const q = url.searchParams.get('q');
  if (q && q.trim() !== '') {
    if (q.trim().length > 80) throw domainError('WC_VALIDATION', { q: 'Demasiado largo' });
    const pattern = `%${q.trim().toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    filters.push(sql`(
      lower(p.sku) LIKE ${pattern} ESCAPE '\\'
      OR lower(p.name) LIKE ${pattern} ESCAPE '\\'
      OR p.gtin = ${q.trim()}
    )`);
  }
  return filters;
}

async function assertRefs(tx: Tx, state: ProductState, current: Product | null, errors: FieldBag): Promise<void> {
  if (state.wine_id && state.wine_id !== current?.wine_id) {
    const rows = await tx.read<{ is_active: boolean }>(sql`
      SELECT is_active FROM catalog.wine WHERE id = CAST(${state.wine_id} AS UUID)
    `);
    const wine = rows[0];
    if (!wine) errors.add('wine_id', 'No existe');
    else if (wine.is_active !== true) errors.add('wine_id', 'El vino no está activo');
  } else if (state.wine_id && current == null) {
    const rows = await tx.read<{ is_active: boolean }>(sql`
      SELECT is_active FROM catalog.wine WHERE id = CAST(${state.wine_id} AS UUID)
    `);
    const wine = rows[0];
    if (!wine) errors.add('wine_id', 'No existe');
    else if (wine.is_active !== true) errors.add('wine_id', 'El vino no está activo');
  }
  if (state.format_id && (current == null || state.format_id !== current.format_id)) {
    const rows = await tx.read<{ is_active: boolean }>(sql`
      SELECT is_active FROM catalog.format WHERE id = CAST(${state.format_id} AS UUID)
    `);
    const format = rows[0];
    if (!format) errors.add('format_id', 'No existe');
    else if (format.is_active !== true) errors.add('format_id', 'El formato no está activo');
  }
  if (state.default_tax_code && state.default_tax_code !== current?.default_tax_code) {
    const rows = await tx.read<{ code: string }>(sql`
      SELECT code FROM billing.tax_code WHERE code = ${state.default_tax_code} AND is_active
    `);
    if (rows.length === 0) errors.add('default_tax_code', 'Código de IVA no válido');
  }
}

async function assertUnique(tx: Tx, id: string, state: ProductState): Promise<void> {
  if (state.kind !== 'wine' || !state.wine_id || state.vintage == null || !state.format_id) return;
  const rows = await tx.read<{ id: string; name: string }>(sql`
    SELECT id, name FROM catalog.product
    WHERE kind = 'wine'
      AND wine_id = CAST(${state.wine_id} AS UUID)
      AND vintage = ${state.vintage}
      AND format_id = CAST(${state.format_id} AS UUID)
      AND id <> CAST(${id} AS UUID)
  `);
  const existing = rows[0];
  if (existing) {
    throw domainError('WC_VALIDATION', {
      wine_id: 'Ya existe',
      vintage: 'Ya existe',
      format_id: 'Ya existe',
    }, {
      existing_id: String(existing.id),
      existing_name: String(existing.name),
    });
  }
}

async function assertSku(tx: Tx, id: string, sku: string, previous: string): Promise<void> {
  if (sku === previous) return;
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM catalog.product WHERE sku = ${sku} AND id <> CAST(${id} AS UUID)
  `);
  if (rows.length > 0) throw domainError('WC_VALIDATION', { sku: 'Ya existe' });
}

async function assertIdentityLock(
  tx: Tx,
  id: string,
  current: Product,
  state: ProductState,
  errors: FieldBag,
): Promise<void> {
  const changed = state.wine_id !== current.wine_id
    || state.vintage !== current.vintage
    || state.format_id !== current.format_id;
  if (!changed) return;
  const rows = await tx.read(sql`
    SELECT 1 AS hit FROM inventory.stock_move WHERE product_id = CAST(${id} AS UUID) LIMIT 1
  `);
  if (rows.length === 0) return;
  const message = 'El producto tiene movimientos; el vino, la añada y el formato están bloqueados';
  if (state.wine_id !== current.wine_id) errors.add('wine_id', message);
  if (state.vintage !== current.vintage) errors.add('vintage', message);
  if (state.format_id !== current.format_id) errors.add('format_id', message);
}

function insertProduct(tx: Tx, id: string, state: ProductState, now: Date): void {
  tx.write(sql`
    INSERT INTO catalog.product (
      id, sku, name, name_en, kind, wine_id, vintage, format_id, unit,
      gtin, gtin_case, nc_code, excise_product_key, alcohol_pct, default_tax_code,
      sales_account, is_stock_tracked, requires_lot, is_active, legacy_refs, created_at, updated_at
    ) VALUES (
      CAST(${id} AS UUID), ${state.sku}, ${state.name}, ${state.name_en}, ${state.kind},
      CAST(${state.wine_id} AS UUID), ${state.vintage}, CAST(${state.format_id} AS UUID), ${state.unit},
      ${state.gtin}, ${state.gtin_case}, ${state.nc_code}, ${state.excise_product_key},
      ${state.alcohol_pct === null ? null : new Decimal(state.alcohol_pct)},
      ${state.default_tax_code}, ${state.sales_account}, ${state.is_stock_tracked}, ${state.requires_lot},
      ${state.is_active}, ${sql.json(state.legacy_refs)}, ${now}, ${now}
    )
  `);
  tx.audit({
    table: 'catalog.product',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { id, ...state, created_at: now.toISOString(), updated_at: now.toISOString() },
  });
}

function updateProductRow(tx: Tx, id: string, state: ProductState, before: Product, now: Date): void {
  const assignments = [
    sql`name = ${state.name}`,
    sql`name_en = ${state.name_en}`,
    sql`kind = ${state.kind}`,
    sql`wine_id = CAST(${state.wine_id} AS UUID)`,
    sql`vintage = ${state.vintage}`,
    sql`format_id = CAST(${state.format_id} AS UUID)`,
    sql`unit = ${state.unit}`,
    sql`gtin = ${state.gtin}`,
    sql`gtin_case = ${state.gtin_case}`,
    sql`nc_code = ${state.nc_code}`,
    sql`excise_product_key = ${state.excise_product_key}`,
    sql`alcohol_pct = ${state.alcohol_pct === null ? null : new Decimal(state.alcohol_pct)}`,
    sql`default_tax_code = ${state.default_tax_code}`,
    sql`sales_account = ${state.sales_account}`,
    sql`is_stock_tracked = ${state.is_stock_tracked}`,
    sql`requires_lot = ${state.requires_lot}`,
    sql`is_active = ${state.is_active}`,
    sql`legacy_refs = ${sql.json(state.legacy_refs)}`,
    sql`updated_at = ${now}`,
  ];
  if (state.sku !== before.sku) assignments.unshift(sql`sku = ${state.sku}`);
  tx.write(`UPDATE catalog.product SET ${assignments.join(', ')} WHERE ${sql`id = CAST(${id} AS UUID)`}`);
  const { is_gtin_current: _ignored, ...prior } = before;
  tx.audit({
    table: 'catalog.product',
    rowId: id,
    action: 'UPDATE',
    before: prior,
    after: { ...prior, ...state, updated_at: now.toISOString() },
  });
}

function parseProduct(input: Record<string, unknown>, current: Product | null, errors: FieldBag): ProductState {
  const kind = pickEnum(input, 'kind', current?.kind ?? null, KINDS, errors) ?? '';
  const sku = pickText(input, 'sku', current?.sku ?? null, errors, {
    required: true,
    pattern: SKU,
    patternMessage: 'SKU no válido',
  }) ?? '';
  const name = pickText(input, 'name', current?.name ?? null, errors, { required: true, min: 2, max: 120 }) ?? '';
  const nameEn = pickText(input, 'name_en', current?.name_en ?? null, errors, { max: 120 });
  const wineId = pickUuid(input, 'wine_id', current?.wine_id ?? null, errors);
  const vintage = pickVintage(input, current?.vintage ?? null, errors);
  const formatId = pickUuid(input, 'format_id', current?.format_id ?? null, errors);
  const unit = pickEnum(input, 'unit', current?.unit ?? 'ud', UNITS, errors) ?? 'ud';
  const gtin = pickGtin(input, 'gtin', current?.gtin ?? null, errors, false);
  const gtinCase = pickGtin(input, 'gtin_case', current?.gtin_case ?? null, errors, true);
  const nc = pickText(input, 'nc_code', current?.nc_code ?? null, errors, {
    pattern: NC,
    patternMessage: 'El código NC tiene 8 dígitos',
  });
  const excise = pickText(input, 'excise_product_key', current?.excise_product_key ?? null, errors, {
    pattern: EXCISE,
    patternMessage: 'Clave de producto no válida',
  });
  const alcohol = pickAlcohol(input, current?.alcohol_pct ?? null, errors);
  const tax = pickText(input, 'default_tax_code', current?.default_tax_code ?? null, errors, {
    pattern: /^[A-Z0-9_]{2,20}$/,
    patternMessage: 'Código de IVA no válido',
  });
  const account = pickText(input, 'sales_account', current?.sales_account ?? null, errors, {
    pattern: ACCOUNT,
    patternMessage: 'La cuenta de ventas empieza por 7',
  });
  const stockDefault = kind !== 'service' && kind !== 'gift_card';
  const lotDefault = kind === 'wine';
  const stock = pickBool(input, 'is_stock_tracked', current?.is_stock_tracked ?? stockDefault, errors);
  const lot = pickBool(input, 'requires_lot', current?.requires_lot ?? lotDefault, errors);
  const active = pickBool(input, 'is_active', current?.is_active ?? true, errors);
  const legacy = pickLegacy(input, current?.legacy_refs ?? {}, errors);
  if (kind === 'wine') {
    if (!wineId) errors.add('wine_id', 'Obligatorio para el vino');
    if (vintage == null) errors.add('vintage', 'Obligatorio para el vino');
    if (!formatId) errors.add('format_id', 'Obligatorio para el vino');
    if (!lot) errors.add('requires_lot', 'El vino exige lote');
  }
  if ((kind === 'service' || kind === 'gift_card') && stock) {
    errors.add('is_stock_tracked', 'Un servicio o tarjeta regalo no lleva stock');
  }
  return {
    sku,
    name,
    name_en: nameEn,
    kind,
    wine_id: wineId,
    vintage,
    format_id: formatId,
    unit,
    gtin,
    gtin_case: gtinCase,
    nc_code: nc,
    excise_product_key: excise,
    alcohol_pct: alcohol,
    default_tax_code: tax,
    sales_account: account,
    is_stock_tracked: stock,
    requires_lot: lot,
    is_active: active,
    legacy_refs: legacy,
  };
}

function pickText(
  input: Record<string, unknown>,
  key: string,
  current: string | null,
  errors: FieldBag,
  opts: { required?: boolean; min?: number; max?: number; pattern?: RegExp; patternMessage?: string },
): string | null {
  if (!hasKey(input, key)) {
    if (current == null && opts.required) errors.add(key, 'Obligatorio');
    return current;
  }
  return textValue(input[key], key, errors, opts);
}

function pickBool(input: Record<string, unknown>, key: string, current: boolean, errors: FieldBag): boolean {
  if (!hasKey(input, key)) return current;
  return boolValue(input[key], key, errors) ?? current;
}

function pickEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  current: string | null,
  allowed: readonly T[],
  errors: FieldBag,
): T | null {
  if (!hasKey(input, key)) {
    if (current == null) errors.add(key, 'Obligatorio');
    return current as T | null;
  }
  return enumValue(input[key], key, allowed, errors);
}

function pickUuid(input: Record<string, unknown>, key: string, current: string | null, errors: FieldBag): string | null {
  if (!hasKey(input, key)) return current;
  if (input[key] == null) return null;
  const text = textValue(input[key], key, errors, { required: true });
  if (!text) return null;
  if (!isUuid(text)) {
    errors.add(key, 'Identificador no válido');
    return null;
  }
  return text;
}

function pickVintage(input: Record<string, unknown>, current: number | null, errors: FieldBag): number | null {
  if (!hasKey(input, 'vintage')) return current;
  if (input.vintage == null) return null;
  const year = intValue(input.vintage, 'vintage', errors, { min: 1990, max: 2100 });
  if (year == null) return null;
  return year;
}

function pickGtin(
  input: Record<string, unknown>,
  key: string,
  current: string | null,
  errors: FieldBag,
  caseCode: boolean,
): string | null {
  if (!hasKey(input, key)) return current;
  if (input[key] == null) return null;
  const text = textValue(input[key], key, errors, { required: true });
  if (!text) return null;
  if (caseCode && !/^\d{14}$/.test(text)) {
    errors.add(key, 'El GTIN de la caja tiene 14 dígitos');
    return null;
  }
  if (!isValidGtin(text)) {
    errors.add(key, 'El dígito de control no es válido');
    return null;
  }
  return text;
}

function pickAlcohol(input: Record<string, unknown>, current: string | null, errors: FieldBag): string | null {
  if (!hasKey(input, 'alcohol_pct')) return current;
  if (input.alcohol_pct == null) return null;
  const parsed = decimalValue(input.alcohol_pct, 'alcohol_pct', errors, { scale: 2, min: '0', max: '25' });
  return parsed ? parsed.toDecimalPlaces(2).toFixed(2) : null;
}

function pickLegacy(input: Record<string, unknown>, current: Record<string, unknown>, errors: FieldBag): Record<string, unknown> {
  if (!hasKey(input, 'legacy_refs')) return current;
  return jsonObjectValue(input.legacy_refs, 'legacy_refs', errors) ?? current;
}

function toProduct(row: Record<string, unknown>): Product {
  return {
    id: asString(row.id),
    sku: asString(row.sku),
    name: asString(row.name),
    name_en: asNullableString(row.name_en),
    kind: asString(row.kind),
    wine_id: asNullableString(row.wine_id),
    vintage: asNullableInt(row.vintage),
    format_id: asNullableString(row.format_id),
    unit: asString(row.unit),
    gtin: asNullableString(row.gtin),
    gtin_case: asNullableString(row.gtin_case),
    nc_code: asNullableString(row.nc_code),
    excise_product_key: asNullableString(row.excise_product_key),
    alcohol_pct: row.alcohol_pct == null ? null : scale(row.alcohol_pct, 2),
    default_tax_code: asNullableString(row.default_tax_code),
    sales_account: asNullableString(row.sales_account),
    is_stock_tracked: asBool(row.is_stock_tracked),
    requires_lot: asBool(row.requires_lot),
    is_active: asBool(row.is_active),
    legacy_refs: asJsonObject(row.legacy_refs),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    is_gtin_current: asBool(row.is_gtin_current),
  };
}

function toGtin(row: Record<string, unknown>) {
  return {
    gtin: asString(row.gtin),
    product_id: asString(row.product_id),
    updated_by: asString(row.updated_by),
    updated_at: asString(row.updated_at),
  };
}

function toPrice(row: Record<string, unknown>) {
  return {
    id: asString(row.id),
    version_id: asString(row.version_id),
    product_id: asString(row.product_id),
    min_qty: scale(row.min_qty, 3),
    unit_price: scale(row.unit_price, 4),
    version: Number(row.version),
    valid_from: asString(row.valid_from),
    valid_to: asNullableString(row.valid_to),
    status: asString(row.status),
    price_list_id: asString(row.price_list_id),
    code: asString(row.code),
    name: asString(row.name),
    price_list_code: asString(row.code),
    price_list_name: asString(row.name),
    currency: asString(row.currency),
    tax_included: asBool(row.tax_included),
  };
}

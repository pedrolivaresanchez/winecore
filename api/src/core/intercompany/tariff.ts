import type { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { coversDate, intercompanyUnitPrice, rangesOverlap } from './calendar';
import { defaultPair, pairByIds, type EntityPair } from './entities';
import { asDecimal, dateText, isUuid, uuidText } from './numbers';

export interface TariffInput {
  sellerEntityId?: string;
  buyerEntityId?: string;
  basePriceListId: string;
  discountPct: string;
  validFrom: string;
  validTo: string | null;
  advisorValidation: string;
}

export interface TariffRecord {
  id: string;
  sellerEntityId: string;
  buyerEntityId: string;
  basePriceListId: string;
  discountPct: string;
  validFrom: string;
  validTo: string | null;
  status: 'draft' | 'active' | 'retired';
  advisorValidation: string;
  createdBy: string;
  createdAt: string;
}

interface TariffRow {
  id: string;
  seller_entity_id: string;
  buyer_entity_id: string;
  base_price_list_id: string;
  discount_pct: string;
  valid_from: string;
  valid_to: string | null;
  status: string;
  advisor_validation: string;
  created_by: string;
  created_at: string;
}

export function parseTariffBody(value: unknown, partial: boolean): TariffInput {
  if (!value || typeof value !== 'object') {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const base = optionalUuid(body.base_price_list_id);
  if (!partial && !base) fields.base_price_list_id = 'Indica la tarifa base';
  const discount = body.discount_pct === undefined ? null : discountText(body.discount_pct, fields);
  if (!partial && discount === null && !fields.discount_pct) fields.discount_pct = 'Indica el descuento';
  const validFrom = body.valid_from === undefined ? null : civilDate(body.valid_from, 'valid_from', fields);
  if (!partial && !validFrom && !fields.valid_from) fields.valid_from = 'Indica el inicio de la vigencia';
  let validTo: string | null = null;
  if (body.valid_to != null && body.valid_to !== '') {
    validTo = civilDate(body.valid_to, 'valid_to', fields);
  }
  const advisor = body.advisor_validation === undefined ? null : String(body.advisor_validation).trim();
  if ((advisor !== null && advisor.length < 5) || (!partial && (advisor === null || advisor.length < 5))) {
    throw domainError('WC_IC_ADVISOR_REQUIRED');
  }
  const seller = optionalUuid(body.seller_entity_id);
  const buyer = optionalUuid(body.buyer_entity_id);
  if (body.seller_entity_id != null && body.seller_entity_id !== '' && !seller) {
    fields.seller_entity_id = 'Identificador no válido';
  }
  if (body.buyer_entity_id != null && body.buyer_entity_id !== '' && !buyer) {
    fields.buyer_entity_id = 'Identificador no válido';
  }
  if (validFrom && validTo && validTo <= validFrom) {
    fields.valid_to = 'El fin de la vigencia es exclusivo y tiene que ser posterior al inicio';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    sellerEntityId: seller ?? undefined,
    buyerEntityId: buyer ?? undefined,
    basePriceListId: base ?? '',
    discountPct: discount ?? '',
    validFrom: validFrom ?? '',
    validTo,
    advisorValidation: advisor ?? '',
  };
}

export async function createTariff(tx: Tx, input: TariffInput, actorId: string, now: Date): Promise<TariffRecord> {
  const pair = await resolvePair(tx, input.sellerEntityId, input.buyerEntityId);
  await requirePriceList(tx, input.basePriceListId);
  requireAdvisor(input.advisorValidation);
  const id = newId();
  const discount = money.fromString(input.discountPct);
  tx.write(sql`
    INSERT INTO catalog.intercompany_tariff (
      id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct,
      valid_from, valid_to, status, advisor_validation, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${pair.seller.id} AS UUID),
      CAST(${pair.buyer.id} AS UUID),
      CAST(${input.basePriceListId} AS UUID),
      ${discount},
      CAST(${input.validFrom} AS DATE),
      CASE WHEN ${input.validTo} IS NULL THEN NULL ELSE CAST(${input.validTo} AS DATE) END,
      'draft',
      ${input.advisorValidation},
      ${actorId},
      ${now}
    )
  `);
  const record: TariffRecord = {
    id,
    sellerEntityId: pair.seller.id,
    buyerEntityId: pair.buyer.id,
    basePriceListId: input.basePriceListId,
    discountPct: discount.toDecimalPlaces(2).toFixed(2),
    validFrom: input.validFrom,
    validTo: input.validTo,
    status: 'draft',
    advisorValidation: input.advisorValidation,
    createdBy: actorId,
    createdAt: now.toISOString(),
  };
  tx.audit({
    table: 'catalog.intercompany_tariff',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: auditOf(record),
  });
  return record;
}

export async function updateDraftTariff(tx: Tx, id: string, next: TariffInput): Promise<TariffRecord> {
  const current = await requireTariff(tx, id);
  if (current.status !== 'draft') throw domainError('WC_IC_TARIFF_LOCKED');
  requireAdvisor(next.advisorValidation);
  if (next.validTo !== null && next.validTo <= next.validFrom) {
    throw domainError('WC_VALIDATION', { valid_to: 'El fin de la vigencia es exclusivo y tiene que ser posterior al inicio' });
  }
  await requirePriceList(tx, next.basePriceListId);
  const discount = money.fromString(next.discountPct);
  tx.write(sql`
    UPDATE catalog.intercompany_tariff SET
      base_price_list_id = CAST(${next.basePriceListId} AS UUID),
      discount_pct = ${discount},
      valid_from = CAST(${next.validFrom} AS DATE),
      valid_to = CASE WHEN ${next.validTo} IS NULL THEN NULL ELSE CAST(${next.validTo} AS DATE) END,
      advisor_validation = ${next.advisorValidation}
    WHERE id = CAST(${id} AS UUID) AND status = 'draft'
  `);
  const record: TariffRecord = {
    ...current,
    basePriceListId: next.basePriceListId,
    discountPct: discount.toDecimalPlaces(2).toFixed(2),
    validFrom: next.validFrom,
    validTo: next.validTo,
    advisorValidation: next.advisorValidation,
  };
  tx.audit({
    table: 'catalog.intercompany_tariff',
    rowId: id,
    action: 'UPDATE',
    before: auditOf(current),
    after: auditOf(record),
  });
  return record;
}

export async function activateTariff(tx: Tx, id: string): Promise<TariffRecord> {
  const current = await requireTariff(tx, id);
  if (current.status !== 'draft') throw domainError('WC_IC_TARIFF_LOCKED');
  requireAdvisor(current.advisorValidation);
  const others = await loadTariffs(tx, current.sellerEntityId, current.buyerEntityId, 'active');
  // UQ:catalog.intercompany_tariff — active ranges of the same pair must not overlap.
  const clash = others.find((other) => rangesOverlap(
    current.validFrom,
    current.validTo,
    other.validFrom,
    other.validTo,
  ));
  if (clash) {
    throw domainError('WC_IC_TARIFF_OVERLAP', undefined, {
      tariff_id: clash.id,
      valid_from: clash.validFrom,
      valid_to: clash.validTo,
    });
  }
  tx.write(sql`
    UPDATE catalog.intercompany_tariff
    SET status = 'active'
    WHERE id = CAST(${id} AS UUID) AND status = 'draft'
  `);
  const record: TariffRecord = { ...current, status: 'active' };
  tx.audit({
    table: 'catalog.intercompany_tariff',
    rowId: id,
    action: 'UPDATE',
    before: auditOf(current),
    after: auditOf(record),
  });
  return record;
}

export async function retireTariff(tx: Tx, id: string): Promise<TariffRecord> {
  const current = await requireTariff(tx, id);
  if (current.status === 'retired') return current;
  if (current.status === 'draft') throw domainError('WC_IC_TARIFF_LOCKED');
  tx.write(sql`
    UPDATE catalog.intercompany_tariff
    SET status = 'retired'
    WHERE id = CAST(${id} AS UUID) AND status = 'active'
  `);
  const record: TariffRecord = { ...current, status: 'retired' };
  tx.audit({
    table: 'catalog.intercompany_tariff',
    rowId: id,
    action: 'UPDATE',
    before: auditOf(current),
    after: auditOf(record),
  });
  return record;
}

export async function tariffById(tx: Tx, id: string): Promise<TariffRecord> {
  return requireTariff(tx, id);
}

export async function listTariffs(tx: Tx, sellerId?: string, buyerId?: string): Promise<TariffRecord[]> {
  const pair = sellerId && buyerId
    ? await pairByIds(tx, sellerId, buyerId)
    : await defaultPair(tx);
  return loadTariffs(tx, pair.seller.id, pair.buyer.id, null);
}

export async function loadActiveTariffs(tx: Tx, sellerId: string, buyerId: string): Promise<TariffRecord[]> {
  return loadTariffs(tx, sellerId, buyerId, 'active');
}

export function tariffForDate(tariffs: readonly TariffRecord[], day: string): TariffRecord | null {
  const matches = tariffs.filter((tariff) => tariff.status === 'active' && coversDate(tariff.validFrom, tariff.validTo, day));
  matches.sort((left, right) => right.validFrom.localeCompare(left.validFrom));
  return matches[0] ?? null;
}

export async function intercompanyPrice(
  tx: Tx,
  input: { productId: string; date: string; quantity?: string; sellerEntityId?: string; buyerEntityId?: string },
): Promise<Decimal> {
  const pair = input.sellerEntityId && input.buyerEntityId
    ? await pairByIds(tx, input.sellerEntityId, input.buyerEntityId)
    : await defaultPair(tx);
  const day = dateText(input.date);
  const quantity = money.fromString(input.quantity ?? '1');
  const tariffs = await loadActiveTariffs(tx, pair.seller.id, pair.buyer.id);
  const tariff = tariffForDate(tariffs, day);
  if (!tariff) {
    throw domainError('WC_IC_TARIFF_MISSING', undefined, {
      reason: 'tariff',
      products: [{ id: input.productId }],
    });
  }
  const base = await basePrice(tx, tariff, input.productId, day, quantity);
  if (!base) {
    throw domainError('WC_IC_TARIFF_MISSING', undefined, {
      reason: 'base_price',
      products: [{ id: input.productId }],
      tariff_id: tariff.id,
    });
  }
  return intercompanyUnitPrice(base, money.fromString(tariff.discountPct));
}

async function basePrice(
  tx: Tx,
  tariff: TariffRecord,
  productId: string,
  day: string,
  quantity: Decimal,
): Promise<Decimal | null> {
  const versions = await tx.read<{ id: string; valid_from: string; valid_to: string | null; status: string }>(sql`
    SELECT id, valid_from, valid_to, status
    FROM catalog.price_list_version
    WHERE price_list_id = CAST(${tariff.basePriceListId} AS UUID) AND status = 'active'
  `);
  const version = versions
    .map((row) => ({
      id: uuidText(row.id),
      validFrom: dateText(row.valid_from),
      validTo: row.valid_to == null ? null : dateText(row.valid_to),
    }))
    .filter((row) => coversDate(row.validFrom, row.validTo, day))
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
  if (!version) return null;
  const items = await tx.read<{ min_qty: string; unit_price: string }>(sql`
    SELECT min_qty, unit_price
    FROM catalog.price_list_item
    WHERE version_id = CAST(${version.id} AS UUID) AND product_id = CAST(${productId} AS UUID)
  `);
  const eligible = items
    .map((row) => ({ min: asDecimal(row.min_qty), price: asDecimal(row.unit_price) }))
    .filter((row) => row.min.lte(quantity))
    .sort((left, right) => right.min.cmp(left.min));
  return eligible[0]?.price ?? null;
}

async function loadTariffs(
  tx: Tx,
  sellerId: string,
  buyerId: string,
  status: 'draft' | 'active' | 'retired' | null,
): Promise<TariffRecord[]> {
  const rows = await tx.read<TariffRow>(sql`
    SELECT id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct,
           valid_from, valid_to, status, advisor_validation, created_by, created_at
    FROM catalog.intercompany_tariff
    WHERE seller_entity_id = CAST(${sellerId} AS UUID)
      AND buyer_entity_id = CAST(${buyerId} AS UUID)
      AND (${status} IS NULL OR status = ${status})
    ORDER BY valid_from, id
  `);
  return rows.map(mapTariff);
}

async function requireTariff(tx: Tx, id: string): Promise<TariffRecord> {
  const rows = await tx.read<TariffRow>(sql`
    SELECT id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct,
           valid_from, valid_to, status, advisor_validation, created_by, created_at
    FROM catalog.intercompany_tariff
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return mapTariff(row);
}

async function requirePriceList(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM catalog.price_list WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError('WC_VALIDATION', { base_price_list_id: 'La tarifa base no existe' });
}

async function resolvePair(tx: Tx, sellerId?: string, buyerId?: string): Promise<EntityPair> {
  if (sellerId && buyerId) return pairByIds(tx, sellerId, buyerId);
  if (sellerId || buyerId) {
    throw domainError('WC_VALIDATION', { entity: 'Indica las dos entidades o ninguna' });
  }
  return defaultPair(tx);
}

function requireAdvisor(value: string): void {
  if (value.trim().length < 5) throw domainError('WC_IC_ADVISOR_REQUIRED');
}

function mapTariff(row: TariffRow): TariffRecord {
  const status = row.status;
  if (status !== 'draft' && status !== 'active' && status !== 'retired') {
    throw domainError('WC_VALIDATION', { status: 'Estado de tarifa desconocido' });
  }
  return {
    id: uuidText(row.id),
    sellerEntityId: uuidText(row.seller_entity_id),
    buyerEntityId: uuidText(row.buyer_entity_id),
    basePriceListId: uuidText(row.base_price_list_id),
    discountPct: asDecimal(row.discount_pct).toDecimalPlaces(2).toFixed(2),
    validFrom: dateText(row.valid_from),
    validTo: row.valid_to == null ? null : dateText(row.valid_to),
    status,
    advisorValidation: row.advisor_validation,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
  };
}

function auditOf(record: TariffRecord): Record<string, unknown> {
  return {
    seller_entity_id: record.sellerEntityId,
    buyer_entity_id: record.buyerEntityId,
    base_price_list_id: record.basePriceListId,
    discount_pct: record.discountPct,
    valid_from: record.validFrom,
    valid_to: record.validTo,
    status: record.status,
    advisor_validation: record.advisorValidation,
  };
}

function optionalUuid(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value).toLowerCase();
  return isUuid(text) ? text : null;
}

function civilDate(value: unknown, field: string, fields: Record<string, string>): string | null {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fields[field] = 'Usa una fecha AAAA-MM-DD';
    return null;
  }
  return text;
}

function discountText(value: unknown, fields: Record<string, string>): string | null {
  try {
    const parsed = asDecimal(value);
    if (parsed.isNeg() || parsed.gte(100)) {
      fields.discount_pct = 'El descuento tiene que ser mayor o igual que 0 y menor que 100';
      return null;
    }
    if (parsed.decimalPlaces() > 2) {
      fields.discount_pct = 'El descuento admite como máximo 2 decimales';
      return null;
    }
    return parsed.toFixed();
  } catch {
    fields.discount_pct = 'Descuento no válido';
    return null;
  }
}

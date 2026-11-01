import { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { bodyId, decOf, fail, idOf, loadProduct, optionalText, parseDecimal, priceText, taxRateOf, throwIf } from './db';

const CHANNEL_LIST: Record<string, string> = {
  distributor: 'distributor',
  horeca: 'distributor',
  eci_edi: 'distributor',
  institutional: 'distributor',
  intercompany: 'distributor',
  export: 'final',
  direct: 'final',
  web: 'final',
  fair: 'final',
  cellar_shop: 'shop',
};

export function priceListCodeForChannel(channel: string): string | null {
  return CHANNEL_LIST[channel] ?? null;
}

export type PriceHit = {
  unitPrice: Decimal;
  priceListId: string;
  versionId: string;
  minQty: string;
};

/**
 * Precio de la tarifa del cliente (o la del canal) vigente en la fecha:
 * la escala con mayor mínimo que no supera la cantidad.
 */
export async function quotePrice(
  tx: Tx,
  input: { productId: string; quantity: Decimal; date: string; priceListId: string | null; channel: string },
): Promise<PriceHit> {
  const listId = input.priceListId ?? await listIdForChannel(tx, input.channel);
  if (!listId) fail('No hay precio de tarifa para el producto', { product_id: input.productId });
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT i.unit_price, i.min_qty, v.id AS version_id, v.price_list_id
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    WHERE v.price_list_id = CAST(${listId} AS UUID)
      AND v.status = 'active'
      AND v.valid_from <= CAST(${input.date} AS DATE)
      AND (v.valid_to IS NULL OR v.valid_to > CAST(${input.date} AS DATE))
      AND i.product_id = CAST(${input.productId} AS UUID)
      AND i.min_qty <= CAST(${input.quantity.toFixed(3)} AS DECIMAL(14,3))
    ORDER BY i.min_qty DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) fail('No hay precio de tarifa para el producto', { product_id: input.productId });
  return {
    unitPrice: decOf(row.unit_price),
    priceListId: idOf(row.price_list_id),
    versionId: idOf(row.version_id),
    minQty: decOf(row.min_qty).toFixed(3),
  };
}

async function listIdForChannel(tx: Tx, channel: string): Promise<string | null> {
  const code = CHANNEL_LIST[channel];
  if (!code) return null;
  const rows = await tx.read<{ id: unknown }>(sql`
    SELECT id FROM catalog.price_list WHERE code = ${code} AND is_active
  `);
  return rows[0] ? idOf(rows[0].id) : null;
}

export type CommercialLineInput = {
  productId: string;
  quantity: Decimal;
  discountPct: Decimal;
  unitPrice: Decimal | null;
  priceReason: string | null;
  taxCode: string | null;
  description: string | null;
  unit: string | null;
};

export function parseCommercialLines(raw: unknown): CommercialLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('Hace falta al menos una línea', { lines: 'Obligatorio' });
  return raw.map((item, index) => {
    const fields: Record<string, string> = {};
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!row) fail('Línea no válida', { [`lines.${index}`]: 'Debe ser un objeto' });
    const prefix = `lines.${index}`;
    const productId = bodyId(row.product_id, `${prefix}.product_id`, fields);
    const quantity = parseDecimal(row.quantity, `${prefix}.quantity`, fields, true);
    const discount = row.discount_pct == null || row.discount_pct === ''
      ? new Decimal(0)
      : parseDecimal(row.discount_pct, `${prefix}.discount_pct`, fields, true);
    const unitPrice = row.unit_price == null || row.unit_price === ''
      ? null
      : parseDecimal(row.unit_price, `${prefix}.unit_price`, fields, true);
    const priceReason = optionalText(row.price_reason, `${prefix}.price_reason`, fields, 300);
    const taxCode = row.tax_code == null || row.tax_code === '' ? null : (typeof row.tax_code === 'string' ? row.tax_code : null);
    if (row.tax_code != null && row.tax_code !== '' && taxCode == null) fields[`${prefix}.tax_code`] = 'Debe ser texto';
    const description = optionalText(row.description, `${prefix}.description`, fields, 250);
    const unit = optionalText(row.unit, `${prefix}.unit`, fields, 30);
    if (quantity && quantity.lte(0)) fields[`${prefix}.quantity`] = 'La cantidad debe ser mayor que cero';
    if (discount && (discount.lt(0) || discount.gt(100))) fields[`${prefix}.discount_pct`] = 'El descuento debe estar entre 0 y 100';
    if (unitPrice && unitPrice.lt(0)) fields[`${prefix}.unit_price`] = 'El precio no puede ser negativo';
    throwIf(fields);
    if (!productId || !quantity || !discount) fail('Línea no válida');
    return { productId, quantity, discountPct: discount, unitPrice, priceReason, taxCode, description, unit };
  });
}

export async function resolveLinePrice(
  tx: Tx,
  line: CommercialLineInput,
  date: string,
  priceListId: string | null,
  channel: string,
): Promise<{ unitPrice: Decimal; taxCode: string; description: string; productName: string }> {
  const product = await loadProduct(tx, line.productId);
  if (!product.is_active) fail('El producto no está activo', { product_id: line.productId });
  const hit = await quotePrice(tx, {
    productId: line.productId,
    quantity: line.quantity,
    date,
    priceListId,
    channel,
  }).catch((error: unknown) => {
    if (line.unitPrice) return null;
    throw error;
  });
  let unitPrice = hit?.unitPrice ?? null;
  if (line.unitPrice) {
    const differs = !unitPrice || !line.unitPrice.equals(unitPrice.toDecimalPlaces(6));
    if (differs && (!line.priceReason || line.priceReason.length < 3)) {
      fail('El precio distinto de la tarifa necesita un motivo', { price_reason: 'Obligatorio' });
    }
    unitPrice = line.unitPrice;
  }
  if (!unitPrice) fail('No hay precio de tarifa para el producto', { product_id: line.productId });
  const taxCode = line.taxCode ?? product.default_tax_code;
  if (!taxCode) fail('El producto no tiene impuesto', { product_id: line.productId });
  await taxRateOf(tx, taxCode);
  const description = line.description ?? product.name;
  return { unitPrice, taxCode, description, productName: product.name };
}

export function priceJson(hit: PriceHit): { unit_price: string; price_list_id: string; version_id: string; min_qty: string } {
  return {
    unit_price: priceText(hit.unitPrice),
    price_list_id: hit.priceListId,
    version_id: hit.versionId,
    min_qty: hit.minQty,
  };
}

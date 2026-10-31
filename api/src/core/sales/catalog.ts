import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { businessDate, isMadridCivilDate } from '../time';
import { priceListCodeForChannel } from './pricing';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELLABLE = `('wine','bulk_wine','merchandise','service','gift_card','other')`;

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  requires_lot: boolean;
  format: { id: string; code: string; name: string; nominal_volume_ml: number } | null;
  price: {
    currency: 'EUR';
    unit_price: string;
    price_list_id: string;
    version_id: string;
    min_qty: string;
  } | null;
}

export interface CatalogLot {
  id: string;
  code: string;
  product_id: string | null;
  location_id: string;
  location_code: string;
  qty_units: string;
  volume_ml: string;
}

export async function salesCatalog(writer: Writer, url: URL, now: Date): Promise<{
  date: string;
  channel: string | null;
  customer_id: string | null;
  price_list_id: string | null;
  products: CatalogProduct[];
  lots: CatalogLot[];
}> {
  const fields: Record<string, string> = {};
  const channelRaw = url.searchParams.get('channel')?.trim() ?? '';
  const customerRaw = url.searchParams.get('customer_id')?.trim().toLowerCase() ?? '';
  const dateRaw = url.searchParams.get('date')?.trim() ?? '';
  const day = dateRaw === '' ? businessDate(now) : dateRaw;
  if (!isMadridCivilDate(day)) fields.date = 'La fecha debe ser AAAA-MM-DD';
  if (customerRaw !== '' && !UUID.test(customerRaw)) fields.customer_id = 'Identificador no válido';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);

  let channel: string | null = null;
  if (channelRaw !== '') {
    const rows = await writer.read<{ code: string }>(sql`
      SELECT code FROM sales.channel WHERE code = ${channelRaw} AND is_active
    `);
    if (!rows[0]) throw domainError('WC_VALIDATION', { channel: 'El canal no existe' });
    channel = String(rows[0].code);
  }

  let customerId: string | null = null;
  let listId: string | null = null;
  if (customerRaw !== '') {
    const rows = await writer.read<Record<string, unknown>>(sql`
      SELECT id, is_customer, default_price_list_id
      FROM party.contact
      WHERE id = CAST(${customerRaw} AS UUID) AND archived_at IS NULL AND merged_into_id IS NULL
    `);
    const row = rows[0];
    if (!row) throw domainError('WC_VALIDATION', { customer_id: 'El cliente no existe' });
    if (!flag(row.is_customer)) throw domainError('WC_VALIDATION', { customer_id: 'El contacto no es cliente' });
    customerId = String(row.id).toLowerCase();
    listId = row.default_price_list_id == null ? null : String(row.default_price_list_id).toLowerCase();
  }
  if (!listId && channel) listId = await listIdForChannel(writer, channel);

  const [products, lots] = await Promise.all([
    loadProducts(writer, listId, day),
    loadLots(writer),
  ]);
  return { date: day, channel, customer_id: customerId, price_list_id: listId, products, lots };
}

async function listIdForChannel(writer: Writer, channel: string): Promise<string | null> {
  const code = priceListCodeForChannel(channel);
  if (!code) return null;
  const rows = await writer.read<{ id: unknown }>(sql`
    SELECT id FROM catalog.price_list WHERE code = ${code} AND is_active
  `);
  return rows[0] ? String(rows[0].id).toLowerCase() : null;
}

async function loadProducts(writer: Writer, listId: string | null, day: string): Promise<CatalogProduct[]> {
  const priceJoin = listId
    ? `
      LEFT JOIN (
        SELECT product_id, unit_price, min_qty, version_id, price_list_id
        FROM (
          SELECT i.product_id, i.unit_price, i.min_qty, v.id AS version_id, v.price_list_id,
                 row_number() OVER (
                   PARTITION BY i.product_id
                   ORDER BY v.valid_from DESC, i.min_qty DESC
                 ) AS rn
          FROM catalog.price_list_item i
          JOIN catalog.price_list_version v ON v.id = i.version_id
          WHERE v.price_list_id = CAST(${sqlText(listId)} AS UUID)
            AND v.status = 'active'
            AND v.valid_from <= CAST(${sqlText(day)} AS DATE)
            AND (v.valid_to IS NULL OR v.valid_to > CAST(${sqlText(day)} AS DATE))
            AND i.min_qty <= 1
        ) ranked
        WHERE rn = 1
      ) pr ON pr.product_id = p.id
    `
    : '';
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT p.id, p.sku, p.name, p.kind, p.unit, p.requires_lot,
           f.id AS format_id, f.code AS format_code, f.name AS format_name, f.nominal_volume_ml
           ${listId ? ', pr.unit_price, pr.min_qty, pr.version_id, pr.price_list_id' : ''}
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    ${priceJoin}
    WHERE p.is_active AND p.kind IN ${SELLABLE}
    ORDER BY p.name, p.sku
  `);
  return rows.map((row) => {
    const formatId = idOf(row.format_id);
    const price = listId && row.unit_price != null
      ? {
          currency: 'EUR' as const,
          unit_price: money.fromString(String(row.unit_price)).toDecimalPlaces(6).toFixed(6),
          price_list_id: idOf(row.price_list_id) ?? listId,
          version_id: idOf(row.version_id) ?? '',
          min_qty: money.fromString(String(row.min_qty ?? '1')).toDecimalPlaces(3).toFixed(3),
        }
      : null;
    return {
      id: idOf(row.id) ?? '',
      sku: String(row.sku),
      name: String(row.name),
      kind: String(row.kind),
      unit: String(row.unit),
      requires_lot: flag(row.requires_lot),
      format: formatId
        ? {
            id: formatId,
            code: String(row.format_code),
            name: String(row.format_name),
            nominal_volume_ml: Number(row.nominal_volume_ml),
          }
        : null,
      price,
    };
  });
}

async function loadLots(writer: Writer): Promise<CatalogLot[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT b.lot_id, b.product_id, b.location_id, lot.code AS lot_code, loc.code AS location_code,
           sum(b.qty_units) AS qty_units, sum(b.volume_ml) AS volume_ml
    FROM inventory.v_stock_balance b
    JOIN inventory.lot lot ON lot.id = b.lot_id
    JOIN inventory.location loc ON loc.id = b.location_id
    WHERE b.lot_id IS NOT NULL
    GROUP BY b.lot_id, b.product_id, b.location_id, lot.code, loc.code
    HAVING sum(b.qty_units) > 0 OR sum(b.volume_ml) > 0
    ORDER BY lot.code, loc.code
  `);
  return rows.flatMap((row) => {
    const id = idOf(row.lot_id);
    const locationId = idOf(row.location_id);
    if (!id || !locationId) return [];
    return [{
      id,
      code: String(row.lot_code ?? ''),
      product_id: idOf(row.product_id),
      location_id: locationId,
      location_code: String(row.location_code ?? ''),
      qty_units: String(row.qty_units ?? '0'),
      volume_ml: String(row.volume_ml ?? '0'),
    }];
  });
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

function idOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text === '' ? null : text;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

import { sql } from '../../src/core/db/sql';
import type { Tx } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { money } from '../../src/core/money';
import { createTariff } from '../../src/core/intercompany/tariff';

export const PO = '019a0000-0000-7000-8000-000000000001';
export const CVPO = '019a0000-0000-7000-8000-000000000002';
export const OWNER = '019a0000-0000-7000-8000-000000000011';

export const actor = {
  type: 'user' as const,
  id: OWNER,
  requestId: 'intercompany-test',
};

export interface Catalog {
  priceListId: string;
  versionId: string;
  productId: string;
  lotId: string;
  fromLocationId: string;
  toLocationId: string;
  seriesId: string;
}

export async function seedCatalog(
  tx: Tx,
  options?: { unitPrice?: string; taxCode?: string | null; requiresLot?: boolean; sku?: string; tracked?: boolean },
): Promise<Catalog> {
  const priceListId = newId();
  const versionId = newId();
  const productId = newId();
  const lotId = newId();
  const fromLocationId = newId();
  const toLocationId = newId();
  const seriesId = newId();
  const sku = options?.sku ?? 'VIN075';
  const unitPrice = options?.unitPrice ?? '12.500000';
  const requiresLot = options?.requiresLot ?? true;
  const tracked = options?.tracked ?? true;
  tx.write(sql`
    INSERT INTO catalog.price_list (id, code, name)
    VALUES (CAST(${priceListId} AS UUID), 'distributor', 'Distribuidor')
  `);
  tx.write(sql`
    INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
    VALUES (CAST(${versionId} AS UUID), CAST(${priceListId} AS UUID), 1, DATE '2026-01-01', 'active', ${OWNER})
  `);
  tx.write(sql`
    INSERT INTO catalog.product (id, sku, name, kind, unit, requires_lot, is_stock_tracked, default_tax_code)
    VALUES (
      CAST(${productId} AS UUID), ${sku}, ${'Vino de prueba'}, ${tracked ? 'wine' : 'service'}, 'ud',
      ${requiresLot}, ${tracked}, ${options?.taxCode === undefined ? 'IVA21' : options.taxCode}
    )
  `);
  tx.write(sql`
    INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
    VALUES (
      CAST(${newId()} AS UUID), CAST(${versionId} AS UUID), CAST(${productId} AS UUID),
      ${money.fromString('1')}, ${money.fromString(unitPrice)}
    )
  `);
  tx.write(sql`
    INSERT INTO inventory.lot (id, producer_entity_id, code, kind, origin)
    VALUES (CAST(${lotId} AS UUID), CAST(${PO} AS UUID), 'L2027', 'bottled', 'opening_count')
  `);
  tx.write(sql`
    INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
    VALUES (CAST(${fromLocationId} AS UUID), 'BOD', 'Bodega', 'cellar', CAST(${PO} AS UUID))
  `);
  tx.write(sql`
    INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
    VALUES (CAST(${toLocationId} AS UUID), 'VLC', 'Valencia', 'own_warehouse', CAST(${CVPO} AS UUID))
  `);
  tx.write(sql`
    INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, country_code, is_customer, payment_terms_days, created_by)
    VALUES (
      CAST(${newId()} AS UUID), 'company', 'Comercializadora CVPO', 'B00000000', 'nif', 'ES', TRUE, 30, ${OWNER}
    )
  `);
  tx.write(sql`
    INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix, is_default, is_active)
    VALUES (
      CAST(${seriesId} AS UUID), CAST(${PO} AS UUID), 'intercompany_invoice', 'PI', 2027, 'PI27', TRUE, TRUE
    )
  `);
  return { priceListId, versionId, productId, lotId, fromLocationId, toLocationId, seriesId };
}

export function addProduct(
  tx: Tx,
  catalog: Catalog,
  input: { sku: string; name: string; unitPrice?: string | null; taxCode?: string | null; requiresLot?: boolean; tracked?: boolean },
): string {
  const productId = newId();
  const tracked = input.tracked ?? true;
  tx.write(sql`
    INSERT INTO catalog.product (id, sku, name, kind, unit, requires_lot, is_stock_tracked, default_tax_code)
    VALUES (
      CAST(${productId} AS UUID), ${input.sku}, ${input.name}, ${tracked ? 'wine' : 'service'}, 'ud',
      ${input.requiresLot ?? false}, ${tracked}, ${input.taxCode === undefined ? 'IVA21' : input.taxCode}
    )
  `);
  if (input.unitPrice != null) {
    tx.write(sql`
      INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
      VALUES (
        CAST(${newId()} AS UUID), CAST(${catalog.versionId} AS UUID), CAST(${productId} AS UUID),
        ${money.fromString('1')}, ${money.fromString(input.unitPrice)}
      )
    `);
  }
  return productId;
}

export async function draftDefaultTariff(tx: Tx, priceListId: string, discount = '60'): Promise<string> {
  const created = await createTariff(tx, {
    basePriceListId: priceListId,
    discountPct: discount,
    validFrom: '2026-01-01',
    validTo: null,
    advisorValidation: 'Informe asesor IC-2026',
  }, OWNER, new Date('2026-12-01T10:00:00Z'));
  return created.id;
}

export function ownershipMove(
  tx: Tx,
  input: {
    at: string;
    units: number;
    productId: string;
    lotId: string | null;
    locationId: string;
    sourceTable?: string;
    sourceId?: string;
    sourceLineId?: string | null;
    state?: string;
  },
): string {
  const sourceId = input.sourceId ?? newId();
  const outId = newId();
  const inId = newId();
  const at = new Date(input.at);
  const state = input.state ?? 'packaged_labeled';
  const sourceTable = input.sourceTable ?? 'inventory.stock_move';
  writeMove(tx, outId, at, 'ownership_out', -Math.abs(input.units), PO, input, sourceTable, sourceId, state);
  writeMove(tx, inId, at, 'ownership_in', Math.abs(input.units), CVPO, input, sourceTable, sourceId, state);
  return sourceId;
}

function writeMove(
  tx: Tx,
  id: string,
  at: Date,
  moveType: 'ownership_out' | 'ownership_in',
  units: number,
  owner: string,
  input: {
    productId: string;
    lotId: string | null;
    locationId: string;
    sourceLineId?: string | null;
  },
  sourceTable: string,
  sourceId: string,
  state: string,
): void {
  tx.write(sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
      qty_units, source_table, source_id, source_line_id, created_by
    ) VALUES (
      CAST(${id} AS UUID),
      ${at},
      ${moveType},
      CAST(${input.locationId} AS UUID),
      CAST(${owner} AS UUID),
      CASE WHEN ${input.lotId} IS NULL THEN NULL ELSE CAST(${input.lotId} AS UUID) END,
      CAST(${input.productId} AS UUID),
      ${state},
      ${units},
      ${sourceTable},
      CAST(${sourceId} AS UUID),
      CASE WHEN ${input.sourceLineId ?? null} IS NULL THEN NULL ELSE CAST(${input.sourceLineId ?? null} AS UUID) END,
      'test'
    )
  `);
}

export async function countOf(tx: Tx, statement: string): Promise<number> {
  const rows = await tx.read<{ n: number | string }>(statement);
  return Number(rows[0]?.n ?? 0);
}

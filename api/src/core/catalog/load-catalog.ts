import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { newId } from '../ids';
import { CATALOG_WINES, EXTRA_LOTS, EXTRA_NAMED_LOTS, SHARED_LOTS } from './catalog-snapshot';

const ACTOR = { type: 'migration' as const, id: '019c0000-0000-7000-8000-0000000000ac', requestId: 'load-catalog' };

const FORMATS: Record<number, { code: string; name: string }> = {
  500: { code: 'B050', name: 'Botella 0,50 L' },
  750: { code: 'B075', name: 'Botella 0,75 L' },
  1500: { code: 'B150', name: 'Magnum 1,50 L' },
};

export type CatalogLoadReport = {
  wines: number;
  products: number;
  lots: number;
  holded_archived: number;
  holded_removed: number;
  unpriced: string[];
};

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

/**
 * Crea el catálogo real y aparta los productos de Holded.
 * No los borra: DuckDB comprueba las claves foráneas contra el estado anterior
 * a la transacción, así que borrar precios y producto a la vez falla. Se desactivan
 * y se dejan las filas hijas. Pedro prefiere desactivar a borrar.
 */
export async function loadCatalog(writer: Writer): Promise<CatalogLoadReport> {
  const entities = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
  const po = entities.find((row) => row.code === 'PO');
  if (!po) throw new Error('Falta la entidad PO');
  const poId = idOf(po.id);
  const formats = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM catalog.format`);
  const wines = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM catalog.wine`);
  const products = await writer.read<{ id: string; sku: string }>(`SELECT id::VARCHAR AS id, sku FROM catalog.product`);
  const lots = await writer.read<{ id: string; code: string }>(sql`
    SELECT id::VARCHAR AS id, code FROM inventory.lot WHERE producer_entity_id = CAST(${poId} AS UUID)
  `);
  const formatId = new Map(formats.map((row) => [row.code, idOf(row.id)]));
  const wineId = new Map(wines.map((row) => [row.code, idOf(row.id)]));
  const productId = new Map(products.map((row) => [row.sku, idOf(row.id)]));
  const lotId = new Map(lots.map((row) => [row.code, idOf(row.id)]));
  const statements: string[] = [];
  let createdProducts = 0;
  let createdLots = 0;

  for (const ml of Object.keys(FORMATS).map(Number)) {
    const spec = FORMATS[ml];
    if (!spec || formatId.has(spec.code)) continue;
    const id = newId();
    formatId.set(spec.code, id);
    statements.push(sql`
      INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
      VALUES (CAST(${id} AS UUID), ${spec.code}, ${spec.name}, 'bottle', ${ml})
    `);
  }

  for (const row of CATALOG_WINES) {
    if (!wineId.has(row.wineCode)) {
      const id = newId();
      wineId.set(row.wineCode, id);
      statements.push(sql`
        INSERT INTO catalog.wine (id, code, name, color, is_organic)
        VALUES (CAST(${id} AS UUID), ${row.wineCode}, ${row.wine}, ${row.color}, ${row.organic})
      `);
    }
    const format = FORMATS[row.formatMl];
    const fid = format ? formatId.get(format.code) : null;
    const wid = wineId.get(row.wineCode);
    if (!productId.has(row.sku) && fid && wid) {
      const id = newId();
      productId.set(row.sku, id);
      createdProducts += 1;
      statements.push(sql`
        INSERT INTO catalog.product (
          id, sku, name, kind, wine_id, vintage, format_id, unit, alcohol_pct,
          is_stock_tracked, requires_lot, for_sale, is_active, legacy_refs, default_tax_code
        ) VALUES (
          CAST(${id} AS UUID), ${row.sku}, ${row.name}, 'wine', CAST(${wid} AS UUID),
          ${row.vintage}, CAST(${fid} AS UUID), 'ud',
          CASE WHEN ${row.abv} IS NULL THEN NULL ELSE CAST(${row.abv} AS DECIMAL(4,2)) END,
          TRUE, ${row.requiresLot ?? row.lot != null}, ${row.forSale}, TRUE,
          ${sql.json({ source: 'pedro-2026', priced: row.priced })}, 'IVA21'
        )
      `);
    } else if (productId.has(row.sku)) {
      statements.push(sql`
        UPDATE catalog.product SET for_sale = ${row.forSale}, is_active = TRUE
        WHERE sku = ${row.sku}
      `);
    }
    const shared = (SHARED_LOTS as readonly string[]).includes(row.lot ?? '');
    if (row.lot && !lotId.has(row.lot)) {
      const id = newId();
      lotId.set(row.lot, id);
      createdLots += 1;
      const lotWine = shared ? null : wid ?? null;
      statements.push(sql`
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, is_organic, origin, notes)
        VALUES (
          CAST(${id} AS UUID), CAST(${poId} AS UUID), ${row.lot}, 'bottled',
          CASE WHEN ${lotWine} IS NULL THEN NULL ELSE CAST(${lotWine} AS UUID) END,
          ${row.vintage}, ${row.organic}, 'opening_count',
          ${shared ? 'Lote de hoja compartido por varias fichas.' : null}
        )
      `);
    }
  }
  for (const named of EXTRA_NAMED_LOTS) {
    if (lotId.has(named.code)) continue;
    const id = newId();
    lotId.set(named.code, id);
    createdLots += 1;
    const wid = wineId.get(named.wineCode) ?? null;
    statements.push(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, is_organic, origin, notes)
      VALUES (
        CAST(${id} AS UUID), CAST(${poId} AS UUID), ${named.code}, 'bottled',
        CASE WHEN ${wid} IS NULL THEN NULL ELSE CAST(${wid} AS UUID) END,
        ${named.vintage}, TRUE, 'opening_count', ${named.note}
      )
    `);
  }
  for (const code of EXTRA_LOTS) {
    if (lotId.has(code)) continue;
    const id = newId();
    lotId.set(code, id);
    createdLots += 1;
    statements.push(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, is_organic, origin, notes)
      VALUES (CAST(${id} AS UUID), CAST(${poId} AS UUID), ${code}, 'bottled', TRUE, 'opening_count',
              'Lote de hoja usado por varias referencias. Pedro debe confirmar el vino.')
    `);
  }

  const holded = await writer.read<{ id: string }>(`
    SELECT id::VARCHAR AS id FROM catalog.product
    WHERE lower(legacy_refs::VARCHAR) LIKE '%holded%'
  `);
  let archived = 0;
  const removed = 0;
  for (const row of holded) {
    const id = idOf(row.id);
    archived += 1;
    statements.push(sql`
      UPDATE catalog.product SET is_active = FALSE, for_sale = FALSE
      WHERE id = CAST(${id} AS UUID)
    `);
  }

  if (statements.length > 0) {
    await writer.withWrite(ACTOR, async (tx) => {
      for (const statement of statements) tx.write(statement);
    });
  }
  return {
    wines: wineId.size,
    products: createdProducts,
    lots: createdLots,
    holded_archived: archived,
    holded_removed: removed,
    unpriced: CATALOG_WINES.filter((row) => !row.priced).map((row) => row.sku),
  };
}

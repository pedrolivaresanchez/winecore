import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { newId } from '../ids';
import { CAVES_CURRENCY_UNSTATED, LIST_NAMES, TAX_INCLUDED_LISTS, TARIFF_LINES, type TariffLine } from './tariff-rules';
import { fold } from '../inventory/bottled-snapshot';

const ACTOR = { type: 'migration' as const, id: '019c0000-0000-7000-8000-0000000000ab', requestId: 'load-tariffs' };
const NOTE = 'tarifa-pedro-2026';

function versionNote(code: string): string {
  if (code === 'custom-pyrene' && CAVES_CURRENCY_UNSTATED) {
    return `${NOTE}. El fichero no indica moneda; se carga como EUR pendiente de confirmar.`;
  }
  if (code === 'final') return `${NOTE}. PVP con IVA incluido. El documento guarda la base.`;
  if (code === 'custom-eci') return `${NOTE}. Coste neto de la plantilla 2025 (5 vinos). El PVP de ECI no se usa como precio.`;
  return NOTE;
}

export type TariffLoadReport = {
  loaded: { list: string; prices: number }[];
  skipped: string[];
  unmatched: { list: string; wine: string; vintage: string }[];
};

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

/** Crea las tarifas publicadas y pone precio solo donde ya hay un producto de esa añada. */
export async function loadTariffs(writer: Writer): Promise<TariffLoadReport> {
  const products = await writer.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.sku, p.name, p.vintage::VARCHAR AS vintage,
           COALESCE(wo.name, w.name) AS wine_name
    FROM catalog.product p
    LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
    LEFT JOIN catalog.wine w ON w.id = COALESCE(po.wine_id, p.wine_id)
    LEFT JOIN catalog.wine_overlay wo ON wo.wine_id = w.id
    WHERE p.is_active AND NOT COALESCE(po.hidden, FALSE) AND p.kind = 'wine'
      AND COALESCE(po.for_sale, p.for_sale, TRUE)
  `);
  const lists = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM catalog.price_list`);
  const versions = await writer.read<{ code: string }>(sql`
    SELECT l.code FROM catalog.price_list_version v
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE v.notes LIKE ${`${NOTE}%`}
  `);
  const done = new Set(versions.map((row) => row.code));
  const byList = new Map<string, TariffLine[]>();
  for (const line of TARIFF_LINES) {
    const list = byList.get(line.list) ?? [];
    list.push(line);
    byList.set(line.list, list);
  }
  const statements: string[] = [];
  const report: TariffLoadReport = { loaded: [], skipped: [], unmatched: [] };
  for (const [code, lines] of byList) {
    if (done.has(code)) {
      report.skipped.push(code);
      continue;
    }
    const existing = lists.find((row) => row.code === code);
    const listId = existing ? idOf(existing.id) : newId();
    const meta = LIST_NAMES[code as TariffLine['list']];
    if (!existing) {
      statements.push(sql`
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        VALUES (
          CAST(${listId} AS UUID), ${code}, ${meta.name}, ${meta.currency},
          ${TAX_INCLUDED_LISTS.has(code as TariffLine['list'])}, TRUE
        )
      `);
    }
    const versionId = newId();
    statements.push(sql`
      INSERT INTO catalog.price_list_version (
        id, price_list_id, version, valid_from, status, notes, created_by, activated_at
      )
      SELECT CAST(${versionId} AS UUID), CAST(${listId} AS UUID),
             coalesce(max(version), 0) + 1, DATE '2026-01-01', 'active', ${versionNote(code)}, 'load-tariffs', now()
      FROM catalog.price_list_version WHERE price_list_id = CAST(${listId} AS UUID)
    `);
    // La SELECT de arriba no inserta si la tarifa es nueva y no tiene versiones.
    statements.push(sql`
      INSERT INTO catalog.price_list_version (
        id, price_list_id, version, valid_from, status, notes, created_by, activated_at
      )
      SELECT CAST(${versionId} AS UUID), CAST(${listId} AS UUID), 1, DATE '2026-01-01', 'active', ${versionNote(code)}, 'load-tariffs', now()
      WHERE NOT EXISTS (SELECT 1 FROM catalog.price_list_version WHERE id = CAST(${versionId} AS UUID))
    `);
    let prices = 0;
    for (const line of lines) {
      const hits = products.filter((row) => sameWine(row, line));
      const byLot = line.lot ? hits.filter((row) => fold(String(row.sku)) === fold(line.lot ?? '')) : [];
      const product = hits.length === 1 ? hits[0] : byLot.length === 1 ? byLot[0] : undefined;
      if (!product) {
        report.unmatched.push({ list: code, wine: line.wine, vintage: line.vintageLabel });
        continue;
      }
      prices += 1;
      statements.push(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES (
          CAST(${newId()} AS UUID), CAST(${versionId} AS UUID), CAST(${idOf(product.id)} AS UUID),
          1, CAST(${line.price} AS DECIMAL(14,6))
        )
      `);
    }
    report.loaded.push({ list: code, prices });
  }
  if (statements.length > 0) {
    await writer.withWrite(ACTOR, async (tx) => {
      for (const statement of statements) tx.write(statement);
    });
  }
  return report;
}

function sameWine(row: Record<string, unknown>, line: TariffLine): boolean {
  const name = fold(`${row.wine_name ?? ''} ${row.name ?? ''}`);
  const wanted = fold(line.wine);
  if (!name.includes(wanted) && !wanted.includes(fold(String(row.wine_name ?? '')))) return false;
  if (line.vintage == null) return true;
  const vintage = row.vintage == null || row.vintage === '' ? null : Number(row.vintage);
  return vintage === line.vintage;
}

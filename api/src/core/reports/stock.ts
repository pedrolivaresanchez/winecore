import { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import {
  addYears,
  buildReport,
  dateText,
  decimalText,
  dimension,
  emptyBucket,
  idText,
  periodCuts,
  text,
  type Bucket,
} from './metrics';
import type { GroupBy, ReportBody, ReportScope } from './types';

/**
 * Existencias del libro físico en la fecha de corte (fin de mes, fin de año o `to`).
 * El saldo es la suma de movimientos con fecha de Madrid menor o igual al corte.
 * El importe no se valora: el coste estándar no entra en esta serie.
 */
export async function stockReport(writer: Writer, scope: ReportScope): Promise<ReportBody> {
  const current = await loadStock(writer, scope, scope.from, scope.to);
  const previous = scope.compare === 'previous_year'
    ? await loadStock(writer, scope, addYears(scope.from, -1), addYears(scope.to, -1))
    : null;
  const closingKey = scope.groupBy === 'month'
    ? scope.to.slice(0, 7)
    : scope.groupBy === 'year'
      ? scope.to.slice(0, 4)
      : null;
  return buildReport('stock', scope, current, previous, closingKey);
}

async function loadStock(writer: Writer, scope: ReportScope, from: string, to: string): Promise<Map<string, Bucket>> {
  const timed = scope.groupBy === 'month' || scope.groupBy === 'year';
  const cuts = scope.groupBy === 'month' || scope.groupBy === 'year'
    ? periodCuts(from, to, scope.groupBy)
    : [{ key: 'snapshot', label: '', asOf: to }];
  const buckets = new Map<string, Bucket>();
  if (cuts.length === 0) return buckets;
  const values = cuts.map((cut) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cut.asOf)) throw new Error('Fecha de corte no válida');
    return `(DATE '${cut.asOf}')`;
  }).join(', ');
  const rows = await writer.read(`
    SELECT CAST(c.cut_date AS VARCHAR) AS cut_date,
           CAST(m.product_id AS VARCHAR) AS product_id,
           any_value(CASE WHEN p.id IS NULL THEN NULL ELSE p.sku || ' · ' || p.name END) AS product_label,
           CAST(COALESCE(p.wine_id, lot.wine_id) AS VARCHAR) AS wine_id,
           any_value(w.name) AS wine_label,
           any_value(w.category) AS category,
           CAST(m.lot_id AS VARCHAR) AS lot_id,
           any_value(lot.code) AS lot_label,
           CAST(sum(m.qty_units) AS VARCHAR) AS units,
           CAST(sum(m.volume_ml) AS VARCHAR) AS volume_ml
    FROM (VALUES ${values}) AS c(cut_date)
    JOIN inventory.stock_move m
      ON CAST(m.occurred_at AT TIME ZONE 'Europe/Madrid' AS DATE) <= c.cut_date
    JOIN core.legal_entity e ON e.id = m.owner_entity_id
    LEFT JOIN catalog.product p ON p.id = m.product_id
    LEFT JOIN inventory.lot lot ON lot.id = m.lot_id
    LEFT JOIN catalog.wine w ON w.id = COALESCE(p.wine_id, lot.wine_id)
    WHERE ((${scope.po ? 'TRUE' : 'FALSE'} = TRUE AND e.code = 'PO') OR (${scope.cvpo ? 'TRUE' : 'FALSE'} = TRUE AND e.code = 'CVPO'))
    GROUP BY c.cut_date, m.product_id, COALESCE(p.wine_id, lot.wine_id), m.lot_id
  `);
  for (const row of rows) {
    const cut = dateText(row.cut_date);
    const dim = stockDimension(scope.groupBy, {
      cut,
      productId: idText(row.product_id),
      productLabel: text(row.product_label) || null,
      wineId: idText(row.wine_id),
      wineLabel: text(row.wine_label) || null,
      category: text(row.category) || null,
      lotId: idText(row.lot_id),
      lotLabel: text(row.lot_label) || null,
    });
    const bucket = buckets.get(dim.key) ?? emptyBucket(dim.key, dim.label, timed ? cut : to);
    bucket.units = bucket.units.plus(new Decimal(decimalText(row.units)));
    bucket.volume = bucket.volume.plus(new Decimal(decimalText(row.volume_ml)));
    buckets.set(dim.key, bucket);
  }
  return buckets;
}

function stockDimension(groupBy: GroupBy, grain: {
  cut: string;
  productId: string | null;
  productLabel: string | null;
  wineId: string | null;
  wineLabel: string | null;
  category: string | null;
  lotId: string | null;
  lotLabel: string | null;
}): { key: string; label: string } {
  if (groupBy === 'customer') return { key: 'none', label: 'Sin cliente' };
  return dimension(groupBy, {
    issueDate: grain.cut,
    customerId: null,
    customerLabel: null,
    productId: grain.productId,
    productLabel: grain.productLabel,
    wineId: grain.wineId,
    wineLabel: grain.wineLabel,
    lotId: grain.lotId,
    lotLabel: grain.lotLabel,
    category: grain.category,
    categoryLabel: null,
  }, 'wine');
}

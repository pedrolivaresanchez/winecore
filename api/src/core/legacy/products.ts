import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { intOf, money2 } from './overview';
import { entityPredicate, legacyScope, likePattern, parseEntityParam } from './scope';

export interface LegacyProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  stock: string | null;
  cost: string | null;
  sale_value: string | null;
  tax_label: string | null;
  warehouse_label: string | null;
  entity_code: string;
  source: 'holded';
}

export interface LegacyProductPage {
  items: LegacyProduct[];
  next_cursor: string | null;
  total: number;
  catalog_total: number;
  entity: 'PO' | 'CVPO' | 'both';
}

export async function listLegacyProducts(writer: Writer, user: UserCtx, url: URL): Promise<LegacyProductPage> {
  const scope = legacyScope(user, parseEntityParam(url.searchParams.get('entity')));
  const limit = parseLimit(url.searchParams.get('limit'));
  const q = url.searchParams.get('q')?.trim() || null;
  if (q && q.length > 120) throw domainError('WC_VALIDATION', { q: 'La búsqueda es demasiado larga' });
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (url.searchParams.get('cursor') && !cursor) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });

  const filters = [entityPredicate(scope)];
  if (q) {
    const pattern = likePattern(q);
    filters.push(sql`(
      lower(h.name) LIKE ${pattern} ESCAPE '\\'
      OR lower(coalesce(h.sku, '')) LIKE ${pattern} ESCAPE '\\'
    )`);
  }
  const where = filters.join(' AND ');
  const listed = [...filters];
  if (cursor) {
    listed.push(sql`(
      h.name > ${cursor.name}
      OR (h.name = ${cursor.name} AND h.id > CAST(${cursor.id} AS UUID))
    )`);
  }
  const [rows, totals, catalog] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      SELECT h.id, h.name, h.sku, h.description,
             CAST(h.stock AS VARCHAR) AS stock,
             CAST(h.cost AS VARCHAR) AS cost,
             CAST(h.sale_value AS VARCHAR) AS sale_value,
             h.tax_label, h.warehouse_label, e.code AS entity_code
        FROM legacy.holded_product h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${listed.join(' AND ')}
       ORDER BY h.name, h.id
       LIMIT ${limit + 1}
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS total
        FROM legacy.holded_product h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${where}
    `),
    writer.read<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM catalog.product`),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(productOf),
    next_cursor: hasMore && last ? encodeCursor(String(last.name), String(last.id)) : null,
    total: intOf(totals[0]?.total),
    catalog_total: intOf(catalog[0]?.total),
    entity: scope.entity,
  };
}

function productOf(row: Record<string, unknown>): LegacyProduct {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    sku: text(row.sku),
    description: text(row.description),
    stock: row.stock == null || row.stock === '' ? null : trimNumber(row.stock),
    cost: row.cost == null || row.cost === '' ? null : money2(row.cost),
    sale_value: row.sale_value == null || row.sale_value === '' ? null : money2(row.sale_value),
    tax_label: text(row.tax_label),
    warehouse_label: text(row.warehouse_label),
    entity_code: String(row.entity_code ?? ''),
    source: 'holded',
  };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function trimNumber(value: unknown): string {
  const textValue = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(textValue)) return textValue;
  return textValue.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function parseLimit(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 50;
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  return Number(raw);
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(`${name}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null): { name: string; id: string } | null {
  if (!raw) return null;
  try {
    const textValue = Buffer.from(raw, 'base64url').toString('utf8');
    const split = textValue.lastIndexOf('|');
    if (split <= 0) return null;
    const name = textValue.slice(0, split);
    const id = textValue.slice(split + 1);
    if (!name || name.length > 200 || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { name, id };
  } catch {
    return null;
  }
}

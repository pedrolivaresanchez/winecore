import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { dateOf, intOf, invoiceOf, type LegacyInvoiceRow } from './overview';
import { entityPredicate, legacyScope, likePattern, parseEntityParam } from './scope';

export interface LegacyInvoicePage {
  items: LegacyInvoiceRow[];
  next_cursor: string | null;
  total: number;
  kind: 'sale' | 'purchase';
  entity: 'PO' | 'CVPO' | 'both';
}

export async function listLegacyInvoices(writer: Writer, user: UserCtx, url: URL): Promise<LegacyInvoicePage> {
  const kind = parseKind(url.searchParams.get('kind'));
  const scope = legacyScope(user, parseEntityParam(url.searchParams.get('entity')));
  const limit = parseLimit(url.searchParams.get('limit'));
  const q = url.searchParams.get('q')?.trim() || null;
  if (q && q.length > 120) throw domainError('WC_VALIDATION', { q: 'La búsqueda es demasiado larga' });
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (url.searchParams.get('cursor') && !cursor) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });

  const filters = [
    sql`h.kind = ${kind}`,
    entityPredicate(scope),
  ];
  if (q) {
    const pattern = likePattern(q);
    filters.push(sql`(
      lower(h.number) LIKE ${pattern} ESCAPE '\\'
      OR lower(h.counterparty_name) LIKE ${pattern} ESCAPE '\\'
    )`);
  }
  const where = filters.join(' AND ');
  const listed = [...filters];
  if (cursor) {
    listed.push(sql`(
      h.issue_date < CAST(${cursor.date} AS DATE)
      OR (h.issue_date = CAST(${cursor.date} AS DATE) AND h.id < CAST(${cursor.id} AS UUID))
    )`);
  }
  const [rows, totals] = await Promise.all([
    writer.read<Record<string, unknown>>(`
      SELECT h.id, h.number, CAST(h.issue_date AS VARCHAR) AS issue_date, h.counterparty_name,
             CAST(h.total AS VARCHAR) AS total, CAST(h.pending AS VARCHAR) AS pending,
             h.status_holded, h.kind, e.code AS entity_code
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${listed.join(' AND ')}
       ORDER BY h.issue_date DESC, h.id DESC
       LIMIT ${limit + 1}
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS total
        FROM legacy.holded_invoice h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${where}
    `),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(invoiceOf),
    next_cursor: hasMore && last ? encodeCursor(dateOf(last.issue_date), String(last.id)) : null,
    total: intOf(totals[0]?.total),
    kind,
    entity: scope.entity,
  };
}

function parseKind(raw: string | null): 'sale' | 'purchase' {
  if (raw == null || raw.trim() === '' || raw === 'sale' || raw === 'venta') return 'sale';
  if (raw === 'purchase' || raw === 'compra') return 'purchase';
  throw domainError('WC_VALIDATION', { kind: 'Debe ser venta o compra' });
}

function parseLimit(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 50;
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  return Number(raw);
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null): { date: string; id: string } | null {
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    const split = text.lastIndexOf('|');
    if (split <= 0) return null;
    const date = text.slice(0, split);
    const id = text.slice(split + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { date, id };
  } catch {
    return null;
  }
}

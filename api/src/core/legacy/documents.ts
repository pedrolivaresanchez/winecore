import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { dateOf, intOf, money2 } from './overview';
import { entityPredicate, legacyScope, likePattern, parseEntityParam } from './scope';

export type LegacyDocumentKind = 'delivery_note' | 'quote';

export interface LegacyDocumentRow {
  id: string;
  number: string;
  issue_date: string;
  counterparty_name: string;
  total: string;
  status_holded: string;
  kind: LegacyDocumentKind;
  entity_code: string;
}

export interface LegacyDocumentPage {
  items: LegacyDocumentRow[];
  next_cursor: string | null;
  total: number;
  kind: LegacyDocumentKind;
  entity: 'PO' | 'CVPO' | 'both';
}

export async function listLegacyDocuments(writer: Writer, user: UserCtx, url: URL): Promise<LegacyDocumentPage> {
  const kind = parseKind(url.searchParams.get('kind'));
  const scope = legacyScope(user, parseEntityParam(url.searchParams.get('entity')));
  const limit = parseLimit(url.searchParams.get('limit'));
  const q = url.searchParams.get('q')?.trim() || null;
  if (q && q.length > 120) throw domainError('WC_VALIDATION', { q: 'La búsqueda es demasiado larga' });
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (url.searchParams.get('cursor') && !cursor) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });

  const nameSql = kind === 'quote' ? 'h.counterparty_name' : "COALESCE(h.destination, h.description, '')";
  const statusSql = kind === 'quote' ? 'h.status_holded' : 'h.invoiced_status';
  const table = kind === 'quote' ? 'legacy.holded_quote' : 'legacy.holded_delivery_note';
  const filters = [entityPredicate(scope)];
  if (q) {
    const pattern = likePattern(q);
    const quoted = sql`${pattern}`;
    filters.push(`(
      lower(h.number) LIKE ${quoted} ESCAPE '\\'
      OR lower(${nameSql}) LIKE ${quoted} ESCAPE '\\'
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
      SELECT h.id, h.number, CAST(h.issue_date AS VARCHAR) AS issue_date,
             ${nameSql} AS counterparty_name,
             CAST(h.total AS VARCHAR) AS total,
             ${statusSql} AS status_holded,
             e.code AS entity_code
        FROM ${table} h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${listed.join(' AND ')}
       ORDER BY h.issue_date DESC, h.id DESC
       LIMIT ${limit + 1}
    `),
    writer.read<Record<string, unknown>>(`
      SELECT COUNT(*) AS total
        FROM ${table} h
        JOIN core.legal_entity e ON e.id = h.entity_id
       WHERE ${where}
    `),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: String(row.id),
      number: String(row.number ?? ''),
      issue_date: dateOf(row.issue_date),
      counterparty_name: String(row.counterparty_name ?? ''),
      total: money2(row.total),
      status_holded: String(row.status_holded ?? ''),
      kind,
      entity_code: String(row.entity_code ?? ''),
    })),
    next_cursor: hasMore && last ? encodeCursor(dateOf(last.issue_date), String(last.id)) : null,
    total: intOf(totals[0]?.total),
    kind,
    entity: scope.entity,
  };
}

function parseKind(raw: string | null): LegacyDocumentKind {
  if (raw === 'quote' || raw === 'presupuesto') return 'quote';
  if (raw == null || raw.trim() === '' || raw === 'delivery_note' || raw === 'albaran') return 'delivery_note';
  throw domainError('WC_VALIDATION', { kind: 'Debe ser albarán o presupuesto' });
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

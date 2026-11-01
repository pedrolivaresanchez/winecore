import { sql } from '../../db/sql';
import type { Writer } from '../../db/writer';
import { DomainError, domainError } from '../../errors';
import {
  boolOf,
  countOf,
  decodeOpCursor,
  encodeOpCursor,
  intOf,
  invalid,
  isUuid,
  oneOf,
  optionalUuid,
  parseLimit,
  slicePage,
  textOf,
  textOrNull,
  type ListBody,
} from './http';

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;

export interface LotView {
  id: string;
  producer_entity_id: string;
  code: string;
  kind: string;
  wine_id: string | null;
  wine_name: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: string;
  origin: string;
  created_by_operation_id: string | null;
  notes: string | null;
  created_at: string;
  composition: CompositionEdge[];
  ancestors: LotNode[];
  descendants: LotNode[];
  positions: LotPosition[];
}

interface CompositionEdge {
  parent_lot_id: string;
  parent_code: string;
  parent_kind: string;
  volume_ml: number;
  mass_g: number;
  operation_id: string;
}

interface LotNode {
  lot_id: string;
  code: string;
  kind: string;
  vintage: number | null;
  depth: number;
}

interface LotPosition {
  location_id: string;
  location_code: string;
  location_name: string;
  vessel_id: string | null;
  vessel_code: string | null;
  owner_entity_id: string;
  product_id: string | null;
  product_state: string;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
}

export async function getLot(writer: Writer, request: Request, code: string): Promise<LotView> {
  if (!LOT_CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const producer = producerFilter(request);
  const rows = await writer.read<Record<string, unknown>>(producer === null
    ? sql`
      SELECT
        id::VARCHAR AS id,
        producer_entity_id::VARCHAR AS producer_entity_id,
        code, kind, wine_id::VARCHAR AS wine_id, vintage,
        is_organic, status, origin,
        created_by_operation_id::VARCHAR AS created_by_operation_id,
        notes, created_at
      FROM inventory.lot
      WHERE code = ${code}
    `
    : sql`
      SELECT
        id::VARCHAR AS id,
        producer_entity_id::VARCHAR AS producer_entity_id,
        code, kind, wine_id::VARCHAR AS wine_id, vintage,
        is_organic, status, origin,
        created_by_operation_id::VARCHAR AS created_by_operation_id,
        notes, created_at
      FROM inventory.lot
      WHERE code = ${code} AND producer_entity_id = CAST(${producer} AS UUID)
    `);
  if (rows.length > 1) {
    throw new DomainError(
      'WC_VALIDATION',
      422,
      'Hay varios lotes con este código; indica producer_entity_id',
      { producer_entity_id: 'Indica el productor' },
    );
  }
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const id = textOf(row.id);
  const wineId = textOrNull(row.wine_id);
  const wineName = wineId ? await wineNameOf(writer, wineId) : null;
  const [composition, ancestors, descendants, positions] = await Promise.all([
    loadComposition(writer, id),
    loadNodes(writer, id, 'up'),
    loadNodes(writer, id, 'down'),
    loadPositions(writer, id),
  ]);
  return {
    id,
    producer_entity_id: textOf(row.producer_entity_id),
    code: textOf(row.code),
    kind: textOf(row.kind),
    wine_id: wineId,
    wine_name: wineName,
    vintage: row.vintage == null ? null : intOf(row.vintage),
    is_organic: boolOf(row.is_organic),
    status: textOf(row.status),
    origin: textOf(row.origin),
    created_by_operation_id: textOrNull(row.created_by_operation_id),
    notes: textOrNull(row.notes),
    created_at: textOf(row.created_at),
    composition,
    ancestors,
    descendants,
    positions,
  };
}

async function wineNameOf(writer: Writer, wineId: string): Promise<string | null> {
  const rows = await writer.read<{ name: string }>(sql`
    SELECT name FROM catalog.wine WHERE id = CAST(${wineId} AS UUID)
  `);
  return rows[0]?.name ?? null;
}

function producerFilter(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('producer_entity_id');
  if (raw === null || raw.trim() === '') return null;
  const id = optionalUuid(raw, 'producer_entity_id');
  if (id === null || !isUuid(id)) invalid({ producer_entity_id: 'Debe ser un UUID' });
  return id;
}

async function loadComposition(writer: Writer, lotId: string): Promise<CompositionEdge[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT
      e.parent_lot_id::VARCHAR AS parent_lot_id,
      p.code AS parent_code,
      p.kind AS parent_kind,
      e.volume_ml::VARCHAR AS volume_ml,
      e.mass_g::VARCHAR AS mass_g,
      e.operation_id::VARCHAR AS operation_id
    FROM inventory.lot_edge e
    JOIN inventory.lot p ON p.id = e.parent_lot_id
    WHERE e.child_lot_id = CAST(${lotId} AS UUID)
    ORDER BY p.code
  `);
  return rows.map((row) => ({
    parent_lot_id: textOf(row.parent_lot_id),
    parent_code: textOf(row.parent_code),
    parent_kind: textOf(row.parent_kind),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
    operation_id: textOf(row.operation_id),
  }));
}

type SqlReader = {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
};

/** Strict ancestors of a lot (parents, grandparents, …), the same walk as the lot sheet. */
export async function ancestorLotIds(reader: SqlReader, lotId: string): Promise<string[]> {
  const nodes = await loadNodes(reader, lotId, 'up');
  return nodes.map((node) => node.lot_id);
}

async function loadNodes(reader: SqlReader, lotId: string, direction: 'up' | 'down'): Promise<LotNode[]> {
  const sqlText = direction === 'up'
    ? `
      WITH RECURSIVE walk AS (
        SELECT parent_lot_id AS lot_id, 1 AS depth
        FROM inventory.lot_edge
        WHERE child_lot_id = CAST('${lotId}' AS UUID)
        UNION ALL
        SELECT e.parent_lot_id, walk.depth + 1
        FROM inventory.lot_edge e
        JOIN walk ON e.child_lot_id = walk.lot_id
        WHERE walk.depth < 32
      )
      SELECT walk.lot_id::VARCHAR AS lot_id, min(walk.depth) AS depth, p.code, p.kind, p.vintage
      FROM walk
      JOIN inventory.lot p ON p.id = walk.lot_id
      GROUP BY walk.lot_id, p.code, p.kind, p.vintage
      ORDER BY min(walk.depth), p.code
    `
    : `
      WITH RECURSIVE walk AS (
        SELECT child_lot_id AS lot_id, 1 AS depth
        FROM inventory.lot_edge
        WHERE parent_lot_id = CAST('${lotId}' AS UUID)
        UNION ALL
        SELECT e.child_lot_id, walk.depth + 1
        FROM inventory.lot_edge e
        JOIN walk ON e.parent_lot_id = walk.lot_id
        WHERE walk.depth < 32
      )
      SELECT walk.lot_id::VARCHAR AS lot_id, min(walk.depth) AS depth, p.code, p.kind, p.vintage
      FROM walk
      JOIN inventory.lot p ON p.id = walk.lot_id
      GROUP BY walk.lot_id, p.code, p.kind, p.vintage
      ORDER BY min(walk.depth), p.code
    `;
  if (!isUuid(lotId)) throw new Error('Lote no válido');
  const rows = await reader.read<Record<string, unknown>>(sqlText);
  return rows.map((row) => ({
    lot_id: textOf(row.lot_id),
    code: textOf(row.code),
    kind: textOf(row.kind),
    vintage: row.vintage == null ? null : intOf(row.vintage),
    depth: intOf(row.depth),
  }));
}

async function loadPositions(writer: Writer, lotId: string): Promise<LotPosition[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT
      m.location_id::VARCHAR AS location_id,
      loc.code AS location_code,
      loc.name AS location_name,
      m.vessel_id::VARCHAR AS vessel_id,
      v.code AS vessel_code,
      m.owner_entity_id::VARCHAR AS owner_entity_id,
      m.product_id::VARCHAR AS product_id,
      m.product_state,
      sum(m.qty_units)::VARCHAR AS qty_units,
      sum(m.volume_ml)::VARCHAR AS volume_ml,
      sum(m.mass_g)::VARCHAR AS mass_g
    FROM inventory.stock_move m
    JOIN inventory.location loc ON loc.id = m.location_id
    LEFT JOIN cellar.vessel v ON v.id = m.vessel_id
    WHERE m.lot_id = CAST(${lotId} AS UUID)
    GROUP BY m.location_id, loc.code, loc.name, m.vessel_id, v.code,
             m.owner_entity_id, m.product_id, m.product_state
    HAVING sum(m.qty_units) <> 0 OR sum(m.volume_ml) <> 0 OR sum(m.mass_g) <> 0
    ORDER BY loc.code, v.code
  `);
  return rows.map((row) => ({
    location_id: textOf(row.location_id),
    location_code: textOf(row.location_code),
    location_name: textOf(row.location_name),
    vessel_id: textOrNull(row.vessel_id),
    vessel_code: textOrNull(row.vessel_code),
    owner_entity_id: textOf(row.owner_entity_id),
    product_id: textOrNull(row.product_id),
    product_state: textOf(row.product_state),
    qty_units: intOf(row.qty_units),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
  }));
}

const LOT_KINDS = ['grape', 'must', 'wine', 'bottled'] as const;
const LOT_STATUSES = ['active', 'depleted', 'closed'] as const;

export interface LotListItem {
  id: string;
  producer_entity_id: string;
  code: string;
  kind: string;
  wine_id: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: string;
  volume_ml: number;
  qty_units: number;
  location_id: string | null;
  location_code: string | null;
  vessel_id: string | null;
  vessel_code: string | null;
}

export async function listLots(writer: Writer, request: Request): Promise<ListBody<LotListItem>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && cursor !== '' && !LOT_CODE.test(cursor)) invalid({ cursor: 'Cursor no válido' });
  const kind = optionalEnum(url.searchParams.get('kind'), 'kind', LOT_KINDS);
  const status = optionalEnum(url.searchParams.get('status'), 'status', LOT_STATUSES);
  const vintage = optionalVintage(url.searchParams.get('vintage'));
  const q = optionalQuery(url.searchParams.get('q'));
  const organic = optionalEnum(url.searchParams.get('organic'), 'organic', ['true', 'false'] as const);
  const filters = ['TRUE'];
  if (kind) filters.push(sql`l.kind = ${kind}`);
  if (status) filters.push(sql`l.status = ${status}`);
  if (vintage !== null) filters.push(sql`l.vintage = ${vintage}`);
  if (organic) filters.push(organic === 'true' ? 'l.is_organic' : 'NOT l.is_organic');
  if (q) filters.push(sql`l.code ILIKE ${`%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`} ESCAPE '\\'`);
  if (cursor) filters.push(sql`l.code > ${cursor}`);
  const totalWhere = filters.filter((part) => !part.includes('l.code >')).join(' AND ');
  const pageWhere = filters.join(' AND ');
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM inventory.lot l WHERE ${totalWhere}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT l.id::VARCHAR AS id, l.producer_entity_id::VARCHAR AS producer_entity_id, l.code, l.kind,
           l.wine_id::VARCHAR AS wine_id, l.vintage, l.is_organic, l.status,
           coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume_ml,
           coalesce(sum(m.qty_units), 0)::VARCHAR AS qty_units
    FROM inventory.lot l
    LEFT JOIN inventory.stock_move m ON m.lot_id = l.id
    WHERE ${pageWhere}
    GROUP BY l.id, l.producer_entity_id, l.code, l.kind, l.wine_id, l.vintage, l.is_organic, l.status
    ORDER BY l.code
    LIMIT ${limit + 1}
  `);
  const page = rows.length > limit ? rows.slice(0, limit) : rows;
  const places = await placesFor(writer, page.map((row) => textOf(row.id)));
  const items = page.map((row) => {
    const place = places.get(textOf(row.id));
    return {
      id: textOf(row.id),
      producer_entity_id: textOf(row.producer_entity_id),
      code: textOf(row.code),
      kind: textOf(row.kind),
      wine_id: textOrNull(row.wine_id),
      vintage: row.vintage == null ? null : intOf(row.vintage),
      is_organic: boolOf(row.is_organic),
      status: textOf(row.status),
      volume_ml: intOf(row.volume_ml),
      qty_units: intOf(row.qty_units),
      location_id: place?.location_id ?? null,
      location_code: place?.location_code ?? null,
      vessel_id: place?.vessel_id ?? null,
      vessel_code: place?.vessel_code ?? null,
    };
  });
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: rows.length > limit && last ? last.code : null,
    total,
  };
}

export interface Traceability {
  nodes: LotNode[];
  edges: { parent_lot_id: string; child_lot_id: string; operation_id: string; volume_ml: number; mass_g: number }[];
  mermaid: string;
}

export async function lotTraceability(writer: Writer, request: Request, code: string): Promise<Traceability> {
  const lot = await getLot(writer, request, code);
  const direction = traceDirection(new URL(request.url).searchParams.get('direction'));
  const self: LotNode = { lot_id: lot.id, code: lot.code, kind: lot.kind, vintage: lot.vintage, depth: 0 };
  const ancestors = direction === 'down' ? [] : lot.ancestors;
  const descendants = direction === 'up' ? [] : lot.descendants;
  const nodes = [self, ...ancestors, ...descendants];
  const ids = new Set(nodes.map((node) => node.lot_id));
  const edges = await loadEdges(writer, [...ids]);
  const visible = edges.filter((edge) => ids.has(edge.parent_lot_id) && ids.has(edge.child_lot_id));
  return { nodes, edges: visible, mermaid: toMermaid(nodes, visible) };
}

export async function lotMoves(writer: Writer, request: Request, code: string): Promise<ListBody<Record<string, unknown>>> {
  const lot = await requireLot(writer, code);
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeOpCursor(url.searchParams.get('cursor'));
  const filters = [sql`m.lot_id = CAST(${lot.id} AS UUID)`];
  const page = [...filters];
  if (cursor) {
    page.push(sql`(
      m.occurred_at < CAST(${cursor.occurredAt} AS TIMESTAMPTZ)
      OR (m.occurred_at = CAST(${cursor.occurredAt} AS TIMESTAMPTZ) AND m.id < CAST(${cursor.id} AS UUID))
    )`);
  }
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM inventory.stock_move m WHERE ${filters.join(' AND ')}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT m.id::VARCHAR AS id, m.occurred_at, m.move_type, m.location_id::VARCHAR AS location_id,
           m.vessel_id::VARCHAR AS vessel_id, m.owner_entity_id::VARCHAR AS owner_entity_id,
           m.lot_id::VARCHAR AS lot_id, m.product_id::VARCHAR AS product_id, m.product_state,
           m.qty_units, m.volume_ml::VARCHAR AS volume_ml, m.mass_g::VARCHAR AS mass_g, m.loss_kind,
           m.source_table, m.source_id::VARCHAR AS source_id
    FROM inventory.stock_move m
    WHERE ${page.join(' AND ')}
    ORDER BY m.occurred_at DESC, m.id DESC
    LIMIT ${limit + 1}
  `);
  const mapped = rows.map((row) => ({
    id: textOf(row.id),
    occurred_at: textOf(row.occurred_at),
    move_type: textOf(row.move_type),
    location_id: textOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id),
    owner_entity_id: textOf(row.owner_entity_id),
    lot_id: textOf(row.lot_id),
    product_id: textOrNull(row.product_id),
    product_state: textOf(row.product_state),
    qty_units: intOf(row.qty_units),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
    loss_kind: textOrNull(row.loss_kind),
    source_table: textOf(row.source_table),
    source_id: textOf(row.source_id),
  }));
  return slicePage(mapped, limit, total, (row) => encodeOpCursor(row.occurred_at, row.id));
}

export async function lotAdditions(writer: Writer, _request: Request, code: string): Promise<ListBody<Record<string, unknown>>> {
  const lot = await requireLot(writer, code);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, lot_id::VARCHAR AS lot_id,
           vessel_id::VARCHAR AS vessel_id, additive_product_id::VARCHAR AS additive_product_id,
           quantity::VARCHAR AS quantity, quantity_unit, dose::VARCHAR AS dose, dose_unit, purpose, created_at
    FROM cellar.addition
    WHERE lot_id = CAST(${lot.id} AS UUID)
    ORDER BY created_at
  `);
  return { items: rows, next_cursor: null, total: rows.length };
}

export async function emptyLotList(writer: Writer, _request: Request, code: string): Promise<ListBody<never>> {
  await requireLot(writer, code);
  return { items: [], next_cursor: null, total: 0 };
}

async function requireLot(writer: Writer, code: string): Promise<{ id: string }> {
  if (!LOT_CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${code}`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (rows.length > 1) {
    throw new DomainError('WC_VALIDATION', 422, 'Hay varios lotes con este código', { code: 'Indica el productor' });
  }
  return row;
}

async function placesFor(writer: Writer, lotIds: readonly string[]): Promise<Map<string, LotListItem>> {
  const map = new Map<string, LotListItem>();
  if (lotIds.length === 0) return map;
  const list = lotIds.map((id) => {
    if (!isUuid(id)) throw new Error('Lote no válido');
    return `CAST('${id}' AS UUID)`;
  }).join(', ');
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT m.lot_id::VARCHAR AS lot_id, m.location_id::VARCHAR AS location_id, loc.code AS location_code,
           m.vessel_id::VARCHAR AS vessel_id, v.code AS vessel_code, sum(m.volume_ml)::VARCHAR AS volume_ml
    FROM inventory.stock_move m
    JOIN inventory.location loc ON loc.id = m.location_id
    LEFT JOIN cellar.vessel v ON v.id = m.vessel_id
    WHERE m.lot_id IN (${list})
    GROUP BY m.lot_id, m.location_id, loc.code, m.vessel_id, v.code
    HAVING sum(m.volume_ml) <> 0 OR sum(m.qty_units) <> 0 OR sum(m.mass_g) <> 0
  `);
  for (const row of rows) {
    const lotId = textOf(row.lot_id);
    const volume = intOf(row.volume_ml);
    const current = map.get(lotId);
    if (current && Math.abs(current.volume_ml) >= Math.abs(volume)) continue;
    map.set(lotId, {
      id: lotId,
      producer_entity_id: '',
      code: '',
      kind: '',
      wine_id: null,
      vintage: null,
      is_organic: false,
      status: '',
      volume_ml: volume,
      qty_units: 0,
      location_id: textOf(row.location_id),
      location_code: textOf(row.location_code),
      vessel_id: textOrNull(row.vessel_id),
      vessel_code: textOrNull(row.vessel_code),
    });
  }
  return map;
}

async function loadEdges(writer: Writer, lotIds: readonly string[]) {
  if (lotIds.length === 0) return [];
  const list = lotIds.map((id) => `CAST('${id}' AS UUID)`).join(', ');
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT parent_lot_id::VARCHAR AS parent_lot_id, child_lot_id::VARCHAR AS child_lot_id,
           operation_id::VARCHAR AS operation_id, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g
    FROM inventory.lot_edge
    WHERE parent_lot_id IN (${list}) OR child_lot_id IN (${list})
  `);
  return rows.map((row) => ({
    parent_lot_id: textOf(row.parent_lot_id),
    child_lot_id: textOf(row.child_lot_id),
    operation_id: textOf(row.operation_id),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
  }));
}

function toMermaid(nodes: readonly LotNode[], edges: readonly { parent_lot_id: string; child_lot_id: string }[]): string {
  const byId = new Map(nodes.map((node) => [node.lot_id, node]));
  const lines = ['graph LR'];
  for (const node of nodes) lines.push(`  ${mermaidId(node.code)}["${node.code.replaceAll('"', '')}"]`);
  for (const edge of edges) {
    const parent = byId.get(edge.parent_lot_id);
    const child = byId.get(edge.child_lot_id);
    if (!parent || !child) continue;
    lines.push(`  ${mermaidId(parent.code)} --> ${mermaidId(child.code)}`);
  }
  return lines.join('\n');
}

function mermaidId(code: string): string {
  const safe = code.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `L_${safe}`;
}

function traceDirection(value: string | null): 'up' | 'down' | 'both' {
  if (value === null || value.trim() === '' || value === 'both') return 'both';
  return oneOf(value, 'direction', ['up', 'down', 'both'] as const);
}

function optionalEnum<T extends string>(value: string | null, field: string, allowed: readonly T[]): T | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, field, allowed);
}

function optionalVintage(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  if (!/^\d{4}$/.test(value)) invalid({ vintage: 'La añada debe ser un año' });
  return Number(value);
}

function optionalQuery(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 40) invalid({ q: 'La búsqueda es demasiado larga' });
  return trimmed;
}

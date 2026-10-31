import { sql } from '../../db/sql';
import type { Writer } from '../../db/writer';
import { DomainError, domainError } from '../../errors';
import { boolOf, intOf, invalid, isUuid, optionalUuid, textOf, textOrNull } from './http';

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;

export interface LotView {
  id: string;
  producer_entity_id: string;
  code: string;
  kind: string;
  wine_id: string | null;
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
    wine_id: textOrNull(row.wine_id),
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

async function loadNodes(writer: Writer, lotId: string, direction: 'up' | 'down'): Promise<LotNode[]> {
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
  const rows = await writer.read<Record<string, unknown>>(sqlText);
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

import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import type { Tx } from '../../src/core/db/writer';
import { createTestApp } from '../helpers';

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export interface Lab {
  ctx: TestApp;
  po: string;
  ownerId: string;
  wineA: string;
  wineB: string;
  parcelA: string;
  parcelB: string;
  yeastId: string;
  so2Id: string;
  vesselId: string;
}

export async function openLab(): Promise<Lab> {
  const ctx = await createTestApp();
  const entities = await ctx.writer.read<{ id: string; code: string }>(sql`
    SELECT id::VARCHAR AS id, code FROM core.legal_entity
  `);
  const users = await ctx.writer.read<{ id: string; email: string }>(sql`
    SELECT id::VARCHAR AS id, email FROM core.app_user
  `);
  const po = entities.find((row) => row.code === 'PO')?.id;
  const ownerId = users.find((row) => row.email === 'owner@winecore.test')?.id;
  if (!po || !ownerId) throw new Error('Semilla incompleta');
  const wineA = newId();
  const wineB = newId();
  const parcelA = newId();
  const parcelB = newId();
  const yeastId = newId();
  const so2Id = newId();
  const locationId = newId();
  const vesselId = newId();
  await write(ctx, (tx) => {
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color)
      VALUES
        (CAST(${wineA} AS UUID), 'REFA', 'Referencia A', 'red'),
        (CAST(${wineB} AS UUID), 'REFB', 'Referencia B', 'white')
    `);
    tx.write(sql`
      INSERT INTO catalog.product (id, sku, name, kind, unit, is_stock_tracked)
      VALUES
        (CAST(${yeastId} AS UUID), 'LEV-SINT', 'Levadura sintética', 'oenological_product', 'kg', TRUE),
        (CAST(${so2Id} AS UUID), 'SO2-SINT', 'Metabisulfito sintético', 'oenological_product', 'kg', TRUE)
    `);
    tx.write(sql`
      INSERT INTO vineyard.parcel (
        id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_polygon, sigpac_parcel,
        sigpac_enclosure, area_ha
      ) VALUES
        (CAST(${parcelA} AS UUID), 'PARC-A', 'Parcela sintética A', 'own', 52, 999, 999, 99901, 1, 2.0),
        (CAST(${parcelB} AS UUID), 'PARC-B', 'Parcela sintética B', 'own', 52, 999, 999, 99902, 1, 1.0)
    `);
    tx.write(sql`
      INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
      VALUES (CAST(${locationId} AS UUID), 'SINT-BOD', 'Bodega sintética', 'cellar', CAST(${po} AS UUID))
    `);
    tx.write(sql`
      INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id)
      VALUES (
        CAST(${vesselId} AS UUID), 'INOX-S1', 'Depósito sintético', 'tank_storage', 10000000,
        'stainless_steel', CAST(${locationId} AS UUID)
      )
    `);
  });
  return { ctx, po, ownerId, wineA, wineB, parcelA, parcelB, yeastId, so2Id, vesselId };
}

export async function write(ctx: TestApp, fn: (tx: Tx) => void | Promise<void>): Promise<void> {
  await ctx.writer.withWrite({ type: 'system', id: 'lot-design-test', requestId: newId() }, async (tx) => {
    await fn(tx);
  });
}

export function lot(
  tx: Tx,
  row: {
    id: string;
    entityId: string;
    code: string;
    kind: string;
    vintage?: number | null;
    wineId?: string | null;
    origin: string;
    createdBy?: string | null;
  },
): void {
  tx.write(sql`
    INSERT INTO inventory.lot (
      id, producer_entity_id, code, kind, wine_id, vintage, is_organic, status, origin, created_by_operation_id
    ) VALUES (
      CAST(${row.id} AS UUID),
      CAST(${row.entityId} AS UUID),
      ${row.code},
      ${row.kind},
      CAST(${row.wineId ?? null} AS UUID),
      ${row.vintage ?? null},
      TRUE,
      'active',
      ${row.origin},
      CAST(${row.createdBy ?? null} AS UUID)
    )
  `);
}

export function operation(
  tx: Tx,
  row: {
    id: string;
    entityId: string;
    ownerId: string;
    number: string;
    opType: string;
    occurredAt: string;
    details?: unknown;
  },
): void {
  tx.write(sql`
    INSERT INTO cellar.operation (
      id, legal_entity_id, number, op_type, occurred_at, status, details,
      performed_by, confirmed_by, confirmed_at, created_by
    ) VALUES (
      CAST(${row.id} AS UUID),
      CAST(${row.entityId} AS UUID),
      ${row.number},
      ${row.opType},
      CAST(${row.occurredAt} AS TIMESTAMPTZ),
      'confirmed',
      ${sql.json(row.details ?? {})},
      'Equipo sintético',
      CAST(${row.ownerId} AS UUID),
      CAST(${row.occurredAt} AS TIMESTAMPTZ),
      'lot-design-test'
    )
  `);
}

export function line(
  tx: Tx,
  row: {
    operationId: string;
    lotId: string;
    role?: string;
    vesselId?: string | null;
    state: string;
    volumeMl?: number;
    massG?: number;
  },
): void {
  tx.write(sql`
    INSERT INTO cellar.operation_line (
      id, operation_id, role, lot_id, vessel_id, product_state, volume_ml, qty_units, mass_g
    ) VALUES (
      CAST(${newId()} AS UUID),
      CAST(${row.operationId} AS UUID),
      ${row.role ?? 'output'},
      CAST(${row.lotId} AS UUID),
      CAST(${row.vesselId ?? null} AS UUID),
      ${row.state},
      ${row.volumeMl ?? 0},
      0,
      ${row.massG ?? 0}
    )
  `);
}

export function edge(
  tx: Tx,
  row: { child: string; parent: string; operationId: string; volumeMl?: number; massG?: number },
): void {
  tx.write(sql`
    INSERT INTO inventory.lot_edge (child_lot_id, parent_lot_id, operation_id, volume_ml, mass_g)
    VALUES (
      CAST(${row.child} AS UUID),
      CAST(${row.parent} AS UUID),
      CAST(${row.operationId} AS UUID),
      ${row.volumeMl ?? 0},
      ${row.massG ?? 0}
    )
  `);
}

export async function call(
  ctx: TestApp,
  method: string,
  path: string,
  body?: unknown,
  user = 'bodega@winecore.test',
): Promise<{ status: number; body: Record<string, unknown>; text: string; contentType: string | null }> {
  const headers: Record<string, string> = { 'x-dev-user': user };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed, text, contentType: response.headers.get('content-type') };
}

export async function countOps(ctx: TestApp): Promise<number> {
  const rows = await ctx.writer.read<{ n: unknown }>(sql`SELECT count(*)::VARCHAR AS n FROM cellar.operation`);
  return Number(rows[0]?.n ?? 0);
}

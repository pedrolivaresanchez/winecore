import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import type { createTestApp } from '../helpers';

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function call(
  ctx: TestApp,
  method: string,
  path: string,
  body?: unknown,
  user?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (user) headers['x-dev-user'] = user;
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

export async function entityId(ctx: TestApp, code = 'PO'): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Entidad ${code} no sembrada`);
  return id;
}

export async function seedWarehouse(ctx: TestApp, entityIdValue: string): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
      VALUES (CAST(${id} AS UUID), CAST(${entityIdValue} AS UUID), ${'ES00000000001'}, ${'V1'}, ${'Bodega sintética'}, TRUE)
    `);
  });
  return id;
}

export async function seedSeries(ctx: TestApp, entityIdValue: string, year = 2026): Promise<void> {
  const id = newId();
  const yy = String(year).slice(2);
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO core.number_series (
        id, legal_entity_id, doc_type, code, year, prefix, padding, next_value, is_default, is_active
      ) VALUES (
        CAST(${id} AS UUID), CAST(${entityIdValue} AS UUID), ${'cellar_operation'}, ${'OB'},
        ${year}, ${`OB${yy}-`}, 4, 1, TRUE, TRUE
      )
    `);
  });
}

export async function seedOperator(ctx: TestApp): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_logistics_operator, created_by)
      VALUES (
        CAST(${id} AS UUID), ${'company'}, ${'Operador logístico sintético'}, ${'B12345678'},
        ${'nif'}, TRUE, ${'cellar-test'}
      )
    `);
  });
  return id;
}

export async function seedHolding(
  ctx: TestApp,
  args: {
    entityId: string;
    warehouseId: string;
    locationId: string;
    vesselId: string;
    code: string;
    volumeMl: number;
    excise?: string;
  },
): Promise<string> {
  const lotId = newId();
  const stockId = newId();
  const fiscalId = newId();
  const excise = args.excise ?? 'GRANEL-TINTO';
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, is_organic, status, origin)
      VALUES (
        CAST(${lotId} AS UUID), CAST(${args.entityId} AS UUID), ${args.code}, ${'wine'},
        2025, TRUE, ${'active'}, ${'opening_count'}
      )
    `);
    tx.write(sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state,
        qty_units, volume_ml, mass_g, source_table, source_id, created_by
      ) VALUES (
        CAST(${stockId} AS UUID),
        CAST(${'2026-06-01T06:00:00Z'} AS TIMESTAMPTZ),
        ${'opening'},
        CAST(${args.locationId} AS UUID),
        CAST(${args.vesselId} AS UUID),
        CAST(${args.entityId} AS UUID),
        CAST(${lotId} AS UUID),
        ${'wine'},
        0,
        ${args.volumeMl},
        0,
        ${'inventory.inventory_count'},
        CAST(${stockId} AS UUID),
        ${'cellar-test'}
      )
    `);
    tx.write(sql`
      INSERT INTO inventory.fiscal_move (
        id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id,
        volume_ml, units, abv_pct, excise_product_key, justification_type, justification_ref,
        fiscal_trigger, source_table, source_id, created_by
      ) VALUES (
        CAST(${fiscalId} AS UUID),
        CAST(${args.warehouseId} AS UUID),
        CAST(${'2026-06-01'} AS DATE),
        CAST(${'2026-06-01'} AS DATE),
        ${'opening'},
        ${'bulk'},
        CAST(${lotId} AS UUID),
        ${args.volumeMl},
        0,
        CAST(${'13.50'} AS DECIMAL(5,2)),
        ${excise},
        ${'count_record'},
        ${'AFORO-SINTETICO'},
        ${'count'},
        ${'inventory.inventory_count'},
        CAST(${stockId} AS UUID),
        ${'cellar-test'}
      )
    `);
  });
  return lotId;
}

export async function counts(ctx: TestApp): Promise<{ operations: number; stock: number; fiscal: number; edges: number }> {
  const rows = await ctx.writer.read<{ operations: string; stock: string; fiscal: string; edges: string }>(`
    SELECT
      (SELECT count(*) FROM cellar.operation)::VARCHAR AS operations,
      (SELECT count(*) FROM inventory.stock_move)::VARCHAR AS stock,
      (SELECT count(*) FROM inventory.fiscal_move)::VARCHAR AS fiscal,
      (SELECT count(*) FROM inventory.lot_edge)::VARCHAR AS edges
  `);
  const row = rows[0];
  if (!row) throw new Error('Sin recuento');
  return {
    operations: Number(row.operations),
    stock: Number(row.stock),
    fiscal: Number(row.fiscal),
    edges: Number(row.edges),
  };
}

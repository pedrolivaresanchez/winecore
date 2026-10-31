import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import type { createTestApp } from '../helpers';

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export interface TastingWorld {
  entityId: string;
  ownerId: string;
  parcelId: string;
  wineA: string;
  wineB: string;
  lotA2026: string;
  lotA2024: string;
  lotB2026: string;
  lotMust: string;
  vesselA: string;
  vesselB: string;
}

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

export async function seedWorld(ctx: TestApp): Promise<TastingWorld> {
  const entityId = await scalar(ctx, sql`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = 'PO'`);
  const ownerId = await scalar(ctx, sql`SELECT id::VARCHAR AS id FROM core.app_user WHERE email = 'owner@winecore.test'`);
  const ids = {
    parcelId: newId(),
    locationId: newId(),
    wineA: newId(),
    wineB: newId(),
    lotA2026: newId(),
    lotA2024: newId(),
    lotB2026: newId(),
    lotMust: newId(),
    vesselA: newId(),
    vesselB: newId(),
    analysisOld: newId(),
    analysisNew: newId(),
    resultOld: newId(),
    resultNew: newId(),
  };
  await ctx.writer.withWrite({ type: 'system', id: 'tasting-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO vineyard.parcel (
        id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_aggregate,
        sigpac_zone, sigpac_polygon, sigpac_parcel, sigpac_enclosure, area_ha
      ) VALUES (
        CAST(${ids.parcelId} AS UUID), ${'P-SINT'}, ${'Pago sintético'}, ${'own'},
        1, 1, 0, 0, 1, 1, 1, 1.5
      )
    `);
    tx.write(sql`
      INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
      VALUES (CAST(${ids.locationId} AS UUID), ${'SINT-BOD'}, ${'Bodega sintética'}, ${'cellar'}, CAST(${entityId} AS UUID))
    `);
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color) VALUES
        (CAST(${ids.wineA} AS UUID), ${'REFA'}, ${'Referencia A'}, ${'red'}),
        (CAST(${ids.wineB} AS UUID), ${'REFB'}, ${'Referencia B'}, ${'red'})
    `);
    tx.write(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin) VALUES
        (CAST(${ids.lotA2026} AS UUID), CAST(${entityId} AS UUID), ${'REFA2026'}, ${'wine'}, CAST(${ids.wineA} AS UUID), 2026, ${'opening_count'}),
        (CAST(${ids.lotA2024} AS UUID), CAST(${entityId} AS UUID), ${'REFA2024'}, ${'wine'}, CAST(${ids.wineA} AS UUID), 2024, ${'opening_count'}),
        (CAST(${ids.lotB2026} AS UUID), CAST(${entityId} AS UUID), ${'REFB2026'}, ${'wine'}, CAST(${ids.wineB} AS UUID), 2026, ${'opening_count'}),
        (CAST(${ids.lotMust} AS UUID), CAST(${entityId} AS UUID), ${'MOSTOS1'}, ${'must'}, NULL, 2026, ${'opening_count'})
    `);
    tx.write(sql`
      INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id) VALUES
        (CAST(${ids.vesselA} AS UUID), ${'INOX-S1'}, ${'Depósito sintético 1'}, ${'tank_storage'}, 5000000, ${'stainless_steel'}, CAST(${ids.locationId} AS UUID)),
        (CAST(${ids.vesselB} AS UUID), ${'INOX-S2'}, ${'Depósito sintético 2'}, ${'tank_storage'}, 5000000, ${'stainless_steel'}, CAST(${ids.locationId} AS UUID))
    `);
    tx.write(sql`
      INSERT INTO cellar.analysis (id, lot_id, kind, sampled_at, lab, created_by) VALUES
        (CAST(${ids.analysisOld} AS UUID), CAST(${ids.lotA2024} AS UUID), ${'control'}, CAST(${'2024-10-01T09:00:00Z'} AS TIMESTAMPTZ), ${'internal'}, ${'tasting-test'}),
        (CAST(${ids.analysisNew} AS UUID), CAST(${ids.lotA2026} AS UUID), ${'control'}, CAST(${'2026-03-01T09:00:00Z'} AS TIMESTAMPTZ), ${'internal'}, ${'tasting-test'})
    `);
    tx.write(sql`
      INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value) VALUES
        (CAST(${ids.resultOld} AS UUID), CAST(${ids.analysisOld} AS UUID), ${'ph'}, 3.4),
        (CAST(${ids.resultNew} AS UUID), CAST(${ids.analysisNew} AS UUID), ${'volatile_acidity'}, 0.32)
    `);
  });
  return {
    entityId,
    ownerId,
    parcelId: ids.parcelId,
    wineA: ids.wineA,
    wineB: ids.wineB,
    lotA2026: ids.lotA2026,
    lotA2024: ids.lotA2024,
    lotB2026: ids.lotB2026,
    lotMust: ids.lotMust,
    vesselA: ids.vesselA,
    vesselB: ids.vesselB,
  };
}

async function scalar(ctx: TestApp, statement: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(statement);
  const id = rows[0]?.id;
  if (!id) throw new Error('Fila sintética no encontrada');
  return id.toLowerCase();
}

export const grapeValues = {
  seed_colour: 'brown',
  seed_crunch: 'crunchy',
  skin_astringency: 4,
  skin_colour: 'purple',
  pulp_sweetness: 3,
  pulp_acidity: 3,
  phenolic_maturity: 4,
  estimated_days_to_harvest: 10,
};

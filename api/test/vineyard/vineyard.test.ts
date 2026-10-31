import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { businessDate } from '../../src/core/time';
import { createTestApp } from '../helpers';
import { call, entityId, seedWarehouse } from '../cellar-api/fixtures';

const fiscal = businessDate(new Date());
const occurred = `${fiscal}T10:00:00Z`;
const year = Number(fiscal.slice(0, 4));

function expectOk(response: { status: number; body: Record<string, unknown> }, status: number) {
  if (response.status !== status) {
    throw new Error(`${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function world(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  const location = expectOk(await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  }), 201);
  const first = expectOk(await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-01',
    name: 'Depósito 1',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: location.id,
  }), 201);
  const second = expectOk(await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-02',
    name: 'Depósito 2',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: location.id,
  }), 201);
  await ctx.writer.withWrite({ type: 'system', id: 'vineyard-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year, status)
      VALUES (CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), ${year}, 'open')
    `);
  });
  expectOk(await call(ctx, 'POST', '/v1/grape-varieties', { code: 'BOBAL', name: 'Bobal', color: 'red' }), 201);
  expectOk(await call(ctx, 'POST', '/v1/grape-varieties', { code: 'TEMPRANILLO', name: 'Tempranillo', color: 'red' }), 201);
  expectOk(await call(ctx, 'POST', '/v1/parcels', parcel('P-07', '23:50:0:0:7:1:1', '1.0000', 'organic', 'BOBAL', '1.0000')), 201);
  expectOk(await call(ctx, 'POST', '/v1/parcels', parcel('P-08', '23:50:0:0:8:1:1', '0.5000', 'conventional', 'TEMPRANILLO', '0.5000')), 201);
  return { po, warehouse, first: String(first.id), second: String(second.id) };
}

function parcel(code: string, sigpac: string, area: string, organic: 'organic' | 'conventional', variety: string, varietyArea: string) {
  return {
    code,
    name: code === 'P-07' ? 'Pago Norte' : 'Pago Sur',
    ownership: 'own',
    sigpac,
    area_ha: area,
    organic_status: organic,
    organic_since: organic === 'organic' ? '2019-01-01' : null,
    varieties: [{ variety, area_ha: varietyArea, planting_year: 2004 }],
  };
}

function reception(cellar: { po: string; first: string; second: string }, which: 'P-07' | 'P-08') {
  const north = which === 'P-07';
  return {
    legal_entity_id: cellar.po,
    occurred_at: occurred,
    performed_by: 'Operario sintético',
    variety_code: north ? 'BOBAL' : 'TEMPRANILLO',
    gross_kg: north ? '1200' : '300',
    tare_kg: north ? '200' : '50',
    net_kg: north ? '1000' : '250',
    probable_abv: north ? '13.50' : '12.00',
    sanitary_status: 'good',
    is_organic: north,
    organic_label_checked: north,
    has_do: false,
    destination_vessel_id: north ? cellar.first : cellar.second,
    lot_code: north ? 'U26-P07' : 'U26-P08',
    vintage: year,
    parcels: [{ parcel_code: which, kg: north ? '1000' : '250' }],
  };
}

describe('viñedo y entrada de uva', () => {
  it('niega la escritura a quien no tiene vineyard.write y deja leer al asesor', async () => {
    const ctx = await createTestApp();
    try {
      const denied = await call(ctx, 'POST', '/v1/parcels', {}, 'asesor@winecore.test');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');
      const admin = await call(ctx, 'POST', '/v1/grape-varieties', { code: 'BOBAL', name: 'Bobal', color: 'red' }, 'admin@winecore.test');
      expect(admin.status).toBe(403);
      const read = await call(ctx, 'GET', '/v1/parcels', undefined, 'asesor@winecore.test');
      expect(read.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  it('valida el SIGPAC y que las variedades no superen la parcela', async () => {
    const ctx = await createTestApp();
    try {
      expectOk(await call(ctx, 'POST', '/v1/grape-varieties', { code: 'BOBAL', name: 'Bobal', color: 'red' }), 201);
      const sigpac = await call(ctx, 'POST', '/v1/parcels', parcel('P-01', '99:1:0:0:1:1:1', '1.0000', 'organic', 'BOBAL', '1.0000'));
      expect(sigpac.status).toBe(422);
      expect(sigpac.body.code).toBe('WC_VALIDATION');
      const area = await call(ctx, 'POST', '/v1/parcels', parcel('P-01', '23:50:0:0:1:1:1', '1.0000', 'organic', 'BOBAL', '1.1000'));
      expect(area.status).toBe(422);
      expect(area.body.code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });

  it('registra un día de vendimia, el stock, el asiento A02 y el cierre', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const task = expectOk(await call(ctx, 'POST', '/v1/field-tasks', {
        parcel_code: 'P-07',
        done_on: fiscal,
        kind: 'harvest',
        operator_name: 'Cuadrilla sintética',
        hours: '6.5',
      }, 'bodega@winecore.test'), 201);
      expect(task.kind).toBe('harvest');
      const check = expectOk(await call(ctx, 'POST', '/v1/maturity-checks', {
        parcel_code: 'P-07',
        checked_at: occurred,
        sugar_gl: '220.5',
        probable_abv: '13.50',
        total_acidity: '5.20',
        ph: '3.40',
        sanitary_status: 'good',
      }), 201);
      expect(check.sugar_gl).toBe('220.50');
      expect(check.ph).toBe('3.40');

      const northDraft = expectOk(await call(ctx, 'POST', '/v1/grape-receptions', reception(cellar, 'P-07')), 201);
      const preview = expectOk(await call(ctx, 'POST', `/v1/grape-receptions/${northDraft.id}/preview`), 200);
      const previewMoves = preview.stock_moves as { mass_g: number; product_state: string }[];
      expect(previewMoves[0]?.mass_g).toBe(1_000_000);
      expect(previewMoves[0]?.product_state).toBe('grape');
      const previewSilicie = preview.silicie as { entry_kind: string; mass_g: number; numero_justificante: string | null };
      expect(previewSilicie.entry_kind).toBe('A02');
      expect(previewSilicie.mass_g).toBe(1_000_000);
      expect(previewSilicie.numero_justificante).toBeNull();
      const before = await ctx.writer.read<{ total: string }>(`SELECT count(*)::VARCHAR AS total FROM inventory.stock_move`);
      expect(before[0]?.total).toBe('0');

      const north = expectOk(await call(ctx, 'POST', `/v1/grape-receptions/${northDraft.id}/confirm`), 200);
      expect(String(north.number)).toMatch(/^OB\d{2}-/);
      const northSilicie = north.silicie as { entry_kind: string; mass_g: number; referencia: string; status: string };
      expect(northSilicie.entry_kind).toBe('A02');
      expect(northSilicie.mass_g).toBe(1_000_000);
      expect(northSilicie.referencia).toBe('UVA');
      expect(northSilicie.status).toBe('pending');

      const southDraft = expectOk(await call(ctx, 'POST', '/v1/grape-receptions', reception(cellar, 'P-08')), 201);
      const south = expectOk(await call(ctx, 'POST', `/v1/grape-receptions/${southDraft.id}/confirm`), 200);
      const crowded = await call(ctx, 'POST', '/v1/grape-receptions', {
        ...reception(cellar, 'P-07'),
        lot_code: 'U26-EXTRA',
        destination_vessel_id: cellar.first,
      });
      expect(crowded.status).toBe(201);
      const blocked = await call(ctx, 'POST', `/v1/grape-receptions/${crowded.body.id}/confirm`);
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('WC026');

      const summary = expectOk(await call(ctx, 'GET', `/v1/harvests/summary?campaign=${year}`), 200);
      expect(summary.rows).toEqual([
        {
          parcel_code: 'P-07',
          grower_contact_id: null,
          variety_code: 'BOBAL',
          area_ha: '1.0000',
          net_kg: '1000.000',
          yield_kg_ha: '1000.0',
          organic_kg: '1000.000',
          conventional_kg: '0.000',
        },
        {
          parcel_code: 'P-08',
          grower_contact_id: null,
          variety_code: 'TEMPRANILLO',
          area_ha: '0.5000',
          net_kg: '250.000',
          yield_kg_ha: '500.0',
          organic_kg: '0.000',
          conventional_kg: '250.000',
        },
      ]);
      expect(summary.totals).toEqual({
        net_kg: '1250.000',
        organic_kg: '1000.000',
        conventional_kg: '250.000',
      });

      const plan = expectOk(await call(ctx, 'POST', '/v1/harvests', {
        parcel_code: 'P-07',
        vintage: year,
        harvested_on: fiscal,
        variety: 'BOBAL',
        estimated_kg: '1100.0',
        crew_size: 8,
      }), 201);
      const wrong = await call(ctx, 'POST', `/v1/harvests/${plan.id}/close`, { reception_operation_id: south.id });
      expect(wrong.status).toBe(422);
      const closed = expectOk(await call(ctx, 'POST', `/v1/harvests/${plan.id}/close`, { receptionOperationId: north.id }), 200);
      expect(closed.closed).toBe(true);
      expect(closed.reception_operation_id).toBe(north.id);

      const stock = await ctx.writer.read<{ mass: string }>(sql`
        SELECT COALESCE(sum(mass_g), 0)::VARCHAR AS mass
        FROM inventory.stock_move
        WHERE product_state = 'grape'
      `);
      expect(stock[0]?.mass).toBe('1250000');

      const viaCellar = await call(ctx, 'POST', `/v1/cellar-operations/${north.id}/rectify`, { reason: 'peso mal leído' });
      expect(viaCellar.status).toBe(422);
      const rectified = expectOk(await call(ctx, 'POST', `/v1/grape-receptions/${north.id}/rectify`, {
        reason: 'peso mal leído',
      }), 201);
      expect(rectified.status).toBe('confirmed');
      const original = expectOk(await call(ctx, 'GET', `/v1/grape-receptions/${north.id}`), 200);
      expect(original.status).toBe('rectified');
      const annulled = original.silicie as { status: string };
      expect(annulled.status).toBe('annulled');
      const after = await ctx.writer.read<{ mass: string }>(sql`
        SELECT COALESCE(sum(mass_g), 0)::VARCHAR AS mass
        FROM inventory.stock_move m
        JOIN inventory.lot l ON l.id = m.lot_id
        WHERE l.code = 'U26-P07'
      `);
      expect(after[0]?.mass).toBe('0');
      const rest = expectOk(await call(ctx, 'GET', `/v1/harvests/summary?campaign=${year}`), 200);
      expect(rest.totals).toEqual({
        net_kg: '250.000',
        organic_kg: '0.000',
        conventional_kg: '250.000',
      });
    } finally {
      await ctx.close();
    }
  });

  it('exige certificado vigente para la uva ecológica de un proveedor', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const contactId = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'vineyard-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_supplier, created_by)
          VALUES (
            CAST(${contactId} AS UUID), 'company', 'Viticultor sintetico', 'B00000000', 'nif', TRUE, 'vineyard-test'
          )
        `);
      });
      const draft = expectOk(await call(ctx, 'POST', '/v1/grape-receptions', {
        legal_entity_id: cellar.po,
        occurred_at: occurred,
        performed_by: 'Operario sintético',
        variety_code: 'BOBAL',
        gross_kg: '500',
        tare_kg: '0',
        net_kg: '500',
        probable_abv: '13.00',
        sanitary_status: 'good',
        is_organic: true,
        organic_label_checked: true,
        has_do: false,
        destination_vessel_id: cellar.second,
        lot_code: 'U26-EXT',
        vintage: year,
        grower_contact_id: contactId,
      }), 201);
      const missing = await call(ctx, 'POST', `/v1/grape-receptions/${draft.id}/confirm`);
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe('WC_ECO_CERT_MISSING');
      await ctx.writer.withWrite({ type: 'system', id: 'vineyard-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO regulatory.organic_certificate (
            id, holder_kind, contact_id, control_body_code, product_categories, valid_from, valid_to
          ) VALUES (
            CAST(${newId()} AS UUID), 'supplier', CAST(${contactId} AS UUID), 'ES-ECO-001-AN',
            ['a'], CAST(${`${year}-01-01`} AS DATE), CAST(${`${year}-12-31`} AS DATE)
          )
        `);
      });
      const confirmed = expectOk(await call(ctx, 'POST', `/v1/grape-receptions/${draft.id}/confirm`), 200);
      const silicie = confirmed.silicie as { entry_kind: string; mass_g: number };
      expect(silicie.entry_kind).toBe('A02');
      expect(silicie.mass_g).toBe(500_000);
    } finally {
      await ctx.close();
    }
  });
});

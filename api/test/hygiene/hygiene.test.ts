import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse, type TestApp } from '../cellar-api/fixtures';

const CELLAR = 'bodega@winecore.test';
const ADVISOR = 'asesor@winecore.test';

async function boot(ctx: TestApp) {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  const tank = await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-01',
    name: 'Depósito',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: String(location.body.id),
  });
  const lotId = await seedHolding(ctx, {
    entityId: po,
    warehouseId: warehouse,
    locationId: String(location.body.id),
    vesselId: String(tank.body.id),
    code: 'L25T01',
    volumeMl: 1_000_000,
  });
  return {
    po,
    locationId: String(location.body.id),
    tankId: String(tank.body.id),
    lotId,
  };
}

async function product(ctx: TestApp, sku: string, name: string, kind = 'packaging_material') {
  const created = await call(ctx, 'POST', '/v1/products', {
    sku,
    name,
    kind,
    unit: 'ud',
    is_stock_tracked: true,
    requires_lot: false,
  });
  expect(created.status).toBe(201);
  return String(created.body.id);
}

async function wineProduct(ctx: TestApp): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'hygiene-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO catalog.product (id, sku, name, kind, unit, is_stock_tracked, requires_lot)
      VALUES (CAST(${id} AS UUID), ${'B075EJEM'}, ${'Botella ejemplo 0,75'}, ${'wine'}, ${'ud'}, TRUE, TRUE)
    `);
  });
  return id;
}

async function supplier(ctx: TestApp): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'hygiene-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_supplier, created_by)
      VALUES (
        CAST(${id} AS UUID), ${'company'}, ${'Suministros Ejemplo S.L.'}, ${'B00000000'},
        ${'nif'}, TRUE, ${'hygiene-test'}
      )
    `);
  });
  return id;
}

function procedureBody(code: string, purpose: 'cleaning' | 'disinfection', name: string) {
  return {
    code,
    name,
    purpose,
    product_name: 'Ácido peracético',
    active_substance: 'ácido peracético',
    dose_min: '0.200',
    dose_max: '0.500',
    dose_unit: 'pct',
    concentration: '15 % p/p',
    contact_time_min: 15,
    rinse_required: true,
    applicable_classes: ['tank_storage', 'tank_fermenter', 'barrel'],
    effluent_destination: 'canal a pozo de biodegradación',
  };
}

function cleaningOperation(cellar: { po: string; tankId: string }, productId: string, day: string) {
  return {
    op_type: 'cleaning',
    legal_entity_id: cellar.po,
    occurred_at: `${day}T08:00:00Z`,
    fiscal_date: day,
    performed_by: 'Operario sintético',
    cleaning: {
      vessel_id: cellar.tankId,
      product_id: productId,
      active_substance: 'ácido peracético',
      quantity: '1.000',
      quantity_unit: 'l',
      efficacy_check: 'aclarado y tira de pH',
    },
  };
}

describe('higiene y APPCC', () => {
  it('valida la dosis del procedimiento y deja auditoría', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await boot(ctx);
      const cleaner = await product(ctx, 'PERACEJ', 'Ácido peracético ejemplo');
      const denied = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('PERAC-01', 'disinfection', 'Desinfección con ácido peracético'), CELLAR);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');

      const procedure = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('PERAC-01', 'disinfection', 'Desinfección con ácido peracético'));
      expect(procedure.status).toBe(201);
      expect(procedure.body.dose_min).toBe('0.200');
      expect(procedure.body.dose_max).toBe('0.500');
      expect(String(procedure.body.effluent_destination)).toBe('canal a pozo de biodegradación');
      expect(String(procedure.body.effluent_note)).toContain('PENDIENTE');

      const press = await call(ctx, 'POST', '/v1/hygiene/equipment', {
        code: 'PRENS-1',
        name: 'Prensa ejemplo',
        kind: 'press',
      }, CELLAR);
      expect(press.status).toBe(201);

      const draft = await call(ctx, 'POST', '/v1/cellar-operations', cleaningOperation(cellar, cleaner, '2026-06-15'), CELLAR);
      expect(draft.status).toBe(201);
      const log = {
        operation_id: draft.body.id,
        procedure_id: procedure.body.id,
        actual_dose_unit: 'pct',
        actual_contact_time_min: 15,
        rinsed: true,
        operator: 'Operario sintético',
        vessel_id: cellar.tankId,
      };
      const high = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', { ...log, actual_dose: '0.800' }, CELLAR);
      expect(high.status).toBe(422);
      expect(high.body.code).toBe('WC_HYGIENE_DOSE');
      const short = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', {
        ...log,
        actual_dose: '0.300',
        actual_contact_time_min: 5,
      }, CELLAR);
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('WC_HYGIENE_DOSE');
      const unrinsed = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', { ...log, actual_dose: '0.300', rinsed: false }, CELLAR);
      expect(unrinsed.status).toBe(422);
      expect(unrinsed.body.code).toBe('WC_HYGIENE_DOSE');
      const wrongUnit = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', {
        ...log,
        actual_dose: '0.300',
        actual_dose_unit: 'g/l',
      }, CELLAR);
      expect(wrongUnit.status).toBe(422);
      expect(wrongUnit.body.code).toBe('WC_HYGIENE_DOSE');
      const scope = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', {
        ...log,
        actual_dose: '0.300',
        vessel_id: null,
        equipment_id: press.body.id,
      }, CELLAR);
      expect(scope.status).toBe(422);
      expect(scope.body.code).toBe('WC_HYGIENE_SCOPE');

      const ok = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', { ...log, actual_dose: '0.300' }, CELLAR);
      expect(ok.status).toBe(201);
      expect(ok.body.actual_dose).toBe('0.300');
      expect(String(ok.body.effluent_note)).toContain('PENDIENTE');
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, CELLAR);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('confirmed');

      const audit = await ctx.writer.read<{ n: string }>(`
        SELECT count(*)::VARCHAR AS n FROM audit.audit_log
        WHERE table_name = 'hygiene.cleaning_procedure' AND action = 'INSERT'
      `);
      expect(Number(audit[0]?.n)).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('da de baja el consumible con un movimiento de stock', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await boot(ctx);
      const plates = await product(ctx, 'PLACAV13', 'Placas filtrantes V13 ejemplo');
      const other = await product(ctx, 'OTROEJ', 'Otro ejemplo', 'other');
      const rejected = await call(ctx, 'POST', '/v1/hygiene/consumables', {
        product_id: other,
        consumable_kind: 'other',
      }, CELLAR);
      expect(rejected.status).toBe(422);
      expect(rejected.body.code).toBe('WC_VALIDATION');

      const registered = await call(ctx, 'POST', '/v1/hygiene/consumables', {
        product_id: plates,
        consumable_kind: 'filter_plate',
      }, CELLAR);
      expect(registered.status).toBe(201);

      const receipt = await call(ctx, 'POST', '/v1/hygiene/consumable-receipts', {
        product_id: plates,
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        quantity: 20,
        occurred_at: '2026-06-01T08:00:00Z',
        supplier_name: 'Suministros Ejemplo S.L.',
      }, CELLAR);
      expect(receipt.status).toBe(201);
      expect(receipt.body.balance_units).toBe(20);

      const contactId = await supplier(ctx);
      const mismatch = await call(ctx, 'POST', '/v1/hygiene/filtrations', {
        occurred_at: '2026-06-10T08:00:00Z',
        plate_grade: 'V13',
        plate_format: '40x40',
        supplier_contact_id: contactId,
        plate_count: 5,
        operator: 'Operario sintético',
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        consumptions: [{ product_id: plates, quantity: 12 }],
      }, CELLAR);
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('WC_VALIDATION');

      const forbidden = await call(ctx, 'POST', '/v1/hygiene/filtrations', {
        occurred_at: '2026-06-15T08:00:00Z',
        plate_grade: 'V13',
        plate_format: '40x40',
        supplier_contact_id: contactId,
        plate_count: 12,
        operator: 'Operario sintético',
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        consumptions: [{ product_id: plates, quantity: 12 }],
      }, ADVISOR);
      expect(forbidden.status).toBe(403);

      const used = await call(ctx, 'POST', '/v1/hygiene/filtrations', {
        occurred_at: '2026-06-15T08:00:00Z',
        plate_grade: 'V13',
        plate_format: '40x40',
        supplier_contact_id: contactId,
        plate_count: 12,
        operator: 'Operario sintético',
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        consumptions: [{ product_id: plates, quantity: 12 }],
      }, CELLAR);
      expect(used.status).toBe(201);
      expect(used.body.plate_grade_label).toBe('V13 amicróbica');
      expect(used.body.balances).toEqual([{ product_id: plates, balance_units: 8 }]);

      const moves = await ctx.writer.read<{ move_type: string; qty: number }>(sql`
        SELECT move_type, qty_units AS qty
        FROM inventory.stock_move
        WHERE product_id = CAST(${plates} AS UUID) AND product_state = 'goods'
        ORDER BY occurred_at, move_type
      `);
      expect(moves.map((row) => [row.move_type, Number(row.qty)])).toEqual([
        ['purchase_in', 20],
        ['cellar_out', -12],
      ]);

      const over = await call(ctx, 'POST', '/v1/hygiene/filtrations', {
        occurred_at: '2026-06-16T08:00:00Z',
        plate_grade: 'V00',
        plate_format: '40x40',
        supplier_contact_id: contactId,
        plate_count: 10,
        operator: 'Operario sintético',
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        consumptions: [{ product_id: plates, quantity: 10 }],
      }, CELLAR);
      expect(over.status).toBe(422);
      expect(over.body.code).toBe('WC024');
      const left = await ctx.writer.read<{ qty: string }>(sql`
        SELECT COALESCE(sum(qty_units), 0)::VARCHAR AS qty
        FROM inventory.stock_move
        WHERE product_id = CAST(${plates} AS UUID) AND product_state = 'goods'
      `);
      expect(left[0]?.qty).toBe('8');

      const rest = await call(ctx, 'POST', '/v1/hygiene/filtrations', {
        occurred_at: '2026-06-17T08:00:00Z',
        plate_grade: 'V07',
        plate_format: '40x40',
        supplier_contact_id: contactId,
        plate_count: 4,
        operator: 'Operario sintético',
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        consumptions: [{ product_id: plates, quantity: 4 }],
      }, CELLAR);
      expect(rest.status).toBe(201);
      expect(rest.body.plate_grade_label).toBe('V07 intermedia');

      const soap = await product(ctx, 'LIMPEJ', 'Limpiador ejemplo');
      const registeredSoap = await call(ctx, 'POST', '/v1/hygiene/consumables', {
        product_id: soap,
        consumable_kind: 'cleaning_product',
      }, CELLAR);
      expect(registeredSoap.status).toBe(201);
      const soapIn = await call(ctx, 'POST', '/v1/hygiene/consumable-receipts', {
        product_id: soap,
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        quantity: 5,
        occurred_at: '2026-06-02T08:00:00Z',
        supplier_name: 'Suministros Ejemplo S.L.',
      }, CELLAR);
      expect(soapIn.status).toBe(201);
      const procedure = await call(ctx, 'POST', '/v1/hygiene/procedures', {
        code: 'LIMP-01',
        name: 'Limpieza de depósito',
        purpose: 'cleaning',
        product_name: 'Limpiador ejemplo',
        active_substance: 'ácido peracético',
        dose_min: '0.200',
        dose_max: '0.500',
        dose_unit: 'pct',
        concentration: '15 % p/p',
        contact_time_min: 10,
        rinse_required: true,
        applicable_classes: ['tank_storage'],
        effluent_destination: 'canal a pozo de biodegradación',
      });
      expect(procedure.status).toBe(201);
      const draft = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'cleaning',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-18T08:00:00Z',
        fiscal_date: '2026-06-18',
        performed_by: 'Operario sintético',
        cleaning: {
          vessel_id: cellar.tankId,
          product_id: soap,
          active_substance: 'ácido peracético',
          quantity: '1.000',
          quantity_unit: 'l',
          efficacy_check: 'aclarado',
        },
      }, CELLAR);
      expect(draft.status).toBe(201);
      const logged = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', {
        operation_id: draft.body.id,
        procedure_id: procedure.body.id,
        actual_dose: '0.300',
        actual_dose_unit: 'pct',
        actual_contact_time_min: 10,
        rinsed: true,
        operator: 'Operario sintético',
        vessel_id: cellar.tankId,
        consumptions: [{ product_id: soap, quantity: 2, location_id: cellar.locationId }],
      }, CELLAR);
      expect(logged.status).toBe(201);
      const before = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM inventory.stock_move
        WHERE product_id = CAST(${soap} AS UUID) AND move_type = 'cellar_out'
      `);
      expect(before[0]?.n).toBe('0');
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, CELLAR);
      expect(confirmed.status).toBe(200);
      const after = await ctx.writer.read<{ qty: string }>(sql`
        SELECT COALESCE(sum(qty_units), 0)::VARCHAR AS qty
        FROM inventory.stock_move
        WHERE product_id = CAST(${soap} AS UUID) AND product_state = 'goods'
      `);
      expect(after[0]?.qty).toBe('3');
    } finally {
      await ctx.close();
    }
  });

  it('exige el control de envasado antes de confirmar', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await boot(ctx);
      const bottled = await wineProduct(ctx);
      const procedure = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('BOT-DES', 'disinfection', 'Desinfección de botellas'));
      expect(procedure.status).toBe(201);
      const filler = await call(ctx, 'POST', '/v1/hygiene/equipment', {
        code: 'LLEN-4',
        name: 'Llenadora manual 4 picos',
        kind: 'bottler',
        capacity: '4.000',
        capacity_unit: 'ud',
        maintenance_notes: 'Revisión de picos',
      }, CELLAR);
      expect(filler.status).toBe(201);

      const draft = (code: string) => call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bottling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-20T08:00:00Z',
        fiscal_date: '2026-06-20',
        performed_by: 'Operario sintético',
        new_lot: { code },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 7_500, product_state: 'wine' },
          {
            role: 'output',
            location_id: cellar.locationId,
            product_id: bottled,
            product_state: 'packaged_unlabeled',
            qty_units: 10,
            volume_ml: 7_500,
            nominal_volume_ml: 750,
            excise_product_key: 'B075-EJEM',
            nc_code: '22042100',
          },
        ],
      }, CELLAR);

      const first = await draft('L26001');
      expect(first.status).toBe(201);
      const blocked = await call(ctx, 'POST', `/v1/cellar-operations/${first.body.id}/confirm`, undefined, CELLAR);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('WC_HYGIENE_CHECKLIST');
      const still = await call(ctx, 'GET', `/v1/cellar-operations/${first.body.id}`);
      expect(still.body.status).toBe('draft');

      const policyDenied = await call(ctx, 'PUT', '/v1/hygiene/policy', { bottling_checklist_required: false }, CELLAR);
      expect(policyDenied.status).toBe(403);

      const check = await call(ctx, 'PUT', `/v1/hygiene/bottling-checks/${first.body.id}`, {
        bottles_disinfected: true,
        disinfection_procedure_id: procedure.body.id,
        fill_rejects: 2,
        closure_rejects: 1,
        label_rejects: 0,
        equipment_id: filler.body.id,
        closure_type: 'natural_cork',
        seal_type: 'capsule',
        notes: 'Control visual de ejemplo',
        operator: 'Operario sintético',
      }, CELLAR);
      expect(check.status).toBe(200);
      expect(check.body.closure_label).toBe('corcho natural');
      expect(check.body.seal_label).toBe('cápsula');

      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${first.body.id}/confirm`, undefined, CELLAR);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('confirmed');

      const opened = await call(ctx, 'PUT', '/v1/hygiene/policy', { bottling_checklist_required: false });
      expect(opened.status).toBe(200);
      expect(opened.body.bottling_checklist_required).toBe(false);
      const second = await draft('L26002');
      expect(second.status).toBe(201);
      const without = await call(ctx, 'POST', `/v1/cellar-operations/${second.body.id}/confirm`, undefined, CELLAR);
      expect(without.status).toBe(200);
      expect(without.body.status).toBe('confirmed');
    } finally {
      await ctx.close();
    }
  });

  it('exporta el registro APPCC del periodo', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await boot(ctx);
      const cleaner = await product(ctx, 'PERAC2', 'Peracético de ejemplo');
      const cleaning = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('LIMP-06', 'cleaning', 'Limpieza de junio'));
      const disinfection = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('DES-06', 'disinfection', 'Desinfección de junio'));
      const outside = await call(ctx, 'POST', '/v1/hygiene/procedures', procedureBody('MAY-FU', 'disinfection', 'Mayo fuera'));
      expect(cleaning.status).toBe(201);
      expect(disinfection.status).toBe(201);
      expect(outside.status).toBe(201);

      async function logAndConfirm(day: string, procedureId: string) {
        const draft = await call(ctx, 'POST', '/v1/cellar-operations', cleaningOperation(cellar, cleaner, day), CELLAR);
        expect(draft.status).toBe(201);
        const logged = await call(ctx, 'POST', '/v1/hygiene/cleaning-logs', {
          operation_id: draft.body.id,
          procedure_id: procedureId,
          actual_dose: '0.300',
          actual_dose_unit: 'pct',
          actual_contact_time_min: 20,
          rinsed: true,
          operator: 'Operario sintético',
          vessel_id: cellar.tankId,
        }, CELLAR);
        expect(logged.status).toBe(201);
        const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, CELLAR);
        expect(confirmed.status).toBe(200);
      }

      await logAndConfirm('2026-06-15', String(cleaning.body.id));
      await logAndConfirm('2026-06-16', String(disinfection.body.id));
      await logAndConfirm('2026-05-02', String(outside.body.id));

      const pump = await call(ctx, 'POST', '/v1/hygiene/equipment', {
        code: 'BOMB-1',
        name: 'Bomba ejemplo',
        kind: 'pump',
      }, CELLAR);
      expect(pump.status).toBe(201);
      const kept = await call(ctx, 'POST', `/v1/hygiene/equipment/${pump.body.id}/maintenance`, {
        performed_at: '2026-06-18T09:00:00Z',
        notes: 'Cambio de juntas junio',
        operator: 'Operario sintético',
        next_due_on: '2026-12-18',
      }, CELLAR);
      expect(kept.status).toBe(201);
      const dropped = await call(ctx, 'POST', `/v1/hygiene/equipment/${pump.body.id}/maintenance`, {
        performed_at: '2026-05-04T09:00:00Z',
        notes: 'Mantenimiento mayo fuera',
        operator: 'Operario sintético',
      }, CELLAR);
      expect(dropped.status).toBe(201);

      const bottled = await wineProduct(ctx);
      const filler = await call(ctx, 'POST', '/v1/hygiene/equipment', {
        code: 'LLEN-4',
        name: 'Llenadora manual 4 picos',
        kind: 'bottler',
      }, CELLAR);
      const bottling = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bottling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-20T08:00:00Z',
        fiscal_date: '2026-06-20',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L26020' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 7_500, product_state: 'wine' },
          {
            role: 'output',
            location_id: cellar.locationId,
            product_id: bottled,
            product_state: 'packaged_unlabeled',
            qty_units: 10,
            volume_ml: 7_500,
            nominal_volume_ml: 750,
            excise_product_key: 'B075-EJEM',
            nc_code: '22042100',
          },
        ],
      }, CELLAR);
      expect(bottling.status).toBe(201);
      const linked = await call(ctx, 'POST', `/v1/hygiene/operations/${bottling.body.id}/equipment`, {
        equipment_id: filler.body.id,
        role: 'used',
      }, CELLAR);
      expect(linked.status).toBe(201);
      const check = await call(ctx, 'PUT', `/v1/hygiene/bottling-checks/${bottling.body.id}`, {
        bottles_disinfected: true,
        disinfection_procedure_id: disinfection.body.id,
        fill_rejects: 1,
        closure_rejects: 0,
        label_rejects: 3,
        equipment_id: filler.body.id,
        closure_type: 'agglomerated_cork',
        seal_type: 'wax_seal',
        operator: 'Operario sintético',
      }, CELLAR);
      expect(check.status).toBe(200);
      const bottledOk = await call(ctx, 'POST', `/v1/cellar-operations/${bottling.body.id}/confirm`, undefined, CELLAR);
      expect(bottledOk.status).toBe(200);

      const report = await call(ctx, 'GET', '/v1/hygiene/appcc?from=2026-06-01&to=2026-06-30', undefined, ADVISOR);
      expect(report.status).toBe(200);
      expect(report.body.title).toBe('Registro APPCC de bodega');
      expect(String(report.body.environmental_note)).toContain('PENDIENTE');
      const cleanings = report.body.cleanings as { procedure_name: string }[];
      const disinfections = report.body.disinfections as { procedure_name?: string; procedure_code?: string }[];
      const checks = report.body.bottling_checks as { closure_label: string; label_rejects: number }[];
      const maintenance = report.body.equipment_maintenance as { notes: string }[];
      expect(cleanings.map((row) => row.procedure_name)).toEqual(['Limpieza de junio']);
      expect(disinfections.some((row) => row.procedure_name === 'Desinfección de junio')).toBe(true);
      expect(JSON.stringify(report.body)).not.toContain('Mayo fuera');
      expect(JSON.stringify(report.body)).not.toContain('Mantenimiento mayo fuera');
      expect(checks).toEqual([expect.objectContaining({ closure_label: 'corcho aglomerado', label_rejects: 3 })]);
      expect(maintenance.map((row) => row.notes)).toEqual(['Cambio de juntas junio']);

      const response = await ctx.app.handle(new Request('http://localhost/v1/hygiene/appcc?from=2026-06-01&to=2026-06-30&format=csv', {
        headers: { 'x-dev-user': ADVISOR },
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      const csv = await response.text();
      expect(csv).toContain('limpieza');
      expect(csv).toContain('desinfeccion');
      expect(csv).toContain('envasado');
      expect(csv).toContain('mantenimiento');
      expect(csv).not.toContain('Mayo fuera');
    } finally {
      await ctx.close();
    }
  });
});

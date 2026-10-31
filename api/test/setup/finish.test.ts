import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const FIRST = `ES${'A'.repeat(11)}`;
const NEXT = `ES${'B'.repeat(11)}`;
const actor = { type: 'user' as const, id: 'setup-finish', requestId: 'setup-finish' };

type Check = {
  id: string;
  status: string;
  detail: string;
  action?: { kind: string; warehouse?: { id: string }; items?: { year: number }[] };
};

function call(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<Response> {
  const headers = new Headers();
  if (email) headers.set('x-dev-user', email);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}`);
  const id = rows[0]?.id;
  if (!id) throw new Error('sin entidad');
  return id.toLowerCase();
}

describe('cierre de la puesta en marcha', () => {
  it('cambia el CAE, abre el ejercicio y crea los mayores sin duplicar', async () => {
    const ctx = await createTestApp({ now: () => new Date('2026-10-31T10:00:00.000Z') });
    try {
      const po = await entityId(ctx, 'PO');
      const warehouseId = newId();
      const locationId = newId();
      const lotId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test, is_active)
          VALUES (CAST(${warehouseId} AS UUID), CAST(${po} AS UUID), ${FIRST}, 'V1', 'Fábrica de prueba', TRUE, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id)
          VALUES (
            CAST(${locationId} AS UUID), 'BOD-T', 'Bodega prueba', 'cellar',
            CAST(${warehouseId} AS UUID), CAST(${po} AS UUID)
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, status, origin)
          VALUES (CAST(${lotId} AS UUID), CAST(${po} AS UUID), 'LT-CAE', 'wine', 'active', 'opening_count')
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, location_id, lot_id, owner_entity_id, move_type, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), now(), CAST(${locationId} AS UUID), CAST(${lotId} AS UUID),
            CAST(${po} AS UUID), 'opening', 'wine', 1000, 'inventory.lot', CAST(${lotId} AS UUID), 'setup-finish'
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.fiscal_move (
            id, tax_warehouse_id, fiscal_date, move_type, product_class, lot_id, volume_ml,
            justification_type, justification_ref, fiscal_trigger, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${warehouseId} AS UUID), DATE '2026-10-01', 'opening', 'bulk',
            CAST(${lotId} AS UUID), 1000, 'count_record', 'AF-1', 'count', 'inventory.lot', CAST(${lotId} AS UUID), 'setup-finish'
          )
        `);
      });

      const bad = await call(ctx, 'PATCH', `/v1/tax-warehouses/${warehouseId}`, { cae: 'ES123' });
      expect(bad.status).toBe(422);
      const forbidden = await call(ctx, 'PATCH', `/v1/tax-warehouses/${warehouseId}`, { cae: NEXT, is_test: false }, 'admin@winecore.test');
      expect(forbidden.status).toBe(403);

      const saved = await call(ctx, 'PATCH', `/v1/tax-warehouses/${warehouseId}`, { cae: NEXT, is_test: false });
      expect(saved.status).toBe(200);
      const body = await saved.json() as { cae: string; cae_masked: string; is_test: boolean };
      expect(body.cae).toBe(NEXT);
      expect(body.is_test).toBe(false);
      expect(body.cae_masked).not.toBe(NEXT);

      const listed = await call(ctx, 'GET', '/v1/tax-warehouses', undefined, 'admin@winecore.test');
      expect(listed.status).toBe(200);
      const list = await listed.json() as { items: { cae: string }[] };
      expect(JSON.stringify(list)).not.toContain(NEXT);

      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'inventory.tax_warehouse'
      `);
      expect(audit.some((row) => row.action === 'UPDATE')).toBe(true);

      const opened = await call(ctx, 'POST', '/v1/silicie-exercises', { tax_warehouse_id: warehouseId, year: 2026 });
      expect(opened.status).toBe(201);
      const againYear = await call(ctx, 'POST', '/v1/silicie-exercises', { tax_warehouse_id: warehouseId, year: 2026 });
      expect(againYear.status).toBe(200);

      const created = await call(ctx, 'POST', '/v1/silicie-ledgers/opening', { tax_warehouse_id: warehouseId });
      expect(created.status).toBe(201);
      const first = await created.json() as { items: { reference: string; status: string }[] };
      expect(first.items.map((item) => item.reference)).toEqual([
        'UVA', 'GRANEL-TINTO', 'GRANEL-BLANCO', 'GRANEL-ROSADO', 'CRIANZA-TINTO', 'CRIANZA-BLANCO', 'CRIANZA-ROSADO',
      ]);
      expect(first.items.every((item) => item.status === 'created')).toBe(true);
      const repeat = await call(ctx, 'POST', '/v1/silicie-ledgers/opening', { tax_warehouse_id: warehouseId });
      expect(repeat.status).toBe(200);
      const second = await repeat.json() as { items: { status: string }[] };
      expect(second.items.every((item) => item.status === 'existing')).toBe(true);
      const forbiddenLedgers = await call(ctx, 'POST', '/v1/silicie-ledgers/opening', { tax_warehouse_id: warehouseId }, 'admin@winecore.test');
      expect(forbiddenLedgers.status).toBe(403);

      const readiness = await call(ctx, 'GET', '/v1/setup/readiness');
      const report = await readiness.json() as { modules: { id: string; checks: Check[] }[] };
      const silicie = report.modules.find((item) => item.id === 'silicie');
      const warehouse = silicie?.checks.find((item) => item.id === 'silicie.warehouse');
      const exercise = silicie?.checks.find((item) => item.id === 'silicie.exercise');
      const ledgers = silicie?.checks.find((item) => item.id === 'silicie.ledgers');
      expect(warehouse?.status).toBe('ok');
      expect(exercise?.status).toBe('warning');
      expect(exercise?.action?.kind).toBe('open_exercise');
      expect(exercise?.action?.items?.[0]?.year).toBe(2027);
      expect(ledgers?.status).toBe('warning');
      expect(JSON.stringify(report)).not.toContain(NEXT);
    } finally {
      await ctx.close();
    }
  });

  it('pide la aprobación de las reglas y no las activa', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const denied = await call(ctx, 'POST', '/v1/setup/billing-rules/request-activation', { issuing_entity_id: po }, 'admin@winecore.test');
      expect(denied.status).toBe(403);

      const requested = await call(ctx, 'POST', '/v1/setup/billing-rules/request-activation', { issuing_entity_id: po });
      expect(requested.status).toBe(200);
      const body = await requested.json() as { approval_request_id: string; status: string; already_pending: boolean };
      expect(body.status).toBe('pending');
      expect(body.already_pending).toBe(false);

      const sets = await ctx.writer.read<{ status: string }>(sql`SELECT status FROM billing.billing_rule_set`);
      expect(sets.every((row) => row.status === 'draft')).toBe(true);
      const approvals = await ctx.writer.read<{ id: string; status: string }>(sql`
        SELECT id::VARCHAR AS id, status FROM ops.approval_request WHERE kind = 'billing_rules_activation'
      `);
      expect(approvals).toHaveLength(1);
      expect(String(approvals[0]?.status)).toBe('pending');

      const second = await call(ctx, 'POST', '/v1/setup/billing-rules/request-activation', { issuing_entity_id: po });
      const again = await second.json() as { approval_request_id: string; already_pending: boolean };
      expect(again.already_pending).toBe(true);
      expect(again.approval_request_id).toBe(body.approval_request_id);
      const still = await ctx.writer.read<{ total: number }>(sql`
        SELECT count(*)::INTEGER AS total FROM ops.approval_request WHERE kind = 'billing_rules_activation'
      `);
      expect(Number(still[0]?.total)).toBe(1);

      const readiness = await call(ctx, 'GET', '/v1/setup/readiness');
      const report = await readiness.json() as { modules: { id: string; checks: Check[] }[] };
      const rules = report.modules.find((item) => item.id === 'ventas')?.checks.find((item) => item.id === 'billing.rules');
      expect(rules?.status).toBe('warning');
      expect(rules?.action?.kind).toBe('open_approvals');
      expect(rules?.detail).toContain('pendiente de aprobación');
    } finally {
      await ctx.close();
    }
  });
});

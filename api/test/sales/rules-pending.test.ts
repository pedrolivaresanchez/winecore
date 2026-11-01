import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { approveSet, buildSalesFixture, call, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;
let setId = '';

beforeAll(async () => {
  fx = await buildSalesFixture(ctx, { rules: false });
  expect((await json(ctx, 'GET', '/v1/billing-rules/state')).state).toBe('empty');
  const created = await json(ctx, 'POST', '/v1/billing-rules/sets', { notes: 'pendiente' });
  setId = String(created.id);
  await json(ctx, 'PUT', `/v1/billing-rules/sets/${setId}/rules`, {
    rules: [{ scope: 'default', issuing_entity_id: fx.cvpo }],
  });
  await json(ctx, 'POST', `/v1/billing-rules/sets/${setId}/request-activation`, {});
});

afterAll(async () => {
  await ctx.close();
});

function newOrder(body: Record<string, unknown>) {
  return call(ctx, 'POST', '/v1/sales-orders', body, { 'Idempotency-Key': `pedido-${newId()}` });
}

async function setStatuses(): Promise<string[]> {
  const sets = await json(ctx, 'GET', '/v1/billing-rules/sets');
  return (sets.items as { status: string }[]).map((item) => item.status);
}

describe('reglas pendientes de aprobación', () => {
  it('el estado es inactivo y la vista previa no anuncia entidad', async () => {
    expect((await json(ctx, 'GET', '/v1/billing-rules/state')).state).toBe('inactive');
    const preview = await call(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.other}&channel=direct`);
    expect(preview.status).toBe(200);
    expect(preview.body).toBeNull();
  });

  it('sin entidad elegida el presupuesto falla y no se abre otro conjunto', async () => {
    const refused = await call(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('WC_RULES_INACTIVE');
    expect(String(refused.body?.message)).toContain('Aprobaciones');
    expect(await setStatuses()).toEqual(['draft']);
  });

  it('con la entidad elegida el presupuesto se crea sin regla y queda auditado como elección manual', async () => {
    const created = await call(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(created.status).toBe(201);
    expect(created.body?.legal_entity_id).toBe(fx.po);
    const audit = await ctx.writer.read<{ after_data: unknown }>(sql`
      SELECT after_data FROM audit.audit_log
      WHERE table_name = 'sales.quote' AND row_id = ${String(created.body?.id)} AND action = 'INSERT'
    `);
    const raw = audit[0]?.after_data;
    const after = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    expect(after.entity_choice).toBe('manual');
    expect(after.rule_id).toBeNull();
    expect(await setStatuses()).toEqual(['draft']);

    const sent = await call(ctx, 'POST', `/v1/quotes/${String(created.body?.id)}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body?.legal_entity_id).toBe(fx.po);
  });

  it('el pedido borrador con entidad elegida se crea, pero confirmarlo exige las reglas aprobadas', async () => {
    const created = await newOrder({
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(created.status).toBe(201);
    const trace = created.body?.billing_rule_trace as { exception?: { legal_entity_id?: string; reason?: string } } | null;
    expect(trace?.exception?.legal_entity_id).toBe(fx.po);
    expect(trace?.exception?.reason).toContain('sin reglas activas');
    expect(created.body?.billing_rule_id).toBeNull();

    const orderId = String(created.body?.id);
    const refused = await call(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('WC_RULES_INACTIVE');
    expect(await setStatuses()).toEqual(['draft']);

    await approveSet(ctx, setId);
    expect((await json(ctx, 'GET', '/v1/billing-rules/state')).state).toBe('active');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.legal_entity_id).toBe(fx.po);
    expect(confirmed.billing_rule_id).toBeTruthy();
    expect(await setStatuses()).toEqual(['active']);
  });
});

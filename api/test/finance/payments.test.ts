import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { bodyOf, financeApp, insertContact, insertInvoice, insertOpenItem, insertSupplierInvoice, world } from './fixture';

async function post(ctx: Awaited<ReturnType<typeof financeApp>>, key: string, body: unknown, user?: string) {
  return ctx.app.handle(new Request('http://localhost/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(user ? { 'X-Dev-User': user } : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe('cobros e imputaciones', () => {
  it('cobra 100 de 121, deja 21 pendientes y no deja imputar de más', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Ejemplo SL', customer: true });
      const invoice = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id,
        customerId: customer,
        total: '121.00',
        dueDate: today,
      });
      const denied = await post(ctx, 'cobro-denegado-1', {}, 'bodega@winecore.test');
      expect(denied.status).toBe(403);

      const created = await post(ctx, 'cobro-parcial-01', {
        direction: 'in',
        method: 'transfer',
        amount: '100.00',
        value_date: today,
        counterparty_id: customer,
        legal_entity_id: ids.po.id,
        allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '100.00' }],
      });
      expect(created.status).toBe(201);
      const payment = await bodyOf(created);
      expect(payment.amount).toBe('100.00');
      const allocations = payment.allocations as Array<{ outstanding: string; payment_status: string }>;
      expect(allocations[0]).toMatchObject({ outstanding: '21.00', payment_status: 'partially_paid' });
      expect(payment.unallocated).toBe('0.00');

      const again = await post(ctx, 'cobro-parcial-01', {
        direction: 'in',
        method: 'transfer',
        amount: '100.00',
        value_date: today,
        counterparty_id: customer,
        legal_entity_id: ids.po.id,
        allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '100.00' }],
      });
      expect(again.status).toBe(201);
      expect((await bodyOf(again)).id).toBe(payment.id);

      const clash = await post(ctx, 'cobro-parcial-01', {
        direction: 'in', method: 'transfer', amount: '1.00', value_date: today,
        counterparty_id: customer, allocations: [],
      });
      expect(clash.status).toBe(409);
      expect((await bodyOf(clash)).code).toBe('WC_IDEMPOTENCY_MISMATCH');

      const over = await post(ctx, 'cobro-exceso-001', {
        direction: 'in', method: 'transfer', amount: '22.00', value_date: today,
        counterparty_id: customer, legal_entity_id: ids.po.id,
        allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '22.00' }],
      });
      expect(over.status).toBe(422);
      expect((await bodyOf(over)).code).toBe('WC100');

      const draft = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '10.00', dueDate: today, status: 'draft',
      });
      const notPayable = await post(ctx, 'cobro-borrador-1', {
        direction: 'in', method: 'transfer', amount: '10.00', value_date: today,
        counterparty_id: customer,
        allocations: [{ target_table: 'billing.invoice', target_id: draft.id, amount: '10.00' }],
      });
      expect(notPayable.status).toBe(422);
      expect((await bodyOf(notPayable)).code).toBe('WC101');
    } finally {
      await ctx.close();
    }
  });

  it('el pendiente es el total menos la suma de imputaciones registradas', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Suma SL', customer: true });
      const invoice = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '121.00', dueDate: today,
      });
      for (const [key, amount] of [['cobro-suma-0001', '40.00'], ['cobro-suma-0002', '40.00'], ['cobro-suma-0003', '41.00']] as const) {
        const response = await post(ctx, key, {
          direction: 'in', method: 'transfer', amount, value_date: today, counterparty_id: customer,
          allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount }],
        });
        expect(response.status).toBe(201);
      }
      const rows = await ctx.writer.read<{ total: string; amount_paid: string; payment_status: string; paid: string }>(sql`
        SELECT i.total, i.amount_paid, i.payment_status,
               (SELECT coalesce(sum(a.amount), 0) FROM finance.payment_allocation a
                 JOIN finance.payment p ON p.id = a.payment_id AND p.status = 'registered'
                WHERE a.target_table = 'billing.invoice' AND a.target_id = i.id) AS paid
        FROM billing.invoice i WHERE i.id = CAST(${invoice.id} AS UUID)
      `);
      expect(String(rows[0]?.payment_status)).toBe('paid');
      expect(Number(rows[0]?.amount_paid)).toBe(121);
      expect(Number(rows[0]?.paid)).toBe(Number(rows[0]?.total));
      const listed = await bodyOf(await ctx.app.handle(new Request(`http://localhost/v1/payments?entity=PO`)));
      expect(listed.total).toBe(3);
    } finally {
      await ctx.close();
    }
  });

  it('imputa a una partida de Holded y a una factura de proveedor, y anula el cobro', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Holded SL', customer: true });
      const supplier = await insertContact(ctx.writer, ids.ownerId, { name: 'Proveedor Ejemplo SL', supplier: true });
      const open = await insertOpenItem(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, contactId: customer, amount: '121.00', dueDate: today, number: 'H-260001',
      });
      const paid = await post(ctx, 'cobro-holded-001', {
        direction: 'in', method: 'transfer', amount: '121.00', value_date: today, counterparty_id: customer,
        allocations: [{ target_table: 'legacy.open_item', target_id: open, amount: '121.00' }],
      });
      expect(paid.status).toBe(201);
      expect((await bodyOf(paid)).allocations).toMatchObject([{ payment_status: 'paid', outstanding: '0.00' }]);
      const closed = await post(ctx, 'cobro-holded-002', {
        direction: 'in', method: 'transfer', amount: '1.00', value_date: today, counterparty_id: customer,
        allocations: [{ target_table: 'legacy.open_item', target_id: open, amount: '1.00' }],
      });
      expect((await bodyOf(closed)).code).toBe('WC101');

      const bill = await insertSupplierInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, supplierId: supplier, total: '80.50', dueDate: today, number: 'PR-1001',
      });
      const pending = await insertSupplierInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, supplierId: supplier, total: '10.00', dueDate: today, number: 'PR-1002', status: 'validated',
      });
      const notApproved = await post(ctx, 'pago-borrador-01', {
        direction: 'out', method: 'transfer', amount: '10.00', value_date: today, counterparty_id: supplier,
        allocations: [{ target_table: 'purchasing.supplier_invoice', target_id: pending, amount: '10.00' }],
      });
      expect((await bodyOf(notApproved)).code).toBe('WC101');
      const supplierPay = await post(ctx, 'pago-proveedor-1', {
        direction: 'out', method: 'transfer', amount: '80.50', value_date: today, counterparty_id: supplier,
        allocations: [{ target_table: 'purchasing.supplier_invoice', target_id: bill, amount: '80.50' }],
      });
      expect(supplierPay.status).toBe(201);

      const split = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '50.00', dueDate: today, number: 'FS26-0050',
      });
      const other = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '30.00', dueDate: today, number: 'FS26-0030',
      });
      const tooMuch = await post(ctx, 'cobro-reparto-01', {
        direction: 'in', method: 'transfer', amount: '100.00', value_date: today, counterparty_id: customer,
        allocations: [
          { target_table: 'billing.invoice', target_id: split.id, amount: '60.00' },
          { target_table: 'billing.invoice', target_id: other.id, amount: '50.00' },
        ],
      });
      expect((await bodyOf(tooMuch)).code).toBe('WC100');

      const cash = await post(ctx, 'cobro-efectivo-1', {
        direction: 'in', method: 'cash', amount: '1000.01', value_date: today, counterparty_id: customer,
        legal_entity_id: ids.po.id, allocations: [],
      });
      expect(cash.status).toBe(201);
      expect((await bodyOf(cash)).warnings).toEqual([
        'El pago en efectivo supera 1.000 € entre profesionales. Confirma el límite con el asesor.',
      ]);
      const future = await post(ctx, 'cobro-futuro-001', {
        direction: 'in', method: 'transfer', amount: '10.00', value_date: addCalendarDays(today, 1),
        counterparty_id: customer, legal_entity_id: ids.po.id, allocations: [],
      });
      expect(future.status).toBe(422);

      const partial = await post(ctx, 'cobro-anular-001', {
        direction: 'in', method: 'transfer', amount: '20.00', value_date: today, counterparty_id: customer,
        allocations: [{ target_table: 'billing.invoice', target_id: other.id, amount: '20.00' }],
      });
      const partialBody = await bodyOf(partial);
      const admin = await ctx.app.handle(new Request(`http://localhost/v1/payments/${String(partialBody.id)}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'anular-admin-01', 'X-Dev-User': 'admin@winecore.test' },
        body: JSON.stringify({ reason: 'importe equivocado' }),
      }));
      expect(admin.status).toBe(403);
      const reversed = await ctx.app.handle(new Request(`http://localhost/v1/payments/${String(partialBody.id)}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'anular-owner-01' },
        body: JSON.stringify({ reason: 'importe equivocado' }),
      }));
      expect(reversed.status).toBe(200);
      expect((await bodyOf(reversed)).status).toBe('reversed');
      const invoiceRow = await ctx.writer.read<{ amount_paid: string; payment_status: string }>(sql`
        SELECT amount_paid, payment_status FROM billing.invoice WHERE id = CAST(${other.id} AS UUID)
      `);
      expect(Number(invoiceRow[0]?.amount_paid)).toBe(0);
      expect(invoiceRow[0]?.payment_status).toBe('unpaid');
    } finally {
      await ctx.close();
    }
  });
});

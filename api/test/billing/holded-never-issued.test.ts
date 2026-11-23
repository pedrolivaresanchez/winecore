import { describe, expect, it } from 'bun:test';
import { exportIssuedBook } from '../../src/core/billing/books';
import { sql } from '../../src/core/db/sql';
import type { Writer } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { todayMadrid } from '../../src/core/finance/support';
import { bodyOf, financeApp, insertContact, insertInvoice, insertOpenItem, world } from '../finance/fixture';

type Ctx = Awaited<ReturnType<typeof financeApp>>;

/** Factura de Holded proyectada en billing.invoice con su partida pendiente, como deja 0047. */
async function holdedInvoice(writer: Writer, ownerId: string, input: { entityId: string; customerId: string; total: string; number: string; date: string }) {
  const openItem = await insertOpenItem(writer, ownerId, {
    entityId: input.entityId, contactId: input.customerId, amount: input.total, dueDate: input.date, number: input.number,
  });
  const holded = await writer.read<{ id: string }>(sql`
    SELECT CAST(holded_invoice_id AS VARCHAR) AS id FROM legacy.open_item WHERE id = CAST(${openItem} AS UUID)
  `);
  const holdedId = String(holded[0]!.id);
  const invoice = await insertInvoice(writer, ownerId, {
    entityId: input.entityId, customerId: input.customerId, total: input.total, dueDate: input.date, number: input.number,
  });
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `proj-${invoice.id}` }, async (tx) => {
    tx.write(sql`
      UPDATE billing.invoice SET origin = 'holded_import', holded_invoice_id = CAST(${holdedId} AS UUID)
      WHERE id = CAST(${invoice.id} AS UUID)
    `);
    tx.write(sql`
      INSERT INTO billing.invoice_line (id, invoice_id, line_no, description, quantity, unit_price, line_base, tax_code)
      VALUES (CAST(${newId()} AS UUID), CAST(${invoice.id} AS UUID), 1, 'Histórico Holded', 1, ${input.total}, ${input.total}, 'IVA21')
    `);
    tx.write(sql`
      INSERT INTO billing.invoice_tax (id, invoice_id, tax_code, tax, regime_key, qualification, rate, base, quota)
      VALUES (CAST(${newId()} AS UUID), CAST(${invoice.id} AS UUID), 'IVA21', '01', '01', 'S1', 0, ${input.total}, 0)
    `);
  });
  return { invoiceId: invoice.id, openItem, holdedId };
}

async function call(ctx: Ctx, path: string, body: unknown, headers: Record<string, string> = {}) {
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}

async function invoiceRow(writer: Writer, id: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT status, void_reason, CAST(amount_paid AS VARCHAR) AS amount_paid, payment_status
    FROM billing.invoice WHERE id = CAST(${id} AS UUID)
  `);
  return rows[0]!;
}

async function openItemRow(writer: Writer, id: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT status, CAST(amount_paid AS VARCHAR) AS amount_paid, notes FROM legacy.open_item WHERE id = CAST(${id} AS UUID)
  `);
  return rows[0]!;
}

async function pay(ctx: Ctx, key: string, input: { entityId: string; customerId: string; openItem: string; amount: string; date: string }) {
  return call(ctx, '/v1/payments', {
    direction: 'in', method: 'transfer', amount: input.amount, value_date: input.date,
    counterparty_id: input.customerId, legal_entity_id: input.entityId,
    allocations: [{ target_table: 'legacy.open_item', target_id: input.openItem, amount: input.amount }],
  }, { 'Idempotency-Key': key });
}

describe('facturas de Holded: nunca emitida', () => {
  it('la saca de lo emitido, cancela la deuda y deja rastro, sin outbox ni aprobación', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Wolf Prueba SL', customer: true });
      const inv = await holdedInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.cvpo.id, customerId: customer, total: '883.30', number: 'F260066', date: today,
      });
      const outboxBefore = await ctx.writer.read<{ n: number }>('SELECT count(*)::INTEGER AS n FROM ops.outbox_event');
      const approvalsBefore = await ctx.writer.read<{ n: number }>('SELECT count(*)::INTEGER AS n FROM ops.approval_request');

      const bookBefore = await exportIssuedBook(ctx.writer, { entityId: ids.cvpo.id, from: today, to: today });
      expect(bookBefore.csv).toContain('F260066');

      const denied = await call(ctx, `/v1/invoices/${inv.invoiceId}/never-issued`, { reason: 'x' }, { 'X-Dev-User': 'bodega@winecore.test' });
      expect(denied.status).toBe(403);
      const noReason = await call(ctx, `/v1/invoices/${inv.invoiceId}/never-issued`, {});
      expect(noReason.status).toBe(422);

      const res = await call(ctx, `/v1/invoices/${inv.invoiceId}/never-issued`, { reason: 'Nunca emitida: borrador en Holded' });
      expect(res.status).toBe(200);
      const body = await bodyOf(res);
      expect(body).toMatchObject({ status: 'voided', replayed: false, void_reason: 'never_issued: Nunca emitida: borrador en Holded' });

      expect(await invoiceRow(ctx.writer, inv.invoiceId)).toMatchObject({ status: 'voided', void_reason: 'never_issued: Nunca emitida: borrador en Holded' });
      expect((await openItemRow(ctx.writer, inv.openItem)).status).toBe('written_off');

      const again = await call(ctx, `/v1/invoices/${inv.invoiceId}/never-issued`, { reason: 'Nunca emitida: borrador en Holded' });
      expect(again.status).toBe(200);
      expect((await bodyOf(again)).replayed).toBe(true);

      const page = await bodyOf(await ctx.app.handle(new Request(`http://localhost/v1/receivables?entity=CVPO&contact_id=${customer}`)));
      const groups = (page.groups ?? []) as Array<{ items: Array<Record<string, unknown>> }>;
      expect(groups.flatMap((g) => g.items).some((item) => item.document_number === 'F260066')).toBe(false);

      const bookAfter = await exportIssuedBook(ctx.writer, { entityId: ids.cvpo.id, from: today, to: today });
      expect(bookAfter.csv).not.toContain('F260066');

      const outboxAfter = await ctx.writer.read<{ n: number }>('SELECT count(*)::INTEGER AS n FROM ops.outbox_event');
      const approvalsAfter = await ctx.writer.read<{ n: number }>('SELECT count(*)::INTEGER AS n FROM ops.approval_request');
      expect(Number(outboxAfter[0]!.n)).toBe(Number(outboxBefore[0]!.n));
      expect(Number(approvalsAfter[0]!.n)).toBe(Number(approvalsBefore[0]!.n));

      const audit = await ctx.writer.read<{ table_name: string; actor_id: string }>(sql`
        SELECT table_name, actor_id FROM audit.audit_log
        WHERE row_id IN (${inv.invoiceId}, ${inv.openItem}) AND action = 'UPDATE'
      `);
      expect(audit.map((row) => row.table_name).sort()).toEqual(['billing.invoice', 'legacy.open_item']);
    } finally {
      await ctx.close();
    }
  });

  it('se niega si hay cobros, registro Verifactu, albarán o no es de Holded', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Negativas SL', customer: true });

      const paid = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '100.00', number: 'H-PAGADA', date: today });
      expect((await pay(ctx, 'neg-cobro-01', { entityId: ids.cvpo.id, customerId: customer, openItem: paid.openItem, amount: '10.00', date: today })).status).toBe(201);
      expect((await call(ctx, `/v1/invoices/${paid.invoiceId}/never-issued`, { reason: 'Nunca emitida' })).status).toBe(409);

      const withNote = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '50.00', number: 'H-ALBARAN', date: today });
      await ctx.writer.withWrite({ type: 'user', id: ids.ownerId, requestId: 'line-dn' }, async (tx) => {
        tx.write(sql`UPDATE billing.invoice_line SET delivery_note_line_id = CAST(${newId()} AS UUID) WHERE invoice_id = CAST(${withNote.invoiceId} AS UUID)`);
      });
      expect((await call(ctx, `/v1/invoices/${withNote.invoiceId}/never-issued`, { reason: 'Nunca emitida' })).status).toBe(422);

      const withRecord = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '40.00', number: 'H-VERIFACTU', date: today });
      await ctx.writer.withWrite({ type: 'user', id: ids.ownerId, requestId: 'vf' }, async (tx) => {
        tx.write(sql`UPDATE billing.invoice SET verifactu_record_id = CAST(${newId()} AS UUID) WHERE id = CAST(${withRecord.invoiceId} AS UUID)`);
      });
      expect((await call(ctx, `/v1/invoices/${withRecord.invoiceId}/never-issued`, { reason: 'Nunca emitida' })).status).toBe(422);
      expect((await openItemRow(ctx.writer, withRecord.openItem)).status).toBe('open');

      const native = await insertInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '20.00', dueDate: today });
      expect((await call(ctx, `/v1/invoices/${native.id}/never-issued`, { reason: 'Nunca emitida' })).status).toBe(422);

      for (const id of [paid.invoiceId, withNote.invoiceId, withRecord.invoiceId, native.id]) {
        expect((await invoiceRow(ctx.writer, id)).status).toBe('issued');
      }
    } finally {
      await ctx.close();
    }
  });
});

describe('facturas de Holded: cobro de la partida', () => {
  it('el cobro de la partida marca la factura cobrada, sin doble imputación, y la anulación lo deshace', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Growzz Prueba SL', customer: true });
      const inv = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '5004.56', number: 'F260108', date: today });

      const part = await pay(ctx, 'growzz-parcial', { entityId: ids.cvpo.id, customerId: customer, openItem: inv.openItem, amount: '1000.00', date: today });
      expect(part.status).toBe(201);
      expect(await invoiceRow(ctx.writer, inv.invoiceId)).toMatchObject({ amount_paid: '1000.00', payment_status: 'partially_paid' });

      const rest = await pay(ctx, 'growzz-resto', { entityId: ids.cvpo.id, customerId: customer, openItem: inv.openItem, amount: '4004.56', date: today });
      expect(rest.status).toBe(201);
      expect(await invoiceRow(ctx.writer, inv.invoiceId)).toMatchObject({ amount_paid: '5004.56', payment_status: 'paid' });
      expect(await openItemRow(ctx.writer, inv.openItem)).toMatchObject({ status: 'paid', amount_paid: '5004.56' });

      const allocs = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n FROM finance.payment_allocation WHERE target_id = CAST(${inv.invoiceId} AS UUID)
      `);
      expect(Number(allocs[0]!.n)).toBe(0);

      const restId = String((await bodyOf(rest)).id);
      const reversed = await call(ctx, `/v1/payments/${restId}/reverse`, { reason: 'importe equivocado' }, { 'Idempotency-Key': 'growzz-anula' });
      expect(reversed.status).toBe(200);
      expect(await invoiceRow(ctx.writer, inv.invoiceId)).toMatchObject({ amount_paid: '1000.00', payment_status: 'partially_paid' });
    } finally {
      await ctx.close();
    }
  });

  it('la puesta al día refleja cobros anteriores, con prueba en seco e idempotente', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cobro Antiguo SL', customer: true });
      const inv = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '300.00', number: 'H-ANTIGUO', date: today });
      const untouched = await holdedInvoice(ctx.writer, ids.ownerId, { entityId: ids.cvpo.id, customerId: customer, total: '70.00', number: 'H-SINCOBRO', date: today });
      expect((await pay(ctx, 'antiguo-01', { entityId: ids.cvpo.id, customerId: customer, openItem: inv.openItem, amount: '300.00', date: today })).status).toBe(201);
      // Simula el estado previo al arreglo: la factura se quedó sin cobrar.
      await ctx.writer.withWrite({ type: 'user', id: ids.ownerId, requestId: 'reset' }, async (tx) => {
        tx.write(sql`UPDATE billing.invoice SET amount_paid = 0, payment_status = 'unpaid' WHERE id = CAST(${inv.invoiceId} AS UUID)`);
      });

      expect((await call(ctx, '/v1/invoices/holded/sync-paid', { dry_run: false }, { 'X-Dev-User': 'bodega@winecore.test' })).status).toBe(403);
      const dry = await bodyOf(await call(ctx, '/v1/invoices/holded/sync-paid', {}));
      expect(dry.dry_run).toBe(true);
      expect(dry.changes).toEqual([expect.objectContaining({
        invoice_id: inv.invoiceId, number: 'H-ANTIGUO',
        before: { amount_paid: '0.00', payment_status: 'unpaid' }, after: { amount_paid: '300.00', payment_status: 'paid' },
      })]);
      expect((await invoiceRow(ctx.writer, inv.invoiceId)).payment_status).toBe('unpaid');

      const applied = await bodyOf(await call(ctx, '/v1/invoices/holded/sync-paid', { dry_run: false }));
      expect((applied.changes as unknown[]).length).toBe(1);
      expect(await invoiceRow(ctx.writer, inv.invoiceId)).toMatchObject({ amount_paid: '300.00', payment_status: 'paid' });
      expect(await invoiceRow(ctx.writer, untouched.invoiceId)).toMatchObject({ amount_paid: '0.00', payment_status: 'unpaid' });

      const second = await bodyOf(await call(ctx, '/v1/invoices/holded/sync-paid', { dry_run: false }));
      expect(second.changes).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

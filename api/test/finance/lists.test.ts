import { describe, expect, it } from 'bun:test';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { bodyOf, financeApp, insertContact, insertInvoice, insertSupplierInvoice, world } from './fixture';
import { n43AccountHeader, n43Movement } from './files';
import { spanishIban } from './iban';

describe('listados de cobros', () => {
  it('lista remesas y extractos, filtra pagos a proveedores y muestra el nombre', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Lista SL', customer: true });
      const supplierIban = spanishIban('0099', '0001', '0000000092');
      const supplier = await insertContact(ctx.writer, ids.ownerId, {
        name: 'Proveedor Lista SL', supplier: true, iban: supplierIban,
      });
      const invoice = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '50.00', dueDate: today, number: 'FS-LISTA-1',
      });
      const bill = await insertSupplierInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, supplierId: supplier, total: '18.00', dueDate: today, number: 'PR-LISTA-1',
      });

      const receivable = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/receivables?entity=PO')));
      const receivableDocs = (receivable.groups as { items: { document_number: string }[] }[])
        .flatMap((group) => group.items.map((item) => item.document_number));
      expect(receivableDocs).toContain('FS-LISTA-1');
      expect(receivableDocs).not.toContain('PR-LISTA-1');

      const payable = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/receivables?entity=PO&direction=payable')));
      const payableGroups = payable.groups as { customer_name: string; items: { document_number: string; target_table: string }[] }[];
      expect(payableGroups).toHaveLength(1);
      expect(payableGroups[0]?.customer_name).toBe('Proveedor Lista SL');
      expect(payableGroups[0]?.items[0]).toMatchObject({
        document_number: 'PR-LISTA-1',
        target_table: 'purchasing.supplier_invoice',
      });
      const bad = await ctx.app.handle(new Request('http://localhost/v1/receivables?direction=sideways'));
      expect(bad.status).toBe(422);

      const iban = spanishIban('0099', '0001', '0000000091');
      const account = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'cuenta-lista-0001' },
        body: JSON.stringify({ legal_entity_id: ids.po.id, bank_name: 'Banco Ejemplo', iban, bic: 'TESTESMMXXX' }),
      })));
      const created = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'remesa-lista-0001' },
        body: JSON.stringify({
          legal_entity_id: ids.po.id,
          kind: 'credit_transfer',
          bank_account_id: account.id,
          execution_date: addCalendarDays(today, 2),
          items: [{ target_table: 'purchasing.supplier_invoice', target_id: bill }],
        }),
      })));
      const listed = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances?entity=PO')));
      const remittance = (listed.items as { id: string; status: string; total: string; entity_code: string }[])
        .find((item) => item.id === created.id);
      expect(remittance).toMatchObject({ status: 'draft', total: '18.00', entity_code: 'PO' });

      const secondBill = await insertSupplierInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, supplierId: supplier, total: '7.00', dueDate: today, number: 'PR-LISTA-2',
      });
      const second = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'remesa-lista-0002' },
        body: JSON.stringify({
          legal_entity_id: ids.po.id,
          kind: 'credit_transfer',
          bank_account_id: account.id,
          execution_date: addCalendarDays(today, 3),
          items: [{ target_table: 'purchasing.supplier_invoice', target_id: secondBill }],
        }),
      })));
      const first = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances?entity=PO&limit=1')));
      expect(first).toMatchObject({ total: 2, next_cursor: '1' });
      const rest = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances?entity=PO&limit=1&cursor=1')));
      expect(rest).toMatchObject({ total: 2, next_cursor: null });
      const walked = [...(first.items as { id: string }[]), ...(rest.items as { id: string }[])].map((item) => item.id).sort();
      expect(walked).toEqual([String(created.id), String(second.id)].sort());
      const debits = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances?entity=PO&kind=direct_debit')));
      expect(debits).toMatchObject({ items: [], total: 0 });
      const transfers = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/remittances?entity=PO&kind=credit_transfer')));
      expect(transfers.total).toBe(2);
      for (const query of ['kind=sideways', 'cursor=-1', 'cursor=abc']) {
        const rejected = await ctx.app.handle(new Request(`http://localhost/v1/remittances?${query}`));
        expect(rejected.status).toBe(422);
      }
      const detail = await bodyOf(await ctx.app.handle(new Request(`http://localhost/v1/remittances/${String(created.id)}`)));
      expect((detail.items as { document_number: string; counterparty_name: string }[])[0]).toMatchObject({
        document_number: 'PR-LISTA-1',
        counterparty_name: 'Proveedor Lista SL',
      });

      const paid = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'cobro-lista-0001' },
        body: JSON.stringify({
          direction: 'in',
          method: 'transfer',
          amount: '50.00',
          value_date: today,
          counterparty_id: customer,
          legal_entity_id: ids.po.id,
          allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '50.00' }],
        }),
      })));
      expect(paid.counterparty_name).toBe('Cliente Lista SL');
      expect((paid.allocations as { document_number: string }[])[0]?.document_number).toBe('FS-LISTA-1');
      const payments = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/payments?entity=PO')));
      const payment = (payments.items as { id: string; counterparty_name: string; allocations: { document_number: string }[] }[])
        .find((item) => item.id === paid.id);
      expect(payment?.counterparty_name).toBe('Cliente Lista SL');
      expect(payment?.allocations[0]?.document_number).toBe('FS-LISTA-1');

      const header = n43AccountHeader('0000000091', today, today);
      const movement = n43Movement({ bookingDate: today, amount: '3.00', document: 'SIN-REF', concept: 'Comision' });
      const uploaded = await ctx.app.handle(new Request('http://localhost/v1/bank-statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'extracto-lista-01' },
        body: JSON.stringify({
          bank_account_id: account.id,
          format: 'n43',
          filename: 'lista.n43',
          content: [header, movement].join('\n'),
        }),
      }));
      expect(uploaded.status).toBe(201);
      const imports = await bodyOf(await ctx.app.handle(new Request('http://localhost/v1/bank-statements?entity=PO')));
      const imported = (imports.items as { matched: number; suggested: number; ignored: number; lines_count: number; entity_code: string }[])[0];
      expect(imported).toMatchObject({ entity_code: 'PO', lines_count: 1, matched: 0, ignored: 0 });
      expect(imported?.suggested).toBeGreaterThanOrEqual(0);
    } finally {
      await ctx.close();
    }
  });
});

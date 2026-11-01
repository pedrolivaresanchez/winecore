import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import type { Tx } from '../../src/core/db/writer';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { newId } from '../../src/core/ids';
import { bodyOf, financeApp, insertInvoice, world } from './fixture';

type Item = {
  target_id: string;
  entity_code: string;
  document_number: string;
  counterparty_name: string | null;
  contact_match: string | null;
  outstanding: string;
  aging: string;
  is_overdue: boolean;
  source_label: string | null;
};
type Group = { key: string; contact_id: string | null; customer_name: string; amounts: Record<string, string>; items: Item[] };
type Summary = {
  pending_total: string;
  overdue_total: string;
  due_next_30: string;
  collected_this_month: string;
  by_entity: Array<{ entity_code: string; pending: string; overdue: string }>;
};
type Page = { groups: Group[]; totals: Record<string, string>; summary: Summary };

describe('pendiente de cobro con nombre de cliente y resumen', () => {
  it('enlaza Holded por contacto, NIF o nombre, corta por antigüedad y resume lo pendiente y lo cobrado', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const lince = newId();
      const garza = newId();
      const nueva = newId();
      const antigua = newId();
      const open: Record<string, string> = {};
      await ctx.writer.withWrite({ type: 'user', id: ids.ownerId, requestId: `cobros-${newId()}` }, async (tx) => {
        contact(tx, lince, 'Viñedos Lince SL', 'B12000063', null);
        contact(tx, garza, 'Comercial Garza SL', 'B12000071', null);
        contact(tx, nueva, 'Cooperativa Nueva SL', 'B12000089', null);
        contact(tx, antigua, 'Cooperativa Antigua SL', 'B12000097', nueva);
        contact(tx, newId(), 'Repetida SL', 'B12000105', null);
        contact(tx, newId(), 'Repetida SL', 'B12000113', null);
        const batch = newId();
        tx.write(sql`
          INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
          VALUES (CAST(${batch} AS UUID), 'holded', CAST(${ids.po.id} AS UUID), 'open_items', 'sintetico.xlsx', ${'cd'.repeat(32)}, 'load', 'test')
        `);
        open.lince = openItem(tx, batch, { entity: ids.po.id, number: 'HP-01', name: 'Lince Holded', due: addCalendarDays(today, -45), amount: '100.00', tax: 'ES B12000063' });
        open.garza = openItem(tx, batch, { entity: ids.po.id, number: 'HP-02', name: 'comercial  GARZA sl', due: addCalendarDays(today, 10), amount: '50.00', paid: '20.00' });
        open.repetida = openItem(tx, batch, { entity: ids.cvpo.id, number: 'HP-03', name: 'Repetida SL', due: addCalendarDays(today, -100), amount: '40.00' });
        open.suelto = openItem(tx, batch, { entity: ids.cvpo.id, number: 'HP-04', name: 'Cliente Suelto', due: addCalendarDays(today, 40), amount: '25.00' });
        open.fusion = openItem(tx, batch, { entity: ids.po.id, number: 'HP-05', name: 'Antigua en Holded', due: addCalendarDays(today, -5), amount: '10.00', contact: antigua });
        openItem(tx, batch, { entity: ids.po.id, number: 'HC-01', name: 'Proveedor Holded', due: addCalendarDays(today, -1), amount: '70.00', payable: true });

        const lastMonth = `${addCalendarDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`;
        payment(tx, { entity: ids.cvpo.id, direction: 'in', amount: '5.00', date: today, status: 'registered' });
        payment(tx, { entity: ids.po.id, direction: 'in', amount: '99.00', date: today, status: 'reversed', contact: lince });
        payment(tx, { entity: ids.po.id, direction: 'in', amount: '33.00', date: lastMonth, status: 'registered', contact: lince });
        payment(tx, { entity: ids.po.id, direction: 'out', amount: '44.00', date: today, status: 'registered' });
      });
      const native = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: lince, total: '60.00', dueDate: addCalendarDays(today, 30), number: 'FS-LINCE',
      });

      const page = await receivables(ctx.app, '');
      expect(page.groups.map((group) => [group.customer_name, group.contact_id, group.key])).toEqual([
        ['Cliente Suelto', null, 'name:CLIENTE SUELTO'],
        ['Comercial Garza SL', garza, garza],
        ['Cooperativa Nueva SL', nueva, nueva],
        ['Repetida SL', null, 'name:REPETIDA SL'],
        ['Viñedos Lince SL', lince, lince],
      ]);
      const linceGroup = page.groups.find((group) => group.contact_id === lince);
      expect(linceGroup?.amounts).toMatchObject({ '0-30': '60.00', '31-60': '100.00', total: '160.00', overdue: '100.00' });
      expect(linceGroup?.items.map((item) => [item.document_number, item.counterparty_name, item.contact_match, item.entity_code])).toEqual([
        ['HP-01', 'Lince Holded', 'tax_id', 'PO'],
        [native.number, 'Viñedos Lince SL', 'contact', 'PO'],
      ]);
      const garzaItem = page.groups.find((group) => group.contact_id === garza)?.items[0];
      expect(garzaItem).toMatchObject({ contact_match: 'name', counterparty_name: 'comercial  GARZA sl', outstanding: '30.00', is_overdue: false });
      expect(page.groups.find((group) => group.contact_id === nueva)?.items[0]).toMatchObject({ target_id: open.fusion, contact_match: 'contact' });
      expect(page.groups.find((group) => group.key === 'name:REPETIDA SL')?.items[0]).toMatchObject({
        contact_match: null, entity_code: 'CVPO', aging: '>90', source_label: 'Holded',
      });
      expect(page.totals).toMatchObject({ '0-30': '125.00', '31-60': '100.00', '61-90': '0.00', '>90': '40.00', total: '265.00', overdue: '150.00' });
      expect(page.summary).toEqual({
        pending_total: '265.00',
        overdue_total: '150.00',
        due_next_30: '90.00',
        collected_this_month: '5.00',
        by_entity: [
          { entity_code: 'CVPO', pending: '65.00', overdue: '40.00' },
          { entity_code: 'PO', pending: '200.00', overdue: '110.00' },
        ],
      });

      const bucket = await receivables(ctx.app, 'aging=31-60');
      expect(bucket.groups.map((group) => group.items.map((item) => item.document_number))).toEqual([['HP-01']]);
      expect(bucket.summary.pending_total).toBe('265.00');

      const po = await receivables(ctx.app, 'entity=PO');
      expect(po.summary).toMatchObject({
        pending_total: '200.00', overdue_total: '110.00', due_next_30: '90.00', collected_this_month: '0.00',
        by_entity: [{ entity_code: 'PO', pending: '200.00', overdue: '110.00' }],
      });

      const byContact = await receivables(ctx.app, `contact_id=${lince}`);
      expect(byContact.groups.map((group) => group.items.length)).toEqual([2]);
      expect(byContact.summary).toMatchObject({ pending_total: '160.00', overdue_total: '100.00', due_next_30: '60.00', collected_this_month: '0.00' });

      const payable = await receivables(ctx.app, 'direction=payable');
      expect(payable.groups.map((group) => [group.customer_name, group.key, group.amounts.total])).toEqual([
        ['Proveedor Holded', 'name:PROVEEDOR HOLDED', '70.00'],
      ]);
      expect(payable.summary).toMatchObject({ pending_total: '70.00', overdue_total: '70.00', collected_this_month: '44.00' });

      const paid = await ctx.app.handle(new Request('http://localhost/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'cobro-holded-nif-01' },
        body: JSON.stringify({
          direction: 'in',
          method: 'transfer',
          amount: '15.00',
          value_date: today,
          counterparty_id: lince,
          allocations: [{ target_table: 'legacy.open_item', target_id: open.lince, amount: '15.00' }],
        }),
      }));
      expect(paid.status).toBe(201);
      const after = await receivables(ctx.app, '');
      expect(after.groups.find((group) => group.contact_id === lince)?.items[0]).toMatchObject({ target_id: open.lince, outstanding: '85.00' });
      expect(after.summary).toMatchObject({ pending_total: '250.00', collected_this_month: '20.00' });
      expect((await receivables(ctx.app, `entity=PO&contact_id=${lince}`)).summary.collected_this_month).toBe('15.00');
    } finally {
      await ctx.close();
    }
  });
});

async function receivables(app: { handle: (request: Request) => Promise<Response> }, query: string): Promise<Page> {
  const response = await app.handle(new Request(`http://localhost/v1/receivables?${query}`));
  expect(response.status).toBe(200);
  return (await bodyOf(response)) as unknown as Page;
}

function contact(tx: Tx, id: string, name: string, tax: string, mergedInto: string | null) {
  tx.write(sql`
    INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, merged_into_id, created_by)
    VALUES (CAST(${id} AS UUID), 'company', ${name}, ${tax}, 'nif', 'ES', 'ES', TRUE, CAST(${mergedInto} AS UUID), 'test')
  `);
}

function openItem(tx: Tx, batch: string, input: {
  entity: string;
  number: string;
  name: string;
  due: string;
  amount: string;
  paid?: string;
  tax?: string;
  contact?: string;
  payable?: boolean;
}): string {
  const holded = newId();
  const id = newId();
  const kind = input.payable ? 'purchase' : 'sale';
  const issue = addCalendarDays(input.due, -30);
  tx.write(sql`
    INSERT INTO legacy.holded_invoice (
      id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name, counterparty_contact_id,
      subtotal, total, status_holded, raw
    ) VALUES (
      CAST(${holded} AS UUID), CAST(${batch} AS UUID), CAST(${input.entity} AS UUID), ${kind}, ${input.number},
      CAST(${issue} AS DATE), CAST(${input.due} AS DATE), ${input.name}, CAST(${input.contact ?? null} AS UUID),
      ${input.amount}, ${input.amount}, 'Pendiente', ${sql.json({})}
    )
  `);
  if (input.tax) {
    tx.write(sql`
      INSERT INTO legacy.holded_invoice_line (
        id, batch_id, entity_id, kind, document_number, document_date, line_seq, counterparty_name, counterparty_tax_id, raw
      ) VALUES (
        CAST(${newId()} AS UUID), CAST(${batch} AS UUID), CAST(${input.entity} AS UUID), ${kind}, ${input.number},
        CAST(${issue} AS DATE), 1, ${input.name}, ${input.tax}, ${sql.json({})}
      )
    `);
  }
  tx.write(sql`
    INSERT INTO legacy.open_item (
      id, entity_id, direction, holded_invoice_id, counterparty_contact_id, document_number, document_date,
      due_date, amount, amount_paid, status
    ) VALUES (
      CAST(${id} AS UUID), CAST(${input.entity} AS UUID), ${input.payable ? 'payable' : 'receivable'}, CAST(${holded} AS UUID),
      CAST(${input.contact ?? null} AS UUID), ${input.number}, CAST(${issue} AS DATE), CAST(${input.due} AS DATE),
      ${input.amount}, ${input.paid ?? '0.00'}, ${input.paid ? 'partially_paid' : 'open'}
    )
  `);
  return id;
}

function payment(tx: Tx, input: { entity: string; direction: 'in' | 'out'; amount: string; date: string; status: 'registered' | 'reversed'; contact?: string }) {
  tx.write(sql`
    INSERT INTO finance.payment (
      id, legal_entity_id, direction, method, amount, value_date, counterparty_id, source, status, reversal_reason, created_by
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${input.entity} AS UUID), ${input.direction}, 'transfer', ${input.amount},
      CAST(${input.date} AS DATE), CAST(${input.contact ?? null} AS UUID), 'manual', ${input.status},
      ${input.status === 'reversed' ? 'Prueba' : null}, 'test'
    )
  `);
}
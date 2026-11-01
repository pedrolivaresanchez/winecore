import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const NOW = new Date('2026-10-31T10:00:00Z');
const HASH = 'ef'.repeat(32);
const ctx = await createTestApp({ now: () => NOW });

const ids = {
  contact: newId(),
  other: newId(),
  batch: newId(),
  quoteBatch: newId(),
  series: newId(),
  holdedPaid: newId(),
  holdedByName: newId(),
  holdedVoid: newId(),
  holdedLastYear: newId(),
  holdedOther: newId(),
  holdedReissued: newId(),
  holdedOpen: newId(),
  openByName: newId(),
  openOther: newId(),
  openPending: newId(),
  invoice: newId(),
  draft: newId(),
  paymentInvoice: newId(),
  paymentOpenItem: newId(),
  paymentReversed: newId(),
  quote: newId(),
  holdedQuote: newId(),
  scopedUser: newId(),
  scopedRole: newId(),
  namesake: newId(),
};

async function summary(id: string, user?: string) {
  return ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/summary`, {
    headers: user ? { 'X-Dev-User': user } : {},
  }));
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('resumen de contacto', () => {
  beforeAll(async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!po || !cvpo) throw new Error('Falta la semilla');

    await ctx.writer.withWrite({ type: 'system', id: 'summary-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, created_by
        ) VALUES
          (CAST(${ids.contact} AS UUID), 'company', 'Bodega Sintética Norte S.L.', 'B12000014', 'nif', 'ES', 'ES', TRUE, 'test'),
          (CAST(${ids.other} AS UUID), 'company', 'Cliente Ajeno', 'B12000022', 'nif', 'ES', 'ES', TRUE, 'test')
      `);
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${ids.batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices', 'sintetico.xlsx', ${HASH}, 'load', 'test')
      `);
      const holded = (
        id: string,
        number: string,
        date: string,
        due: string | null,
        name: string,
        contactId: string | null,
        total: string,
        pending: string,
        status: string,
      ) => {
        tx.write(sql`
          INSERT INTO legacy.holded_invoice (
            id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name, counterparty_contact_id,
            subtotal, total, pending, status_holded, raw
          ) VALUES (
            CAST(${id} AS UUID), CAST(${ids.batch} AS UUID), CAST(${po} AS UUID), 'sale', ${number},
            CAST(${date} AS DATE), CAST(${due} AS DATE), ${name}, CAST(${contactId} AS UUID),
            CAST(${total} AS DECIMAL(14,2)), CAST(${total} AS DECIMAL(14,2)), CAST(${pending} AS DECIMAL(14,2)), ${status}, ${sql.json({})}
          )
        `);
      };
      const name = 'Bodega Sintética Norte S.L.';
      holded(ids.holdedPaid, 'H-1', '2026-02-10', null, name, ids.contact, '100.00', '0', 'Pagado');
      holded(ids.holdedByName, 'H-2', '2026-09-05', '2026-10-05', '  bodega  sintética\u00a0norte s.l. ', null, '50.00', '50.00', 'Vencido');
      holded(ids.holdedVoid, 'H-3', '2026-03-01', null, name, ids.contact, '999.00', '0', 'Anulado');
      holded(ids.holdedLastYear, 'H-4', '2025-10-15', null, name, ids.contact, '80.00', '0', 'Pagado');
      holded(ids.holdedOther, 'H-5', '2026-04-01', '2026-05-01', name, ids.other, '70.00', '70.00', 'Pendiente');
      holded(ids.holdedReissued, 'PF26-1', '2026-06-15', null, name, ids.contact, '121.00', '121.00', 'Pendiente');
      holded(ids.holdedOpen, 'H-7', '2026-10-20', '2026-11-20', name, ids.contact, '40.00', '40.00', 'Pendiente');
      tx.write(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, counterparty_contact_id, document_number, document_date, due_date,
          amount, amount_paid, status
        ) VALUES
          (CAST(${ids.openByName} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.holdedByName} AS UUID), NULL,
           'H-2', CAST('2026-09-05' AS DATE), CAST('2026-10-05' AS DATE), 50.00, 20.00, 'partially_paid'),
          (CAST(${ids.openOther} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.holdedOther} AS UUID), CAST(${ids.other} AS UUID),
           'H-5', CAST('2026-04-01' AS DATE), CAST('2026-05-01' AS DATE), 70.00, 0, 'open'),
          (CAST(${ids.openPending} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.holdedOpen} AS UUID), CAST(${ids.contact} AS UUID),
           'H-7', CAST('2026-10-20' AS DATE), CAST('2026-11-20' AS DATE), 40.00, 0, 'open')
      `);
      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix)
        VALUES (CAST(${ids.series} AS UUID), CAST(${po} AS UUID), 'invoice', 'PF', 2026, 'PF26-')
      `);
      tx.write(sql`
        INSERT INTO billing.invoice (
          id, legal_entity_id, series_id, number, status, payment_status, invoice_type, issue_date, customer_id,
          customer_snapshot, subtotal, tax_total, surcharge_total, withholding_total, total, amount_paid,
          issued_at, created_by
        ) VALUES (
          CAST(${ids.invoice} AS UUID), CAST(${po} AS UUID), CAST(${ids.series} AS UUID), 'PF26-1', 'issued', 'partially_paid', 'F1',
          CAST('2026-06-15' AS DATE), CAST(${ids.contact} AS UUID), ${sql.json({ legal_name: name })},
          100.00, 21.00, 0, 0, 121.00, 21.00, TIMESTAMPTZ '2026-06-15 10:00:00+00', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO billing.invoice (
          id, legal_entity_id, series_id, status, invoice_type, customer_id, customer_snapshot,
          subtotal, tax_total, surcharge_total, withholding_total, total, created_by
        ) VALUES (
          CAST(${ids.draft} AS UUID), CAST(${po} AS UUID), CAST(${ids.series} AS UUID), 'draft', 'F1',
          CAST(${ids.contact} AS UUID), ${sql.json({ legal_name: name })}, 10.00, 2.10, 0, 0, 12.10, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO billing.invoice_due (invoice_id, seq, due_date, amount)
        VALUES (CAST(${ids.invoice} AS UUID), 1, CAST('2026-07-15' AS DATE), 121.00)
      `);
      tx.write(sql`
        INSERT INTO finance.payment (
          id, legal_entity_id, direction, method, amount, value_date, source, status, reversal_reason, created_by
        ) VALUES
          (CAST(${ids.paymentInvoice} AS UUID), CAST(${po} AS UUID), 'in', 'transfer', 21.00, CAST('2026-07-20' AS DATE), 'manual', 'registered', NULL, 'test'),
          (CAST(${ids.paymentOpenItem} AS UUID), CAST(${po} AS UUID), 'in', 'transfer', 20.00, CAST('2026-10-01' AS DATE), 'manual', 'registered', NULL, 'test'),
          (CAST(${ids.paymentReversed} AS UUID), CAST(${po} AS UUID), 'in', 'transfer', 5.00, CAST('2026-10-02' AS DATE), 'manual', 'reversed', 'Duplicado', 'test')
      `);
      tx.write(sql`
        INSERT INTO finance.payment_allocation (id, payment_id, target_table, target_id, amount, allocated_by)
        VALUES
          (CAST(${newId()} AS UUID), CAST(${ids.paymentInvoice} AS UUID), 'billing.invoice', CAST(${ids.invoice} AS UUID), 21.00, 'test'),
          (CAST(${newId()} AS UUID), CAST(${ids.paymentOpenItem} AS UUID), 'legacy.open_item', CAST(${ids.openByName} AS UUID), 20.00, 'test'),
          (CAST(${newId()} AS UUID), CAST(${ids.paymentReversed} AS UUID), 'billing.invoice', CAST(${ids.invoice} AS UUID), 5.00, 'test')
      `);
      tx.write(sql`
        INSERT INTO sales.quote (id, legal_entity_id, number, status, customer_id, channel, issue_date, total, created_by)
        VALUES (
          CAST(${ids.quote} AS UUID), CAST(${po} AS UUID), 'PR26-1', 'sent', CAST(${ids.contact} AS UUID), 'direct',
          CAST('2026-10-20' AS DATE), 60.00, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${ids.quoteBatch} AS UUID), 'holded', CAST(${po} AS UUID), 'quotes', 'presupuestos.xlsx', ${'ab'.repeat(32)}, 'load', 'test')
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_quote (id, batch_id, entity_id, number, issue_date, counterparty_name, total, status_holded, raw)
        VALUES (
          CAST(${ids.holdedQuote} AS UUID), CAST(${ids.quoteBatch} AS UUID), CAST(${po} AS UUID), 'P-77',
          CAST('2026-01-10' AS DATE), ${name}, 30.00, 'Aceptado', ${sql.json({})}
        )
      `);
      tx.write(sql`
        INSERT INTO core.app_user (id, email, display_name, locale, status)
        VALUES (CAST(${ids.scopedUser} AS UUID), 'solo.cvpo@winecore.test', 'Solo CVPO', 'es-ES', 'active')
      `);
      tx.write(sql`
        INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id)
        VALUES (CAST(${ids.scopedRole} AS UUID), CAST(${ids.scopedUser} AS UUID), 'admin', CAST(${cvpo} AS UUID))
      `);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('suma la facturación de WineCore y Holded sin anuladas ni reemitidas', async () => {
    const response = await summary(ids.contact);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.contact_id).toBe(ids.contact);
    expect(body.as_of).toBe('2026-10-31');
    expect(body.year).toBe(2026);
    const invoices = body.invoices as Record<string, unknown>;
    expect(invoices.kpis).toEqual({
      invoiced_ytd: '311.00',
      invoiced_prior_ytd: '80.00',
      invoiced_last_year: '80.00',
      invoiced_total: '391.00',
      invoice_count: 5,
      average_ticket: '78.20',
      first_invoice_date: '2025-10-15',
      last_invoice_date: '2026-10-20',
    });
    const months = invoices.months as { month: string; total: string }[];
    expect(months).toHaveLength(12);
    expect(months[0]?.month).toBe('2025-11');
    expect(months[11]?.month).toBe('2026-10');
    expect(Object.fromEntries(months.filter((row) => row.total !== '0.00').map((row) => [row.month, row.total]))).toEqual({
      '2026-02': '100.00',
      '2026-06': '121.00',
      '2026-09': '50.00',
      '2026-10': '40.00',
    });

    const items = invoices.items as Record<string, unknown>[];
    expect(invoices.total_count).toBe(7);
    expect(items.map((row) => row.number)).toEqual([null, 'H-7', 'H-2', 'PF26-1', 'H-3', 'H-1', 'H-4']);
    const byNumber = new Map(items.map((row) => [row.number, row]));
    expect(byNumber.get('PF26-1')).toMatchObject({ source: 'winecore', id: ids.invoice, state: 'overdue', pending: '100.00', due_date: '2026-07-15' });
    expect(byNumber.get('H-2')).toMatchObject({ source: 'holded', state: 'overdue', pending: '30.00', linked_by: 'name' });
    expect(byNumber.get('H-3')).toMatchObject({ state: 'voided', pending: '0.00' });
    expect(byNumber.get('H-1')).toMatchObject({ state: 'paid', linked_by: 'contact' });
    expect(byNumber.get('H-7')).toMatchObject({ state: 'pending', pending: '40.00' });
    expect(byNumber.get(null)).toMatchObject({ source: 'winecore', state: 'draft' });
    expect(byNumber.has('H-5')).toBe(false);
  });

  it('lista el pendiente de cobro y los cobros del cliente', async () => {
    const body = await json(await summary(ids.contact));
    const receivables = body.receivables as Record<string, unknown>;
    expect(receivables).toMatchObject({ total: '170.00', overdue: '130.00', count: 3 });
    const items = receivables.items as Record<string, unknown>[];
    expect(items.map((row) => row.number)).toEqual(['PF26-1', 'H-2', 'H-7']);
    expect(items[0]).toMatchObject({ source: 'winecore', invoice_id: ids.invoice, outstanding: '100.00', is_overdue: true, days_overdue: 108 });
    expect(items[1]).toMatchObject({ source: 'holded', invoice_id: ids.holdedByName, outstanding: '30.00', linked_by: 'name' });
    expect(items[2]).toMatchObject({ is_overdue: false, days_overdue: 0 });

    const payments = body.payments as Record<string, unknown>;
    expect(payments).toMatchObject({ total: '221.00', count: 4 });
    const paid = payments.items as Record<string, unknown>[];
    expect(paid.map((row) => [row.source, row.amount, row.documents])).toEqual([
      ['winecore', '20.00', ['H-2']],
      ['winecore', '21.00', ['PF26-1']],
      ['holded', '100.00', ['H-1']],
      ['holded', '80.00', ['H-4']],
    ]);

    const sales = body.sales as Record<string, unknown[]>;
    expect((sales.quotes as Record<string, unknown>[]).map((row) => [row.source, row.number, row.total])).toEqual([
      ['winecore', 'PR26-1', '60.00'],
      ['holded', 'P-77', '30.00'],
    ]);
    expect(sales.orders).toEqual([]);
    expect(sales.delivery_notes).toEqual([]);
  });

  it('respeta permisos y sociedades', async () => {
    const denied = await summary(ids.contact, 'bodega@winecore.test');
    expect(denied.status).toBe(403);
    expect((await summary(newId())).status).toBe(404);
    expect((await summary('no-es-un-id')).status).toBe(404);

    const advisor = await json(await summary(ids.contact, 'asesor@winecore.test'));
    expect((advisor.invoices as Record<string, unknown>).total_count).toBe(7);

    const scoped = await json(await summary(ids.contact, 'solo.cvpo@winecore.test'));
    expect((scoped.invoices as Record<string, unknown>).total_count).toBe(0);
    expect((scoped.receivables as Record<string, unknown>).count).toBe(0);
    expect((scoped.payments as Record<string, unknown>).count).toBe(0);
    expect((scoped.sales as Record<string, unknown[]>).quotes).toEqual([]);
  });

  it('no casa por nombre si otro contacto se llama igual', async () => {
    await ctx.writer.withWrite({ type: 'system', id: 'summary-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, created_by
        ) VALUES (
          CAST(${ids.namesake} AS UUID), 'company', 'Bodega  Sintética Norte S.L.', 'B12000030', 'nif', 'ES', 'ES', TRUE, 'test'
        )
      `);
    });

    const body = await json(await summary(ids.contact));
    const invoices = body.invoices as Record<string, unknown>;
    expect((invoices.items as Record<string, unknown>[]).map((row) => row.number)).toEqual([null, 'H-7', 'PF26-1', 'H-3', 'H-1', 'H-4']);
    expect((body.receivables as Record<string, unknown>).count).toBe(2);
    expect(((body.sales as Record<string, unknown[]>).quotes as Record<string, unknown>[]).map((row) => row.number)).toEqual(['PR26-1']);

    const namesake = await json(await summary(ids.namesake));
    expect((namesake.invoices as Record<string, unknown>).total_count).toBe(0);
    expect((namesake.receivables as Record<string, unknown>).count).toBe(0);
  });
});

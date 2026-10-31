import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const NOW = new Date('2026-10-31T10:00:00Z');
const HASH = 'cd'.repeat(32);
const ctx = await createTestApp({ now: () => NOW });

const ids = {
  batch: newId(),
  norte: newId(),
  poOnly: newId(),
  cvpoOnly: newId(),
  archived: newId(),
  saleJan: newId(),
  saleMar: newId(),
  saleVoid: newId(),
  saleCvpo: newId(),
  saleLast: newId(),
  purchase: newId(),
  openPo: newId(),
  openCvpo: newId(),
  payable: newId(),
  product: newId(),
};

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('histórico Holded', () => {
  afterAll(async () => {
    await ctx.close();
  });

  it('agrega ventas, cobros, contactos y el filtro de sociedad', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!po || !cvpo) throw new Error('Falta la semilla');

    await ctx.writer.withWrite({ type: 'system', id: 'legacy-test', requestId: newId() }, async (tx) => {
      const contact = (id: string, name: string, tax: string, archived = false) => {
        tx.write(sql`
          INSERT INTO party.contact (
            id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code,
            is_customer, created_by, archived_at
          ) VALUES (
            CAST(${id} AS UUID), 'company', ${name}, ${tax}, 'nif', 'ES', 'ES',
            TRUE, 'test', ${archived ? new Date('2026-01-01T00:00:00Z') : null}
          )
        `);
      };
      contact(ids.norte, 'Cliente Norte', 'B12000014');
      contact(ids.poOnly, 'Cliente Solo PO', 'B12000022');
      contact(ids.cvpoOnly, 'Cliente Solo CVPO', 'B12000030');
      contact(ids.archived, 'Contacto Archivado', 'B12000048', true);
      tx.write(sql`
        INSERT INTO party.contact_entity_terms (contact_id, legal_entity_id) VALUES
          (CAST(${ids.poOnly} AS UUID), CAST(${po} AS UUID)),
          (CAST(${ids.cvpoOnly} AS UUID), CAST(${cvpo} AS UUID))
      `);
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (
          CAST(${ids.batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices', 'sintetico.xlsx', ${HASH}, 'load', 'test'
        )
      `);
      const invoice = (
        id: string,
        entity: string,
        kind: string,
        number: string,
        date: string,
        name: string,
        total: number,
        pending: number,
        status: string,
      ) => {
        tx.write(sql`
          INSERT INTO legacy.holded_invoice (
            id, batch_id, entity_id, kind, number, issue_date, counterparty_name,
            subtotal, total, pending, status_holded, raw
          ) VALUES (
            CAST(${id} AS UUID), CAST(${ids.batch} AS UUID), CAST(${entity} AS UUID), ${kind}, ${number},
            CAST(${date} AS DATE), ${name}, ${total}, ${total}, ${pending}, ${status}, ${sql.json({})}
          )
        `);
      };
      invoice(ids.saleJan, po, 'sale', 'H-100', '2026-01-15', 'Cliente Norte', 100, 0, 'Pagado');
      invoice(ids.saleMar, po, 'sale', 'H-140', '2026-03-02', 'Cliente Norte', 40, 40, 'Pendiente');
      invoice(ids.saleVoid, po, 'sale', 'H-110', '2026-03-20', 'Cliente Norte', 10, 0, 'Anulado');
      invoice(ids.saleCvpo, cvpo, 'sale', 'H-170', '2026-04-01', 'Cliente Solo CVPO', 70, 50, 'Pendiente');
      invoice(ids.saleLast, po, 'sale', 'H-025', '2025-11-01', 'Cliente Norte', 25, 0, 'Pagado');
      invoice(ids.purchase, po, 'purchase', 'C-015', '2026-02-01', 'Proveedor Ejemplo', 15, 15, 'Pendiente');
      tx.write(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, document_number, document_date, due_date, amount, amount_paid, status
        ) VALUES
          (CAST(${ids.openPo} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.saleMar} AS UUID),
           'H-140', CAST('2026-03-02' AS DATE), CAST('2026-04-02' AS DATE), 40.00, 0, 'open'),
          (CAST(${ids.openCvpo} AS UUID), CAST(${cvpo} AS UUID), 'receivable', CAST(${ids.saleCvpo} AS UUID),
           'H-170', CAST('2026-04-01' AS DATE), CAST('2026-05-01' AS DATE), 70.00, 20.00, 'partially_paid'),
          (CAST(${ids.payable} AS UUID), CAST(${po} AS UUID), 'payable', CAST(${ids.purchase} AS UUID),
           'C-015', CAST('2026-02-01' AS DATE), CAST('2026-03-01' AS DATE), 15.00, 0, 'open')
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_product (id, batch_id, entity_id, name, sku, stock, sale_value, raw)
        VALUES (
          CAST(${ids.product} AS UUID), CAST(${ids.batch} AS UUID), CAST(${po} AS UUID),
          'Botella ejemplo', 'EJ-075', 12, 8.50, ${sql.json({})}
        )
      `);
    });

    const both = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview')));
    const kpis = both.kpis as Record<string, unknown>;
    expect(both.entity).toBe('both');
    expect(both.year).toBe(2026);
    expect(kpis.sales_this_year).toBe('210.00');
    expect(kpis.sales_last_year).toBe('25.00');
    expect(kpis.pending_receivables).toBe('90.00');
    expect(kpis.pending_receivables_count).toBe(2);
    expect(kpis.contacts).toBe(3);
    expect(kpis.open_payables).toBe('15.00');
    expect(kpis.open_payables_count).toBe(1);
    expect(both.has_imported).toBe(true);

    const recent = both.recent_invoices as { number: string; kind: string }[];
    expect(recent.map((row) => row.number)).toEqual(['H-170', 'H-110', 'H-140', 'H-100', 'H-025']);
    expect(recent.every((row) => row.kind === 'sale')).toBe(true);

    const customers = both.top_customers as { name: string; total: string }[];
    expect(customers[0]).toEqual({ name: 'Cliente Norte', total: '140.00', invoices: 2 });
    expect(customers[1]).toEqual({ name: 'Cliente Solo CVPO', total: '70.00', invoices: 1 });

    const months = both.months as { month: number; total: string }[];
    expect(months).toHaveLength(12);
    expect(months.find((row) => row.month === 1)?.total).toBe('100.00');
    expect(months.find((row) => row.month === 3)?.total).toBe('40.00');
    expect(months.find((row) => row.month === 4)?.total).toBe('70.00');
    expect(months.find((row) => row.month === 2)?.total).toBe('0.00');

    const poOnly = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview?entity=PO')));
    const poKpis = poOnly.kpis as Record<string, unknown>;
    expect(poKpis.sales_this_year).toBe('140.00');
    expect(poKpis.pending_receivables).toBe('40.00');
    expect(poKpis.contacts).toBe(2);
    expect(poKpis.open_payables).toBe('15.00');

    const cvpoView = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview?entity=CVPO')));
    const cvpoKpis = cvpoView.kpis as Record<string, unknown>;
    expect(cvpoKpis.sales_this_year).toBe('70.00');
    expect(cvpoKpis.sales_last_year).toBe('0.00');
    expect(cvpoKpis.contacts).toBe(2);

    const denied = await ctx.app.handle(new Request('http://localhost/v1/legacy/overview', {
      headers: { 'X-Dev-User': 'bodega@winecore.test' },
    }));
    expect(denied.status).toBe(403);

    const invalid = await ctx.app.handle(new Request('http://localhost/v1/legacy/overview?entity=otra'));
    expect(invalid.status).toBe(422);
  });

  it('lista facturas históricas y no esconde contactos sin ficha', async () => {
    const sales = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/invoices')));
    expect(sales.kind).toBe('sale');
    expect(sales.total).toBe(5);
    const purchases = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/invoices?kind=purchase')));
    const purchaseItems = purchases.items as { number: string; pending: string }[];
    expect(purchases.total).toBe(1);
    expect(purchaseItems[0]?.number).toBe('C-015');
    expect(purchaseItems[0]?.pending).toBe('15.00');

    const products = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/products?q=botella')));
    const productItems = products.items as { name: string; sku: string; source: string }[];
    expect(productItems).toHaveLength(1);
    expect(productItems[0]).toMatchObject({ name: 'Botella ejemplo', sku: 'EJ-075', source: 'holded' });

    const poContacts = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts?entity=PO&limit=100')));
    const poNames = (poContacts.items as { legal_name: string }[]).map((row) => row.legal_name);
    expect(poNames).toContain('Cliente Norte');
    expect(poNames).toContain('Cliente Solo PO');
    expect(poNames).not.toContain('Cliente Solo CVPO');
    expect(poNames).not.toContain('Contacto Archivado');

    const cvpoContacts = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts?entity=CVPO&limit=100')));
    const cvpoNames = (cvpoContacts.items as { legal_name: string }[]).map((row) => row.legal_name);
    expect(cvpoNames).toContain('Cliente Norte');
    expect(cvpoNames).toContain('Cliente Solo CVPO');
    expect(cvpoNames).not.toContain('Cliente Solo PO');

    const all = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts?entity=ambas&limit=100')));
    const allNames = (all.items as { legal_name: string }[]).map((row) => row.legal_name);
    expect(allNames).toContain('Cliente Norte');
    expect(allNames).toContain('Cliente Solo PO');
    expect(allNames).toContain('Cliente Solo CVPO');
    expect(allNames).not.toContain('Contacto Archivado');
    expect(all.total).toBe(3);
  });
});

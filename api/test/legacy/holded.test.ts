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
  nativePo: newId(),
  nativeCvpo: newId(),
  nativeLast: newId(),
  nativeOld: newId(),
  imported: newId(),
  saleOld: newId(),
  saleOldCvpo: newId(),
  purchaseOld: newId(),
  openOld: newId(),
  openOldCvpo: newId(),
  payableOld: newId(),
  payableNativeOld: newId(),
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
      invoice(ids.saleOld, po, 'sale', 'H-OLD', '2024-11-15', 'Cliente Norte', 70, 70, 'Pendiente');
      invoice(ids.saleOldCvpo, cvpo, 'sale', 'H-OLD-CV', '2023-02-02', 'Cliente Solo CVPO', 12, 12, 'Pendiente');
      invoice(ids.purchaseOld, po, 'purchase', 'C-OLD', '2024-06-01', 'Proveedor Ejemplo', 25, 25, 'Pendiente');
      tx.write(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, document_number, document_date, due_date, amount, amount_paid, status
        ) VALUES
          (CAST(${ids.openOld} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.saleOld} AS UUID),
           'H-OLD', CAST('2024-11-15' AS DATE), CAST('2024-12-15' AS DATE), 70.00, 0, 'open'),
          (CAST(${ids.openOldCvpo} AS UUID), CAST(${cvpo} AS UUID), 'receivable', CAST(${ids.saleOldCvpo} AS UUID),
           'H-OLD-CV', CAST('2023-02-02' AS DATE), CAST('2023-03-02' AS DATE), 12.00, 0, 'open'),
          (CAST(${ids.payableOld} AS UUID), CAST(${po} AS UUID), 'payable', CAST(${ids.purchaseOld} AS UUID),
           'C-OLD', CAST('2024-06-01' AS DATE), CAST('2024-07-01' AS DATE), 25.00, 0, 'open')
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_product (id, batch_id, entity_id, name, sku, stock, sale_value, raw)
        VALUES (
          CAST(${ids.product} AS UUID), CAST(${ids.batch} AS UUID), CAST(${po} AS UUID),
          'Botella ejemplo', 'EJ-075', 12, 8.50, ${sql.json({})}
        )
      `);
      const issued = (
        id: string,
        entity: string,
        number: string,
        date: string,
        customer: string,
        name: string,
        total: number,
        paid: number,
        origin: string | null,
      ) => {
        const payment = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partially_paid';
        tx.write(sql`
          INSERT INTO billing.invoice (
            id, legal_entity_id, number, status, invoice_type, issue_date, customer_id, customer_snapshot,
            subtotal, tax_total, total, amount_paid, payment_status, issued_at, created_by, origin
          ) VALUES (
            CAST(${id} AS UUID), CAST(${entity} AS UUID), ${number}, 'issued', 'F1',
            CAST(${date} AS DATE), CAST(${customer} AS UUID), ${sql.json({ name })},
            ${total}, 0, ${total}, ${paid}, ${payment}, ${new Date(`${date}T10:00:00Z`)}, 'test', ${origin}
          )
        `);
      };
      issued(ids.nativePo, po, 'WC-PO', '2026-06-01', ids.norte, 'Cliente Norte', 200, 0, null);
      issued(ids.nativeCvpo, cvpo, 'WC-CV', '2026-08-01', ids.cvpoOnly, 'Cliente Solo CVPO', 80, 80, null);
      issued(ids.nativeLast, po, 'WC-25', '2025-05-01', ids.norte, 'Cliente Norte', 30, 30, null);
      issued(ids.nativeOld, po, 'WC-24', '2024-08-01', ids.norte, 'Cliente Norte', 40, 0, null);
      issued(ids.imported, po, 'H-IMP', '2026-09-01', ids.norte, 'Cliente Norte', 999, 0, 'holded_import');
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice (
          id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, source, status,
          subtotal, tax_total, total, amount_paid, payment_status, approved_by, approved_at, created_by
        ) VALUES (
          CAST(${ids.payableNativeOld} AS UUID), CAST(${po} AS UUID), CAST(${ids.norte} AS UUID), 'G-2025',
          CAST('2025-03-01' AS DATE), 'upload', 'approved',
          18.00, 0, 18.00, 0, 'unpaid', CAST(${ids.norte} AS UUID), ${NOW}, 'test'
        )
      `);
    });

    const both = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview')));
    const kpis = both.kpis as Record<string, unknown>;
    expect(both.entity).toBe('both');
    expect(both.year).toBe(2026);
    // Antes: 210,00 mezclando Holded de P.O (140) y CVPO (70), y el año pasado 25,00.
    // La copia holded_import de 999,00 no entra. Solo lo emitido en WineCore, por sociedad.
    expect(kpis.sales_this_year).toEqual({ PO: '200.00', CVPO: '80.00' });
    expect(kpis.sales_last_year).toEqual({ PO: '30.00', CVPO: '0.00' });
    // Cobros del año: 200 de WineCore (2026) + 40 de Holded (2026) en P.O, y 50 de Holded (2026) en CVPO.
    // Fuera: impagado de 2024 (40), partidas de 2024 (70) y 2023 (12), y la copia holded_import de 999.
    expect(kpis.pending_receivables).toEqual({ PO: '240.00', CVPO: '50.00' });
    expect(kpis.pending_receivables_count).toEqual({ PO: 2, CVPO: 1 });
    expect(kpis.contacts).toBe(4);
    // Pagos del año: 15 de la partida de 2026. Fuera: 25 de 2024 y una factura de proveedor de 2025 (18).
    expect(kpis.open_payables).toBe('15.00');
    expect(kpis.open_payables_count).toBe(1);
    expect(both.has_imported).toBe(true);

    const recent = both.recent_invoices as { number: string; kind: string }[];
    expect(recent.map((row) => row.number)).toEqual(['WC-CV', 'WC-PO', 'WC-25', 'WC-24']);
    expect(recent.every((row) => row.kind === 'sale')).toBe(true);
    expect(recent.some((row) => row.number === 'H-IMP')).toBe(false);

    const customers = both.top_customers as { name: string; total: string; invoices: number }[];
    expect(customers[0]).toEqual({ name: 'Cliente Norte', total: '200.00', invoices: 1 });
    expect(customers[1]).toEqual({ name: 'Cliente Solo CVPO', total: '80.00', invoices: 1 });

    const months = both.months as { month: number; PO: string; CVPO: string }[];
    expect(months).toHaveLength(12);
    expect(months.find((row) => row.month === 6)).toEqual({ month: 6, PO: '200.00', CVPO: '0.00' });
    expect(months.find((row) => row.month === 8)).toEqual({ month: 8, PO: '0.00', CVPO: '80.00' });
    expect(months.find((row) => row.month === 9)).toEqual({ month: 9, PO: '0.00', CVPO: '0.00' });
    expect(months.find((row) => row.month === 1)).toEqual({ month: 1, PO: '0.00', CVPO: '0.00' });

    const poOnly = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview?entity=PO')));
    const poKpis = poOnly.kpis as Record<string, unknown>;
    expect(poKpis.sales_this_year).toEqual({ PO: '200.00', CVPO: '0.00' });
    expect(poKpis.sales_last_year).toEqual({ PO: '30.00', CVPO: '0.00' });
    expect(poKpis.pending_receivables).toEqual({ PO: '240.00', CVPO: '0.00' });
    expect(poKpis.contacts).toBe(3);
    expect(poKpis.open_payables).toBe('15.00');
    expect((poOnly.recent_invoices as { number: string }[]).map((row) => row.number)).toEqual(['WC-PO', 'WC-25', 'WC-24']);

    const cvpoView = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/overview?entity=CVPO')));
    const cvpoKpis = cvpoView.kpis as Record<string, unknown>;
    expect(cvpoKpis.sales_this_year).toEqual({ PO: '0.00', CVPO: '80.00' });
    expect(cvpoKpis.sales_last_year).toEqual({ PO: '0.00', CVPO: '0.00' });
    expect(cvpoKpis.pending_receivables).toEqual({ PO: '0.00', CVPO: '50.00' });
    expect(cvpoKpis.open_payables).toBe('0.00');
    expect(cvpoKpis.contacts).toBe(3);

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
    expect(sales.total).toBe(7);
    const purchases = await json(await ctx.app.handle(new Request('http://localhost/v1/legacy/invoices?kind=purchase')));
    const purchaseItems = purchases.items as { number: string; pending: string }[];
    expect(purchases.total).toBe(2);
    expect(purchaseItems.find((row) => row.number === 'C-015')?.pending).toBe('15.00');
    expect(purchaseItems.some((row) => row.number === 'C-OLD')).toBe(true);

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
    expect(all.total).toBe(4);
  });
});

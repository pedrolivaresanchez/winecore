import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import type { Tx } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const NOW = new Date('2026-10-31T10:00:00Z');
const HASH = 'ef'.repeat(32);
const ctx = await createTestApp({ now: () => NOW });

const ids = {
  batch: newId(),
  norte: newId(),
  tax: newId(),
  avila: newId(),
  dupA: newId(),
  dupB: newId(),
  seriesPo: newId(),
  seriesCvpo: newId(),
  location: newId(),
  toLocation: newId(),
  product: newId(),
  mixedUser: newId(),
  mixedCellar: newId(),
  mixedAdmin: newId(),
};

type Item = {
  id: string;
  origin: string;
  number: string | null;
  issue_date: string | null;
  due_date: string | null;
  customer: { id: string | null; name: string; match: string | null };
  entity_code: string;
  total: string | null;
  pending: string | null;
  status: string;
  status_label: string;
  api_path: string;
};
type Facet = { value: string; label: string; count: number };
type Page = {
  items: Item[];
  total: number;
  totals: { amount: string; pending: string };
  facets: { status: Facet[]; entity: Facet[]; origin: Facet[] };
  origins: string[];
  entity: string;
  as_of: string;
};

async function list(query: string, user?: string): Promise<Page> {
  const response = await ctx.app.handle(new Request(`http://localhost/v1/sales-documents?${query}`, {
    headers: user ? { 'X-Dev-User': user } : {},
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<Page>;
}

async function status(query: string, user?: string): Promise<number> {
  const response = await ctx.app.handle(new Request(`http://localhost/v1/sales-documents?${query}`, {
    headers: user ? { 'X-Dev-User': user } : {},
  }));
  return response.status;
}

function byNumber(page: Page, number: string): Item {
  const found = page.items.find((item) => item.number === number);
  if (!found) throw new Error(`Falta ${number}`);
  return found;
}

function counts(facets: Facet[]): Record<string, number> {
  return Object.fromEntries(facets.filter((facet) => facet.count > 0).map((facet) => [facet.value, facet.count]));
}

describe('lista única de documentos de venta', () => {
  let po = '';
  let cvpo = '';
  const native: Record<string, string> = {};

  beforeAll(async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity');
    po = String(entities.find((row) => row.code === 'PO')?.id);
    cvpo = String(entities.find((row) => row.code === 'CVPO')?.id);

    await ctx.writer.withWrite({ type: 'system', id: 'sales-documents-test', requestId: newId() }, async (tx) => {
      contact(tx, ids.norte, 'Cliente Norte SL', 'B12000014');
      contact(tx, ids.tax, 'Distribuciones Tax SL', 'B12000022');
      contact(tx, ids.avila, 'Bodega Ávila SL', 'B12000030');
      contact(tx, ids.dupA, 'Duplicado SL', 'B12000048');
      contact(tx, ids.dupB, 'Duplicado SL', 'B12000055');
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${ids.batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices', 'sintetico.xlsx', ${HASH}, 'load', 'test')
      `);

      holdedInvoice(tx, { entity: po, number: 'H-001', date: '2026-01-10', due: '2026-02-10', name: 'Cliente Norte SL', contact: ids.norte, total: '100.00', pending: '0.00', status: 'Pagado' });
      holdedInvoice(tx, { entity: po, number: 'H-002', date: '2026-09-01', due: '2026-10-01', name: 'BODEGA  AVILA sl', total: '50.00', pending: '50.00', status: 'Pendiente' });
      holdedInvoice(tx, { entity: cvpo, number: 'H-003', date: '2026-10-15', due: '2026-11-15', name: 'Distrib. Tax', total: '80.00', pending: '30.00', status: 'Pendiente' });
      holdedLine(tx, { entity: cvpo, kind: 'sale', number: 'H-003', date: '2026-10-15', name: 'Distrib. Tax', tax: 'ES-B12000022' });
      holdedInvoice(tx, { entity: po, number: 'H-004', date: '2026-03-20', due: '2026-04-20', name: 'Duplicado SL', total: '10.00', pending: '0.00', status: 'Anulado' });
      const paidLater = holdedInvoice(tx, { entity: po, number: 'H-005', date: '2026-10-20', due: '2026-12-01', name: 'Cliente Norte SL', contact: ids.norte, total: '40.00', pending: '40.00', status: 'Pendiente' });
      tx.write(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, counterparty_contact_id, document_number, document_date,
          due_date, amount, amount_paid, status
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${paidLater} AS UUID), CAST(${ids.norte} AS UUID),
          'H-005', CAST('2026-10-20' AS DATE), CAST('2026-12-01' AS DATE), 40.00, 40.00, 'paid'
        )
      `);
      holdedInvoice(tx, { entity: cvpo, number: 'H-006', date: '2026-06-01', due: null, name: 'Duplicado SL', total: '25.00', pending: '25.00', status: 'Vencido' });
      holdedInvoice(tx, { entity: po, number: 'C-001', date: '2026-09-15', due: '2026-12-01', name: 'Proveedor Ejemplo', total: '15.00', pending: '15.00', status: 'Pendiente', kind: 'purchase' });

      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix) VALUES
          (CAST(${ids.seriesPo} AS UUID), CAST(${po} AS UUID), 'invoice', 'SD', 2026, 'SDP'),
          (CAST(${ids.seriesCvpo} AS UUID), CAST(${cvpo} AS UUID), 'invoice', 'SD', 2026, 'SDC')
      `);
      native.w001 = nativeInvoice(tx, { entity: po, series: ids.seriesPo, number: 'W-001', status: 'issued', date: '2026-10-05', due: '2026-11-04', customer: ids.norte, total: '121.00', paid: '0.00', payment: 'unpaid' });
      native.w002 = nativeInvoice(tx, { entity: cvpo, series: ids.seriesCvpo, number: 'W-002', status: 'issued', date: '2026-08-01', due: '2026-09-01', customer: ids.norte, total: '60.00', paid: '20.00', payment: 'partially_paid' });
      native.draft = nativeInvoice(tx, { entity: po, series: ids.seriesPo, number: null, status: 'draft', date: null, due: null, customer: ids.avila, total: null, paid: '0.00', payment: 'unpaid', created: '2026-10-30T09:00:00Z' });
      native.void = nativeInvoice(tx, { entity: po, series: ids.seriesPo, number: 'W-003', status: 'voided', date: '2026-07-01', due: null, customer: ids.norte, total: '30.00', paid: '0.00', payment: 'unpaid' });
      native.paid = nativeInvoice(tx, { entity: cvpo, series: ids.seriesCvpo, number: 'W-004', status: 'issued', date: '2026-02-02', due: '2026-03-02', customer: ids.avila, total: '90.00', paid: '90.00', payment: 'paid' });

      holdedQuote(tx, { entity: po, number: 'HQ-1', date: '2026-09-01', validUntil: '2026-09-30', name: 'Cliente Norte SL', status: 'Pendiente', invoiced: null, total: '70.00' });
      holdedQuote(tx, { entity: cvpo, number: 'HQ-2', date: '2026-10-20', validUntil: '2026-11-20', name: 'Bodega Avila SL', status: 'Aceptado', invoiced: null, total: '20.00' });
      holdedQuote(tx, { entity: po, number: 'HQ-3', date: '2026-05-01', validUntil: '2026-06-01', name: 'Duplicado SL', status: 'Aceptado', invoiced: 'Facturado', total: '35.00' });
      nativeQuote(tx, { entity: po, number: 'WQ-1', status: 'sent', date: '2026-10-01', validUntil: '2026-10-15', customer: ids.norte, total: '12.10' });
      nativeQuote(tx, { entity: po, number: null, status: 'draft', date: null, validUntil: null, customer: ids.tax, total: '5.00' });

      holdedNote(tx, { entity: po, number: 'HD-1', date: '2026-10-02', destination: 'Almacén Norte', status: 'Pendiente', total: '18.15' });
      holdedLine(tx, { entity: po, kind: 'delivery_note', number: 'HD-1', date: '2026-10-02', name: 'Cliente Norte SL', tax: 'B12000014' });
      holdedNote(tx, { entity: cvpo, number: 'HD-2', date: '2026-09-02', destination: 'Destino Sur', status: 'Facturado', total: '9.68' });
      holdedNote(tx, { entity: po, number: 'HD-3', date: '2026-08-02', destination: 'Destino Este', status: 'Parcialmente', total: '5.00' });
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id) VALUES
          (CAST(${ids.location} AS UUID), 'SDBOD', 'Bodega sintética', 'own_warehouse', CAST(${po} AS UUID)),
          (CAST(${ids.toLocation} AS UUID), 'SDALM', 'Almacén sintético', 'own_warehouse', CAST(${cvpo} AS UUID))
      `);
      const valued = nativeNote(tx, { entity: po, number: 'WD-1', kind: 'sale', status: 'delivered', invoicing: 'invoiced', date: '2026-10-10', customer: ids.norte, valued: true });
      noteLine(tx, valued, 1, '2.000', '10.000000', '0.00');
      noteLine(tx, valued, 2, '1.000', '5.555000', '10.00');
      nativeNote(tx, { entity: cvpo, number: 'WD-2', kind: 'sale', status: 'shipped', invoicing: 'not_invoiced', date: '2026-10-11', customer: ids.avila, valued: false });
      nativeNote(tx, { entity: po, number: 'WD-3', kind: 'transfer', status: 'cancelled', invoicing: 'not_invoiced', date: '2026-10-12', customer: null, valued: false });

      tx.write(sql`
        INSERT INTO core.app_user (id, email, display_name, locale, status)
        VALUES (CAST(${ids.mixedUser} AS UUID), 'mixto@winecore.test', 'Bodega y CVPO', 'es-ES', 'active')
      `);
      tx.write(sql`
        INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id) VALUES
          (CAST(${ids.mixedCellar} AS UUID), CAST(${ids.mixedUser} AS UUID), 'cellar', NULL),
          (CAST(${ids.mixedAdmin} AS UUID), CAST(${ids.mixedUser} AS UUID), 'admin', CAST(${cvpo} AS UUID))
      `);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('une Holded y WineCore con un estado común, enlaces de cliente y totales', async () => {
    const page = await list('kind=invoice');
    expect(page.as_of).toBe('2026-10-31');
    expect(page.entity).toBe('both');
    expect(page.origins).toEqual(['holded', 'winecore']);
    expect(page.total).toBe(11);
    expect(page.items.map((item) => item.number)).toEqual([
      null, 'H-005', 'H-003', 'W-001', 'H-002', 'W-002', 'W-003', 'H-006', 'H-004', 'W-004', 'H-001',
    ]);

    expect(byNumber(page, 'H-001')).toMatchObject({
      origin: 'holded', status: 'paid', status_label: 'Cobrada', pending: '0.00', entity_code: 'PO',
      customer: { id: ids.norte, name: 'Cliente Norte SL', match: 'contact' },
    });
    expect(byNumber(page, 'H-002')).toMatchObject({
      status: 'overdue', status_label: 'Vencida', due_date: '2026-10-01',
      customer: { id: ids.avila, name: 'BODEGA  AVILA sl', match: 'name' },
    });
    expect(byNumber(page, 'H-003')).toMatchObject({
      status: 'partial', pending: '30.00', entity_code: 'CVPO',
      customer: { id: ids.tax, name: 'Distrib. Tax', match: 'tax_id' },
    });
    expect(byNumber(page, 'H-004')).toMatchObject({ status: 'void', pending: '0.00', customer: { id: null, match: null } });
    expect(byNumber(page, 'H-005')).toMatchObject({ status: 'paid', pending: '0.00' });
    expect(byNumber(page, 'H-006')).toMatchObject({ status: 'overdue', due_date: null, customer: { id: null, name: 'Duplicado SL' } });

    const w001 = byNumber(page, 'W-001');
    expect(w001).toMatchObject({
      id: native.w001, origin: 'winecore', status: 'pending', status_label: 'Pendiente de cobro',
      total: '121.00', pending: '121.00', due_date: '2026-11-04',
      customer: { id: ids.norte, name: 'Cliente Norte SL', match: 'contact' },
      api_path: `/v1/invoices/${native.w001}`,
    });
    expect(byNumber(page, 'W-002')).toMatchObject({ status: 'overdue', pending: '40.00', entity_code: 'CVPO' });
    expect(byNumber(page, 'W-003')).toMatchObject({ status: 'void', status_label: 'Anulada', pending: '0.00' });
    expect(byNumber(page, 'W-004')).toMatchObject({ status: 'paid', pending: '0.00' });
    const draft = page.items[0];
    expect(draft).toMatchObject({ id: native.draft, status: 'draft', issue_date: null, total: null, pending: null, customer: { name: 'Bodega Ávila SL' } });
    expect(byNumber(page, 'H-001').api_path).toMatch(/^\/v1\/legacy\/invoices\//);

    expect(page.totals).toEqual({ amount: '566.00', pending: '266.00' });
    expect(counts(page.facets.status)).toEqual({ draft: 1, partial: 1, overdue: 3, paid: 3, void: 2, pending: 1 });
    expect(page.facets.status.map((facet) => facet.value)).toContain('discarded');
    expect(page.facets.status.find((facet) => facet.value === 'partial')?.label).toBe('Cobro parcial');
    expect(page.facets.entity).toEqual([
      { value: 'PO', label: 'P.O', count: 7 },
      { value: 'CVPO', label: 'CVPO', count: 4 },
    ]);
    expect(page.facets.origin).toEqual([
      { value: 'holded', label: 'Holded', count: 6 },
      { value: 'winecore', label: 'WineCore', count: 5 },
    ]);
  });

  it('filtra por libro, sociedad, estado, fechas y cliente; las facetas ignoran su propio filtro', async () => {
    const holded = await list('kind=invoice&origin=holded');
    expect(holded.total).toBe(6);
    expect(holded.items.every((item) => item.origin === 'holded')).toBe(true);
    expect(counts(holded.facets.origin)).toEqual({ holded: 6, winecore: 5 });
    expect(counts(holded.facets.entity)).toEqual({ PO: 4, CVPO: 2 });

    const cvpo = await list('kind=invoice&entity=CVPO');
    expect(cvpo.entity).toBe('CVPO');
    expect(cvpo.items.map((item) => item.number)).toEqual(['H-003', 'W-002', 'H-006', 'W-004']);
    expect(counts(cvpo.facets.entity)).toEqual({ PO: 7, CVPO: 4 });
    expect(counts(cvpo.facets.origin)).toEqual({ holded: 2, winecore: 2 });

    const open = await list('kind=invoice&status=overdue,partial&status=pending');
    expect(open.items.map((item) => item.number)).toEqual(['H-003', 'W-001', 'H-002', 'W-002', 'H-006']);
    expect(open.totals).toEqual({ amount: '336.00', pending: '266.00' });
    expect(counts(open.facets.status)).toEqual({ draft: 1, partial: 1, overdue: 3, paid: 3, void: 2, pending: 1 });
    expect(counts(open.facets.origin)).toEqual({ holded: 3, winecore: 2 });

    const voided = await list('kind=invoice&status=void');
    expect(voided.totals.amount).toBe('40.00');

    const october = await list('kind=invoice&from=2026-10-01&to=2026-10-31');
    expect(october.items.map((item) => item.number)).toEqual([null, 'H-005', 'H-003', 'W-001']);

    const norte = await list(`kind=invoice&customer_id=${ids.norte.toUpperCase()}`);
    expect(norte.items.map((item) => item.number)).toEqual(['H-005', 'W-001', 'W-002', 'W-003', 'H-001']);
    const byTax = await list(`kind=invoice&customer_id=${ids.tax}`);
    expect(byTax.items.map((item) => item.number)).toEqual(['H-003']);
    const byName = await list(`kind=invoice&customer_id=${ids.avila}`);
    expect(byName.items.map((item) => item.number)).toEqual([null, 'H-002', 'W-004']);
  });

  it('busca por número o cliente sin distinguir mayúsculas ni tildes', async () => {
    const accent = await list('kind=invoice&q=%C3%A1vila');
    expect(accent.items.map((item) => item.number)).toEqual([null, 'H-002', 'W-004']);
    const number = await list('kind=invoice&q=w-00');
    expect(number.total).toBe(4);
    const literal = await list('kind=invoice&q=100%25');
    expect(literal.total).toBe(0);
  });

  it('ordena por cada columna y pagina con el total completo', async () => {
    const byTotal = await list('kind=invoice&sort=total&dir=asc');
    expect(byTotal.items.map((item) => item.total)).toEqual([
      '10.00', '25.00', '30.00', '40.00', '50.00', '60.00', '80.00', '90.00', '100.00', '121.00', null,
    ]);
    const byPending = await list('kind=invoice&sort=pending&dir=desc&limit=3');
    expect(byPending.items.map((item) => item.number)).toEqual(['W-001', 'H-002', 'W-002']);
    const byCustomer = await list('kind=invoice&sort=customer&dir=asc&limit=3');
    expect(byCustomer.items.map((item) => item.customer.name)).toEqual(['BODEGA  AVILA sl', 'Bodega Ávila SL', 'Bodega Ávila SL']);
    const byNumberDesc = await list('kind=invoice&sort=number&dir=desc&limit=2');
    expect(byNumberDesc.items.map((item) => item.number)).toEqual(['W-004', 'W-003']);

    const first = await list('kind=invoice&limit=4&offset=0');
    const second = await list('kind=invoice&limit=4&offset=4');
    const third = await list('kind=invoice&limit=4&offset=8');
    expect([first.total, second.total, third.total]).toEqual([11, 11, 11]);
    expect(third.items).toHaveLength(3);
    const all = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(new Set(all).size).toBe(11);
    expect(second.totals).toEqual(first.totals);
  });

  it('lista compras, presupuestos y albaranes de los dos libros', async () => {
    const purchases = await list('kind=invoice&direction=purchase');
    expect(purchases.items.map((item) => [item.number, item.status, item.status_label])).toEqual([
      ['C-001', 'pending', 'Pendiente de pago'],
    ]);

    const quotes = await list('kind=quote');
    expect(quotes.items.map((item) => [item.number, item.origin, item.status])).toEqual([
      [null, 'winecore', 'draft'],
      ['HQ-2', 'holded', 'accepted'],
      ['WQ-1', 'winecore', 'expired'],
      ['HQ-1', 'holded', 'expired'],
      ['HQ-3', 'holded', 'converted'],
    ]);
    expect(byNumber(quotes, 'HQ-1')).toMatchObject({ due_date: '2026-09-30', pending: null, customer: { id: ids.norte, match: 'name' } });
    expect(byNumber(quotes, 'HQ-2').customer).toEqual({ id: ids.avila, name: 'Bodega Avila SL', match: 'name' });
    expect(byNumber(quotes, 'HQ-2').api_path).toMatch(/^\/v1\/legacy\/documents\//);
    expect(byNumber(quotes, 'WQ-1').api_path).toMatch(/^\/v1\/quotes\//);
    expect(quotes.totals.amount).toBe('142.10');
    expect(counts(quotes.facets.status)).toEqual({ draft: 1, accepted: 1, expired: 2, converted: 1 });

    const notes = await list('kind=delivery_note');
    expect(notes.items.map((item) => [item.number, item.status, item.total])).toEqual([
      ['WD-3', 'cancelled', null],
      ['WD-2', 'shipped', null],
      ['WD-1', 'invoiced', '30.25'],
      ['HD-1', 'issued', '18.15'],
      ['HD-2', 'invoiced', '9.68'],
      ['HD-3', 'partially_invoiced', '5.00'],
    ]);
    expect(byNumber(notes, 'HD-1').customer).toEqual({ id: ids.norte, name: 'Cliente Norte SL', match: 'tax_id' });
    expect(byNumber(notes, 'HD-2').customer).toEqual({ id: null, name: 'Destino Sur', match: null });
    expect(byNumber(notes, 'WD-3').customer).toEqual({ id: null, name: 'Almacén sintético', match: null });
    expect(byNumber(notes, 'WD-1').api_path).toMatch(/^\/v1\/delivery-notes\//);
    expect(notes.totals.amount).toBe('63.08');
    expect(byNumber(notes, 'WD-3').status_label).toBe('Anulado');
    const pendingNotes = await list('kind=albaran&status=issued,partially_invoiced');
    expect(pendingNotes.items.map((item) => item.number)).toEqual(['HD-1', 'HD-3']);
  });

  it('respeta la sociedad y el permiso de cada libro', async () => {
    const mixed = await list('kind=invoice', 'mixto@winecore.test');
    expect(mixed.entity).toBe('CVPO');
    expect(mixed.items.every((item) => item.entity_code === 'CVPO')).toBe(true);
    expect(mixed.total).toBe(4);
    expect(mixed.facets.entity).toEqual([{ value: 'CVPO', label: 'CVPO', count: 4 }]);
    expect(await status('kind=invoice&entity=PO', 'mixto@winecore.test')).toBe(403);

    const advisor = await list('kind=invoice&entity=PO', 'asesor@winecore.test');
    expect(advisor.total).toBe(7);
    expect(await status('kind=invoice', 'bodega@winecore.test')).toBe(403);
  });

  it('rechaza parámetros no válidos', async () => {
    for (const query of [
      '',
      'kind=pedido',
      'kind=quote&direction=purchase',
      'kind=invoice&origin=shopify',
      'kind=invoice&entity=otra',
      'kind=invoice&status=sent',
      'kind=invoice&from=2026-02-30',
      'kind=invoice&from=2026-10-02&to=2026-10-01',
      'kind=invoice&customer_id=abc',
      'kind=invoice&sort=importe',
      'kind=invoice&dir=up',
      'kind=invoice&limit=0',
      'kind=invoice&limit=201',
      'kind=invoice&offset=-1',
    ]) {
      expect(await status(query)).toBe(422);
    }
    expect(await status('kind=invoice&limit=200')).toBe(200);
  });
});

const contactNames = new Map<string, string>();

function contact(tx: Tx, id: string, name: string, tax: string) {
  contactNames.set(id, name);
  tx.write(sql`
    INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, created_by)
    VALUES (CAST(${id} AS UUID), 'company', ${name}, ${tax}, 'nif', 'ES', 'ES', TRUE, 'test')
  `);
}

function holdedInvoice(tx: Tx, input: {
  entity: string;
  number: string;
  date: string;
  due: string | null;
  name: string;
  contact?: string;
  total: string;
  pending: string;
  status: string;
  kind?: 'sale' | 'purchase';
}): string {
  const id = newId();
  tx.write(sql`
    INSERT INTO legacy.holded_invoice (
      id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name, counterparty_contact_id,
      subtotal, total, pending, status_holded, raw
    ) VALUES (
      CAST(${id} AS UUID), CAST(${ids.batch} AS UUID), CAST(${input.entity} AS UUID), ${input.kind ?? 'sale'}, ${input.number},
      CAST(${input.date} AS DATE), CAST(${input.due} AS DATE), ${input.name}, CAST(${input.contact ?? null} AS UUID),
      ${input.total}, ${input.total}, ${input.pending}, ${input.status}, ${sql.json({})}
    )
  `);
  return id;
}

function holdedLine(tx: Tx, input: { entity: string; kind: string; number: string; date: string; name: string; tax: string }) {
  tx.write(sql`
    INSERT INTO legacy.holded_invoice_line (
      id, batch_id, entity_id, kind, document_number, document_date, line_seq, counterparty_name, counterparty_tax_id, raw
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${ids.batch} AS UUID), CAST(${input.entity} AS UUID), ${input.kind}, ${input.number},
      CAST(${input.date} AS DATE), 1, ${input.name}, ${input.tax}, ${sql.json({})}
    )
  `);
}

function nativeInvoice(tx: Tx, input: {
  entity: string;
  series: string;
  number: string | null;
  status: string;
  date: string | null;
  due: string | null;
  customer: string;
  total: string | null;
  paid: string;
  payment: string;
  created?: string;
}): string {
  const id = newId();
  const issued = input.status === 'issued' || input.status === 'voided';
  tx.write(sql`
    INSERT INTO billing.invoice (
      id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id, customer_snapshot,
      subtotal, tax_total, total, amount_paid, payment_status, issued_at, voided_at, void_reason, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${input.entity} AS UUID), CAST(${input.series} AS UUID), ${input.number}, ${input.status}, 'F1',
      CAST(${input.date} AS DATE), CAST(${input.customer} AS UUID), ${issued ? sql.json({ name: contactNames.get(input.customer) }) : null},
      ${input.total}, ${input.total == null ? null : '0.00'}, ${input.total}, ${input.paid}, ${input.payment},
      ${issued ? NOW : null}, ${input.status === 'voided' ? NOW : null}, ${input.status === 'voided' ? 'Prueba' : null},
      'test', ${input.created ? new Date(input.created) : NOW}
    )
  `);
  if (input.due) {
    tx.write(sql`
      INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
      VALUES (CAST(${newId()} AS UUID), CAST(${id} AS UUID), 1, CAST(${input.due} AS DATE), ${input.total})
    `);
  }
  return id;
}

function holdedQuote(tx: Tx, input: {
  entity: string;
  number: string;
  date: string;
  validUntil: string;
  name: string;
  status: string;
  invoiced: string | null;
  total: string;
}) {
  tx.write(sql`
    INSERT INTO legacy.holded_quote (
      id, batch_id, entity_id, number, issue_date, valid_until, counterparty_name, total, status_holded, invoiced_status, raw
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${ids.batch} AS UUID), CAST(${input.entity} AS UUID), ${input.number},
      CAST(${input.date} AS DATE), CAST(${input.validUntil} AS DATE), ${input.name}, ${input.total},
      ${input.status}, ${input.invoiced}, ${sql.json({})}
    )
  `);
}

function nativeQuote(tx: Tx, input: {
  entity: string;
  number: string | null;
  status: string;
  date: string | null;
  validUntil: string | null;
  customer: string;
  total: string;
}) {
  tx.write(sql`
    INSERT INTO sales.quote (
      id, legal_entity_id, number, status, customer_id, channel, issue_date, valid_until, subtotal, total, created_by, created_at
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${input.entity} AS UUID), ${input.number}, ${input.status}, CAST(${input.customer} AS UUID),
      'direct', CAST(${input.date} AS DATE), CAST(${input.validUntil} AS DATE), ${input.total}, ${input.total}, 'test',
      ${new Date('2026-10-30T12:00:00Z')}
    )
  `);
}

function holdedNote(tx: Tx, input: { entity: string; number: string; date: string; destination: string; status: string; total: string }) {
  tx.write(sql`
    INSERT INTO legacy.holded_delivery_note (id, batch_id, entity_id, number, issue_date, destination, total, invoiced_status, raw)
    VALUES (
      CAST(${newId()} AS UUID), CAST(${ids.batch} AS UUID), CAST(${input.entity} AS UUID), ${input.number},
      CAST(${input.date} AS DATE), ${input.destination}, ${input.total}, ${input.status}, ${sql.json({})}
    )
  `);
}

function nativeNote(tx: Tx, input: {
  entity: string;
  number: string;
  kind: string;
  status: string;
  invoicing: string;
  date: string;
  customer: string | null;
  valued: boolean;
}): string {
  const id = newId();
  tx.write(sql`
    INSERT INTO sales.delivery_note (
      id, legal_entity_id, number, kind, status, invoicing_status, customer_id, issue_date, from_location_id,
      to_location_id, is_valued, cancelled_reason, created_by
    ) VALUES (
      CAST(${id} AS UUID), CAST(${input.entity} AS UUID), ${input.number}, ${input.kind}, ${input.status}, ${input.invoicing},
      CAST(${input.customer} AS UUID), CAST(${input.date} AS DATE), CAST(${ids.location} AS UUID),
      CAST(${input.kind === 'transfer' ? ids.toLocation : null} AS UUID), ${input.valued},
      ${input.status === 'cancelled' ? 'Prueba' : null}, 'test'
    )
  `);
  return id;
}

function noteLine(tx: Tx, noteId: string, lineNo: number, quantity: string, price: string, discount: string) {
  tx.write(sql`
    INSERT INTO sales.delivery_note_line (id, delivery_note_id, line_no, product_id, description, quantity, unit_price, discount_pct, tax_code)
    VALUES (
      CAST(${newId()} AS UUID), CAST(${noteId} AS UUID), ${lineNo}, CAST(${ids.product} AS UUID), 'Botella sintética',
      ${quantity}, ${price}, ${discount}, 'IVA21'
    )
  `);
}

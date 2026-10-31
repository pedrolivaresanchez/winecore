import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();

describe('gastos · filtros y categorías', () => {
  const supplier = newId();
  const other = newId();
  const march = newId();
  const april = newId();
  const accounted = newId();

  afterAll(async () => {
    await ctx.close();
  });

  it('filtra por mes, categoría y texto, y devuelve el nombre y el NIF', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    if (!po) throw new Error('Falta la entidad');
    await ctx.writer.withWrite({ type: 'system', id: 'gastos-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, trade_name, tax_id, tax_id_type, tax_id_country, country_code, is_supplier, created_by
        ) VALUES (
          CAST(${supplier} AS UUID), 'company', 'Suministros Sinteticos SL', 'Viñedo Sintético', 'B11111119',
          'nif', 'ES', 'ES', TRUE, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_supplier, created_by
        ) VALUES (
          CAST(${other} AS UUID), 'company', 'Laboratorio sintetico', 'B44444446', 'nif', 'ES', 'ES', TRUE, 'test'
        )
      `);
      const row = (id: string, contact: string, number: string, issue: string | null, accounting: string | null, category: string) => {
        tx.write(sql`
          INSERT INTO purchasing.supplier_invoice (
            id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
            source, status, category_code, total, created_by
          ) VALUES (
            CAST(${id} AS UUID), CAST(${po} AS UUID), CAST(${contact} AS UUID), ${number},
            CASE WHEN ${issue} IS NULL THEN NULL ELSE CAST(${issue} AS DATE) END,
            CASE WHEN ${accounting} IS NULL THEN NULL ELSE CAST(${accounting} AS DATE) END,
            'upload', 'captured', ${category}, 10.00, 'test'
          )
        `);
      };
      row(march, supplier, 'MAR-1', '2026-03-15', '2026-03-15', 'transport');
      row(april, other, 'ABR-9', '2026-04-02', '2026-04-02', 'lab');
      row(accounted, supplier, 'MAR-2', null, '2026-03-20', 'transport');
    });

    const categories = await json('/v1/expense-categories');
    const grapes = (categories.items as { code: string; name: string; default_account: string }[])
      .find((item) => item.code === 'grapes');
    expect(grapes).toMatchObject({ name: 'Compra de uva', default_account: '601' });

    const byMonth = await json('/v1/supplier-invoices?month=2026-03');
    expect(ids(byMonth).sort()).toEqual([accounted, march].sort());
    const shown = (byMonth.items as { id: string; supplier_name: string | null; supplier_tax_id: string | null }[])
      .find((item) => item.id === march);
    expect(shown?.supplier_name).toBe('Viñedo Sintético');
    expect(shown?.supplier_tax_id).toBe('B11111119');

    const byCategory = await json('/v1/supplier-invoices?category=lab');
    expect(ids(byCategory)).toEqual([april]);

    const byName = await json('/v1/supplier-invoices?q=vinedo');
    expect(ids(byName).sort()).toEqual([accounted, march].sort());
    const byTax = await json('/v1/supplier-invoices?q=B11111119');
    expect(ids(byTax).sort()).toEqual([accounted, march].sort());
    const byNumber = await json('/v1/supplier-invoices?month=2026-04&q=abr');
    expect(ids(byNumber)).toEqual([april]);

    const badMonth = await call('/v1/supplier-invoices?month=2026-13');
    expect(badMonth.status).toBe(422);
    const badCategory = await call('/v1/supplier-invoices?category=no_existe');
    expect(badCategory.status).toBe(422);
    const forbidden = await call('/v1/expense-categories', 'bodega@winecore.test');
    expect(forbidden.status).toBe(403);
  });

  async function call(path: string, user?: string) {
    const headers = new Headers();
    if (user) headers.set('x-dev-user', user);
    const response = await ctx.app.handle(new Request(`http://localhost${path}`, { headers }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function json(path: string) {
    const result = await call(path);
    if (result.status !== 200) throw new Error(`${path} -> ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }
});

function ids(body: Record<string, unknown>): string[] {
  return (body.items as { id: string }[]).map((item) => item.id);
}

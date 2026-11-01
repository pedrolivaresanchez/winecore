import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();
const actor = { type: 'system' as const, id: 'proposal-yy-test', requestId: 'proposal-yy-test' };

async function entity(code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = ${code}`);
  return String(rows[0]?.id).toLowerCase();
}

async function proposal(entityId: string, docType: string, year: number): Promise<{ body: Record<string, unknown> }> {
  const response = await ctx.app.handle(new Request(
    `http://localhost/v1/number-series/proposal?legal_entity_id=${entityId}&doc_type=${docType}&year=${year}`,
    { headers: { 'X-Dev-User': 'owner@winecore.test' } },
  ));
  return { body: await response.json() as Record<string, unknown> };
}

afterAll(async () => {
  await ctx.close();
});

describe('numeración de Holded con año de dos cifras', () => {
  it('lee el formato F260086 de Holded: año de dos cifras y contador que se reinicia cada año', async () => {
    const po = await entity('PO');
    const cvpo = await entity('CVPO');
    const batch = newId();
    const row = (entityId: string, number: string, date: string, total: number) => sql`(
      CAST(${newId()} AS UUID), CAST(${batch} AS UUID), CAST(${entityId} AS UUID), 'sale', ${number},
      CAST(${date} AS DATE), 'Cliente Ejemplo', ${total}, ${total}, 'Pagado', ${sql.json({})}
    )`;
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${batch} AS UUID), 'holded', NULL, 'sales_invoices', 'sintetico-yy.xlsx', ${'ef'.repeat(32)}, 'load', 'test')
      `);
      tx.write(`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name, subtotal, total, status_holded, raw
        ) VALUES ${[
          row(po, 'F250088', '2025-12-30', 10),
          row(po, 'F260085', '2026-10-01', 100),
          row(po, 'F260086', '2026-10-29', 50),
          row(po, 'F260059-1', '2026-09-17', 50),
          row(po, 'CN260001', '2026-01-02', -20),
          row(cvpo, 'F260099', '2026-10-01', 10),
          row(cvpo, 'F260100', '2026-10-02', 10),
          row(cvpo, 'CN260008', '2026-10-23', -10),
        ].join(',')}
      `);
    });
    const invoice = await proposal(po, 'invoice', 2026);
    expect(invoice.body.holded).toEqual(expect.objectContaining({
      prefix: 'F26', padding: 4, next_value: 87, first_number: 'F260087', limit_number: 'F269999', last_number: 'F260086',
    }));
    const nextYear = await proposal(po, 'invoice', 2027);
    expect(nextYear.body.holded).toEqual(expect.objectContaining({ prefix: 'F27', padding: 4, next_value: 1, first_number: 'F270001' }));
    const credit = await proposal(po, 'credit_note', 2026);
    expect(credit.body.holded).toEqual(expect.objectContaining({ code: 'RH', prefix: 'CN26', next_value: 2, first_number: 'CN260002' }));
    expect((await proposal(po, 'credit_note', 2027)).body.holded).toEqual(expect.objectContaining({ prefix: 'CN27', first_number: 'CN270001' }));
    const ceiling = await proposal(cvpo, 'invoice', 2026);
    expect(ceiling.body.holded).toEqual(expect.objectContaining({ prefix: 'F26', first_number: 'F260101' }));
    expect((await proposal(cvpo, 'credit_note', 2026)).body.holded).toEqual(expect.objectContaining({ prefix: 'CN26', first_number: 'CN260009' }));
  });
});

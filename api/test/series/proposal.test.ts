import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { takeNumber } from '../../src/core/series';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();
const actor = { type: 'system' as const, id: 'proposal-test', requestId: 'proposal-test' };
let po = '';
let cvpo = '';

async function entity(code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = ${code}`);
  return String(rows[0]?.id).toLowerCase();
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  user = 'owner@winecore.test',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function proposal(entityId: string, docType: string, year: number, user?: string) {
  return call('GET', `/v1/number-series/proposal?legal_entity_id=${entityId}&doc_type=${docType}&year=${year}`, undefined, user);
}

function open(entityId: string, choice: string, extra: Record<string, unknown> = {}) {
  return call('POST', '/v1/number-series/open', { legal_entity_id: entityId, doc_type: 'invoice', year: 2026, choice, ...extra });
}

beforeAll(async () => {
  po = await entity('PO');
  cvpo = await entity('CVPO');
  const batch = newId();
  const sale = (entityId: string, number: string, date: string, total: number, kind = 'sale') => sql`(
    CAST(${newId()} AS UUID), CAST(${batch} AS UUID), CAST(${entityId} AS UUID), ${kind}, ${number},
    CAST(${date} AS DATE), 'Cliente Ejemplo', ${total}, ${total}, 'Pagado', ${sql.json({})}
  )`;
  await ctx.writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
      VALUES (CAST(${batch} AS UUID), 'holded', NULL, 'sales_invoices', 'sintetico.xlsx', ${'cd'.repeat(32)}, 'load', 'test')
    `);
    tx.write(`
      INSERT INTO legacy.holded_invoice (
        id, batch_id, entity_id, kind, number, issue_date, counterparty_name, subtotal, total, status_holded, raw
      ) VALUES ${[
        sale(po, 'F-2025-40', '2025-12-20', 10),
        sale(po, 'F-2026-01', '2026-01-10', 100),
        sale(po, 'F-2026-02', '2026-02-10', 50),
        sale(po, 'F-2026-03', '2026-03-01', -20),
        sale(po, 'CN-2026-09', '2026-03-05', -10),
        sale(po, 'C-2026-77', '2026-03-06', 30, 'purchase'),
        sale(cvpo, 'F-2025-12', '2025-11-11', 10),
      ].join(',')}
    `);
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('numeración de la primera factura del año', () => {
  it('propone seguir la de Holded o empezar la del plan', async () => {
    const sameYear = await proposal(po, 'invoice', 2026);
    expect(sameYear.status).toBe(200);
    expect(sameYear.body).toEqual({
      legal_entity_id: po,
      entity_code: 'PO',
      doc_type: 'invoice',
      year: 2026,
      active: null,
      fresh: {
        code: 'FA', prefix: 'FA26-', padding: 4, next_value: 1, verifactu: true,
        first_number: 'FA26-0001', limit_number: 'FA26-9999',
      },
      holded: {
        code: 'FH', prefix: 'F-2026-', padding: 2, next_value: 4, verifactu: true,
        first_number: 'F-2026-04', limit_number: 'F-2026-99',
        last_number: 'F-2026-03', last_date: '2026-03-01', last_year: 2026, count: 2,
      },
    });

    const earlier = await proposal(po, 'invoice', 2025);
    expect(earlier.body.holded).toEqual(expect.objectContaining({ prefix: 'F-2025-', first_number: 'F-2025-41', last_number: 'F-2025-40' }));

    const renamed = await proposal(cvpo, 'invoice', 2026);
    expect(renamed.body.holded).toEqual(expect.objectContaining({
      prefix: 'F-2026-', next_value: 1, first_number: 'F-2026-01', last_number: 'F-2025-12', last_year: 2025,
    }));

    const credit = await proposal(po, 'credit_note', 2026);
    expect(credit.body.holded).toEqual(expect.objectContaining({
      code: 'RH', prefix: 'CN-2026-', padding: 2, next_value: 10, first_number: 'CN-2026-10', last_number: 'CN-2026-09',
    }));
    expect(credit.body.fresh).toEqual(expect.objectContaining({ code: 'RC', first_number: 'RC26-0001' }));
    expect((await proposal(cvpo, 'credit_note', 2026)).body.holded).toBeNull();
  });

  it('solo propietario y administración', async () => {
    expect((await proposal(po, 'invoice', 2026, 'admin@winecore.test')).status).toBe(200);
    expect((await proposal(po, 'invoice', 2026, 'asesor@winecore.test')).status).toBe(403);
    const denied = await call('POST', '/v1/number-series/open', {
      legal_entity_id: po, doc_type: 'invoice', year: 2026, choice: 'fresh',
    }, 'bodega@winecore.test');
    expect(denied.status).toBe(403);
    expect((await proposal(po, 'invoice', 1999)).status).toBe(422);
  });

  it('abre la serie elegida una sola vez y no repite números de Holded', async () => {
    expect((await open(po, 'otra')).status).toBe(422);
    const behind = await open(po, 'holded', { next_value: 3 });
    expect(behind.status).toBe(422);
    expect(JSON.stringify(behind.body)).toContain('Holded ya llegó a F-2026-03');

    const opened = await open(po, 'holded');
    expect(opened.status).toBe(201);
    expect(opened.body).toEqual(expect.objectContaining({
      code: 'FH', prefix: 'F-2026-', padding: 2, next_value: 4, verifactu: true, is_default: true, is_active: true,
    }));
    const again = await open(po, 'fresh');
    expect(again.body.id).toBe(opened.body.id);
    expect((await proposal(po, 'invoice', 2026)).body.active).toEqual({
      id: opened.body.id, prefix: 'F-2026-', next_number: 'F-2026-04',
    });
    const number = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
      legalEntityId: po, docType: 'invoice', date: new Date('2026-06-01T10:00:00Z'),
    }));
    expect(number).toBe('F-2026-04');

    const ahead = await open(cvpo, 'holded', { next_value: 5 });
    expect(ahead.body).toEqual(expect.objectContaining({ prefix: 'F-2026-', next_value: 5 }));
  });

  it('el alta manual tampoco empieza por debajo de Holded', async () => {
    const body = { legal_entity_id: cvpo, doc_type: 'invoice', code: 'FX', prefix: 'F-2025-', padding: 2, year: 2025 };
    const low = await call('POST', '/v1/number-series', { ...body, next_value: 12 });
    expect(low.status).toBe(422);
    expect(JSON.stringify(low.body)).toContain('empieza en 13 o más');
    const ok = await call('POST', '/v1/number-series', { ...body, next_value: 13 });
    expect(ok.status).toBe(201);
    expect(ok.body.last_number).toBe('F-2025-12');
  });
});

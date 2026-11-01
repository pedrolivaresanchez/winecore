import { afterAll, describe, expect, test } from 'bun:test';

import { createTestApp } from '../helpers';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

const t: TestApp = await createTestApp({ now: () => new Date('2027-06-15T10:00:00.000Z') });

afterAll(async () => {
  await t.close();
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await t.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, json: text.trim() === '' ? null : JSON.parse(text) as unknown };
}

async function tool(name: string, args: unknown) {
  const response = await post('/m2m/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const body = response.json as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const block = body.result?.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Data : {};
  return { error: body.result?.isError === true, data };
}

/** Prepare and commit, failing loudly with the API's answer when either step is refused. */
async function write(name: string, args: unknown) {
  const prepared = await tool(`${name}_prepare`, args);
  expect(prepared.error ? JSON.stringify(prepared.data) : 'ok').toBe('ok');
  const committed = await tool(`${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? JSON.stringify(committed.data) : 'ok').toBe('ok');
  return { prepared: prepared.data, committed: committed.data };
}

async function rest(path: string): Promise<Data> {
  const response = await t.app.handle(new Request(`http://localhost${path}`));
  expect(response.status).toBe(200);
  return await response.json() as Data;
}

function webOf(data: Data): string {
  return String((data.links as { web?: string } | undefined)?.web ?? '');
}

let caeSeq = 0;

async function warehouseWithMove(): Promise<{ po: string; warehouse: string }> {
  const rows = await t.writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = 'PO'`);
  const po = String(rows[0]?.id);
  const warehouse = newId();
  caeSeq += 1;
  const cae = `ES000${String(caeSeq).padStart(2, "0")}V0000T`;
  await t.writer.withWrite({ type: 'system', id: 'mcp-regulatory-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
      VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${cae}, 'V1', 'Fábrica sintética', TRUE)
    `);
    tx.write(sql`
      INSERT INTO inventory.fiscal_move (
        id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, units, abv_pct,
        excise_product_key, justification_type, justification_ref, fiscal_trigger,
        source_table, source_id, created_by
      ) VALUES (
        CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), DATE '2027-01-01', 'opening', 'bulk',
        2500000, 0, 12.50, 'GRANEL-TINTO', 'count_record', 'AF-02-GRANEL', 'count',
        'inventory.inventory_count', CAST(${newId()} AS UUID), 'mcp-regulatory-test'
      )
    `);
  });
  return { po, warehouse };
}

describe('MCP regulatorio sobre las rutas de la app', () => {
  test('libro SILICIE: crear, listar y validar; ejercicio abierto', async () => {
    const { warehouse } = await warehouseWithMove();
    const ledger = await write('regulatory_silicie_ledger_create', {
      tax_warehouse_id: warehouse, product_class: 'bulk', color: 'tinto', nc_code: '220429',
    });
    expect(ledger.committed.reference).toBe('GRANEL-TINTO');
    const list = await tool('regulatory_silicie_ledgers_list', { tax_warehouse_id: warehouse });
    expect(JSON.stringify(list.data)).toContain('GRANEL-TINTO');
    const ledgerId = String(ledger.committed.id);
    const validated = await write('regulatory_silicie_ledger_validate', { id: ledgerId, advisor_ref: 'VAL-SINTETICA-01' });
    expect(validated.committed).toBeTruthy();

    const exercise = await write('regulatory_silicie_exercise_open', { tax_warehouse_id: warehouse, year: 2027 });
    expect(exercise.committed).toBeTruthy();
  });

  test('envío SILICIE: preparar, validar, pedir aprobación y anular; calendario', async () => {
    const { po, warehouse } = await warehouseWithMove();
    await write('regulatory_silicie_ledger_create', { tax_warehouse_id: warehouse, product_class: 'bulk', color: 'tinto', nc_code: '220429' });
    const created = await write('regulatory_submission_create', {
      legal_entity_id: po, tax_warehouse_id: warehouse, period_start: '2027-01-01', period_end: '2027-07-31',
      recorded_on: '2027-10-01', aggregation: 'none',
    });
    const submissionId = String(created.committed.id);
    expect(created.committed.status).toBe('draft');
    expect(webOf(created.committed)).toContain(`/regulatorio/envios/${submissionId}`);

    const detail = await tool('regulatory_submission_get', { id: submissionId });
    expect(detail.data.status).toBe('draft');
    const list = await tool('regulatory_submissions_list', { flow: 'silicie' });
    expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(submissionId);

    const file = await tool('regulatory_submission_file_get', { id: submissionId });
    expect(file.error ? JSON.stringify(file.data) : 'ok').toBe('ok');
    expect(String(file.data.filename)).toContain('IESA1V2');
    expect(String(file.data.text)).toContain('GRANEL-TINTO');
    expect(String(file.data.text)).not.toContain('\uFFFD');
    expect(file.data.charset).toBe('iso-8859-1');
    const original = Buffer.from(String(file.data.base64), 'base64');
    expect(new TextDecoder('windows-1252').decode(original)).toBe(String(file.data.text));

    const validated = await write('regulatory_submission_validate', { id: submissionId });
    expect(validated.committed.status).toBe('validated');
    const requested = await write('regulatory_submission_request_approval', { id: submissionId });
    expect(requested.committed.status).toBe('pending_approval');
    const cancelled = await write('regulatory_submission_cancel', { id: submissionId, reason: 'Prueba de anulación' });
    expect(cancelled.committed.status).toBe('cancelled');

    const obligations = await tool('regulatory_obligations_list', { flow: 'silicie' });
    expect(obligations.error ? JSON.stringify(obligations.data) : 'ok').toBe('ok');
    const synced = await write('regulatory_obligations_sync', { legal_entity_id: po, year: 2027 });
    expect(synced.committed).toBeTruthy();
  });

  test('presentar sin aprobación se rechaza al confirmar', async () => {
    const { po, warehouse } = await warehouseWithMove();
    await write('regulatory_silicie_ledger_create', { tax_warehouse_id: warehouse, product_class: 'bulk', color: 'tinto', nc_code: '220429' });
    const created = await write('regulatory_submission_create', {
      legal_entity_id: po, tax_warehouse_id: warehouse, period_start: '2027-01-01', period_end: '2027-07-31',
      recorded_on: '2027-10-01', aggregation: 'none',
    });
    const submissionId = String(created.committed.id);
    const prepared = await tool('regulatory_submission_mark_submitted_prepare', { id: submissionId, external_ref: 'CSV-SINTETICO-01' });
    expect(prepared.error).toBe(false);
    const committed = await tool('regulatory_submission_mark_submitted_commit', { confirmation_token: prepared.data.confirmation_token });
    expect(committed.error).toBe(true);
  });
});

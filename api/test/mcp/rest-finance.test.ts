import { afterAll, describe, expect, test } from 'bun:test';

import { createTestApp } from '../helpers';
import { bindFinance } from '../../src/core/finance/runtime';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { financeEnv, insertContact, insertInvoice, world } from '../finance/fixture';
import { camtEntry, camtStatement, n43AccountHeader, n43Movement } from '../finance/files';
import { spanishIban } from '../finance/iban';
import { buildSalesFixture } from '../sales/fixture';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

const t: TestApp = await createTestApp({ env: financeEnv() });

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

describe('MCP de tesorería sobre las rutas de la app', () => {
  test('cuenta, cobro, anulación y resumen de pendientes', async () => {
    const ids = await world(t.writer);
    const today = todayMadrid();
    const iban = spanishIban('0099', '0001', '0000000031');
    const account = await write('finance_bank_account_create', {
      legal_entity_id: 'PO', bank_name: 'Banco Ejemplo', iban, bic: 'TESTESMMXXX', is_default: true,
    });
    expect(JSON.stringify(account.committed)).not.toContain(iban);
    const accounts = await tool('finance_bank_accounts_list', { entity: 'PO' });
    expect(JSON.stringify(accounts.data)).not.toContain(iban);

    const customer = await insertContact(t.writer, ids.ownerId, { name: 'Cliente Cobro SL', customer: true });
    const invoice = await insertInvoice(t.writer, ids.ownerId, {
      entityId: ids.po.id, customerId: customer, total: '100.00', dueDate: today, number: 'FS26-0501',
    });

    const pending = await tool('finance_receivables_list', { entity: 'PO' });
    expect(pending.error).toBe(false);
    expect(JSON.stringify(pending.data)).toContain(invoice.id);

    const paid = await write('finance_payment_record', {
      direction: 'in', method: 'transfer', amount: '40.00', value_date: today, counterparty_id: customer,
      legal_entity_id: 'PO', bank_account_id: String(account.committed.id),
      allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '40.00' }],
    });
    const paymentId = String(paid.committed.id);
    expect(paid.committed.status).toBe('registered');
    expect(webOf(paid.committed)).toContain('/cobros');
    const stored = await rest(`/v1/invoices/${invoice.id}`);
    expect(stored.payment_status).toBe('partially_paid');

    const got = await tool('finance_payment_get', { id: paymentId });
    expect(got.data.amount).toBe('40.00');
    const list = await tool('finance_payments_list', { direction: 'in', counterparty_id: customer });
    expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(paymentId);

    const reversed = await write('finance_payment_reverse', { id: paymentId, reason: 'Cobro duplicado de prueba' });
    expect(reversed.committed.status).toBe('reversed');
    const after = await rest(`/v1/invoices/${invoice.id}`);
    expect(after.payment_status).toBe('unpaid');
  });

  test('un cobro cambiado entre la vista previa y la confirmación se rechaza', async () => {
    const ids = await world(t.writer);
    const today = todayMadrid();
    const customer = await insertContact(t.writer, ids.ownerId, { name: 'Cliente Rápido SL', customer: true });
    const invoice = await insertInvoice(t.writer, ids.ownerId, {
      entityId: ids.po.id, customerId: customer, total: '30.00', dueDate: today, number: 'FS26-0502',
    });
    const paid = await write('finance_payment_record', {
      direction: 'in', method: 'cash', amount: '30.00', value_date: today, counterparty_id: customer, legal_entity_id: 'PO',
      allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: '30.00' }],
    });
    const paymentId = String(paid.committed.id);
    const prepared = await tool('finance_payment_reverse_prepare', { id: paymentId, reason: 'Se anulará dos veces' });
    expect(prepared.error).toBe(false);
    await write('finance_payment_reverse', { id: paymentId, reason: 'Anulado antes' });
    const committed = await tool('finance_payment_reverse_commit', { confirmation_token: prepared.data.confirmation_token });
    expect(committed.error).toBe(true);
    expect(JSON.stringify(committed.data)).toContain('WC_MCP_PREVIEW_STALE');
  });

  test('remesa de adeudos: crear, pedir aprobación, generar y descargar el fichero', async () => {
    const ids = await world(t.writer);
    const today = todayMadrid();
    const ours = spanishIban('0099', '0001', '0000000032');
    const debtor = spanishIban('0099', '0001', '0000000033');
    const account = await write('finance_bank_account_create', { legal_entity_id: 'PO', bank_name: 'Banco Ejemplo', iban: ours, bic: 'TESTESMMXXX' });
    const customer = await insertContact(t.writer, ids.ownerId, {
      name: 'Cliente Mandato SL', customer: true, iban: debtor, mandateRef: 'MANDATO-0501', mandateDate: '2025-04-15',
    });
    const invoice = await insertInvoice(t.writer, ids.ownerId, {
      entityId: ids.po.id, customerId: customer, total: '121.00', dueDate: today, number: 'FS26-0503',
    });
    const created = await write('finance_remittance_create', {
      legal_entity_id: 'PO', kind: 'direct_debit', bank_account_id: String(account.committed.id),
      execution_date: addCalendarDays(today, 4), items: [{ target_table: 'billing.invoice', target_id: invoice.id }],
    });
    const remittanceId = String(created.committed.id);
    expect(created.committed.status).toBe('draft');
    expect(JSON.stringify(created.committed)).not.toContain(debtor);

    const detail = await tool('finance_remittance_get', { id: remittanceId });
    expect(detail.data.total).toBe('121.00');
    const list = await tool('finance_remittances_list', { kind: 'direct_debit' });
    expect((list.data.items as { id: string }[]).map((item) => item.id)).toContain(remittanceId);

    const requested = await write('finance_remittance_request_approval', { id: remittanceId });
    expect(requested.committed.status).toBe('pending_approval');
    bindFinance(t.writer, { approval: { decide: () => ({ approved: true }) } });
    const generated = await write('finance_remittance_file_generate', { id: remittanceId });
    expect(generated.committed.status).toBe('file_generated');

    const file = await tool('finance_remittance_file_get', { id: remittanceId });
    expect(file.error ? JSON.stringify(file.data) : 'ok').toBe('ok');
    expect(JSON.stringify(file.data)).toContain('base64');

    const submitted = await write('finance_remittance_mark_submitted', { id: remittanceId });
    expect(submitted.committed.status).toBe('uploaded_by_user');
  });

  test('extracto Norma 43: importar, ver sugerencias y conciliar un movimiento', async () => {
    const ids = await world(t.writer);
    const today = todayMadrid();
    const account = await write('finance_bank_account_create', {
      legal_entity_id: 'PO', bank_name: 'Banco Ejemplo', iban: spanishIban('0099', '0001', '0000000034'), bic: 'TESTESMMXXX',
    });
    const customer = await insertContact(t.writer, ids.ownerId, { name: 'Cliente Extracto SL', customer: true });
    const invoice = await insertInvoice(t.writer, ids.ownerId, {
      entityId: ids.po.id, customerId: customer, total: '15.00', dueDate: today, number: 'FS26-0504',
    });
    const content = [
      n43AccountHeader('0000000034', today, today),
      n43Movement({ bookingDate: today, amount: '15.00', document: 'SIN-NUMERO', concept: 'Ingreso' }),
      n43Movement({ bookingDate: today, amount: '-4.00', document: 'COMISION', concept: 'Comision' }),
    ].join('\n');
    const imported = await write('finance_bank_statement_import', {
      bank_account_id: String(account.committed.id), format: 'n43', filename: 'extracto.n43', content,
    });
    const statementId = String(imported.committed.id);
    const statements = await tool('finance_bank_statements_list', { entity: 'PO' });
    expect(JSON.stringify(statements.data)).toContain(statementId);

    const suggestions = await tool('finance_bank_statement_suggestions_list', { id: statementId });
    const lines = suggestions.data.lines as { id: string; amount: string; status: string }[];
    const income = lines.find((line) => line.amount === '15.00');
    const fee = lines.find((line) => line.amount === '-4.00') ?? lines.find((line) => line.amount.includes('4.00'));
    expect(income).toBeTruthy();
    expect(fee).toBeTruthy();

    const confirmed = await write('finance_bank_statement_line_confirm', {
      id: statementId, line_id: String(income?.id), allocations: [{ target_table: 'billing.invoice', target_id: invoice.id }],
    });
    expect(JSON.stringify(confirmed.committed)).toContain('bank_import');
    const ignored = await write('finance_bank_statement_line_ignore', { id: statementId, line_id: String(fee?.id), reason: 'Comisión del banco' });
    expect(ignored.committed).toBeTruthy();

    const camt = camtStatement(camtEntry({ amount: '8.00', bookingDate: today, reference: 'REF-MCP-08' }), today, today);
    const second = await write('finance_bank_statement_import', {
      bank_account_id: String(account.committed.id), format: 'camt053', content_base64: Buffer.from(camt).toString('base64'),
    });
    expect(second.committed.inserted).toBe(1);
  });

  test('tarifas y liquidaciones intercompañía', async () => {
    const tariffs = await tool('finance_intercompany_tariffs_list', {});
    expect(tariffs.error ? JSON.stringify(tariffs.data) : 'ok').toBe('ok');
    const month = todayMadrid().slice(0, 7);
    const settlements = await tool('finance_intercompany_settlements_list', { period: month });
    expect(settlements.error ? JSON.stringify(settlements.data) : 'ok').toBe('ok');
    const fx = await buildSalesFixture(t);
    const created = await write('finance_intercompany_tariff_create', {
      base_price_list_id: fx.priceList, discount_pct: '60', valid_from: '2030-01-01', advisor_validation: 'VAL-SINTETICA-01',
    });
    const tariffId = String(created.committed.id);
    expect(created.committed.status).toBe('draft');
    const edited = await write('finance_intercompany_tariff_update', { id: tariffId, changes: { discount_pct: '55' } });
    expect(String(edited.committed.discount_pct)).toContain('55');
    const got = await tool('finance_intercompany_tariff_get', { id: tariffId });
    expect(got.data.status).toBe('draft');
    const all = await tool('finance_intercompany_settlements_list', {});
    expect(all.error).toBe(false);
  });
});

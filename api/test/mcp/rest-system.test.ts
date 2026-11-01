import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

const SUPPLIER_TAX = 'B11111119';
const CVPO_TAX = 'B00000000';
const ADMIN = 'admin@winecore.test';

function facturae(number: string, base: string, quota: string, total: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Facturae>
  <Parties>
    <SellerParty>
      <TaxIdentification><TaxIdentificationNumber>${SUPPLIER_TAX}</TaxIdentificationNumber></TaxIdentification>
      <LegalEntity><CorporateName>Suministros Sintéticos SL</CorporateName></LegalEntity>
    </SellerParty>
    <BuyerParty>
      <TaxIdentification><TaxIdentificationNumber>${CVPO_TAX}</TaxIdentificationNumber></TaxIdentification>
    </BuyerParty>
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader><InvoiceNumber>${number}</InvoiceNumber></InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>2027-02-03</IssueDate>
        <InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>
      </InvoiceIssueData>
      <TaxesOutputs>
        <Tax>
          <TaxRate>21.00</TaxRate>
          <TaxableBase><TotalAmount>${base}</TotalAmount></TaxableBase>
          <TaxAmount><TotalAmount>${quota}</TotalAmount></TaxAmount>
        </Tax>
      </TaxesOutputs>
      <InvoiceTotals>
        <TotalGrossAmountBeforeTaxes>${base}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${quota}</TotalTaxOutputs>
        <TotalTaxesWithheld>0.00</TotalTaxesWithheld>
        <InvoiceTotal>${total}</InvoiceTotal>
      </InvoiceTotals>
      <Items>
        <InvoiceLine>
          <ItemDescription>Metabisulfito de potasio</ItemDescription>
          <Quantity>1.000</Quantity>
          <UnitPriceWithoutTax>${base}</UnitPriceWithoutTax>
          <GrossAmount>${base}</GrossAmount>
          <TaxesOutputs>
            <Tax>
              <TaxRate>21.00</TaxRate>
              <TaxAmount><TotalAmount>${quota}</TotalAmount></TaxAmount>
            </Tax>
          </TaxesOutputs>
        </InvoiceLine>
      </Items>
    </Invoice>
  </Invoices>
</Facturae>`;
}

async function rest(app: TestApp['app'], method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
  const text = await response.text();
  return { status: response.status, json: (text.trim() === '' ? null : JSON.parse(text)) as Data };
}

async function tool(app: TestApp['app'], name: string, args: unknown): Promise<{ error: boolean; data: Data }> {
  const response = await app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = await response.json() as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const block = body.result?.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Data : {};
  return { error: body.result?.isError === true, data };
}

/** Prepares, checks the preview and confirms, as the person would say yes. */
async function confirmed(app: TestApp['app'], name: string, args: unknown): Promise<{ prepared: Data; result: Data }> {
  const prepared = await tool(app, `${name}_prepare`, args);
  expect(prepared.error ? JSON.stringify(prepared.data) : 'ok').toBe('ok');
  const committed = await tool(app, `${name}_commit`, { confirmation_token: prepared.data.confirmation_token });
  expect(committed.error ? JSON.stringify(committed.data) : 'ok').toBe('ok');
  return { prepared: prepared.data, result: committed.data };
}

async function newSupplier(app: TestApp['app']): Promise<string> {
  const created = await rest(app, 'POST', '/v1/contacts', {
    headers: { 'idempotency-key': `test-${crypto.randomUUID()}` },
    body: {
      kind: 'company',
      legal_name: 'Suministros Sintéticos SL',
      tax_id: SUPPLIER_TAX,
      country_code: 'ES',
      language: 'es',
      is_customer: false,
      is_supplier: true,
      is_carrier: false,
      is_logistics_operator: false,
      vat_regime: 'general',
      payment_terms_days: 30,
    },
  });
  expect(created.status).toBe(201);
  return String(created.json.id);
}

/** An admin (who cannot approve expenses) captures, validates and asks for approval in the app. */
async function pendingExpenseApproval(app: TestApp['app'], number: string): Promise<{ expenseId: string; requestId: string }> {
  const form = new FormData();
  form.set('file', new File([facturae(number, '20.00', '4.20', '24.20')], 'factura.xml', { type: 'application/xml' }));
  const captured = await app.handle(new Request('http://localhost/v1/supplier-invoices/capture', {
    method: 'POST',
    headers: { 'idempotency-key': `test-${crypto.randomUUID()}`, 'x-dev-user': ADMIN },
    body: form,
  }));
  expect(captured.status).toBe(201);
  const expense = await captured.json() as Data;
  const validated = await rest(app, 'POST', `/v1/supplier-invoices/${String(expense.id)}/validate`, {
    headers: { 'if-match': String(expense.updated_at), 'x-dev-user': ADMIN },
  });
  expect(validated.json.status).toBe('validated');
  const asked = await rest(app, 'POST', `/v1/supplier-invoices/${String(expense.id)}/request-approval`, {
    headers: { 'if-match': String(validated.json.updated_at), 'x-dev-user': ADMIN },
  });
  expect(asked.json.approval_status).toBe('pending');
  return { expenseId: String(expense.id), requestId: String(asked.json.approval_request_id) };
}

describe('MCP: gastos, aprobaciones, panel e informes', () => {
  test('captura, corrige, valida y aprueba un gasto con prepare/commit, y lo encuentra en listas, libro, informe y adjuntos', async () => {
    const t = await createTestApp();
    try {
      await newSupplier(t.app);
      const xml = facturae('F-MCP-2027-01', '48.00', '10.08', '58.08');

      const upload = await confirmed(t.app, 'purchasing_expense_upload', {
        file_base64: Buffer.from(xml, 'utf8').toString('base64'),
        filename: 'factura-proveedor.xml',
        content_type: 'application/xml',
        entity: 'CVPO',
      });
      expect((upload.prepared.preview as { changes: Data }).changes).toEqual({ entity: 'CVPO', filename: 'factura-proveedor.xml' });
      const expenseId = String(upload.result.id);
      expect(upload.result.status).toBe('captured');
      expect(upload.result.legal_entity_code).toBe('CVPO');
      expect((upload.result.links as { web: string }).web.endsWith(`/gastos/${expenseId}`)).toBe(true);

      const categories = await tool(t.app, 'purchasing_expense_categories_list', {});
      expect((categories.data.items as { code: string }[]).map((item) => item.code)).toContain('oenological');

      const update = await confirmed(t.app, 'purchasing_expense_update', {
        id: expenseId,
        changes: { notes: 'Pedido de vendimia', category_code: 'oenological' },
      });
      expect(String(update.prepared.summary_es)).toContain('Corregir la factura F-MCP-2027-01 de Suministros Sintéticos SL por 58.08 €: categoría, notas.');
      expect(update.result.notes).toBe('Pedido de vendimia');

      const validate = await confirmed(t.app, 'purchasing_expense_validate', { id: expenseId });
      expect(String(validate.prepared.summary_es)).toContain('Validar la factura F-MCP-2027-01');
      expect(validate.result.status).toBe('validated');

      const approve = await confirmed(t.app, 'purchasing_expense_approve', { id: expenseId });
      expect(String(approve.prepared.summary_es)).toContain('Aprobar la factura F-MCP-2027-01');
      expect(approve.result.status).toBe('approved');

      const audit = await t.writer.read<{ request_id: string; actor_type: string }>(sql`
        SELECT request_id, actor_type FROM audit.audit_log
        WHERE table_name = 'purchasing.supplier_invoice' AND row_id = ${expenseId} AND action = 'UPDATE'
      `);
      expect(audit.length).toBeGreaterThanOrEqual(3);
      expect(audit.every((row) => row.request_id.startsWith('mcp.') && row.actor_type === 'user')).toBe(true);

      const frozen = await tool(t.app, 'purchasing_expense_reject_prepare', { id: expenseId, reason: 'No es nuestra' });
      expect(frozen.error).toBe(false);
      const refused = await tool(t.app, 'purchasing_expense_reject_commit', { confirmation_token: frozen.data.confirmation_token });
      expect(refused.error).toBe(true);
      expect(refused.data.code).toBe('WC090');

      const list = await tool(t.app, 'purchasing_expenses_list', { status: 'approved', entity: 'CVPO', q: 'F-MCP' });
      expect((list.data.items as { id: string }[]).map((item) => item.id)).toEqual([expenseId]);

      const book = await tool(t.app, 'purchasing_expenses_export_csv', { entity: 'CVPO', period: '2027-T1' });
      expect(book.error).toBe(false);
      expect(String(book.data.text)).toContain('F-MCP-2027-01');

      const report = await tool(t.app, 'reports_expenses_get', { from: '2027-01-01', to: '2027-12-31', group_by: 'category', entity: 'CVPO' });
      expect(report.error).toBe(false);
      expect(report.data.report).toBe('expenses');
      expect(Number((report.data.totals as { base: string }).base)).toBe(48);
      const reportCsv = await tool(t.app, 'reports_expenses_export_csv', { from: '2027-01-01', to: '2027-12-31' });
      expect(reportCsv.data.content_type).toBe('text/csv');

      const scans = await tool(t.app, 'system_attachments_list', { table: 'purchasing.supplier_invoice', row_id: expenseId });
      expect(scans.error).toBe(false);
      const scan = (scans.data.items as { id: string; role: string }[])[0];
      expect(scan?.role).toBe('supplier_invoice_scan');
      expect(upload.result.attachment_id).toBe(scan?.id);
      const file = await tool(t.app, 'system_attachment_download', { id: scan?.id });
      expect(file.error).toBe(false);
      expect(Buffer.from(String(file.data.base64), 'base64').toString('utf8')).toBe(xml);
    } finally {
      await t.close();
    }
  });

  test('aprueba y rechaza solicitudes de la bandeja; con passkey obligatoria, la API lo rechaza', async () => {
    const t = await createTestApp();
    try {
      await newSupplier(t.app);
      const first = await pendingExpenseApproval(t.app, 'F-APR-MCP-01');
      const second = await pendingExpenseApproval(t.app, 'F-APR-MCP-02');

      const inbox = await tool(t.app, 'approvals_requests_list', { kind: 'purchase_invoice_approval' });
      expect(inbox.error).toBe(false);
      const pending = inbox.data.items as { id: string; can_decide: boolean }[];
      expect(pending.map((item) => item.id).sort()).toEqual([first.requestId, second.requestId].sort());
      expect(pending.every((item) => item.can_decide)).toBe(true);

      const detail = await tool(t.app, 'approvals_request_get', { id: first.requestId });
      expect(detail.data.title).toBe('Factura de proveedor');
      expect((detail.data.links as { web: string }).web.endsWith(`/aprobaciones/${first.requestId}`)).toBe(true);

      const approve = await confirmed(t.app, 'approvals_request_approve', { id: first.requestId, note: 'Conforme' });
      expect(String(approve.prepared.summary_es)).toContain('Aprobar la solicitud «Factura de proveedor: Aprobar factura de proveedor F-APR-MCP-01» (CVPO)');
      const sent = (approve.prepared.preview as { changes: Data }).changes;
      expect(sent).toEqual({ decision: 'approve', payload_sha256: detail.data.payload_sha256, note: 'Conforme' });
      expect(approve.result.status).toBe('consumed');
      const approvedExpense = await rest(t.app, 'GET', `/v1/supplier-invoices/${first.expenseId}`);
      expect(approvedExpense.json.status).toBe('approved');

      const tooShort = await tool(t.app, 'approvals_request_reject_prepare', { id: second.requestId, reason: 'No' });
      expect(tooShort.error).toBe(true);

      const reject = await confirmed(t.app, 'approvals_request_reject', { id: second.requestId, reason: 'El importe no coincide con el pedido' });
      expect(String(reject.prepared.summary_es)).toContain('con el motivo «El importe no coincide con el pedido»');
      expect(reject.result.status).toBe('rejected');
      const stillValidated = await rest(t.app, 'GET', `/v1/supplier-invoices/${second.expenseId}`);
      expect(stillValidated.json.status).toBe('validated');

      const twice = await tool(t.app, 'approvals_request_approve_prepare', { id: first.requestId });
      expect(String(twice.data.summary_es)).toContain('Ojo: La aprobación no está pendiente');
      const again = await tool(t.app, 'approvals_request_approve_commit', { confirmation_token: twice.data.confirmation_token });
      expect(again.error).toBe(true);
      expect(again.data.code).toBe('WC042');

      const settings = await tool(t.app, 'approvals_settings_get', {});
      expect(settings.data.require_step_up).toBe(false);
      const policies = await tool(t.app, 'approvals_policies_list', {});
      expect((policies.data.items as { kind: string }[]).some((item) => item.kind === 'purchase_invoice_approval')).toBe(true);

      const strict = await rest(t.app, 'PUT', '/v1/approval-settings', { body: { require_step_up: true } });
      expect(strict.status).toBe(200);
      const third = await pendingExpenseApproval(t.app, 'F-APR-MCP-03');
      const guarded = await tool(t.app, 'approvals_request_approve_prepare', { id: third.requestId });
      expect(guarded.error).toBe(false);
      const blocked = await tool(t.app, 'approvals_request_approve_commit', { confirmation_token: guarded.data.confirmation_token });
      expect(blocked.error).toBe(true);
      expect(blocked.data.code).toBe('WC_STEP_UP_REQUIRED');
      const untouched = await rest(t.app, 'GET', `/v1/supplier-invoices/${third.expenseId}`);
      expect(untouched.json.status).toBe('validated');
    } finally {
      await t.close();
    }
  });

  test('panel, perfil, personas, avisos, auditoría y puesta en marcha', async () => {
    const t = await createTestApp();
    try {
      const panel = await tool(t.app, 'dashboard_panel_get', {});
      expect(panel.error).toBe(false);
      expect(panel.data.entity).toBe('both');
      expect(panel.data).toHaveProperty('approvals_pending');
      expect(new URL((panel.data.links as { web: string }).web).pathname).toBe('/');

      const sales = await tool(t.app, 'reports_sales_get', { from: '2026-01-01', to: '2026-12-31', compare: 'previous_year' });
      expect(sales.error).toBe(false);
      expect(sales.data.report).toBe('sales');
      const badRange = await tool(t.app, 'reports_stock_get', { from: '2026-12-31', to: '2026-01-01' });
      expect(badRange.error).toBe(true);
      expect(badRange.data.code).toBe('WC_VALIDATION');

      const me = await tool(t.app, 'system_me_get', {});
      expect(me.data.email).toBe('owner@winecore.test');
      expect(me.data.permissions as string[]).toContain('purchasing.approve');

      const users = await tool(t.app, 'system_users_list', {});
      expect((users.data.items as { email: string }[]).map((item) => item.email)).toContain('owner@winecore.test');

      const ownerId = String(me.data.id);
      await t.writer.withWrite({ type: 'system', id: 'test', requestId: 'test-avisos' }, async (tx) => {
        tx.write(sql`
          INSERT INTO core.notification (user_id, kind, title, body, link)
          VALUES (CAST(${ownerId} AS UUID), 'test', 'Aviso sintético', 'Cuerpo sintético', '/gastos')
        `);
        tx.write(sql`
          INSERT INTO core.notification (user_id, kind, title, body, link)
          VALUES (CAST(${ownerId} AS UUID), 'test', 'Otro aviso sintético', 'Cuerpo sintético', '/')
        `);
      });
      const unread = await tool(t.app, 'system_notifications_list', { unread: true });
      const notices = unread.data.items as { id: string }[];
      expect(notices.length).toBe(2);
      const one = await confirmed(t.app, 'system_notification_mark_read', { id: notices[0]?.id });
      expect(one.result.read_at).not.toBeNull();
      const all = await confirmed(t.app, 'system_notifications_mark_all_read', {});
      expect(all.result.updated).toBe(1);
      const none = await tool(t.app, 'system_notifications_list', { unread: true });
      expect(none.data.items).toEqual([]);

      const history = await tool(t.app, 'system_audit_list', { table: 'mcp.call', limit: 100 });
      expect(history.error).toBe(false);
      const calls = (history.data.items as { changes: { field: string; after: unknown }[] }[])
        .map((item) => item.changes.find((change) => change.field === 'tool')?.after);
      expect(calls).toContain('system_notifications_mark_all_read_commit');
      const chain = await tool(t.app, 'system_audit_verify', {});
      expect(chain.error).toBe(false);
      expect(chain.data.intact).toBe(true);

      const readiness = await tool(t.app, 'system_setup_readiness_get', {});
      expect(readiness.error).toBe(false);
      expect(Array.isArray(readiness.data.modules)).toBe(true);
    } finally {
      await t.close();
    }
  });
});

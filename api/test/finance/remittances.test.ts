import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '../../src/core/db/sql';
import { addCalendarDays, todayMadrid } from '../../src/core/finance/support';
import { bindFinance } from '../../src/core/finance/runtime';
import { bodyOf, financeApp, insertContact, insertInvoice, insertSupplierInvoice, world } from './fixture';
import { spanishIban } from './iban';

function xsd(kind: string, xml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sepa-'));
  const file = join(dir, 'file.xml');
  writeFileSync(file, xml);
  const result = spawnSync('xmllint', ['--noout', '--schema', join(import.meta.dir, '../fixtures/xsd', `${kind}.xsd`), file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

async function post(ctx: Awaited<ReturnType<typeof financeApp>>, path: string, key: string, body: unknown, user?: string) {
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(user ? { 'X-Dev-User': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe('remesas SEPA', () => {
  it('genera pain.008 tras la aprobación y deja el hash del fichero en la auditoría', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const when = addCalendarDays(today, 4);
      const ids = await world(ctx.writer);
      const iban = spanishIban('0099', '0001', '0000000011');
      const debtor = spanishIban('0099', '0001', '0000000012');
      const account = await bodyOf(await post(ctx, '/v1/bank-accounts', 'cuenta-adeudo-01', {
        legal_entity_id: ids.po.id, bank_name: 'Banco Ejemplo', iban, bic: 'TESTESMMXXX', is_default: true,
      }));
      const customer = await insertContact(ctx.writer, ids.ownerId, {
        name: 'Cliente Mandato SL', customer: true, iban: debtor, mandateRef: 'MANDATO-0001', mandateDate: '2025-04-15',
      });
      const without = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Sin Mandato SL', customer: true, iban: debtor });
      const invoice = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '121.00', dueDate: today, number: 'FS26-0001',
      });
      const blocked = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: without, total: '10.00', dueDate: today, number: 'FS26-0010',
      });
      const missing = await post(ctx, '/v1/remittances', 'remesa-sin-mandato', {
        legal_entity_id: ids.po.id, kind: 'direct_debit', bank_account_id: account.id, execution_date: when,
        items: [{ target_table: 'billing.invoice', target_id: blocked.id }],
      });
      expect(missing.status).toBe(422);
      expect((await bodyOf(missing)).code).toBe('WC_FIN_MANDATE');

      const admin = await post(ctx, '/v1/remittances', 'remesa-admin-0001', {
        legal_entity_id: ids.po.id, kind: 'direct_debit', bank_account_id: account.id, execution_date: when,
        items: [{ target_table: 'billing.invoice', target_id: invoice.id }],
      }, 'admin@winecore.test');
      expect(admin.status).toBe(403);

      const created = await post(ctx, '/v1/remittances', 'remesa-adeudo-001', {
        legal_entity_id: ids.po.id, kind: 'direct_debit', bank_account_id: account.id, execution_date: when,
        items: [{ target_table: 'billing.invoice', target_id: invoice.id }],
      });
      expect(created.status).toBe(201);
      const remittance = await bodyOf(created);
      expect(remittance.status).toBe('draft');
      expect(remittance.total).toBe('121.00');
      expect(JSON.stringify(remittance)).not.toContain(debtor);

      const early = await post(ctx, `/v1/remittances/${String(remittance.id)}/generate`, 'remesa-generar-00', {});
      expect(early.status).toBe(409);
      expect((await bodyOf(early)).code).toBe('WC_FIN_STATE');

      const requested = await post(ctx, `/v1/remittances/${String(remittance.id)}/request-approval`, 'remesa-aprobar-01', {});
      expect(requested.status).toBe(200);
      const pending = await bodyOf(requested);
      expect(pending.status).toBe('pending_approval');
      const contentSha = String(pending.content_sha256);

      const denied = await post(ctx, `/v1/remittances/${String(remittance.id)}/generate`, 'remesa-generar-01', {});
      expect(denied.status).toBe(409);
      expect((await bodyOf(denied)).code).toBe('WC_FIN_APPROVAL_REQUIRED');

      bindFinance(ctx.writer, {
        approval: { decide: (input) => ({ approved: input.contentSha256 === contentSha }) },
      });
      const generated = await post(ctx, `/v1/remittances/${String(remittance.id)}/generate`, 'remesa-generar-02', {});
      expect(generated.status).toBe(200);
      const file = await bodyOf(generated);
      expect(file.status).toBe('file_generated');
      expect(String(file.file_sha256)).toMatch(/^[0-9a-f]{64}$/);

      const download = await ctx.app.handle(new Request(`http://localhost/v1/remittances/${String(remittance.id)}/file`));
      expect(download.status).toBe(200);
      const xml = await download.text();
      expect(xml).toContain('pain.008.001.02');
      expect(xml).toContain('MANDATO-0001');
      expect(xml).toContain(debtor);
      xsd('pain.008.001.02', xml);
      expect(createHash('sha256').update(Buffer.from(xml)).digest('hex')).toBe(String(file.file_sha256));

      const audit = await ctx.writer.read<{ after_data: { file_sha256?: string } }>(sql`
        SELECT after_data FROM audit.audit_log
        WHERE table_name = 'finance.remittance' AND row_id = ${String(remittance.id)}
        ORDER BY id DESC
      `);
      expect(audit.some((row) => row.after_data?.file_sha256 === file.file_sha256)).toBe(true);

      const submitted = await post(ctx, `/v1/remittances/${String(remittance.id)}/submitted`, 'remesa-enviada-01', {});
      expect(submitted.status).toBe(200);
      expect((await bodyOf(submitted)).status).toBe('uploaded_by_user');
    } finally {
      await ctx.close();
    }
  });

  it('genera pain.001 de transferencia a proveedor', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const when = addCalendarDays(today, 2);
      const ids = await world(ctx.writer);
      const ours = spanishIban('0099', '0001', '0000000021');
      const theirs = spanishIban('0099', '0001', '0000000022');
      const account = await bodyOf(await post(ctx, '/v1/bank-accounts', 'cuenta-transfer-1', {
        legal_entity_id: ids.po.id, bank_name: 'Banco Ejemplo', iban: ours, bic: 'TESTESMMXXX',
      }));
      const supplier = await insertContact(ctx.writer, ids.ownerId, {
        name: 'Proveedor Ejemplo SL', supplier: true, iban: theirs,
      });
      const bill = await insertSupplierInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, supplierId: supplier, total: '80.50', dueDate: today, number: 'PR-1001',
      });
      const created = await bodyOf(await post(ctx, '/v1/remittances', 'remesa-transfer-1', {
        kind: 'credit_transfer', legal_entity_id: ids.po.id, bank_account_id: account.id, execution_date: when,
        items: [{ target_table: 'purchasing.supplier_invoice', target_id: bill }],
      }));
      await post(ctx, `/v1/remittances/${String(created.id)}/request-approval`, 'remesa-tr-aprobar', {});
      bindFinance(ctx.writer, { approval: { decide: () => ({ approved: true }) } });
      const generated = await post(ctx, `/v1/remittances/${String(created.id)}/generate`, 'remesa-tr-fichero', {});
      expect(generated.status).toBe(200);
      const xml = await (await ctx.app.handle(new Request(`http://localhost/v1/remittances/${String(created.id)}/file`))).text();
      expect(xml).toContain('pain.001.001.03');
      expect(xml).toContain('PR-1001');
      xsd('pain.001.001.03', xml);
    } finally {
      await ctx.close();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { todayMadrid } from '../../src/core/finance/support';
import { bodyOf, financeApp, insertContact, insertInvoice, world } from './fixture';
import { spanishIban } from './iban';
import { camtEntry, camtStatement, n43AccountHeader, n43Movement } from './files';

async function account(ctx: Awaited<ReturnType<typeof financeApp>>, entityId: string, iban: string) {
  const response = await ctx.app.handle(new Request('http://localhost/v1/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cuenta-${iban.slice(-4)}-01` },
    body: JSON.stringify({
      legal_entity_id: entityId,
      bank_name: 'Banco Ejemplo',
      iban,
      bic: 'TESTESMMXXX',
      is_default: true,
    }),
  }));
  expect(response.status).toBe(201);
  return bodyOf(response);
}

async function upload(
  ctx: Awaited<ReturnType<typeof financeApp>>,
  key: string,
  bankAccountId: string,
  format: 'n43' | 'camt053',
  content: string,
) {
  return ctx.app.handle(new Request('http://localhost/v1/bank-statements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ bank_account_id: bankAccountId, format, filename: `extracto.${format}`, content }),
  }));
}

describe('extractos', () => {
  it('deduplica líneas entre ficheros, sugiere y confirma el cobro', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const iban = spanishIban('0099', '0001', '0000000001');
      const bank = await account(ctx, ids.po.id, iban);
      expect(bank.iban_last4).toBe('0001');
      expect(String(bank.iban ?? '')).not.toMatch(/\bES\d{22}\b/);
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Ejemplo SL', customer: true });
      const exact = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '121.00', dueDate: today, number: 'FS26-0001',
      });
      const partial = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '80.00', dueDate: today, number: 'FS26-0080',
      });
      const onlyAmount = await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '15.00', dueDate: today, number: 'FS26-0015',
      });
      const shared = n43Movement({
        bookingDate: today, amount: '121.00', document: exact.number, concept: `Factura ${exact.number}`,
      });
      const hinted = n43Movement({
        bookingDate: today, amount: '40.00', document: partial.number, concept: `Factura ${partial.number}`,
      });
      const amountOnly = n43Movement({ bookingDate: today, amount: '15.00', document: 'SIN-NUMERO', concept: 'Ingreso' });
      const header = n43AccountHeader('0000000001', today, today);
      const first = await upload(ctx, 'extracto-norma-01', String(bank.id), 'n43', [header, shared, hinted, amountOnly].join('\n'));
      expect(first.status).toBe(201);
      const imported = await bodyOf(first);
      expect(imported.inserted).toBe(3);
      expect(imported.matched).toBe(1);
      const lines = imported.lines as Array<{ status: string; amount: string; suggestions: Array<{ score: string; document_number: string }> }>;
      expect(lines.find((line) => line.amount === '121.00')?.status).toBe('matched');
      const suggested = lines.find((line) => line.amount === '40.00');
      expect(suggested?.status).toBe('suggested');
      expect(suggested?.suggestions[0]).toMatchObject({ document_number: partial.number, score: '0.50' });
      const loose = lines.find((line) => line.amount === '15.00');
      expect(loose?.suggestions[0]?.score).toBe('0.35');

      const repeated = await upload(ctx, 'extracto-norma-01b', String(bank.id), 'n43', [header, shared, hinted, amountOnly].join('\n'));
      expect(repeated.status).toBe(409);
      expect((await bodyOf(repeated)).code).toBe('WC_FIN_DUPLICATE_FILE');

      const extra = n43Movement({ bookingDate: today, amount: '9.00', document: 'OTRO-0009', concept: 'Otro' });
      const second = await upload(ctx, 'extracto-norma-02', String(bank.id), 'n43', [header, shared, extra].join('\n'));
      expect(second.status).toBe(201);
      const overlap = await bodyOf(second);
      expect(overlap.duplicates).toBe(1);
      expect(overlap.inserted).toBe(1);

      const suggestions = await bodyOf(await ctx.app.handle(new Request(`http://localhost/v1/bank-statements/${String(imported.id)}/suggestions`)));
      const open = (suggestions.lines as Array<{ id: string; amount: string; status: string }>).find((line) => line.amount === '15.00');
      expect(open?.status).toBe('suggested');
      const confirmed = await ctx.app.handle(new Request(`http://localhost/v1/bank-statements/${String(imported.id)}/lines/${String(open?.id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'confirmar-linea-1' },
        body: JSON.stringify({ target_table: 'billing.invoice', target_id: onlyAmount.id }),
      }));
      expect(confirmed.status).toBe(201);
      const payment = (await bodyOf(confirmed)).payment as { source: string; allocations: Array<{ target_id: string; payment_status: string }> };
      expect(payment.source).toBe('bank_import');
      expect(payment.allocations[0]).toMatchObject({ target_id: onlyAmount.id, payment_status: 'paid' });
    } finally {
      await ctx.close();
    }
  });

  it('importa CAMT.053 y no repite la referencia del banco', async () => {
    const ctx = await financeApp();
    try {
      const today = todayMadrid();
      const ids = await world(ctx.writer);
      const bank = await account(ctx, ids.po.id, spanishIban('0099', '0001', '0000000008'));
      const customer = await insertContact(ctx.writer, ids.ownerId, { name: 'Cliente Camt SL', customer: true });
      await insertInvoice(ctx.writer, ids.ownerId, {
        entityId: ids.po.id, customerId: customer, total: '33.00', dueDate: today, number: 'FS26-0033',
      });
      const entry = camtEntry({
        amount: '33.00', bookingDate: today, reference: 'REF-UNICA-33', remittance: 'Factura FS26-0033',
        counterparty: 'Cliente Camt SL',
      });
      const xml = camtStatement(entry, today, today);
      const created = await upload(ctx, 'extracto-camt-001', String(bank.id), 'camt053', xml);
      expect(created.status).toBe(201);
      expect((await bodyOf(created)).matched).toBe(1);
      const other = camtStatement(`${entry}\n${camtEntry({
        amount: '4.00', bookingDate: today, reference: 'REF-NUEVA-04', remittance: 'Varios',
      })}`, today, today);
      const second = await upload(ctx, 'extracto-camt-002', String(bank.id), 'camt053', other);
      expect(second.status).toBe(201);
      const body = await bodyOf(second);
      expect(body.duplicates).toBe(1);
      expect(body.inserted).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});

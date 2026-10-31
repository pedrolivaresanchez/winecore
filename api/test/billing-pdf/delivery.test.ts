import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { knowledgeBaseInvoiceDocuments } from '../../src/core/billing/pdf/documents';
import { loadInvoiceDocument } from '../../src/core/billing/pdf/load';
import { openDeliveryOnIssue } from '../../src/core/billing/delivery/service';
import {
  billingInvoiceDeliveryMarkFailed,
  billingInvoiceDeliveryMarkSent,
  billingInvoicePdfGet,
} from '../../src/core/billing/delivery/mcp-tools';
import { runDeliveryAlertJob } from '../../src/jobs/delivery-alerts';
import { createTestApp } from '../helpers';

const CVPO = '019a0000-0000-7000-8000-000000000002';
const OWNER = '019a0000-0000-7000-8000-000000000011';
const CONTACT = '019a0000-0000-7000-8000-000000000101';
const PERSON_INVOICE = '019a0000-0000-7000-8000-000000000102';
const PERSON_OTHER = '019a0000-0000-7000-8000-000000000103';
const SERIES = '019a0000-0000-7000-8000-000000000111';
const INVOICE = '019a0000-0000-7000-8000-000000000121';
const LINE = '019a0000-0000-7000-8000-000000000122';
const TAX = '019a0000-0000-7000-8000-000000000123';
const DUE = '019a0000-0000-7000-8000-000000000124';

async function insertInvoice(client: { query: (statement: string) => Promise<unknown> }, billingEmail: boolean) {
  const snapshot = {
    legal_name: 'Cliente Congelado S.L.',
    trade_name: null,
    tax_id: 'B11111111',
    tax_id_type: 'nif',
    address: {
      line1: 'Calle Cliente 2',
      line2: null,
      postal_code: '28001',
      city: 'Madrid',
      province: 'Madrid',
      country_code: 'ES',
    },
  };
  const statements = [
    sql`
      INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, country_code, is_customer, created_by)
      VALUES (CAST(${CONTACT} AS UUID), 'company', 'Nombre Vivo S.L.', 'B11111111', 'nif', 'ES', TRUE, 'test')
    `,
    sql`
      INSERT INTO party.contact_person (id, contact_id, full_name, email, receives_invoices)
      VALUES (
        CAST(${PERSON_INVOICE} AS UUID), CAST(${CONTACT} AS UUID), 'Contabilidad',
        'facturas@example.com', ${billingEmail}
      )
    `,
    sql`
      INSERT INTO party.contact_person (id, contact_id, full_name, email, receives_invoices)
      VALUES (CAST(${PERSON_OTHER} AS UUID), CAST(${CONTACT} AS UUID), 'Otra persona', 'otra@example.com', FALSE)
    `,
    sql`
      INSERT INTO core.number_series (
        id, legal_entity_id, doc_type, code, year, prefix, padding, next_value, is_default, verifactu, is_active
      ) VALUES (
        CAST(${SERIES} AS UUID), CAST(${CVPO} AS UUID), 'invoice', 'CF', 2026, 'CF26-', 4, 2, TRUE, FALSE, TRUE
      )
    `,
    sql`
      INSERT INTO billing.invoice (
        id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id,
        customer_snapshot, currency, language, description, subtotal, tax_total, surcharge_total,
        withholding_total, total, payment_method, payment_terms_days, issued_by, issued_at, created_by
      ) VALUES (
        CAST(${INVOICE} AS UUID), CAST(${CVPO} AS UUID), CAST(${SERIES} AS UUID), 'CF26-0001', 'issued', 'F1',
        CAST('2026-03-10' AS DATE), CAST(${CONTACT} AS UUID), ${sql.json(snapshot)}, 'EUR', 'es', 'Venta de vino',
        CAST('120.00' AS DECIMAL(14,2)), CAST('25.20' AS DECIMAL(14,2)), CAST('0.00' AS DECIMAL(14,2)),
        CAST('0.00' AS DECIMAL(14,2)), CAST('145.20' AS DECIMAL(14,2)), 'transfer', 30,
        CAST(${OWNER} AS UUID), TIMESTAMPTZ '2026-03-10 08:00:00+00', 'test'
      )
    `,
    sql`
      INSERT INTO billing.invoice_line (
        id, invoice_id, line_no, description, lot_code, quantity, unit, unit_price, discount_pct, tax_code, line_base
      ) VALUES (
        CAST(${LINE} AS UUID), CAST(${INVOICE} AS UUID), 1, 'Tinto Ejemplo', 'L25-T01-B1',
        CAST('12.000' AS DECIMAL(14,3)), 'ud', CAST('10.000000' AS DECIMAL(14,6)),
        CAST('0.00' AS DECIMAL(5,2)), 'IVA21', CAST('120.00' AS DECIMAL(14,2))
      )
    `,
    sql`
      INSERT INTO billing.invoice_tax (
        id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
        surcharge_rate, surcharge_quota, withholding_rate, withholding
      )
      SELECT CAST(${TAX} AS UUID), CAST(${INVOICE} AS UUID), code, tax, regime_key, qualification, exemption,
             rate, CAST('120.00' AS DECIMAL(14,2)), CAST('25.20' AS DECIMAL(14,2)),
             surcharge_rate, CAST('0.00' AS DECIMAL(14,2)), withholding_rate, CAST('0.00' AS DECIMAL(14,2))
      FROM billing.tax_code WHERE code = 'IVA21'
    `,
    sql`
      INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
      VALUES (
        CAST(${DUE} AS UUID), CAST(${INVOICE} AS UUID), 1, CAST('2026-04-09' AS DATE), CAST('145.20' AS DECIMAL(14,2))
      )
    `,
  ];
  await client.query(statements.join(';\n'));
}

async function issue(ctx: Awaited<ReturnType<typeof createTestApp>>, now = new Date('2026-03-10T09:00:00.000Z')) {
  const found = await loadInvoiceDocument(ctx.writer, INVOICE);
  if (found.kind !== 'ready') throw new Error('la factura no está lista');
  return ctx.writer.withWrite(
    { type: 'system', id: 'issue', requestId: 'issue-1', reason: 'Emitir factura' },
    (tx) => openDeliveryOnIssue(tx, found.invoice, knowledgeBaseInvoiceDocuments(), now),
  );
}

async function bodyOf(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('entrega de facturas por CVBOT', () => {
  it('al emitir queda pendiente y publica billing.invoice.issued, sin enviar correo', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, true);
      const delivery = await issue(ctx);
      expect(delivery.status).toBe('pending');
      expect(delivery.attempt).toBe(1);
      expect(delivery.recipients).toEqual(['facturas@example.com']);
      expect(delivery.requestedBy).toBe('system');

      const again = await issue(ctx);
      expect(again.id).toBe(delivery.id);

      const events = await ctx.writer.read<{ event_type: string; payload: unknown }>(sql`
        SELECT event_type, payload FROM ops.outbox_event
        WHERE aggregate_id = CAST(${INVOICE} AS UUID)
      `);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe('billing.invoice.issued');
      const payload = typeof events[0]?.payload === 'string'
        ? JSON.parse(events[0].payload) as Record<string, unknown>
        : events[0]?.payload as Record<string, unknown>;
      expect(payload.delivery_status).toBe('pending');
      expect(payload.number).toBe('CF26-0001');
      expect(JSON.stringify(payload)).not.toContain('@');

      const lengths = await ctx.writer.read<{ n: number }>(sql`
        SELECT len(recipients) AS n FROM billing.invoice_delivery WHERE invoice_id = CAST(${INVOICE} AS UUID)
      `);
      expect(Number(lengths[0]?.n)).toBe(1);

      const pdf = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/pdf`));
      expect(pdf.status).toBe(200);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    } finally {
      await ctx.close();
    }
  });

  it('marca enviado, fallido y reenvío, y el paquete lleva el texto en español', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, true);
      await issue(ctx);

      const denied = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'asesor@winecore.test' },
        body: JSON.stringify({
          attempt: 1,
          message_id: 'outlook-1',
          sent_at: '2026-03-10T12:00:00.000Z',
          recipients: ['facturas@example.com'],
        }),
      }));
      expect(denied.status).toBe(403);

      const pack = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery`));
      expect(pack.status).toBe(200);
      const packed = await bodyOf(pack);
      expect(packed.subject_es).toBe('Factura CF26-0001 de Comercializadora (CVPO)');
      expect(String(packed.body_es)).toContain('145,20 EUR');
      expect(String(packed.body_es)).toContain('09/04/2026');
      expect(packed.to).toEqual(['facturas@example.com']);
      expect(packed.mime).toBe('application/pdf');
      expect(String(packed.base64).length).toBeGreaterThan(20);

      const sent = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt: 1,
          message_id: 'outlook-1',
          sent_at: '2026-03-10T12:00:00.000Z',
          recipients: ['facturas@example.com'],
        }),
      }));
      expect(sent.status).toBe(200);
      expect((await bodyOf(sent)).status).toBe('sent');

      const repeat = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt: 1,
          message_id: 'outlook-1',
          sent_at: '2026-03-10T12:00:00.000Z',
          recipients: ['facturas@example.com'],
        }),
      }));
      expect(repeat.status).toBe(200);
      expect((await bodyOf(repeat)).already).toBe(true);

      const clash = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt: 1,
          message_id: 'otro-mensaje',
          sent_at: '2026-03-10T12:05:00.000Z',
          recipients: ['facturas@example.com'],
        }),
      }));
      expect(clash.status).toBe(409);

      const resend = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/resend`, {
        method: 'POST',
      }));
      expect(resend.status).toBe(200);
      expect(await bodyOf(resend)).toMatchObject({ attempt: 2, status: 'pending' });

      const failed = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/delivery/failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt: 2, error: '  Outlook\nrechazó el mensaje  ' }),
      }));
      expect(failed.status).toBe(200);
      expect((await bodyOf(failed)).status).toBe('failed');

      const notes = await ctx.writer.read<{ kind: string; body: string }>(sql`
        SELECT kind, body FROM core.notification WHERE kind = 'delivery.failed'
      `);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]?.body).toContain('Outlook rechazó el mensaje');
      expect(notes[0]?.body).not.toContain('\n');
    } finally {
      await ctx.close();
    }
  });

  it('sin correo de facturación queda no_recipient y avisa', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, false);
      const delivery = await issue(ctx);
      expect(delivery.status).toBe('no_recipient');
      expect(delivery.recipients).toEqual([]);
      const notes = await ctx.writer.read<{ email: string; kind: string }>(sql`
        SELECT u.email, n.kind
        FROM core.notification n
        JOIN core.app_user u ON u.id = n.user_id
        WHERE n.kind = 'delivery.no_recipient'
      `);
      const emails = notes.map((row) => row.email).sort();
      expect(emails).toContain('owner@winecore.test');
      expect(emails).toContain('admin@winecore.test');
      expect(emails).not.toContain('asesor@winecore.test');
    } finally {
      await ctx.close();
    }
  });

  it('avisa si el envío sigue pendiente pasadas las horas configuradas', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, true);
      await issue(ctx, new Date('2026-10-01T08:00:00.000Z'));
      const result = await runDeliveryAlertJob(ctx.writer, 24, new Date('2026-10-02T10:00:00.000Z'));
      expect(result.overdue).toBe(1);
      expect(result.notifications).toBeGreaterThan(0);
      const second = await runDeliveryAlertJob(ctx.writer, 24, new Date('2026-10-02T12:00:00.000Z'));
      expect(second.notifications).toBe(0);
      const notes = await ctx.writer.read<{ kind: string }>(sql`
        SELECT kind FROM core.notification WHERE kind = 'delivery.overdue'
      `);
      expect(notes.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('el cliente de máquina marca el envío solo con billing.deliver', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, true);
      await issue(ctx);
      const blocked = {
        writer: ctx.writer,
        actorId: 'cvbot',
        actorType: 'machine' as const,
        permissions: new Set(['billing.read']),
      };
      let caught: unknown;
      try {
        await billingInvoiceDeliveryMarkSent(blocked, {
          invoice_id: INVOICE,
          attempt: 1,
          message_id: 'outlook-cvbot',
          sent_at: '2026-03-10T12:00:00.000Z',
          recipients: ['facturas@example.com'],
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('WC_FORBIDDEN');

      const allowed = { ...blocked, permissions: new Set(['billing.read', 'billing.deliver']) };
      const marked = await billingInvoiceDeliveryMarkSent(allowed, {
        invoice_id: INVOICE,
        attempt: 1,
        message_id: 'outlook-cvbot',
        sent_at: '2026-03-10T12:00:00.000Z',
        recipients: ['facturas@example.com'],
      });
      expect(marked).toEqual({ status: 'sent' });

      const pdf = await billingInvoicePdfGet(
        { writer: ctx.writer, actorId: 'cvbot', actorType: 'machine', permissions: new Set(['billing.read']) },
        { invoice_id: INVOICE },
      );
      expect(pdf.subject_es).toContain('CF26-0001');
      expect(pdf.to).toEqual(['facturas@example.com']);

      const pending = await ctx.app.handle(new Request('http://localhost/v1/invoices/deliveries/pending', {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(pending.status).toBe(403);
      const list = await ctx.app.handle(new Request('http://localhost/v1/invoices/deliveries/pending'));
      expect(list.status).toBe(200);
      expect((await bodyOf(list)).items).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('un fallo repetido no duplica el aviso', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client, true);
      await issue(ctx);
      const ctxTool = {
        writer: ctx.writer,
        actorId: 'cvbot',
        actorType: 'machine' as const,
        permissions: new Set(['billing.deliver']),
      };
      await billingInvoiceDeliveryMarkFailed(ctxTool, { invoice_id: INVOICE, attempt: 1, error: 'buzón lleno' });
      const again = await billingInvoiceDeliveryMarkFailed(ctxTool, { invoice_id: INVOICE, attempt: 1, error: 'otro' });
      expect(again).toEqual({ status: 'failed' });
      const notes = await ctx.writer.read<{ body: string }>(sql`
        SELECT body FROM core.notification WHERE kind = 'delivery.failed' AND link = ${'/facturas/' + INVOICE}
      `);
      expect(notes.length).toBe(2);
      expect(notes.every((row) => row.body.includes('buzón lleno'))).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

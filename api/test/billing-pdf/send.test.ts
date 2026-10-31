import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/app';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { deliverInvoice } from '../../src/core/billing/send/deliver';
import { closedBatchSendApproval, type BatchSendApprovalHook } from '../../src/core/billing/send/approval';
import type { MailProvider, OutboundMail } from '../../src/core/billing/send/provider';
import { loadInvoiceDocument } from '../../src/core/billing/pdf/load';
import { renderInvoicePdf } from '../../src/core/billing/pdf/render';
import { knowledgeBaseInvoiceDocuments } from '../../src/core/billing/pdf/documents';
import { createTestApp } from '../helpers';
import { extractPdfText } from './extract';

const CVPO = '019a0000-0000-7000-8000-000000000002';
const OWNER = '019a0000-0000-7000-8000-000000000011';
const CONTACT = '019a0000-0000-7000-8000-000000000101';
const PERSON_INVOICE = '019a0000-0000-7000-8000-000000000102';
const PERSON_OTHER = '019a0000-0000-7000-8000-000000000103';
const PERSON_ARCHIVED = '019a0000-0000-7000-8000-000000000104';
const SERIES = '019a0000-0000-7000-8000-000000000111';
const INVOICE = '019a0000-0000-7000-8000-000000000121';
const LINE = '019a0000-0000-7000-8000-000000000122';
const TAX = '019a0000-0000-7000-8000-000000000123';
const DUE = '019a0000-0000-7000-8000-000000000124';
const APPROVAL = '019a0000-0000-7000-8000-000000000131';

function spyMail(enabled: boolean): { mail: MailProvider; calls: OutboundMail[] } {
  const calls: OutboundMail[] = [];
  return {
    calls,
    mail: {
      enabled,
      sender: enabled ? 'facturacion@example.com' : '',
      async send(message) {
        calls.push(message);
        if (!enabled) throw new Error('el proveedor desactivado no debe enviar');
      },
    },
  };
}

async function insertInvoice(client: { query: (statement: string) => Promise<unknown> }) {
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
      VALUES (CAST(${PERSON_INVOICE} AS UUID), CAST(${CONTACT} AS UUID), 'Contabilidad', 'facturas@example.com', TRUE)
    `,
    sql`
      INSERT INTO party.contact_person (id, contact_id, full_name, email, receives_invoices)
      VALUES (CAST(${PERSON_OTHER} AS UUID), CAST(${CONTACT} AS UUID), 'Otra persona', 'otra@example.com', FALSE)
    `,
    sql`
      INSERT INTO party.contact_person (id, contact_id, full_name, email, receives_invoices, archived_at)
      VALUES (
        CAST(${PERSON_ARCHIVED} AS UUID), CAST(${CONTACT} AS UUID), 'Archivada', 'archivada@example.com', TRUE,
        TIMESTAMPTZ '2026-01-01 00:00:00+00'
      )
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

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('factura PDF y envío', () => {
  it('guarda el PDF una vez, con el cliente congelado, y lo descarga igual', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client);
      const denied = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/pdf`, {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(denied.status).toBe(403);

      const first = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/pdf`, {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('application/pdf');
      const bytes = new Uint8Array(await first.arrayBuffer());
      expect(Buffer.from(bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-');

      const loaded = await loadInvoiceDocument(ctx.writer, INVOICE);
      expect(loaded.kind).toBe('ready');
      if (loaded.kind !== 'ready') return;
      const rendered = await renderInvoicePdf(loaded.invoice, 'es');
      expect(Buffer.compare(bytes, rendered)).toBe(0);
      const text = Buffer.from(bytes).toString('latin1');
      expect(text.length).toBeGreaterThan(100);

      await ctx.client.query(sql`
        UPDATE party.contact SET legal_name = 'Nombre Vivo Distinto S.L.' WHERE id = CAST(${CONTACT} AS UUID)
      `);
      const auditsBefore = await ctx.writer.read<{ total: number }>(sql`
        SELECT count(*)::INTEGER AS total FROM audit.audit_log WHERE table_name = 'billing.invoice'
      `);
      const second = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/pdf`));
      const again = new Uint8Array(await second.arrayBuffer());
      expect(Buffer.compare(bytes, again)).toBe(0);

      const counts = await ctx.writer.read<{ attachments: number; contents: number }>(sql`
        SELECT
          (SELECT count(*)::INTEGER FROM core.attachment) AS attachments,
          (SELECT count(*)::INTEGER FROM core.attachment_content) AS contents
      `);
      expect(Number(counts[0]?.attachments)).toBe(1);
      expect(Number(counts[0]?.contents)).toBe(1);

      const auditsAfter = await ctx.writer.read<{ total: number }>(sql`
        SELECT count(*)::INTEGER AS total FROM audit.audit_log WHERE table_name = 'billing.invoice'
      `);
      expect(Number(auditsAfter[0]?.total)).toBe(Number(auditsBefore[0]?.total));
      const extracted = extractPdfText(again);
      expect(extracted).toContain('Cliente Congelado S.L.');
      expect(extracted).toContain('Venta de vino');
      expect(extracted).not.toContain('Nombre Vivo');
      expect(extracted).toContain('Importe total de la factura: 145,20 EUR');
      expect(extracted).toContain('B00000000');
      expect(extracted).toContain('CF26-0001');
    } finally {
      await ctx.close();
    }
  });

  it('no genera un PDF con leyenda Verifactu si la instalación está activa y falta el QR', async () => {
    const ctx = await createTestApp();
    try {
      await insertInvoice(ctx.client);
      await ctx.client.query(sql`
        INSERT INTO regulatory.verifactu_installation (
          id, legal_entity_id, environment, mode, system_version, installation_number,
          producer_name, producer_tax_id, starts_on, is_active
        ) VALUES (
          CAST('019a0000-0000-7000-8000-000000000141' AS UUID), CAST(${CVPO} AS UUID),
          'test', 'verifactu', '0.1.0', 'WC-TEST', 'Productor Ejemplo', 'B00000000',
          CAST('2026-01-01' AS DATE), TRUE
        )
      `);
      const response = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/pdf`));
      expect(response.status).toBe(422);
      const body = await json(response);
      expect(body.code).toBe('WC_VALIDATION');
      expect(JSON.stringify(body)).toContain('Verifactu');
    } finally {
      await ctx.close();
    }
  });

  it('no envía sin la acción explícita ni si quien llama no es una persona', async () => {
    const ctx = await createTestApp();
    const disabled = spyMail(false);
    const app = createApp({
      config: ctx.config,
      writer: ctx.writer,
      log: () => undefined,
      mailProvider: disabled.mail,
    });
    try {
      await insertInvoice(ctx.client);
      const missing = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      }));
      expect(missing.status).toBe(422);
      expect((await json(missing)).code).toBe('WC_VALIDATION');

      const fakeTrue = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'true', to: ['attacker@example.com'] }),
      }));
      expect(fakeTrue.status).toBe(422);
      expect(disabled.calls).toHaveLength(0);

      const deps = {
        documents: knowledgeBaseInvoiceDocuments(),
        mail: disabled.mail,
        approvals: closedBatchSendApproval,
        authorize: () => undefined,
        downloadPath: () => '/pdf',
      };
      for (const type of ['agent', 'system', 'migration'] as const) {
        let caught: unknown;
        try {
          await deliverInvoice(ctx.writer, { type, id: 'job', requestId: 'r1' }, {
            invoiceId: INVOICE,
            confirm: true,
            channel: 'email',
            approvalId: APPROVAL,
          }, deps);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(DomainError);
        expect((caught as DomainError).code).toBe('WC_FORBIDDEN');
      }
      expect(disabled.calls).toHaveLength(0);
      const sent = await ctx.writer.read<{ sent_at: string | null }>(sql`
        SELECT sent_at FROM billing.invoice WHERE id = CAST(${INVOICE} AS UUID)
      `);
      expect(sent[0]?.sent_at ?? null).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('sin buzón ofrece la descarga y un texto para copiar, y no marca el correo como enviado', async () => {
    const ctx = await createTestApp();
    const disabled = spyMail(false);
    const app = createApp({
      config: ctx.config,
      writer: ctx.writer,
      log: () => undefined,
      mailProvider: disabled.mail,
    });
    try {
      await insertInvoice(ctx.client);
      const advisor = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'asesor@winecore.test' },
        body: JSON.stringify({ confirm: true }),
      }));
      expect(advisor.status).toBe(403);

      const response = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, to: ['attacker@example.com'], cc: ['otra@example.com'] }),
      }));
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.delivered).toBe(false);
      expect(body.channel).toBe('manual');
      expect(body.download_path).toBe(`/v1/invoices/${INVOICE}/pdf`);
      expect(String(body.notice)).toContain('buzón');
      const email = body.email as { to: string[]; subject: string; text: string };
      expect(email.to).toEqual(['facturas@example.com']);
      expect(email.subject).toBe('Factura CF26-0001 - Comercializadora (CVPO)');
      expect(email.text).toContain('CF26-0001');
      expect(email.text).toContain('145,20 EUR');
      expect(email.text).toContain('Cliente Congelado S.L.');
      expect(email.text).not.toContain('attacker@example.com');
      expect(email.text).not.toContain('otra@example.com');
      expect(email.text).not.toContain('archivada@example.com');
      expect(disabled.calls).toHaveLength(0);

      const row = await ctx.writer.read<{ sent_at: string | null; sent_channel: string | null }>(sql`
        SELECT sent_at, sent_channel FROM billing.invoice WHERE id = CAST(${INVOICE} AS UUID)
      `);
      expect(row[0]?.sent_at ?? null).toBeNull();
      expect(row[0]?.sent_channel ?? null).toBeNull();
      const audits = await ctx.writer.read<{ action: string; actor_type: string }>(sql`
        SELECT action, actor_type FROM audit.audit_log WHERE table_name = 'billing.invoice'
      `);
      expect(audits.some((entry) => entry.action === 'EVENT' && entry.actor_type === 'user')).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('envía solo a quien recibe facturas, una vez, y la descarga no llama al correo', async () => {
    const ctx = await createTestApp();
    const enabled = spyMail(true);
    const app = createApp({
      config: ctx.config,
      writer: ctx.writer,
      log: () => undefined,
      mailProvider: enabled.mail,
    });
    try {
      await insertInvoice(ctx.client);
      const download = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, channel: 'download' }),
      }));
      expect(download.status).toBe(200);
      expect((await json(download)).channel).toBe('download');
      expect(enabled.calls).toHaveLength(0);

      const sent = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, channel: 'email', to: ['attacker@example.com'] }),
      }));
      expect(sent.status).toBe(200);
      const body = await json(sent);
      expect(body.delivered).toBe(true);
      expect(body.channel).toBe('email');
      expect(body.recipients).toEqual(['facturas@example.com']);
      expect(enabled.calls).toHaveLength(1);
      expect(enabled.calls[0]?.to).toEqual(['facturas@example.com']);
      expect(Buffer.from(enabled.calls[0]?.attachments[0]?.bytes ?? []).subarray(0, 5).toString('ascii')).toBe('%PDF-');

      const again = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, channel: 'email' }),
      }));
      expect(again.status).toBe(200);
      expect((await json(again)).already_recorded).toBe(true);
      expect(enabled.calls).toHaveLength(1);

      const events = await ctx.writer.read<{ payload: unknown }>(sql`
        SELECT payload FROM ops.outbox_event
        WHERE event_type = 'billing.invoice.sent' AND aggregate_id = CAST(${INVOICE} AS UUID)
        ORDER BY id DESC
      `);
      const payload = typeof events[0]?.payload === 'string'
        ? JSON.parse(events[0].payload) as { channel?: string; sent_by?: string }
        : events[0]?.payload as { channel?: string; sent_by?: string };
      expect(payload.channel).toBe('email');
      expect(String(payload.sent_by).toLowerCase()).toBe(OWNER);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un lote no aprobado y envía el lote cuando la aprobación de una persona lo autoriza', async () => {
    const ctx = await createTestApp();
    const enabled = spyMail(true);
    let asked = 0;
    const approvals: BatchSendApprovalHook = {
      async isApproved(input) {
        asked += 1;
        return input.approvalId === APPROVAL && input.invoiceId === INVOICE;
      },
    };
    const app = createApp({
      config: ctx.config,
      writer: ctx.writer,
      log: () => undefined,
      mailProvider: enabled.mail,
      batchSendApproval: approvals,
    });
    try {
      await insertInvoice(ctx.client);
      const denied = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, approval_id: '019a0000-0000-7000-8000-000000000199' }),
      }));
      expect(denied.status).toBe(403);
      expect(enabled.calls).toHaveLength(0);

      const approved = await app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false, channel: 'email', approval_id: APPROVAL }),
      }));
      expect(approved.status).toBe(200);
      expect((await json(approved)).delivered).toBe(true);
      expect(enabled.calls).toHaveLength(1);
      expect(asked).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('exige sesión: sin token no hay envío', async () => {
    const ctx = await createTestApp({
      env: {
        AUTH_MODE: 'timbal',
        TIMBAL_ORG_ID: 'org-1',
        TIMBAL_PROJECT_ID: 'proj-1',
      },
    });
    try {
      const response = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${INVOICE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'owner@winecore.test' },
        body: JSON.stringify({ confirm: true }),
      }));
      expect(response.status).toBe(401);
      expect((await json(response)).code).toBe('WC_UNAUTHENTICATED');
    } finally {
      await ctx.close();
    }
  });
});

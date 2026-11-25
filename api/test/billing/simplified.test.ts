import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createSeries } from '../../src/core/series';
import { simplifiedIssues } from '../../src/core/billing/simplified';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';

function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = ${code}`);
  const id = rows[0]?.id;
  if (!id) throw new Error(`sin entidad ${code}`);
  return String(id).toLowerCase();
}

async function post(ctx: Awaited<ReturnType<typeof createTestApp>>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}

describe('factura simplificada', () => {
  it('acota el importe y reserva la simplificada a CVPO', () => {
    const base = { invoiceType: 'F2', entityCode: 'CVPO', channel: null as string | null };
    expect(simplifiedIssues({ ...base, total: '400.00' })).toEqual([]);
    expect(simplifiedIssues({ ...base, total: '-400.00' })).toEqual([]);
    expect(simplifiedIssues({ ...base, total: '400.01' })[0]?.message).toContain('400');
    expect(simplifiedIssues({ ...base, channel: 'web', total: '3000.00' })).toEqual([]);
    expect(simplifiedIssues({ ...base, channel: 'cellar_shop', total: '3000.00' })).toEqual([]);
    expect(simplifiedIssues({ ...base, channel: 'cellar_sales', total: '3000.01' })[0]?.message).toContain('3.000');
    expect(simplifiedIssues({ ...base, channel: 'horeca', total: '400.01' })[0]?.field).toBe('total');
    expect(simplifiedIssues({ invoiceType: 'R5', entityCode: 'PO', channel: 'web', total: '10.00' })[0]?.field).toBe('legal_entity_id');
    expect(simplifiedIssues({ invoiceType: 'F1', entityCode: 'PO', channel: null, total: '9000.00' })).toEqual([]);
  });

  it('abre la serie CS de CVPO en 2026 y 2027 y ninguna en P.O', async () => {
    const ctx = await createTestApp();
    try {
      const rows = await ctx.writer.read<{ code: string; year: number; prefix: string }>(sql`
        SELECT e.code, s.year, s.prefix
        FROM core.number_series s
        JOIN core.legal_entity e ON e.id = s.legal_entity_id
        WHERE s.doc_type = 'simplified_invoice'
        ORDER BY e.code, s.year
      `);
      expect(rows.map((row) => `${row.code}:${row.year}:${row.prefix}`)).toEqual([
        'CVPO:2026:CS26-',
        'CVPO:2027:CS27-',
      ]);
    } finally {
      await ctx.close();
    }
  });

  it('crea, emite y exporta la venta bodega, y rechaza lo que no cabe', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      const po = await entityId(ctx, 'PO');
      const actor = { type: 'user' as const, id: '019a0000-0000-7000-8000-000000000011', requestId: 'f2' };
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, {
        legal_entity_id: cvpo,
        doc_type: 'invoice',
        code: 'CF',
        prefix: 'CF26-',
        padding: 4,
        is_default: true,
        verifactu: false,
        year: 2026,
      }));
      const person = await json(await post(ctx, '/v1/contacts', {
        kind: 'person',
        legal_name: 'Ana Sin Nif',
        country_code: 'ES',
        language: 'es',
        is_customer: true,
        is_supplier: false,
        is_carrier: false,
        is_logistics_operator: false,
        vat_regime: 'general',
        payment_terms_days: 0,
      }, { 'Idempotency-Key': newId() }));
      expect(person.kind).toBe('person');
      const company = await json(await post(ctx, '/v1/contacts', {
        kind: 'company',
        legal_name: 'Cliente Completo SL',
        tax_id: 'B12345674',
        country_code: 'ES',
        language: 'es',
        is_customer: true,
        is_supplier: false,
        is_carrier: false,
        is_logistics_operator: false,
        vat_regime: 'general',
        payment_terms_days: 30,
      }, { 'Idempotency-Key': newId() }));

      const productId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
          tx.write(sql`
            INSERT INTO catalog.product (
              id, sku, name, kind, unit, default_tax_code, requires_lot, is_stock_tracked, is_active
            ) VALUES (
              CAST(${productId} AS UUID), 'COPA-BOD', 'Copa en bodega', 'service', 'ud',
              'IVA21', FALSE, FALSE, TRUE
            )
          `);
        },
      );

      const line = (price: string) => [{ product_id: productId, quantity: '1', unit_price: price, tax_code: 'IVA21' }];

      const auto = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: person.id,
        channel: 'web',
        lines: line('10.00'),
      }));
      expect(auto.invoice_type).toBe('F2');

      const kept = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: person.id,
        channel: 'web',
        invoice_type: 'F1',
        lines: line('10.00'),
      }));
      expect(kept.invoice_type).toBe('F1');

      const companyDefault = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: company.id,
        channel: 'web',
        lines: line('10.00'),
      }));
      expect(companyDefault.invoice_type).toBe('F1');

      const over = await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: person.id,
        invoice_type: 'F2',
        lines: line('400.00'),
      });
      expect(over.status).toBe(422);
      expect((await json(over)).fields).toMatchObject({ total: expect.stringContaining('400') });

      const retail = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: person.id,
        invoice_type: 'F2',
        channel: 'cellar_shop',
        lines: line('400.00'),
      }));
      expect(retail.invoice_type).toBe('F2');
      expect(retail.total).toBe('484.00');

      const tooBig = await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        invoice_type: 'F2',
        channel: 'cellar_sales',
        lines: line('2500.00'),
      });
      expect(tooBig.status).toBe(422);

      const otherEntity = await post(ctx, '/v1/invoices', {
        legal_entity_id: po,
        customer_id: person.id,
        invoice_type: 'F2',
        channel: 'web',
        lines: line('10.00'),
      });
      expect(otherEntity.status).toBe(422);

      const patched = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${companyDefault.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(companyDefault.updated_at) },
        body: JSON.stringify({ invoice_type: 'F2', channel: 'cellar_shop' }),
      }));
      expect(patched.status).toBe(200);
      const asCellar = await json(patched);
      expect(asCellar.invoice_type).toBe('F2');
      const back = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${companyDefault.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(asCellar.updated_at) },
        body: JSON.stringify({ invoice_type: 'F1' }),
      }));
      expect((await json(back)).invoice_type).toBe('F1');

      const anonymous = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        invoice_type: 'F2',
        channel: 'cellar_sales',
        notes: 'Borrador interno. Pagado. Pendiente.',
        lines: [{ ...line('10.50')[0], lot_code: 'Sin lote' }],
      }));
      expect(anonymous.customer_id).toBeNull();
      const issued = await post(ctx, `/v1/invoices/${anonymous.id}/issue`, {}, { 'Idempotency-Key': 'emitir-venta-bodega' });
      expect(issued.status).toBe(200);
      const done = await json(issued);
      expect(String(done.number)).toMatch(/^CS26-/);
      expect(done.customer_snapshot).toMatchObject({ name: 'Consumidor final', tax_id: null, tax_id_type: 'none' });

      const pdf = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${anonymous.id}/pdf`));
      expect(pdf.status).toBe(200);
      const text = extractPdfText(new Uint8Array(await pdf.arrayBuffer()));
      expect(text).toContain('FACTURA SIMPLIFICADA');
      expect(text).toContain('Consumidor final');
      expect(text).not.toContain('Sin lote');
      expect(text).not.toContain('Borrador');
      expect(text).not.toContain('Pagado');
      expect(text).not.toContain('Pendiente');
      expect(text).toMatch(/10,50€/);

      const complete = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        customer_id: company.id,
        invoice_type: 'F1',
        lines: line('10.00'),
      }));
      const issuedComplete = await post(ctx, `/v1/invoices/${complete.id}/issue`, {}, { 'Idempotency-Key': 'emitir-completa-cvpo' });
      expect(issuedComplete.status).toBe(200);

      const book = await ctx.app.handle(new Request(
        `http://localhost/v1/invoices/export?entity=CVPO&period=2026-Q4&invoice_type=F2`,
      ));
      expect(book.status).toBe(200);
      const csv = await book.text();
      expect(csv).toContain(String(done.number));
      expect(csv).not.toContain(String((await json(issuedComplete)).number));

      const listed = await json(await ctx.app.handle(new Request(
        'http://localhost/v1/sales-documents?kind=invoice&invoice_type=F2&from=2026-10-01&to=2026-12-31',
      )));
      const numbers = (listed.items as { number: string; invoice_type: string }[]).map((item) => item.number);
      expect(numbers).toContain(String(done.number));
      expect((listed.items as { invoice_type: string }[]).every((item) => item.invoice_type === 'F2')).toBe(true);

      const rectifies = await json(await post(ctx, '/v1/invoices', {
        legal_entity_id: cvpo,
        invoice_type: 'R5',
        rectification_kind: 'I',
        reason: 'Copa de más',
        rectifies: [{ invoice_id: anonymous.id }],
        channel: 'cellar_shop',
        lines: [{ product_id: productId, quantity: '-1', unit_price: '10.50', tax_code: 'IVA21' }],
      }));
      expect(rectifies.invoice_type).toBe('R5');
      const rectifiesPo = await post(ctx, '/v1/invoices', {
        legal_entity_id: po,
        invoice_type: 'R5',
        rectification_kind: 'I',
        reason: 'No procede',
        rectifies: [{ invoice_id: anonymous.id }],
        lines: [{ product_id: productId, quantity: '-1', unit_price: '10.50', tax_code: 'IVA21' }],
      });
      expect(rectifiesPo.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });
});

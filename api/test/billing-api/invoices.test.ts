import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { businessDate } from '../../src/core/time';
import { grantBillingApproval } from '../../src/core/billing/approval';
import { reconcileBook } from '../../src/core/billing/books';
import { onInvoiceIssued, type IssuedInvoice } from '../../src/core/billing/issued';
import { injectAfterTakeNumber } from '../../src/core/billing/issue';
import { newId } from '../../src/core/ids';
import { createSeries } from '../../src/core/series';
import { createTestApp } from '../helpers';

const actor = { type: 'user' as const, id: '019a0000-0000-7000-8000-000000000011', requestId: 'billing-test' };

let cifSeed = (Date.now() % 8_000_000) + 100_000;

function companyCif(): string {
  cifSeed += 17;
  let body = String(cifSeed % 10_000_000).padStart(7, '0');
  if (body === '0000000') body = '0000001';
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    let n = body.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      n *= 2;
      sum += Math.floor(n / 10) + (n % 10);
    } else {
      sum += n;
    }
  }
  return `B${body}${String((10 - (sum % 10)) % 10)}`;
}

function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = ${code}`);
  const id = rows[0]?.id;
  if (!id) throw new Error(`sin entidad ${code}`);
  return String(id).toLowerCase();
}

async function entityTax(ctx: Awaited<ReturnType<typeof createTestApp>>, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ tax_id: string }>(sql`SELECT tax_id FROM core.legal_entity WHERE code = ${code}`);
  return String(rows[0]?.tax_id);
}

function contactBody(name: string, taxId: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'company',
    legal_name: name,
    tax_id: taxId,
    country_code: 'ES',
    language: 'es',
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    vat_regime: 'general',
    payment_terms_days: 30,
    ...extra,
  };
}

async function postContact(ctx: Awaited<ReturnType<typeof createTestApp>>, body: Record<string, unknown>) {
  const response = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newId() },
    body: JSON.stringify(body),
  }));
  expect(response.status).toBe(201);
  return json(response);
}

async function series(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  entity: string,
  docType: string,
  code: string,
  prefix: string,
  year: number,
) {
  await ctx.writer.withWrite(actor, (tx) => createSeries(tx, {
    legal_entity_id: entity,
    doc_type: docType,
    code,
    prefix,
    padding: 4,
    is_default: true,
    verifactu: false,
    year,
  }));
}

async function product(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  input: { sku: string; name: string; kind?: string; requiresLot?: boolean; tax?: string; price: string },
): Promise<string> {
  const id = newId();
  const listId = newId();
  const versionId = newId();
  await ctx.writer.withWrite(actor, async (tx) => {
    const versions = await tx.read<{ id: string }>(sql`
      SELECT v.id FROM catalog.price_list_version v
      JOIN catalog.price_list p ON p.id = v.price_list_id
      WHERE p.code = 'final' AND v.status = 'active'
      ORDER BY v.version DESC LIMIT 1
    `);
    let version = versions[0]?.id ? String(versions[0].id).toLowerCase() : null;
    if (!version) {
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        VALUES (CAST(${listId} AS UUID), 'final', 'Tarifa final', 'EUR', FALSE, TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES (CAST(${versionId} AS UUID), CAST(${listId} AS UUID), 1, DATE '2020-01-01', 'active', 'test')
      `);
      version = versionId;
    }
    tx.write(sql`
      INSERT INTO catalog.product (
        id, sku, name, kind, unit, default_tax_code, requires_lot, is_stock_tracked, is_active
      ) VALUES (
        CAST(${id} AS UUID), ${input.sku}, ${input.name}, ${input.kind ?? 'merchandise'}, 'ud',
        ${input.tax ?? 'IVA21'}, ${input.requiresLot ?? false}, ${input.kind !== 'service'}, TRUE
      )
    `);
    tx.write(sql`
      INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
      VALUES (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${id} AS UUID), 1, CAST(${input.price} AS DECIMAL(14,6)))
    `);
  });
  return id;
}

describe('facturación', () => {
  it('crea un borrador con precio de tarifa, emite, es idempotente y no se edita', async () => {
    const ctx = await createTestApp();
    try {
      const denied = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(denied.status).toBe(403);

      const po = await entityId(ctx, 'PO');
      const cvpo = await entityId(ctx, 'CVPO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      await series(ctx, cvpo, 'invoice', 'CF', `CF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Sintetico SL', companyCif()));
      const wine = await product(ctx, { sku: 'TINTO-075', name: 'Tinto Ejemplo', kind: 'wine', requiresLot: true, price: '10' });
      const service = await product(ctx, { sku: 'ALQ-LOCAL', name: 'Arrendamiento local', kind: 'service', tax: 'IVA21_ALQ', price: '1000' });

      const draft = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          lines: [{ product_id: wine, quantity: 12 }],
        }),
      }));
      expect(draft.status).toBe(201);
      const invoice = await json(draft);
      expect(invoice.number).toBeNull();
      expect(invoice.status).toBe('draft');
      expect(invoice.subtotal).toBe('120.00');
      expect(invoice.total).toBe('145.20');
      const line = (invoice.lines as { unit_price: string; tax_code: string; line_base: string }[])[0];
      expect(line?.unit_price).toBe('10.000000');
      expect(line?.tax_code).toBe('IVA21');
      expect(line?.line_base).toBe('120.00');

      const noLot = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-sin-lote' },
      }));
      expect(noLot.status).toBe(422);
      const lotError = await json(noLot);
      expect(lotError.code).toBe('WC_INV_LOT_REQUIRED');
      expect(lotError.message).toBe('Indica el lote de la línea 1');

      const patched = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(invoice.updated_at),
        },
        body: JSON.stringify({
          lines: [{ product_id: wine, quantity: 12, lot_code: 'L25-T01' }],
        }),
      }));
      expect(patched.status).toBe(200);
      const ready = await json(patched);
      expect((ready.lines as { lot_code: string }[])[0]?.lot_code).toBe('L25-T01');

      const advisor = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'asesor@winecore.test' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id }),
      }));
      expect(advisor.status).toBe(403);

      const issued = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-po-0001' },
      }));
      expect(issued.status).toBe(200);
      const done = await json(issued);
      expect(String(done.number)).toBe(`PF${yy}-0001`);
      expect(done.verifactu_record_id).toBeNull();
      expect(done.qr_url).toBeNull();
      expect((done.totals as { tax_total: string; total: string }).tax_total).toBe('25.20');
      expect((done.totals as { total: string }).total).toBe('145.20');
      expect((done.customer_snapshot as { name: string; tax_id: string }).name).toBe('Cliente Sintetico SL');
      const due = (done.dues as { due_date: string; amount: string }[])[0];
      expect(due?.amount).toBe('145.20');
      expect(due?.due_date.length).toBe(10);

      const again = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-po-0001' },
      }));
      expect(again.status).toBe(200);
      expect(await json(again)).toEqual(done);

      const renamed = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(customer.updated_at) },
        body: JSON.stringify(contactBody('Nombre Cambiado SL', String((customer as { tax_id: string }).tax_id))),
      }));
      expect(renamed.status).toBe(200);
      const frozen = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}`)));
      expect((frozen.customer_snapshot as { name: string }).name).toBe('Cliente Sintetico SL');

      const immutable = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(frozen.updated_at) },
        body: JSON.stringify({ notes: 'cambio' }),
      }));
      expect(immutable.status).toBe(409);
      expect((await json(immutable)).code).toBe('WC080');

      const rent = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: cvpo,
          customer_id: customer.id,
          lines: [{ product_id: service, quantity: 1 }],
        }),
      }));
      expect(rent.status).toBe(201);
      const rentId = String((await json(rent)).id);
      const rentIssued = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${rentId}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-alquiler-01' },
      })));
      const rentTotals = rentIssued.totals as { subtotal: string; tax_total: string; withholding_total: string; importe_total: string; total: string };
      expect(rentTotals.subtotal).toBe('1000.00');
      expect(rentTotals.tax_total).toBe('210.00');
      expect(rentTotals.withholding_total).toBe('190.00');
      expect(rentTotals.importe_total).toBe('1210.00');
      expect(rentTotals.total).toBe('1020.00');
      expect(String(rentIssued.number).startsWith(`CF${yy}-`)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('no consume número si la emisión falla y dos emisiones encoladas devuelven el mismo', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Hueco SL', companyCif()));
      const item = await product(ctx, { sku: 'CAJA-006', name: 'Caja', price: '5' });
      const created = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 2 }] }),
      })));
      injectAfterTakeNumber(() => {
        throw new Error('fallo posterior');
      });
      const failed = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${created.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-falla-0001' },
      }));
      expect(failed.status).toBe(500);
      const still = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${created.id}`)));
      expect(still.status).toBe('draft');
      expect(still.number).toBeNull();
      const counter = await ctx.writer.read<{ next_value: unknown }>(sql`
        SELECT next_value FROM core.number_series WHERE prefix = ${`PF${yy}-`}
      `);
      expect(Number(counter[0]?.next_value)).toBe(1);

      const hookOff = onInvoiceIssued(() => {
        throw new Error('stock');
      });
      const hooked = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${created.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-hook-0001' },
      }));
      hookOff();
      expect(hooked.status).toBe(500);
      expect(Number((await ctx.writer.read<{ next_value: unknown }>(sql`
        SELECT next_value FROM core.number_series WHERE prefix = ${`PF${yy}-`}
      `))[0]?.next_value)).toBe(1);

      const seen: { invoice: IssuedInvoice | null } = { invoice: null };
      const off = onInvoiceIssued((_tx, invoice) => {
        seen.invoice = invoice;
      });
      const [first, second] = await Promise.all([
        ctx.app.handle(new Request(`http://localhost/v1/invoices/${created.id}/issue`, {
          method: 'POST',
          headers: { 'Idempotency-Key': 'emitir-cola-0001' },
        })),
        ctx.app.handle(new Request(`http://localhost/v1/invoices/${created.id}/issue`, {
          method: 'POST',
          headers: { 'Idempotency-Key': 'emitir-cola-0002' },
        })),
      ]);
      off();
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const a = await json(first);
      const b = await json(second);
      expect(a.number).toBe(`PF${yy}-0001`);
      expect(b.number).toBe(a.number);
      expect(seen.invoice?.number).toBe(`PF${yy}-0001`);
      expect(seen.invoice?.incomeTax).toBe('IRPF');
      expect(Number((await ctx.writer.read<{ next_value: unknown }>(sql`
        SELECT next_value FROM core.number_series WHERE prefix = ${`PF${yy}-`}
      `))[0]?.next_value)).toBe(2);

      const other = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 1 }] }),
      })));
      const next = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${other.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-siguiente-01' },
      })));
      expect(next.number).toBe(`PF${yy}-0002`);
    } finally {
      injectAfterTakeNumber(null);
      await ctx.close();
    }
  });

  it('valida NIF, lote, VIES y el acumulado de la rectificativa', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      await series(ctx, po, 'credit_note', 'PR', `PR${yy}-`, year);
      const anon = await postContact(ctx, contactBody('Sin NIF SL', companyCif(), { tax_id: undefined }));
      const item = await product(ctx, { sku: 'BOTELLA-1', name: 'Botella', price: '10' });
      const missing = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: anon.id, lines: [{ product_id: item, quantity: 1 }] }),
      }));
      expect(missing.status).toBe(201);
      const missingId = String((await json(missing)).id);
      const nif = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${missingId}/validate`, { method: 'POST' })));
      expect((nif.errors as { message: string }[])[0]?.message).toBe('El cliente necesita NIF para una factura completa');

      const eu = await postContact(ctx, contactBody('Cliente UE', 'DE123456789', { country_code: 'DE', vat_regime: 'intra_eu' }));
      const intra = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: eu.id,
          lines: [{ product_id: item, quantity: 1, tax_code: 'INTRA_E5' }],
        }),
      })));
      const vies = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${intra.id}/validate`, { method: 'POST' })));
      expect((vies.errors as { message: string }[]).some((error) => error.message === 'Valida el NIF-IVA en VIES')).toBe(true);

      const customer = await postContact(ctx, contactBody('Cliente Rect SL', companyCif()));
      const original = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 10 }] }),
      })));
      const issued = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${original.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-original-01' },
      })));
      expect(issued.number).toBe(`PF${yy}-0001`);

      const tooMuch = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R4',
          rectification_kind: 'I',
          reason: 'Devolución de más',
          rectifies: [{ invoice_id: original.id }],
          lines: [{ product_id: item, quantity: -20 }],
        }),
      }));
      expect(tooMuch.status).toBe(201);
      const tooMuchId = String((await json(tooMuch)).id);
      const negative = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${tooMuchId}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-negativo-01' },
      }));
      expect(negative.status).toBe(422);
      expect((await json(negative)).code).toBe('WC_INV_NEGATIVE_BALANCE');

      const kinds = ['R1', 'R2', 'R3', 'R4'] as const;
      for (const [index, type] of kinds.entries()) {
        const draft = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legal_entity_id: po,
            customer_id: customer.id,
            invoice_type: type,
            rectification_kind: 'I',
            reason: `Diferencia ${type}`,
            rectifies: [{ invoice_id: original.id }],
            lines: [{ product_id: item, quantity: -1 }],
          }),
        })));
        const result = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${draft.id}/issue`, {
          method: 'POST',
          headers: { 'Idempotency-Key': `emitir-rect-${type}` },
        })));
        expect(result.number).toBe(`PR${yy}-${String(index + 1).padStart(4, '0')}`);
        expect((result.totals as { subtotal: string; tax_total: string; total: string }).subtotal).toBe('-10.00');
        expect((result.totals as { tax_total: string }).tax_total).toBe('-2.10');
        expect((result.totals as { total: string }).total).toBe('-12.10');
      }

      const substitution = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R1',
          rectification_kind: 'S',
          reason: 'Sustitución de la original',
          rectifies: [{ invoice_id: original.id }],
          lines: [{ product_id: item, quantity: 8 }],
        }),
      })));
      const replaced = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${substitution.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-sustitucion-1' },
      })));
      expect((replaced.totals as { subtotal: string }).subtotal).toBe('80.00');
      const stored = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${substitution.id}`)));
      const ref = (stored.rectifications as { base_rectified: string; quota_rectified: string; surcharge_rectified: string }[])[0];
      expect(ref?.base_rectified).toBe('100.00');
      expect(ref?.quota_rectified).toBe('21.00');
      expect(ref?.surcharge_rectified).toBe('0.00');

      const issuer = await entityTax(ctx, 'PO');
      const legacy = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R1',
          rectification_kind: 'S',
          reason: 'Factura de Holded',
          rectifies: [{ legacy: { issuer_tax_id: issuer, number: 'H-2026-0009', issue_date: '2026-02-01', base: '50.00', quota: '10.50', surcharge: '0.00' } }],
          lines: [{ product_id: item, quantity: 4 }],
        }),
      })));
      const legacyIssued = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${legacy.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-holded-0001' },
      })));
      expect(String(legacyIssued.number).startsWith(`PR${yy}-`)).toBe(true);
      const legacyView = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${legacy.id}`)));
      const legacyRef = (legacyView.rectifications as { number: string; base_rectified: string; rectified_invoice_id: string | null }[])[0];
      expect(legacyRef?.number).toBe('H-2026-0009');
      expect(legacyRef?.rectified_invoice_id).toBeNull();
      expect(legacyRef?.base_rectified).toBe('50.00');
    } finally {
      await ctx.close();
    }
  });

  it('anula con aprobación, no reutiliza el número y rechaza una factura cobrada', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Anular SL', companyCif()));
      const item = await product(ctx, { sku: 'ANULA-01', name: 'Partida', price: '20' });
      async function draft() {
        return json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 1 }] }),
        })));
      }
      const first = await draft();
      const issued = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-anular-0001' },
      })));
      expect(issued.number).toBe(`PF${yy}-0001`);
      const admin = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'admin@winecore.test' },
        body: JSON.stringify({ reason_code: 'duplicate' }),
      }));
      expect(admin.status).toBe(403);

      const pending = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: 'duplicate', reason_text: 'Expedida dos veces' }),
      }));
      expect(pending.status).toBe(202);
      const pendingBody = await json(pending);
      expect(pendingBody.status).toBe('pending');
      const untouched = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}`)));
      expect(untouched.status).toBe('issued');

      await ctx.writer.withWrite(actor, (tx) => grantBillingApproval(tx, String(pendingBody.approval_request_id)));
      const voided = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: 'duplicate', reason_text: 'Expedida dos veces' }),
      }));
      expect(voided.status).toBe(200);
      expect((await json(voided)).status).toBe('voided');
      const after = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}`)));
      expect(after.status).toBe('voided');
      expect(after.number).toBe(`PF${yy}-0001`);

      const second = await draft();
      const next = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${second.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-anular-0002' },
      })));
      expect(next.number).toBe(`PF${yy}-0002`);

      const paymentId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO finance.payment (id, legal_entity_id, direction, method, amount, value_date, source, created_by)
          VALUES (
            CAST(${paymentId} AS UUID), CAST(${po} AS UUID), 'in', 'transfer', 10.00,
            CURRENT_DATE, 'manual', 'test'
          )
        `);
        tx.write(sql`
          INSERT INTO finance.payment_allocation (id, payment_id, target_table, target_id, amount, allocated_by)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${paymentId} AS UUID), 'billing.invoice',
            CAST(${String(second.id)} AS UUID), 10.00, 'test'
          )
        `);
      });
      const blocked = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${second.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: 'wrong_customer' }),
      }));
      expect(blocked.status).toBe(409);
      expect((await json(blocked)).code).toBe('WC_INV_PAYMENTS');
    } finally {
      await ctx.close();
    }
  });

  it('emite un lote aprobado en orden de fecha y deja fuera el borrador cambiado', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const today = businessDate(new Date());
      const year = Number(today.slice(0, 4));
      const month = today.slice(5, 7);
      const day = Number(today.slice(8, 10));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Lote SL', companyCif()));
      const item = await product(ctx, { sku: 'LOTE-001', name: 'Caja lote', price: '10' });
      const ids: { id: string; issue_date: string }[] = [];
      const span = Math.min(10, day);
      for (let index = 0; index < 10; index += 1) {
        const issueDay = span === 10 ? day - 9 + index : day;
        const issueDate = `${year}-${month}-${String(issueDay).padStart(2, '0')}`;
        const draft = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legal_entity_id: po,
            customer_id: customer.id,
            issue_date: issueDate,
            lines: [{ product_id: item, quantity: index + 1 }],
          }),
        })));
        ids.push({ id: String(draft.id), issue_date: issueDate });
      }
      const requested = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices/batch-issue-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_ids: ids.map((row) => row.id) }),
      })));
      expect(requested.status).toBe('pending');
      const altered = ids[4];
      if (!altered) throw new Error('sin borrador');
      const current = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${altered.id}`)));
      const changed = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${altered.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(current.updated_at) },
        body: JSON.stringify({ lines: [{ product_id: item, quantity: 50 }] }),
      }));
      expect(changed.status).toBe(200);
      await ctx.writer.withWrite(actor, (tx) => grantBillingApproval(tx, String(requested.approval_request_id)));
      const executed = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/batch-issue/${requested.approval_request_id}/execute`, {
        method: 'POST',
      })));
      const issued = executed.issued as { id: string; number: string }[];
      const failed = executed.failed as { id: string; code: string; message: string }[];
      expect(issued).toHaveLength(9);
      expect(failed).toEqual([{ id: altered.id, code: 'WC_INV_HASH', message: 'El borrador cambió después de pedir la aprobación' }]);
      const expectedOrder = [...ids].filter((row) => row.id !== altered.id)
        .sort((left, right) => left.issue_date.localeCompare(right.issue_date) || left.id.localeCompare(right.id));
      expect(issued.map((row) => row.id)).toEqual(expectedOrder.map((row) => row.id));
      expect(issued.map((row) => row.number)).toEqual(expectedOrder.map((_, index) => `PF${yy}-${String(index + 1).padStart(4, '0')}`));
      const left = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${altered.id}`)));
      expect(left.status).toBe('draft');
    } finally {
      await ctx.close();
    }
  });

  it('cuadra el libro de emitidas con la suma de las facturas', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const today = businessDate(new Date());
      const year = Number(today.slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Libro SL', companyCif()));
      const item = await product(ctx, { sku: 'LIBRO-01', name: 'Partida libro', price: '10' });
      const rent = await product(ctx, { sku: 'LIBRO-ALQ', name: 'Alquiler libro', kind: 'service', tax: 'IVA21_ALQ', price: '100' });
      const first = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 2 }] }),
      })));
      const second = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: rent, quantity: 1 }] }),
      })));
      const a = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${first.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'libro-emitir-0001' },
      })));
      const b = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${second.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'libro-emitir-0002' },
      })));
      const csvResponse = await ctx.app.handle(new Request(`http://localhost/v1/invoices/export?entity=PO&from=${today}&to=${today}`));
      expect(csvResponse.status).toBe(200);
      const csv = (await csvResponse.text()).replace(/^\uFEFF/, '');
      expect(csv.startsWith('Ejercicio;Periodo;Fecha expedición;')).toBe(true);
      const data = csv.trim().split('\r\n').slice(1);
      expect(data).toHaveLength(2);
      const cells = data.map((line) => line.split(';'));
      const bases = cells.reduce((sum, row) => sum + Number(row[11]), 0);
      const quotas = cells.reduce((sum, row) => sum + Number(row[13]), 0);
      const totals = cells.reduce((sum, row) => sum + Number(row[18] || 0), 0);
      expect(bases.toFixed(2)).toBe('120.00');
      expect(quotas.toFixed(2)).toBe('25.20');
      expect(totals.toFixed(2)).toBe('145.20');
      expect(cells[0]?.[4]).toBe(String(a.number));
      expect(cells[1]?.[4]).toBe(String(b.number));
      expect(cells[1]?.[18]).toBe('121.00');
      expect(cells[1]?.[19]).toBe('19.00');
      expect(cells[0]?.join(';')).toBe([
        String(year),
        String(Number(today.slice(5, 7))),
        today,
        '',
        String(a.number),
        'F1',
        'issued',
        '',
        String(customer.tax_id),
        'Cliente Libro SL',
        '01',
        '20.00',
        '21.00',
        '4.20',
        '0.00',
        '0.00',
        '',
        'S1',
        '24.20',
        '0.00',
        '',
        '',
      ].join(';'));

      const failed = reconcileBook({
        invoices: [{ id: 'a', importeTotal: '24.20', verifactuRecordId: null }],
        rows: [{ invoiceId: 'a', base: '20.00', quota: '4.00', surcharge: '0.00' }],
        model303: { base: '20.00', quota: '4.00', surcharge: '0.00' },
        verifactuEnabled: false,
      });
      expect(failed[0]?.ok).toBe(false);
      expect(failed[1]?.ok).toBe(true);
      expect(failed[2]?.ok).toBe(true);
      const records = reconcileBook({
        invoices: [{ id: 'a', importeTotal: '24.20', verifactuRecordId: null }],
        rows: [{ invoiceId: 'a', base: '20.00', quota: '4.20', surcharge: '0.00' }],
        model303: { base: '20.00', quota: '4.20', surcharge: '0.00' },
        verifactuEnabled: true,
      });
      expect(records[2]?.ok).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it('trae líneas y lote desde dos albaranes y no vuelve a facturarlos', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Albaran SL', companyCif()));
      const item = await product(ctx, { sku: 'ALB-TINTO', name: 'Tinto albarán', kind: 'wine', requiresLot: true, price: '8' });
      const locationId = newId();
      const lotId = newId();
      const noteA = newId();
      const noteB = newId();
      const lineA = newId();
      const lineB = newId();
      const today = businessDate(new Date());
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
          VALUES (CAST(${locationId} AS UUID), 'BOD-TEST', 'Bodega test', 'cellar', CAST(${po} AS UUID))
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, origin)
          VALUES (CAST(${lotId} AS UUID), CAST(${po} AS UUID), 'L25-T01', 'bottled', 'legacy')
        `);
        for (const [noteId, lineId, number] of [[noteA, lineA, 'ALB-0001'], [noteB, lineB, 'ALB-0002']] as const) {
          tx.write(sql`
            INSERT INTO sales.delivery_note (
              id, legal_entity_id, number, kind, status, customer_id, issue_date, from_location_id, created_by
            ) VALUES (
              CAST(${noteId} AS UUID), CAST(${po} AS UUID), ${number}, 'sale', 'issued',
              CAST(${String(customer.id)} AS UUID), CAST(${today} AS DATE), CAST(${locationId} AS UUID), 'test'
            )
          `);
          tx.write(sql`
            INSERT INTO sales.delivery_note_line (
              id, delivery_note_id, line_no, product_id, lot_id, description, quantity, unit_price, discount_pct, tax_code
            ) VALUES (
              CAST(${lineId} AS UUID), CAST(${noteId} AS UUID), 1, CAST(${item} AS UUID), CAST(${lotId} AS UUID),
              'Tinto albarán', 3, 8, 0, 'IVA21'
            )
          `);
        }
      });
      const draft = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_delivery_notes: [noteA, noteB] }),
      })));
      const lines = draft.lines as { lot_id: string; lot_code: string; quantity: string }[];
      expect(lines).toHaveLength(2);
      expect(lines.every((line) => line.lot_id === lotId.toLowerCase() && line.lot_code === 'L25-T01')).toBe(true);
      expect(draft.customer_id).toBe(customer.id);
      const duplicate = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_delivery_notes: [noteA] }),
      }));
      expect(duplicate.status).toBe(409);
      const issued = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${draft.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-albaran-0001' },
      })));
      expect(String(issued.number).startsWith(`PF${yy}-`)).toBe(true);
      const notes = await ctx.writer.read<{ invoicing_status: string }>(sql`
        SELECT invoicing_status FROM sales.delivery_note WHERE id IN (CAST(${noteA} AS UUID), CAST(${noteB} AS UUID))
      `);
      expect(notes.map((row) => row.invoicing_status).sort()).toEqual(['invoiced', 'invoiced']);
    } finally {
      await ctx.close();
    }
  });

  it('resuelve la entidad facturadora por la regla del cliente', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, cvpo, 'invoice', 'CF', `CF${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Regla SL', companyCif()));
      const item = await product(ctx, { sku: 'REGLA-01', name: 'Generico', price: '4' });
      const setId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO billing.billing_rule_set (id, version, status, activated_at, created_by)
          VALUES (CAST(${setId} AS UUID), 1, 'active', ${new Date()}, 'test')
        `);
        tx.write(sql`
          INSERT INTO billing.billing_rule (id, rule_set_id, scope, customer_id, issuing_entity_id)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${setId} AS UUID), 'customer',
            CAST(${String(customer.id)} AS UUID), CAST(${cvpo} AS UUID)
          )
        `);
      });
      const draft = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customer.id, lines: [{ product_id: item, quantity: 1 }] }),
      })));
      expect(draft.legal_entity_id).toBe(cvpo);
      expect(draft.entity_code).toBe('CVPO');
    } finally {
      await ctx.close();
    }
  });

  it('guarda sin devolución física como dato de la rectificativa', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx, 'PO');
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await series(ctx, po, 'invoice', 'PF', `PF${yy}-`, year);
      await series(ctx, po, 'credit_note', 'PR', `PR${yy}-`, year);
      const customer = await postContact(ctx, contactBody('Cliente Devolucion SL', companyCif()));
      const item = await product(ctx, { sku: 'DEV-01', name: 'Generico', price: '10' });
      const original = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_entity_id: po, customer_id: customer.id, lines: [{ product_id: item, quantity: 2 }] }),
      })));
      expect(original.no_physical_return).toBeNull();
      const rejected = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          no_physical_return: true,
          lines: [{ product_id: item, quantity: 1 }],
        }),
      }));
      expect(rejected.status).toBe(422);

      await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices/${original.id}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'emitir-sin-devolucion' },
      })));
      const rect = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R4',
          rectification_kind: 'I',
          reason: 'Devolución sin mercancía',
          no_physical_return: true,
          rectifies: [{ invoice_id: original.id }],
          lines: [{ product_id: item, quantity: -1 }],
        }),
      })));
      expect(rect.no_physical_return).toBe(true);
      expect(rect.return_delivery_note).toBeNull();
      expect(rect.notes).toBeNull();
      const withNote = await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R4',
          rectification_kind: 'I',
          reason: 'Devolución con albarán',
          no_physical_return: true,
          return_delivery_note: 'ALB-9',
          rectifies: [{ invoice_id: original.id }],
          lines: [{ product_id: item, quantity: -1 }],
        }),
      }));
      expect(withNote.status).toBe(422);
      const physical = await json(await ctx.app.handle(new Request('http://localhost/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_entity_id: po,
          customer_id: customer.id,
          invoice_type: 'R4',
          rectification_kind: 'I',
          reason: 'Devolución con albarán',
          no_physical_return: false,
          return_delivery_note: 'ALB-9',
          rectifies: [{ invoice_id: original.id }],
          lines: [{ product_id: item, quantity: -1 }],
        }),
      })));
      expect(physical.no_physical_return).toBe(false);
      expect(physical.return_delivery_note).toBe('ALB-9');
    } finally {
      await ctx.close();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { loadInvoiceDocument } from '../../src/core/billing/pdf/load';
import { createSeries, deactivateSeries } from '../../src/core/series';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const actor = { type: 'user' as const, id: '019a0000-0000-7000-8000-000000000011', requestId: 'stripe-import-test' };

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

async function openSeries(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  entity: string,
  docType: string,
  code: string,
  prefix: string,
  options: { verifactu?: boolean; isDefault?: boolean; active?: boolean } = {},
): Promise<string> {
  const id = await ctx.writer.withWrite(actor, (tx) => createSeries(tx, {
    legal_entity_id: entity,
    doc_type: docType,
    code,
    prefix,
    padding: 4,
    is_default: options.isDefault ?? false,
    verifactu: options.verifactu ?? false,
    year: 2026,
  }));
  if (options.active === false) {
    await ctx.writer.withWrite(actor, (tx) => deactivateSeries(tx, id));
  }
  return id;
}

async function nextValue(ctx: Awaited<ReturnType<typeof createTestApp>>, seriesId: string): Promise<number> {
  const rows = await ctx.writer.read<{ next_value: unknown }>(sql`
    SELECT next_value FROM core.number_series WHERE id = CAST(${seriesId} AS UUID)
  `);
  return Number(rows[0]?.next_value);
}

function customer(name: string, taxId: string, country = 'ES') {
  return {
    legal_name: name,
    tax_id: taxId,
    country_code: country,
    address: {
      line1: 'Calle Mayor 1',
      postal_code: country === 'ES' ? '28001' : '8320000',
      city: country === 'ES' ? 'Madrid' : 'Santiago',
      country_code: country,
    },
  };
}

function invoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    entity: 'CVPO',
    stripe_invoice_id: 'in_1Vinoveo0001',
    number: 'VV-0001',
    issue_date: '2026-03-01',
    series_code: 'VV',
    description: 'Suscripción Vinoveo',
    customer: customer('Bodega Ejemplo SL', companyCif()),
    lines: [{ description: 'Suscripción marzo', quantity: '1', unit_price: '100.00', tax_code: 'IVA21' }],
    total: '121.00',
    ...overrides,
  };
}

async function post(ctx: Awaited<ReturnType<typeof createTestApp>>, body: Record<string, unknown>) {
  return ctx.app.handle(new Request('http://localhost/v1/invoices/import/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function enableVerifactu(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  await ctx.writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO core.module_state (module_key, enabled, changed_by)
      VALUES ('verifactu', TRUE, 'test')
      ON CONFLICT (module_key) DO UPDATE SET enabled = TRUE
    `);
  });
}

describe('importación de facturas de Stripe', () => {
  it('grava la factura como emitida, con su número, sin F26, sin Verifactu y sin envío', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      const f26 = await openSeries(ctx, cvpo, 'invoice', 'F', 'F26-', { verifactu: true, isDefault: true });
      const vv = await openSeries(ctx, cvpo, 'invoice', 'VV', 'VV-', { verifactu: false, active: false });
      await enableVerifactu(ctx);
      const taxId = companyCif();
      const response = await post(ctx, invoiceBody({ customer: customer('Bodega Ejemplo SL', taxId) }));
      expect(response.status).toBe(201);
      const body = await json(response);
      expect(body.replayed).toBe(false);
      expect(body.customer_created).toBe(true);
      expect(body.status).toBe('issued');
      expect(body.origin).toBe('stripe_import');
      expect(body.number).toBe('VV-0001');
      expect(body.issue_date).toBe('2026-03-01');
      expect(body.total).toBe('121.00');
      expect(body.tax_total).toBe('21.00');
      expect(body.verifactu_record_id).toBeNull();
      expect(body.series_id).toBe(vv);
      expect(body.payment_status).toBe('unpaid');
      expect(body.amount_paid).toBe('0.00');
      const legacy = body.legacy_refs as { stripe?: string; verifactu?: string };
      expect(legacy.stripe).toBe('in_1Vinoveo0001');
      expect(legacy.verifactu).toBe('not_applicable');

      expect(await nextValue(ctx, f26)).toBe(1);
      expect(await nextValue(ctx, vv)).toBe(1);
      const side = await ctx.writer.read<{ verifactu: number; delivery: number; outbox: number }>(sql`
        SELECT
          (SELECT count(*) FROM regulatory.verifactu_record) AS verifactu,
          (SELECT count(*) FROM billing.invoice_delivery) AS delivery,
          (SELECT count(*) FROM ops.outbox_event WHERE event_type = 'billing.invoice.issued') AS outbox
      `);
      expect(Number(side[0]?.verifactu)).toBe(0);
      expect(Number(side[0]?.delivery)).toBe(0);
      expect(Number(side[0]?.outbox)).toBe(0);

      const pendingVerifactu = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/invoices?entity=${cvpo}&verifactu_status=pending`,
      )));
      expect((pendingVerifactu.items as { id: string }[]).some((item) => item.id === body.id)).toBe(false);
      const pendingDelivery = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/invoices?entity=${cvpo}&delivery_status=none`,
      )));
      expect((pendingDelivery.items as { id: string }[]).some((item) => item.id === body.id)).toBe(false);
      const listed = await json(await ctx.app.handle(new Request(`http://localhost/v1/invoices?entity=${cvpo}`)));
      const row = (listed.items as { id: string; origin: string; delivery_status: string | null }[])
        .find((item) => item.id === body.id);
      expect(row?.origin).toBe('stripe_import');
      expect(row?.delivery_status).toBeNull();

      const book = await ctx.app.handle(new Request(
        'http://localhost/v1/invoices/export?entity=CVPO&from=2026-03-01&to=2026-03-31',
      ));
      expect(book.status).toBe(200);
      expect(await book.text()).toContain('no aplica (histórico Stripe)');

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO regulatory.verifactu_installation (
            id, legal_entity_id, environment, mode, system_version, installation_number,
            producer_name, producer_tax_id, starts_on
          ) VALUES (
            CAST(${newId()} AS UUID),
            CAST(${cvpo} AS UUID),
            'test',
            'verifactu',
            '0.0.0-test',
            '1',
            'WineCore',
            'B00000000',
            CAST('2020-01-01' AS DATE)
          )
        `);
      });
      const loaded = await loadInvoiceDocument(ctx.writer, String(body.id));
      expect(loaded.kind).toBe('ready');
      if (loaded.kind === 'ready') expect(loaded.invoice.verifactu.active).toBe(false);

      const otherEntity = await post(ctx, invoiceBody({ entity: 'PO', stripe_invoice_id: 'in_1Vinoveo0099', number: 'VV-0099' }));
      expect(otherEntity.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  it('al repetir el mismo id de Stripe solo actualiza el cobro', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      await openSeries(ctx, cvpo, 'invoice', 'VV', 'VV-', { active: false });
      const taxId = companyCif();
      const first = await json(await post(ctx, invoiceBody({ customer: customer('Cliente Uno SL', taxId) })));
      const again = await post(ctx, invoiceBody({
        customer: customer('Otro nombre SL', taxId),
        number: 'VV-9999',
        total: '1.00',
        payment: { status: 'paid' },
      }));
      expect(again.status).toBe(200);
      const body = await json(again);
      expect(body.id).toBe(first.id);
      expect(body.replayed).toBe(true);
      expect(body.customer_created).toBe(false);
      expect(body.number).toBe('VV-0001');
      expect(body.total).toBe('121.00');
      expect(body.payment_status).toBe('paid');
      expect(body.amount_paid).toBe('121.00');
      const count = await ctx.writer.read<{ n: unknown }>(sql`
        SELECT count(*) AS n FROM billing.invoice WHERE origin = 'stripe_import'
      `);
      expect(Number(count[0]?.n)).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un número que ya existe en la sociedad', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      await openSeries(ctx, cvpo, 'invoice', 'VV', 'VV-', { active: false });
      const taxId = companyCif();
      expect((await post(ctx, invoiceBody({ customer: customer('Cliente Uno SL', taxId) }))).status).toBe(201);
      const duplicate = await post(ctx, invoiceBody({
        stripe_invoice_id: 'in_1Vinoveo0002',
        customer: customer('Cliente Dos SL', companyCif()),
      }));
      expect(duplicate.status).toBe(422);
      const body = await json(duplicate);
      expect(body.fields).toMatchObject({ number: expect.stringContaining('Ya existe') });
    } finally {
      await ctx.close();
    }
  });

  it('rechaza una serie con Verifactu activado', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      await openSeries(ctx, cvpo, 'invoice', 'F', 'F26-', { verifactu: true, isDefault: true });
      const response = await post(ctx, invoiceBody({ series_code: 'F' }));
      expect(response.status).toBe(422);
      const body = await json(response);
      expect(body.fields).toMatchObject({ series_code: expect.stringContaining('Verifactu') });
      expect(await nextValue(ctx, (await ctx.writer.read<{ id: string }>(sql`
        SELECT id FROM core.number_series WHERE code = 'F' AND legal_entity_id = CAST(${cvpo} AS UUID)
      `))[0]!.id)).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un total distinto del calculado', async () => {
    const ctx = await createTestApp();
    try {
      const response = await post(ctx, invoiceBody({ series_code: undefined, total: '100.00' }));
      expect(response.status).toBe(422);
      const body = await json(response);
      expect(String((body.fields as { total?: string } | undefined)?.total ?? '')).toContain('no coincide');
      const count = await ctx.writer.read<{ n: unknown }>(sql`SELECT count(*) AS n FROM billing.invoice`);
      expect(Number(count[0]?.n)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('reutiliza el contacto y guarda un RUT chileno como IDOtro 04, con NS_LOC', async () => {
    const ctx = await createTestApp();
    try {
      // 8 cifras y K: la misma forma que un NIF, pero es un RUT. No se escribe
      // junto en el fuente: el barrido de datos sintéticos lo tomaría por un NIF.
      const rutDigits = '76086428';
      const rutLetter = 'K';
      const rutStored = `${rutDigits}${rutLetter}`;
      const rutDotted = `${rutDigits.slice(0, 2)}.${rutDigits.slice(2, 5)}.${rutDigits.slice(5)}-${rutLetter}`;
      const created = await post(ctx, invoiceBody({
        series_code: undefined,
        stripe_invoice_id: 'in_1VinoveoChile1',
        number: '8EC75E91-0001',
        customer: customer('Viña del Sur SpA', rutDotted, 'CL'),
        lines: [{ description: 'Servicio de plataforma', quantity: '2', unit_price: '50.00', tax_code: 'NS_LOC' }],
        total: '100.00',
        subtotal: '100.00',
        tax_total: '0.00',
      }));
      expect(created.status).toBe(201);
      const body = await json(created);
      const snapshot = body.customer_snapshot as {
        tax_id: string;
        tax_id_type: string;
        id_otro_type?: string;
        tax_id_country: string;
      };
      expect(snapshot.tax_id).toBe(rutStored);
      expect(snapshot.tax_id_type).toBe('foreign_id');
      expect(snapshot.id_otro_type).toBe('04');
      expect(snapshot.tax_id_country).toBe('CL');
      expect(body.tax_total).toBe('0.00');
      expect(body.total).toBe('100.00');
      const taxes = body.taxes as { tax_code: string; qualification: string; quota: string }[];
      expect(taxes[0]?.tax_code).toBe('NS_LOC');
      expect(taxes[0]?.qualification).toBe('N2');
      expect(taxes[0]?.quota).toBe('0.00');

      const again = await json(await post(ctx, invoiceBody({
        series_code: undefined,
        stripe_invoice_id: 'in_1VinoveoChile2',
        number: '8EC75E91-0002',
        customer: customer('Viña del Sur SpA', `${rutDigits}-${rutLetter}`, 'CL'),
        lines: [{ description: 'Servicio de plataforma', quantity: '1', unit_price: '80.00', tax_code: 'NS_LOC' }],
        total: '80.00',
      })));
      expect(again.customer_created).toBe(false);
      expect(again.customer_id).toBe(body.customer_id);
    } finally {
      await ctx.close();
    }
  });

  it('solo admite un abono íntegro contra una factura stripe_import y en una serie sin Verifactu', async () => {
    const ctx = await createTestApp();
    try {
      const cvpo = await entityId(ctx, 'CVPO');
      const blocked = await openSeries(ctx, cvpo, 'credit_note', 'VR', 'VR-', { verifactu: true });
      const vvr = await openSeries(ctx, cvpo, 'credit_note', 'VVR', 'VVR-', { verifactu: false, active: false });
      const taxId = companyCif();
      const original = await json(await post(ctx, invoiceBody({
        series_code: undefined,
        stripe_invoice_id: 'in_1VinoveoBase01',
        number: 'VV-0010',
        customer: customer('Cliente Abono SL', taxId),
        payment: { status: 'paid' },
      })));
      expect(original.status).toBe('issued');

      const partial = await post(ctx, invoiceBody({
        series_code: 'VVR',
        invoice_type: 'R1',
        stripe_invoice_id: 'in_1VinoveoCredit1',
        number: 'VVR-0001',
        rectifies: { stripe_invoice_id: 'in_1VinoveoBase01' },
        lines: [{ description: 'Abono parcial', quantity: '-1', unit_price: '50.00', tax_code: 'IVA21' }],
        total: '-60.50',
      }));
      expect(partial.status).toBe(422);
      expect((await json(partial)).fields).toMatchObject({ total: expect.stringContaining('íntegro') });

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`UPDATE billing.invoice SET origin = 'native' WHERE id = CAST(${String(original.id)} AS UUID)`);
      });
      const foreign = await post(ctx, creditBody(taxId));
      expect(foreign.status).toBe(422);
      const foreignBody = await json(foreign);
      expect(String((foreignBody.fields as { rectifies?: string } | undefined)?.rectifies ?? '')).toContain('stripe_import');
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`UPDATE billing.invoice SET origin = 'stripe_import' WHERE id = CAST(${String(original.id)} AS UUID)`);
      });

      const verifactuSeries = await post(ctx, creditBody(taxId, { series_code: 'VR' }));
      expect(verifactuSeries.status).toBe(422);
      expect((await json(verifactuSeries)).fields).toMatchObject({ series_code: expect.stringContaining('Verifactu') });
      expect(await nextValue(ctx, blocked)).toBe(1);

      const credited = await post(ctx, creditBody(taxId));
      expect(credited.status).toBe(201);
      const note = await json(credited);
      expect(note.origin).toBe('stripe_import');
      expect(note.invoice_type).toBe('R1');
      expect(note.rectification_kind).toBe('I');
      expect(note.number).toBe('VVR-0001');
      expect(note.total).toBe('-121.00');
      expect(note.series_id).toBe(vvr);
      expect(note.verifactu_record_id).toBeNull();
      const rectifications = note.rectifications as { rectified_invoice_id: string }[];
      expect(rectifications[0]?.rectified_invoice_id).toBe(original.id);
      expect(await nextValue(ctx, vvr)).toBe(1);

      const second = await post(ctx, creditBody(taxId, {
        stripe_invoice_id: 'in_1VinoveoCredit2',
        number: 'VVR-0002',
      }));
      expect(second.status).toBe(422);
      expect((await json(second)).fields).toMatchObject({ rectifies: expect.stringContaining('ya tiene') });
    } finally {
      await ctx.close();
    }
  });
});

function creditBody(taxId: string, overrides: Record<string, unknown> = {}) {
  return invoiceBody({
    series_code: 'VVR',
    invoice_type: 'R1',
    stripe_invoice_id: 'in_1VinoveoCredit1',
    number: 'VVR-0001',
    issue_date: '2026-04-01',
    customer: customer('Cliente Abono SL', taxId),
    rectifies: { stripe_invoice_id: 'in_1VinoveoBase01' },
    lines: [{ description: 'Abono íntegro', quantity: '-1', unit_price: '100.00', tax_code: 'IVA21' }],
    total: '-121.00',
    ...overrides,
  });
}

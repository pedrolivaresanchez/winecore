import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readOptional } from '../../src/core/db/optional';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const NOW = new Date('2026-10-31T10:00:00Z');
const HASH = 'ab'.repeat(32);
const HASH_UP = 'AB'.repeat(32);

const ctx = await createTestApp({ now: () => NOW });

describe('panel', () => {
  const ids = {
    customer: newId(),
    seriesPo: newId(),
    seriesCvpo: newId(),
    invoicePo: newId(),
    duePo: newId(),
    invoiceCvpo: newId(),
    dueCvpo: newId(),
    invoiceFuture: newId(),
    dueFuture: newId(),
    batch: newId(),
    holded: newId(),
    openItem: newId(),
    paidItem: newId(),
    holdedPaid: newId(),
    supplier: newId(),
    expense: newId(),
    location: newId(),
    move: newId(),
    obligationPo: newId(),
    obligationCvpo: newId(),
    obligationLate: newId(),
    approval: newId(),
    subject: newId(),
    notice: newId(),
    noticeRead: newId(),
    installation: newId(),
    record: newId(),
    submission: newId(),
    run: newId(),
    diff: newId(),
    scopedUser: newId(),
    scopedRole: newId(),
  };

  beforeAll(async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const users = await ctx.writer.read<{ id: string; email: string }>(`SELECT id, email FROM core.app_user`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    const owner = users.find((row) => row.email === 'owner@winecore.test')?.id;
    const admin = users.find((row) => row.email === 'admin@winecore.test')?.id;
    if (!po || !cvpo || !owner || !admin) throw new Error('Falta la semilla');

    const actor = { type: 'system' as const, id: 'panel-test', requestId: newId() };
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, is_supplier, created_by
        ) VALUES (
          CAST(${ids.customer} AS UUID), 'company', 'Cliente sintetico', 'B22222228', 'nif', 'ES', 'ES', TRUE, FALSE, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_supplier, created_by
        ) VALUES (
          CAST(${ids.supplier} AS UUID), 'company', 'Proveedor sintetico', 'B33333337', 'nif', 'ES', 'ES', TRUE, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix) VALUES
          (CAST(${ids.seriesPo} AS UUID), CAST(${po} AS UUID), 'invoice', 'PF', 2026, 'PF26-'),
          (CAST(${ids.seriesCvpo} AS UUID), CAST(${cvpo} AS UUID), 'invoice', 'CF', 2026, 'CF26-')
      `);
      const invoice = (id: string, entity: string, series: string, number: string, total: string, subtotal: string, tax: string, issue: string) => {
        tx.write(sql`
          INSERT INTO billing.invoice (
            id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id,
            customer_snapshot, subtotal, tax_total, surcharge_total, withholding_total, total,
            issued_at, created_by
          ) VALUES (
            CAST(${id} AS UUID), CAST(${entity} AS UUID), CAST(${series} AS UUID), ${number}, 'issued', 'F1',
            CAST(${issue} AS DATE), CAST(${ids.customer} AS UUID), ${sql.json({ legal_name: 'Cliente sintetico' })},
            CAST(${subtotal} AS DECIMAL(14,2)), CAST(${tax} AS DECIMAL(14,2)), 0, 0, CAST(${total} AS DECIMAL(14,2)),
            TIMESTAMPTZ '2026-06-15 10:00:00+00', 'test'
          )
        `);
      };
      invoice(ids.invoicePo, po, ids.seriesPo, 'PF-1', '12.10', '10.00', '2.10', '2026-06-15');
      invoice(ids.invoiceCvpo, cvpo, ids.seriesCvpo, 'CF-1', '5.00', '5.00', '0.00', '2026-03-01');
      invoice(ids.invoiceFuture, po, ids.seriesPo, 'PF-2', '99.00', '99.00', '0.00', '2025-12-01');
      tx.write(sql`
        INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount) VALUES
          (CAST(${ids.duePo} AS UUID), CAST(${ids.invoicePo} AS UUID), 1, CAST('2026-10-01' AS DATE), 12.10),
          (CAST(${ids.dueCvpo} AS UUID), CAST(${ids.invoiceCvpo} AS UUID), 1, CAST('2026-09-01' AS DATE), 5.00),
          (CAST(${ids.dueFuture} AS UUID), CAST(${ids.invoiceFuture} AS UUID), 1, CAST('2026-12-15' AS DATE), 99.00)
      `);
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (
          CAST(${ids.batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices', 'sintetico.xlsx', ${HASH}, 'load', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name, subtotal, total, status_holded, raw
        ) VALUES
          (CAST(${ids.holded} AS UUID), CAST(${ids.batch} AS UUID), CAST(${po} AS UUID), 'sale', 'H-1',
           CAST('2025-06-01' AS DATE), 'Cliente sintetico', 40.00, 40.00, 'Vencido', ${sql.json({})}),
          (CAST(${ids.holdedPaid} AS UUID), CAST(${ids.batch} AS UUID), CAST(${po} AS UUID), 'sale', 'H-2',
           CAST('2025-06-02' AS DATE), 'Cliente sintetico', 8.00, 8.00, 'Pagado', ${sql.json({})})
      `);
      tx.write(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, document_number, document_date, due_date, amount, status
        ) VALUES
          (CAST(${ids.openItem} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.holded} AS UUID),
           'H-1', CAST('2026-01-15' AS DATE), CAST('2026-08-02' AS DATE), 40.00, 'open'),
          (CAST(${ids.paidItem} AS UUID), CAST(${po} AS UUID), 'receivable', CAST(${ids.holdedPaid} AS UUID),
           'H-2', CAST('2026-01-20' AS DATE), CAST('2026-02-01' AS DATE), 8.00, 'paid')
      `);
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice (
          id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
          source, status, category_code, subtotal, tax_total, total, approved_by, approved_at, created_by
        ) VALUES (
          CAST(${ids.expense} AS UUID), CAST(${po} AS UUID), CAST(${ids.supplier} AS UUID), 'GS-1',
          CAST('2026-04-02' AS DATE), CAST('2026-04-02' AS DATE), 'upload', 'approved', 'transport',
          20.00, 0, 20.00, CAST(${owner} AS UUID), TIMESTAMPTZ '2026-04-03 10:00:00+00', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${ids.location} AS UUID), 'PANELBOD', 'Almacen sintetico', 'own_warehouse', CAST(${po} AS UUID))
      `);
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, owner_entity_id, product_state, volume_ml,
          source_table, source_id, created_by
        ) VALUES (
          CAST(${ids.move} AS UUID), TIMESTAMPTZ '2026-06-01 10:00:00+00', 'opening',
          CAST(${ids.location} AS UUID), CAST(${po} AS UUID), 'wine', 1500,
          'inventory.inventory_count', CAST(${newId()} AS UUID), 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO regulatory.obligation (id, legal_entity_id, flow, title, due_date, legal_basis, status) VALUES
          (CAST(${ids.obligationPo} AS UUID), CAST(${po} AS UUID), 'silicie', 'SILICIE sintetico',
           CAST('2026-11-10' AS DATE), 'norma de prueba', 'open'),
          (CAST(${ids.obligationCvpo} AS UUID), CAST(${cvpo} AS UUID), 'infovi', 'INFOVI sintetico',
           CAST('2026-11-20' AS DATE), 'norma de prueba', 'open'),
          (CAST(${ids.obligationLate} AS UUID), CAST(${po} AS UUID), 'sisv', 'SISV lejano',
           CAST('2026-12-20' AS DATE), 'norma de prueba', 'open')
      `);
      tx.write(sql`
        INSERT INTO ops.approval_request (
          id, kind, legal_entity_id, subject_table, subject_id, payload_sha256, summary,
          status, requested_by, requested_at, expires_at
        ) VALUES (
          CAST(${ids.approval} AS UUID), 'inventory_adjustment', CAST(${po} AS UUID),
          'inventory.inventory_count', CAST(${ids.subject} AS UUID), ${HASH}, 'Aforo sintetico pendiente',
          'pending', ${admin}, TIMESTAMPTZ '2026-10-01 09:00:00+00', TIMESTAMPTZ '2026-11-15 09:00:00+00'
        )
      `);
      tx.write(sql`
        INSERT INTO core.notification (id, user_id, kind, title, body, link, read_at) VALUES
          (CAST(${ids.notice} AS UUID), CAST(${owner} AS UUID), 'deadline', 'Aviso sintetico', 'Texto de prueba', '/regulatorio', NULL),
          (CAST(${ids.noticeRead} AS UUID), CAST(${owner} AS UUID), 'deadline', 'Aviso leido', 'Ya visto', NULL, now())
      `);
      tx.write(sql`
        INSERT INTO regulatory.verifactu_installation (
          id, legal_entity_id, environment, mode, system_version, installation_number, producer_name, producer_tax_id, starts_on
        ) VALUES (
          CAST(${ids.installation} AS UUID), CAST(${po} AS UUID), 'test', 'verifactu', '0.1.0', '1',
          'Productor sintetico', 'B00000000', CAST('2026-01-01' AS DATE)
        )
      `);
      tx.write(sql`
        INSERT INTO regulatory.verifactu_record (
          id, installation_id, legal_entity_id, chain_seq, record_type, invoice_id, issuer_tax_id,
          invoice_number, invoice_issue_date, invoice_type, total_tax, total_amount, generated_at, hash, record_xml
        ) VALUES (
          CAST(${ids.record} AS UUID), CAST(${ids.installation} AS UUID), CAST(${po} AS UUID), 1, 'alta',
          CAST(${ids.invoicePo} AS UUID), '00000000T', 'PF-1', CAST('2026-06-15' AS DATE), 'F1', 2.10, 12.10,
          TIMESTAMPTZ '2026-10-01 08:00:00+00', ${HASH_UP}, '<r/>'
        )
      `);
      tx.write(sql`
        INSERT INTO regulatory.submission (
          id, flow, legal_entity_id, kind, status, payload, payload_sha256, created_by
        ) VALUES (
          CAST(${ids.submission} AS UUID), 'silicie', CAST(${po} AS UUID), 'silicie.asientos', 'failed',
          ${sql.json({})}, ${HASH}, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO regulatory.reconciliation_run (
          id, kind, legal_entity_id, period_start, period_end, status, summary, run_by
        ) VALUES (
          CAST(${ids.run} AS UUID), 'physical_vs_fiscal', CAST(${po} AS UUID),
          CAST('2026-01-01' AS DATE), CAST('2026-10-31' AS DATE), 'differences', ${sql.json({})}, 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO regulatory.reconciliation_diff (id, run_id, dimension, difference_ml, explanation)
        VALUES (
          CAST(${ids.diff} AS UUID), CAST(${ids.run} AS UUID), ${sql.json({ product: 'sintetico' })}, 1500, 'Descuadre sintetico'
        )
      `);
      tx.write(sql`
        INSERT INTO core.app_user (id, email, display_name, locale, status)
        VALUES (CAST(${ids.scopedUser} AS UUID), 'solo.panel@winecore.test', 'Solo CVPO', 'es-ES', 'active')
      `);
      tx.write(sql`
        INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id)
        VALUES (CAST(${ids.scopedRole} AS UUID), CAST(${ids.scopedUser} AS UUID), 'admin', CAST(${cvpo} AS UUID))
      `);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('devuelve secciones vacías si la tabla no está desplegada', async () => {
    expect(await readOptional(ctx.writer, 'SELECT 1 AS n FROM regulatory.tabla_inexistente')).toBeNull();
  });

  it('resume aprobaciones, plazos, cobros, avisos y el año', async () => {
    const body = await json('/v1/dashboard?entity=both');
    const approvals = items(body.approvals_pending);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.can_act).toBe(true);
    expect(approvals[0]?.title).toBe('Regularización de aforo');
    expect(deadlines(body)).toEqual(['INFOVI sintetico', 'SILICIE sintetico'].sort());
    const poDeadline = (body.deadlines_next_30d as { items: { title: string; days_left: number }[] }).items
      .find((item) => item.title === 'SILICIE sintetico');
    expect(poDeadline?.days_left).toBe(10);

    const receivables = body.receivables_overdue as { count: number; amount: string; buckets: { key: string; amount: string; count: number }[] };
    expect(receivables.count).toBe(3);
    expect(receivables.amount).toBe('57.10');
    expect(receivables.buckets.find((bucket) => bucket.key === '0-30')).toMatchObject({ amount: '12.10', count: 1 });
    expect(receivables.buckets.find((bucket) => bucket.key === '31-60')).toMatchObject({ amount: '5.00', count: 1 });
    expect(receivables.buckets.find((bucket) => bucket.key === '60+')).toMatchObject({ amount: '40.00', count: 1 });

    expect(items(body.alerts).map((item) => item.title)).toEqual(['Aviso sintetico']);
    const year = body.year as { sales: { amount: string }; expenses: { amount: string }; stock: { volume_ml: string } };
    expect(year.sales.amount).toBe('17.10');
    expect(year.expenses.amount).toBe('20.00');
    expect(year.stock.volume_ml).toBe('1500');
    expect(body.verifactu_pending).toMatchObject({ count: 1 });
    expect((body.verifactu_pending as { since: string }).since).toContain('2026-10-01');
    expect(items(body.submissions_failed)).toHaveLength(1);
    expect(items(body.stock_alerts)[0]?.title).toBe('Descuadre sintetico');
    expect(body.cellar_alerts).toEqual({ count: 0, items: [] });
  });

  it('filtra por entidad y por permiso', async () => {
    const po = await json('/v1/dashboard?entity=P.O');
    expect(po.entity).toBe('PO');
    expect((po.receivables_overdue as { amount: string; count: number }).amount).toBe('52.10');
    expect((po.receivables_overdue as { count: number }).count).toBe(2);
    expect((po.year as { sales: { amount: string } }).sales.amount).toBe('12.10');
    expect(deadlines(po)).toEqual(['SILICIE sintetico']);

    const cvpo = await json('/v1/dashboard?entity=CVPO');
    expect((cvpo.receivables_overdue as { amount: string }).amount).toBe('5.00');
    expect((cvpo.year as { expenses: { amount: string }; stock: { volume_ml: string } }).expenses.amount).toBe('0.00');
    expect((cvpo.year as { stock: { volume_ml: string } }).stock.volume_ml).toBe('0');
    expect(items(cvpo.approvals_pending)).toHaveLength(0);
    expect((cvpo.verifactu_pending as { count: number }).count).toBe(0);

    const admin = await json('/v1/dashboard', 'admin@winecore.test');
    const own = items(admin.approvals_pending)[0];
    expect(own?.own).toBe(true);
    expect(own?.can_act).toBe(false);

    const cellar = await json('/v1/dashboard', 'bodega@winecore.test');
    expect(cellar.receivables_overdue).toBeNull();
    expect(cellar.year).toBeNull();
    expect(cellar.deadlines_next_30d).toBeNull();
    expect(items(cellar.approvals_pending)).toHaveLength(0);
    expect(cellar.stock_alerts).not.toBeNull();

    const denied = await request('/v1/dashboard?entity=PO', 'solo.panel@winecore.test');
    expect(denied.status).toBe(403);
    const narrowed = await json('/v1/dashboard?entity=ambas', 'solo.panel@winecore.test');
    expect(narrowed.entity).toBe('CVPO');
    expect((narrowed.year as { sales: { amount: string } }).sales.amount).toBe('5.00');

    const bad = await request('/v1/dashboard?entity=otra');
    expect(bad.status).toBe(422);
  });

  async function request(path: string, user?: string) {
    const headers = new Headers();
    if (user) headers.set('x-dev-user', user);
    const response = await ctx.app.handle(new Request(`http://localhost${path}`, { headers }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function json(path: string, user?: string) {
    const result = await request(path, user);
    if (result.status !== 200) throw new Error(`${path} -> ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }
});

function items(value: unknown): { title: string; can_act?: boolean; own?: boolean }[] {
  const block = value as { items?: { title: string; can_act?: boolean; own?: boolean }[] };
  return block.items ?? [];
}

function deadlines(body: Record<string, unknown>): string[] {
  return items(body.deadlines_next_30d).map((item) => item.title).sort();
}

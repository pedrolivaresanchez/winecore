import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { baseTools } from '../../src/mcp/server';
import { createSeries } from '../../src/core/series';
import {
  CVPO_AL26_NOTE_IDS,
  CVPO_AL26_PREFIX,
  applyCvpoAl26,
  assertRevertTarget,
  inspectCvpoAl26,
} from '../../src/core/sales/revert-cvpo-al26';
import { businessDate } from '../../src/core/time';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;
const actor = { type: 'user' as const, id: 'revert', requestId: 'revert-cvpo-al26' };

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
  actor.id = fx.owner;
});

afterAll(async () => {
  await ctx.close();
});

describe('eliminar borradores', () => {
  it('registra las herramientas MCP de borrado', () => {
    const names = new Set(baseTools.map((tool) => tool.name));
    for (const name of [
      'sales_delivery_note_delete',
      'sales_quote_delete',
      'sales_order_delete',
      'billing_invoice_draft_delete',
      'purchasing_expense_delete',
    ]) {
      expect(names.has(name)).toBe(true);
      expect(baseTools.find((tool) => tool.name === name)?.kind).toBe('write');
    }
  });

  it('anular un albarán en borrador no le asigna número', async () => {
    const before = await nextDelivery(fx.po);
    const draft = await json(ctx, 'POST', '/v1/delivery-notes', deliveryBody());
    expect(draft.number).toBeNull();
    expect(draft.status).toBe('draft');
    const denied = await call(ctx, 'POST', `/v1/delivery-notes/${String(draft.id)}/void`, { reason: 'no iba a salir' });
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_VOID');
    expect(String(denied.body?.message)).toContain('Elimínalo');
    const still = await json(ctx, 'GET', `/v1/delivery-notes/${String(draft.id)}`);
    expect(still.status).toBe('draft');
    expect(still.number).toBeNull();
    expect(await nextDelivery(fx.po)).toBe(before);
  });

  it('elimina un albarán en borrador y deja constancia', async () => {
    const before = await nextDelivery(fx.po);
    const draft = await json(ctx, 'POST', '/v1/delivery-notes', deliveryBody());
    const removed = await call(ctx, 'DELETE', `/v1/delivery-notes/${String(draft.id)}`);
    expect(removed.status).toBe(200);
    expect(removed.body?.deleted).toBe(true);
    const gone = await call(ctx, 'GET', `/v1/delivery-notes/${String(draft.id)}`);
    expect(gone.status).toBe(404);
    expect(await nextDelivery(fx.po)).toBe(before);
    const audit = await ctx.writer.read<{ action: string }>(sql`
      SELECT action FROM audit.audit_log
      WHERE table_name = 'sales.delivery_note' AND row_id = ${String(draft.id)} AND action = 'DELETE'
    `);
    expect(audit.length).toBeGreaterThan(0);
    const forbidden = await call(ctx, 'DELETE', `/v1/delivery-notes/${String(draft.id)}`, undefined, {
      'X-Dev-User': 'bodega@winecore.test',
    });
    expect(forbidden.status).toBe(403);
  });

  it('rechaza eliminar un albarán emitido', async () => {
    const draft = await json(ctx, 'POST', '/v1/delivery-notes', deliveryBody());
    const issued = await json(ctx, 'POST', `/v1/delivery-notes/${String(draft.id)}/issue`);
    expect(issued.status).toBe('issued');
    expect(issued.number).toBeTruthy();
    const denied = await call(ctx, 'DELETE', `/v1/delivery-notes/${String(draft.id)}`);
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_DELETE');
    const still = await json(ctx, 'GET', `/v1/delivery-notes/${String(draft.id)}`);
    expect(still.status).toBe('issued');
    expect(still.number).toBe(issued.number);
  });

  it('elimina un presupuesto en borrador y rechaza uno numerado', async () => {
    const draft = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '1' }],
    });
    expect(draft.number).toBeNull();
    const removed = await call(ctx, 'DELETE', `/v1/quotes/${String(draft.id)}`);
    expect(removed.status).toBe(200);
    expect((await call(ctx, 'GET', `/v1/quotes/${String(draft.id)}`)).status).toBe(404);

    const sent = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '1' }],
    });
    const numbered = await json(ctx, 'POST', `/v1/quotes/${String(sent.id)}/send`);
    expect(numbered.number).toBeTruthy();
    const denied = await call(ctx, 'DELETE', `/v1/quotes/${String(sent.id)}`);
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_DELETE');
  });

  it('elimina un pedido en borrador y no lo cancela asignándole número', async () => {
    const before = await nextOf(fx.po, 'sales_order');
    const draft = await json(ctx, 'POST', '/v1/sales-orders', {
      customer_id: fx.customer,
      channel: 'horeca',
      source: 'manual',
      lines: [{ product_id: fx.product, quantity: '1' }],
    }, { 'Idempotency-Key': `pedido-borrar-${newId()}` });
    expect(draft.number).toBeNull();
    const cancelled = await call(ctx, 'POST', `/v1/sales-orders/${String(draft.id)}/cancel`, { reason: 'no sale' });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body?.code).toBe('WC_DRAFT_VOID');
    expect(await nextOf(fx.po, 'sales_order')).toBe(before);
    const removed = await call(ctx, 'DELETE', `/v1/sales-orders/${String(draft.id)}`);
    expect(removed.status).toBe(200);
    expect((await call(ctx, 'GET', `/v1/sales-orders/${String(draft.id)}`)).status).toBe(404);

    const kept = await json(ctx, 'POST', '/v1/sales-orders', {
      customer_id: fx.customer,
      channel: 'horeca',
      source: 'manual',
      lines: [{ product_id: fx.product, quantity: '1' }],
    }, { 'Idempotency-Key': `pedido-emitido-${newId()}` });
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${String(kept.id)}/confirm`);
    expect(confirmed.number).toBeTruthy();
    const denied = await call(ctx, 'DELETE', `/v1/sales-orders/${String(kept.id)}`);
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_DELETE');
  });

  it('elimina una factura en borrador y rechaza una emitida', async () => {
    const year = Number(businessDate(new Date()).slice(0, 4));
    await ctx.writer.withWrite(actor, (tx) => createSeries(tx, {
      legal_entity_id: fx.po,
      doc_type: 'invoice',
      code: 'FA',
      prefix: `FA${String(year).slice(2)}-`,
      padding: 4,
      is_default: true,
      verifactu: false,
      year,
    }));
    const draft = await json(ctx, 'POST', '/v1/invoices', {
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      lines: [{ product_id: fx.product, quantity: 1, lot_id: fx.lot, lot_code: 'L25T01B1' }],
    });
    expect(draft.number).toBeNull();
    expect(draft.status).toBe('draft');
    const removed = await call(ctx, 'DELETE', `/v1/invoices/${String(draft.id)}`);
    expect(removed.status).toBe(200);
    expect((await call(ctx, 'GET', `/v1/invoices/${String(draft.id)}`)).status).toBe(404);

    const another = await json(ctx, 'POST', '/v1/invoices', {
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      lines: [{ product_id: fx.product, quantity: 1, lot_id: fx.lot, lot_code: 'L25T01B1' }],
    });
    const issued = await call(ctx, 'POST', `/v1/invoices/${String(another.id)}/issue`, undefined, {
      'Idempotency-Key': `emitir-borrar-${newId()}`,
    });
    expect(issued.status).toBe(200);
    expect(issued.body?.number).toBeTruthy();
    const denied = await call(ctx, 'DELETE', `/v1/invoices/${String(another.id)}`);
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_DELETE');
  });

  it('elimina un gasto capturado y rechaza uno aprobado', async () => {
    const captured = newId();
    const approved = newId();
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice (
          id, legal_entity_id, source, status, created_by
        ) VALUES (
          CAST(${captured} AS UUID), CAST(${fx.cvpo} AS UUID), 'upload', 'captured', ${fx.owner}
        )
      `);
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice_line (
          id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price, line_base, vat_quota
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${captured} AS UUID), 1, 'Corcho', '602',
          1, 10, 10, 2.10
        )
      `);
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice (
          id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, source, status,
          total, approved_by, created_by
        ) VALUES (
          CAST(${approved} AS UUID), CAST(${fx.cvpo} AS UUID), CAST(${fx.customer} AS UUID),
          'F-PROV-1', DATE '2026-11-01', 'upload', 'approved', 10, CAST(${fx.owner} AS UUID), ${fx.owner}
        )
      `);
    });
    const removed = await call(ctx, 'DELETE', `/v1/supplier-invoices/${captured}`);
    expect(removed.status).toBe(200);
    expect(removed.body?.deleted).toBe(true);
    expect((await call(ctx, 'GET', `/v1/supplier-invoices/${captured}`)).status).toBe(404);
    const lines = await ctx.writer.read(sql`
      SELECT id FROM purchasing.supplier_invoice_line WHERE supplier_invoice_id = CAST(${captured} AS UUID)
    `);
    expect(lines).toHaveLength(0);
    const denied = await call(ctx, 'DELETE', `/v1/supplier-invoices/${approved}`);
    expect(denied.status).toBe(409);
    expect(denied.body?.code).toBe('WC_DRAFT_DELETE');
    expect((await call(ctx, 'GET', `/v1/supplier-invoices/${approved}`)).status).toBe(200);
  });
});

describe('reversión AL26', () => {
  it('rechaza la org 1 y el proyecto SDR', () => {
    expect(() => assertRevertTarget({ TIMBAL_ORG_ID: '1', DB_MODE: 'local' })).toThrow(/org 1/);
    expect(() => assertRevertTarget({ TIMBAL_PROJECT_ID: 'sdr-prod', DB_MODE: 'local' })).toThrow(/SDR/);
    expect(() => assertRevertTarget({ DB_MODE: 'timbal', TIMBAL_ORG_ID: '122', TIMBAL_PROJECT_ID: '3942' })).toThrow(/Timbal/);
    expect(() => assertRevertTarget({ DB_MODE: 'local' })).not.toThrow();
  });

  it('no toca la serie si hay un albarán posterior y, si no lo hay, devuelve el contador a AL26-0001', async () => {
    const seriesId = newId();
    const laterId = newId();
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO core.number_series (
          id, legal_entity_id, doc_type, code, "year", prefix, padding, next_value, is_default, verifactu
        ) VALUES (
          CAST(${seriesId} AS UUID), CAST(${fx.cvpo} AS UUID), 'delivery_note', 'AL', 2026,
          ${CVPO_AL26_PREFIX}, 4, 4, FALSE, FALSE
        )
      `);
      for (const [id, number] of [
        [CVPO_AL26_NOTE_IDS[0], `${CVPO_AL26_PREFIX}0001`],
        [CVPO_AL26_NOTE_IDS[1], `${CVPO_AL26_PREFIX}0002`],
      ] as const) {
        tx.write(sql`
          INSERT INTO sales.delivery_note (
            id, legal_entity_id, series_id, number, kind, status, customer_id, from_location_id,
            issue_date, cancelled_reason, created_by
          ) VALUES (
            CAST(${id} AS UUID), CAST(${fx.cvpo} AS UUID), CAST(${seriesId} AS UUID), ${number},
            'sale', 'cancelled', CAST(${fx.customer} AS UUID), CAST(${fx.bod} AS UUID),
            DATE '2026-11-13', 'anulado en borrador', ${fx.owner}
          )
        `);
        tx.write(sql`
          INSERT INTO sales.delivery_note_line (
            id, delivery_note_id, line_no, product_id, description, quantity
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${id} AS UUID), 1, CAST(${fx.product} AS UUID), 'Tinto', 1
          )
        `);
      }
      tx.write(sql`
        INSERT INTO sales.delivery_note (
          id, legal_entity_id, series_id, number, kind, status, customer_id, from_location_id,
          issue_date, created_by
        ) VALUES (
          CAST(${laterId} AS UUID), CAST(${fx.cvpo} AS UUID), CAST(${seriesId} AS UUID),
          ${`${CVPO_AL26_PREFIX}0003`}, 'sale', 'issued', CAST(${fx.customer} AS UUID),
          CAST(${fx.bod} AS UUID), DATE '2026-11-13', ${fx.owner}
        )
      `);
    });

    const blocked = await inspectCvpoAl26(ctx.writer);
    expect(blocked.action).toBe('skip');
    expect(blocked.reason).toBe('later_numbers');
    expect(blocked.later_numbers).toContain(`${CVPO_AL26_PREFIX}0003`);
    expect(blocked.message).toContain('No se hace nada');
    const untouched = await applyCvpoAl26In();
    expect(untouched.action).toBe('skip');
    expect(await noteCount(CVPO_AL26_NOTE_IDS[0])).toBe(1);
    expect(await seriesNext(seriesId)).toBe(4);

    await ctx.writer.withWrite(actor, (tx) => {
      tx.write(sql`DELETE FROM sales.delivery_note WHERE id = CAST(${laterId} AS UUID)`);
      return Promise.resolve();
    });

    const applied = await applyCvpoAl26In();
    expect(applied.action).toBe('apply');
    expect(applied.delete_ids).toEqual([...CVPO_AL26_NOTE_IDS]);
    expect(applied.next_number_after).toBe(`${CVPO_AL26_PREFIX}0001`);
    expect(await noteCount(CVPO_AL26_NOTE_IDS[0])).toBe(0);
    expect(await noteCount(CVPO_AL26_NOTE_IDS[1])).toBe(0);
    expect(await seriesNext(seriesId)).toBe(1);
    const lines = await ctx.writer.read(sql`
      SELECT id FROM sales.delivery_note_line
      WHERE delivery_note_id IN (
        CAST(${CVPO_AL26_NOTE_IDS[0]} AS UUID), CAST(${CVPO_AL26_NOTE_IDS[1]} AS UUID)
      )
    `);
    expect(lines).toHaveLength(0);

    const again = await applyCvpoAl26In();
    expect(again.action).toBe('noop');
    expect(again.reason).toBe('already');
    expect(await seriesNext(seriesId)).toBe(1);
  });
});

function deliveryBody() {
  return {
    kind: 'sale',
    customer_id: fx.customer,
    legal_entity_id: fx.po,
    from_location_id: fx.bod,
    lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
  };
}

async function nextDelivery(entityId: string): Promise<number> {
  return nextOf(entityId, 'delivery_note');
}

async function nextOf(entityId: string, docType: string): Promise<number> {
  const rows = await ctx.writer.read<{ next_value: number | bigint }>(sql`
    SELECT next_value FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND doc_type = ${docType}
      AND is_default
    ORDER BY created_at
    LIMIT 1
  `);
  return Number(rows[0]?.next_value);
}

async function seriesNext(seriesId: string): Promise<number> {
  const rows = await ctx.writer.read<{ next_value: number | bigint }>(sql`
    SELECT next_value FROM core.number_series WHERE id = CAST(${seriesId} AS UUID)
  `);
  return Number(rows[0]?.next_value);
}

async function noteCount(id: string): Promise<number> {
  const rows = await ctx.writer.read<{ n: number }>(sql`
    SELECT count(*)::INTEGER AS n FROM sales.delivery_note WHERE id = CAST(${id} AS UUID)
  `);
  return Number(rows[0]?.n ?? 0);
}

function applyCvpoAl26In() {
  return applyCvpoAl26(ctx.writer, {
    type: 'migration',
    id: 'revert-cvpo-al26',
    requestId: newId(),
    reason: 'prueba de reversión',
  });
}

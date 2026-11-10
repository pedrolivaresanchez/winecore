import { describe, expect, it } from 'bun:test';
import { grantBillingApproval } from '../../src/core/billing/approval';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createSeries } from '../../src/core/series';
import { businessDate } from '../../src/core/time';
import { createTestApp } from '../helpers';
import { buildSalesFixture } from '../sales/fixture';

const actor = { type: 'user' as const, id: '019a0000-0000-7000-8000-000000000011', requestId: 'stock-already' };

type App = Awaited<ReturnType<typeof createTestApp>>;

function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function counts(ctx: App): Promise<{ stock: number; fiscal: number; bottled: number; cvpoIn: number }> {
  const rows = await ctx.writer.read<{ stock: string; fiscal: string; bottled: string; cvpo_in: string }>(`
    SELECT
      (SELECT count(*) FROM inventory.stock_move)::VARCHAR AS stock,
      (SELECT count(*) FROM inventory.fiscal_move)::VARCHAR AS fiscal,
      (SELECT count(*) FROM cellar.bottled_move)::VARCHAR AS bottled,
      (SELECT count(*)
         FROM inventory.stock_move m
         JOIN inventory.location loc ON loc.id = m.location_id
         JOIN core.legal_entity e ON e.id = m.owner_entity_id
        WHERE m.qty_units > 0 AND (e.code = 'CVPO' OR loc.code = 'TFRP'))::VARCHAR AS cvpo_in
  `);
  const row = rows[0];
  return {
    stock: Number(row?.stock ?? 0),
    fiscal: Number(row?.fiscal ?? 0),
    bottled: Number(row?.bottled ?? 0),
    cvpoIn: Number(row?.cvpo_in ?? 0),
  };
}

async function invoiceMoves(ctx: App, invoiceId: string): Promise<{ move_type: string; qty: number; owner: string; location: string }[]> {
  const rows = await ctx.writer.read<{ move_type: string; qty: string; owner: string; location: string }>(sql`
    SELECT m.move_type, m.qty_units::VARCHAR AS qty, e.code AS owner, loc.code AS location
    FROM inventory.stock_move m
    JOIN core.legal_entity e ON e.id = m.owner_entity_id
    JOIN inventory.location loc ON loc.id = m.location_id
    WHERE m.source_table = 'billing.invoice' AND m.source_id = CAST(${invoiceId} AS UUID)
    ORDER BY m.move_type, e.code, loc.code
  `);
  return rows.map((row) => ({
    move_type: String(row.move_type),
    qty: Number(row.qty),
    owner: String(row.owner),
    location: String(row.location),
  }));
}

async function fiscalOf(ctx: App, invoiceId: string): Promise<{ move_type: string; volume: number; units: number }[]> {
  const rows = await ctx.writer.read<{ move_type: string; volume: string; units: string }>(sql`
    SELECT move_type, volume_ml::VARCHAR AS volume, units::VARCHAR AS units
    FROM inventory.fiscal_move
    WHERE source_table = 'billing.invoice' AND source_id = CAST(${invoiceId} AS UUID)
    ORDER BY move_type
  `);
  return rows.map((row) => ({
    move_type: String(row.move_type),
    volume: Number(row.volume),
    units: Number(row.units),
  }));
}

describe('factura con stock ya descontado', () => {
  it('P.O a CVPO: la marcada no crea salida ni entrada; la que no lo está sigue moviendo stock', async () => {
    const ctx = await createTestApp();
    try {
      const fx = await buildSalesFixture(ctx);
      const year = Number(businessDate(new Date()).slice(0, 4));
      const yy = String(year).slice(2);
      await ctx.writer.withWrite(actor, async (tx) => {
        await createSeries(tx, {
          legal_entity_id: fx.po,
          doc_type: 'invoice',
          code: 'PF',
          prefix: `PF${yy}-`,
          padding: 4,
          is_default: true,
          verifactu: false,
          year,
        });
        await createSeries(tx, {
          legal_entity_id: fx.po,
          doc_type: 'credit_note',
          code: 'PR',
          prefix: `PR${yy}-`,
          padding: 4,
          is_default: true,
          verifactu: false,
          year,
        });
        const bod = newId();
        const tfrp = newId();
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, niche_number, line_no, wine_label,
            product_id, lot_id, owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml,
            product_state, not_for_sale, match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${bod} AS UUID), CAST(${fx.bod} AS UUID), 'nicho', 'NIC-01', 1, 1, 'Tinto Ejemplo',
            CAST(${fx.product} AS UUID), CAST(${fx.lot} AS UUID), CAST(${fx.po} AS UUID),
            100, 750, 75000, 'packaged_labeled', FALSE, 'matched', 'TEST', 1, DATE '2026-11-09'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, line_no, wine_label,
            product_id, lot_id, owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml,
            product_state, not_for_sale, match_status, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${tfrp} AS UUID), CAST(${fx.tfrp} AS UUID), 'palet', 'PAL-01', 1, 'Tinto Ejemplo',
            CAST(${fx.product} AS UUID), CAST(${fx.lot} AS UUID), CAST(${fx.cvpo} AS UUID),
            40, 750, 30000, 'packaged_labeled', FALSE, 'matched', 'TEST', 2, DATE '2026-11-09'
          )
        `);
        for (const [placement, units] of [[bod, 100], [tfrp, 40]] as const) {
          tx.write(sql`
            INSERT INTO cellar.bottled_move (
              id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id,
              source_table, source_id, created_by
            ) VALUES (
              CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 10:00:00+01', CAST(${placement} AS UUID),
              ${units}, ${units * 750}, 'opening', CAST(${fx.lot} AS UUID),
              'cellar.bottled_placement', CAST(${placement} AS UUID), 'test'
            )
          `);
        }
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
            qty_units, volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 10:00:00+01', 'opening',
            CAST(${fx.tfrp} AS UUID), CAST(${fx.cvpo} AS UUID), CAST(${fx.lot} AS UUID), CAST(${fx.product} AS UUID),
            'packaged_labeled', 40, 30000, 'inventory.inventory_count', CAST(${newId()} AS UUID), 'test'
          )
        `);
      });
      const buyers = await ctx.writer.read<{ id: string }>(sql`
        SELECT c.id
        FROM party.contact c
        JOIN core.legal_entity e ON e.tax_id = c.tax_id
        WHERE e.code = 'CVPO' AND c.archived_at IS NULL
        LIMIT 1
      `);
      const customerId = String(buyers[0]?.id ?? '').toLowerCase();
      expect(customerId).toMatch(/^[0-9a-f-]{36}$/);

      const line = { product_id: fx.product, quantity: 6, unit_price: '10', lot_id: fx.lot };
      const plain = await postInvoice(ctx, {
        legal_entity_id: fx.po,
        customer_id: customerId,
        lines: [line],
      });
      expect(plain.status).toBe(201);
      const unmarked = await json(plain);
      expect(unmarked.stock_already_deducted).toBe(false);
      expect(unmarked.moves_stock).toBe(true);

      const missingReason = await postInvoice(ctx, {
        legal_entity_id: fx.po,
        customer_id: customerId,
        stock_already_deducted: true,
        lines: [line],
      });
      expect(missingReason.status).toBe(422);

      const markedResponse = await postInvoice(ctx, {
        legal_entity_id: fx.po,
        customer_id: customerId,
        stock_already_deducted: true,
        stock_already_reason: 'Albaranes de hace meses, fuera de WineCore',
        lines: [line],
      });
      expect(markedResponse.status).toBe(201);
      const marked = await json(markedResponse);
      expect(marked.stock_already_deducted).toBe(true);
      expect(marked.stock_already_reason).toBe('Albaranes de hace meses, fuera de WineCore');
      expect(marked.moves_stock).toBe(false);
      expect(marked.entity_code).toBe('PO');

      const before = await counts(ctx);
      const issuedPlain = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(unmarked.id)}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `emitir-po-cvpo-${newId()}` },
      }));
      expect(issuedPlain.status).toBe(200);
      const plainMoves = await invoiceMoves(ctx, String(unmarked.id));
      expect(plainMoves).toEqual([{ move_type: 'delivery_out', qty: -6, owner: 'PO', location: 'BOD' }]);
      const plainFiscal = await fiscalOf(ctx, String(unmarked.id));
      expect(plainFiscal).toEqual([{ move_type: 'exit_domestic', volume: -6 * 750, units: -6 }]);
      const afterPlain = await counts(ctx);
      expect(afterPlain.stock).toBeGreaterThan(before.stock);
      expect(afterPlain.fiscal).toBe(before.fiscal + 1);
      expect(afterPlain.bottled).toBeGreaterThan(before.bottled);

      const quiet = await counts(ctx);
      const issuedMarked = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(marked.id)}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `emitir-ya-descontado-${newId()}` },
      }));
      expect(issuedMarked.status).toBe(200);
      const issuedBody = await json(issuedMarked);
      expect(String(issuedBody.number).startsWith(`PF${yy}-`)).toBe(true);
      expect((issuedBody.totals as { total: string }).total).toBe('72.60');
      expect(await invoiceMoves(ctx, String(marked.id))).toEqual([]);
      expect(await fiscalOf(ctx, String(marked.id))).toEqual([]);
      const bottled = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM cellar.bottled_move
        WHERE source_table = 'billing.invoice' AND source_id = CAST(${String(marked.id)} AS UUID)
      `);
      expect(Number(bottled[0]?.n ?? 0)).toBe(0);
      expect(await counts(ctx)).toEqual(quiet);

      const withoutLot = await postInvoice(ctx, {
        legal_entity_id: fx.po,
        customer_id: customerId,
        stock_already_deducted: true,
        stock_already_reason: 'Salida anterior sin lote en WineCore',
        lines: [{ product_id: fx.product, quantity: 2, unit_price: '10' }],
      });
      expect(withoutLot.status).toBe(201);
      const noLot = await json(withoutLot);
      const still = await counts(ctx);
      const issuedNoLot = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(noLot.id)}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `emitir-sin-lote-${newId()}` },
      }));
      expect(issuedNoLot.status).toBe(200);
      expect(await counts(ctx)).toEqual(still);

      const rectResponse = await postInvoice(ctx, {
        legal_entity_id: fx.po,
        customer_id: customerId,
        invoice_type: 'R1',
        rectification_kind: 'S',
        reason: 'Sustituye una factura cuyo stock ya había salido',
        rectifies: [{ invoice_id: marked.id }],
        lines: [line],
      });
      expect(rectResponse.status).toBe(201);
      const rect = await json(rectResponse);
      expect(rect.moves_stock).toBe(false);
      const beforeRect = await counts(ctx);
      const issuedRect = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(rect.id)}/issue`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `emitir-rect-${newId()}` },
      }));
      expect(issuedRect.status).toBe(200);
      expect(await counts(ctx)).toEqual(beforeRect);
      expect(await invoiceMoves(ctx, String(rect.id))).toEqual([]);
      expect(await fiscalOf(ctx, String(rect.id))).toEqual([]);

      const pending = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(marked.id)}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: 'duplicate', reason_text: 'No devolver stock' }),
      }));
      expect(pending.status).toBe(202);
      const pendingBody = await json(pending);
      await ctx.writer.withWrite(actor, (tx) => grantBillingApproval(tx, String(pendingBody.approval_request_id)));
      const voided = await ctx.app.handle(new Request(`http://localhost/v1/invoices/${String(marked.id)}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason_code: 'duplicate', reason_text: 'No devolver stock' }),
      }));
      expect(voided.status).toBe(200);
      expect(await counts(ctx)).toEqual(still);
      expect(await invoiceMoves(ctx, String(marked.id))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

function postInvoice(ctx: App, body: Record<string, unknown>): Promise<Response> {
  return ctx.app.handle(new Request('http://localhost/v1/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

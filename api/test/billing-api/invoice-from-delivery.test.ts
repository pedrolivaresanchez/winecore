import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createSeries } from '../../src/core/series';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, type SalesFixture } from '../sales/fixture';

const ctx = await createTestApp();
const fx: SalesFixture = await buildSalesFixture(ctx);

async function onHand(lotId: string): Promise<number> {
  const rows = await ctx.writer.read<{ units: string }>(sql`
    SELECT coalesce(sum(qty_units), 0)::VARCHAR AS units
    FROM inventory.stock_move
    WHERE lot_id = CAST(${lotId} AS UUID)
  `);
  return Number(rows[0]?.units ?? 0);
}

async function invoiceMoves(invoiceId: string): Promise<number> {
  const rows = await ctx.writer.read<{ n: number }>(sql`
    SELECT count(*)::INTEGER AS n
    FROM inventory.stock_move
    WHERE source_table = 'billing.invoice' AND source_id = CAST(${invoiceId} AS UUID)
  `);
  return Number(rows[0]?.n ?? 0);
}

async function bottles(placementId: string): Promise<number> {
  const rows = await ctx.writer.read<{ n: string }>(sql`
    SELECT coalesce(sum(qty_units), 0)::VARCHAR AS n
    FROM cellar.bottled_move
    WHERE placement_id = CAST(${placementId} AS UUID)
  `);
  return Number(rows[0]?.n ?? 0);
}

async function placeBottles(locationId: string, lotId: string, productId: string, ownerId: string, qty: number): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'place', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO cellar.bottled_placement (
        id, location_id, slot_kind, slot_code, line_no, wine_label, lot_id, product_id,
        owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml, product_state, not_for_sale,
        match_status, source_sheet, source_row, photo_date
      ) VALUES (
        CAST(${id} AS UUID), CAST(${locationId} AS UUID), 'caja', ${`C${id.slice(0, 6)}`.toUpperCase()}, 1,
        'Caja', CAST(${lotId} AS UUID), CAST(${productId} AS UUID), CAST(${ownerId} AS UUID),
        ${qty}, 750, ${qty * 750}, 'packaged_labeled', FALSE, 'matched', ${id}, 1, DATE '2026-11-09'
      )
    `);
    tx.write(sql`
      INSERT INTO cellar.bottled_move (
        id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
      ) VALUES (
        CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-09 11:00:00+01', CAST(${id} AS UUID),
        ${qty}, ${qty * 750}, 'opening', CAST(${lotId} AS UUID), 'cellar.bottled_placement', CAST(${id} AS UUID), 'test'
      )
    `);
  });
  return id;
}

describe('facturar un albarán', () => {
  it('crea el borrador en P.O y en CVPO, copia las líneas y no descuenta el stock otra vez', async () => {
    const year = fx.year;
    const yy = String(year).slice(2);
    await ctx.writer.withWrite({ type: 'system', id: 'series-factura', requestId: newId() }, async (tx) => {
      await createSeries(tx, {
        legal_entity_id: fx.po, doc_type: 'invoice', code: 'PF', prefix: `PF${yy}-`, padding: 4, is_default: true, verifactu: false, year,
      });
      await createSeries(tx, {
        legal_entity_id: fx.cvpo, doc_type: 'invoice', code: 'CF', prefix: `CF${yy}-`, padding: 4, is_default: true, verifactu: false, year,
      });
      tx.write(sql`
        UPDATE party.contact
        SET payment_method = 'transfer', payment_terms_days = 45
        WHERE id = CAST(${fx.customer} AS UUID)
      `);
      tx.write(sql`
        UPDATE party.contact
        SET payment_method = 'direct_debit', payment_terms_days = 60
        WHERE id = CAST(${fx.cvpoBuyer} AS UUID)
      `);
    });

    await ctx.writer.withWrite({ type: 'system', id: 'stock-cvpo', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
          qty_units, volume_ml, mass_g, source_table, source_id, created_by
        ) VALUES (
          CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-10-02 10:00:00+02', 'opening',
          CAST(${fx.bod} AS UUID), CAST(${fx.cvpo} AS UUID), CAST(${fx.lot} AS UUID), CAST(${fx.product} AS UUID),
          'packaged_labeled', 100, 75000, 0, 'inventory.inventory_count', CAST(${newId()} AS UUID), 'test'
        )
      `);
    });

    const cases = [
      { entity: fx.po, customer: fx.customer, code: 'PO', method: 'transfer', days: 45, status: 'issued' as const },
      { entity: fx.cvpo, customer: fx.cvpoBuyer, code: 'CVPO', method: 'direct_debit', days: 60, status: 'delivered' as const },
    ];

    for (const item of cases) {
      const note = await json(ctx, 'POST', '/v1/delivery-notes', {
        kind: 'sale',
        legal_entity_id: item.entity,
        customer_id: item.customer,
        from_location_id: fx.bod,
        customer_references: 'ECI-7781',
        notes: 'Nota interna de bodega',
        customer_note: 'Obsequio',
        lines: [{
          product_id: fx.product,
          quantity: '2',
          lot_id: fx.lot,
          unit_price: '12.5',
          discount_pct: '10',
          tax_code: 'IVA21',
          description: 'Tinto Ejemplo',
        }],
      });
      await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
      if (item.status === 'delivered') {
        const delivered = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/deliver`);
        expect(delivered.status).toBe('delivered');
      }
      const placement = await placeBottles(fx.bod, fx.lot, fx.product, fx.po, 24);
      const before = await onHand(fx.lot);
      const bottlesBefore = await bottles(placement);

      const draft = await json(ctx, 'POST', '/v1/invoices', {
        legal_entity_id: item.entity,
        customer_id: item.customer,
        from_delivery_notes: [String(note.id)],
      });
      expect(draft.legal_entity_id).toBe(item.entity);
      expect(draft.entity_code).toBe(item.code);
      expect(draft.customer_id).toBe(item.customer);
      expect(draft.status).toBe('draft');
      expect(draft.payment_method).toBe(item.method);
      expect(draft.payment_terms_days).toBe(item.days);
      expect(draft.notes ?? null).toBeNull();
      expect(draft.customer_note).toBe('Obsequio');
      expect(draft.customer_references).toBe('ECI-7781');
      expect(JSON.stringify(draft)).not.toContain('Nota interna de bodega');
      const lines = draft.lines as {
        quantity: string;
        unit_price: string;
        discount_pct: string;
        tax_code: string;
        lot_id: string;
        lot_code: string;
        delivery_note_line_id: string;
      }[];
      expect(lines).toHaveLength(1);
      expect(Number(lines[0]?.quantity)).toBe(2);
      expect(Number(lines[0]?.unit_price)).toBe(12.5);
      expect(Number(lines[0]?.discount_pct)).toBe(10);
      expect(lines[0]?.tax_code).toBe('IVA21');
      expect(lines[0]?.lot_id).toBe(fx.lot);
      expect(lines[0]?.lot_code).toBe('L25T01B1');
      expect(lines[0]?.delivery_note_line_id).toBeTruthy();

      const duplicate = await call(ctx, 'POST', '/v1/invoices', {
        from_delivery_notes: [String(note.id)],
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body?.code).toBe('WC_INV_ALREADY_INVOICED');
      expect((duplicate.body?.details as { invoice_id?: string } | undefined)?.invoice_id).toBe(draft.id);

      const issued = await json(ctx, 'POST', `/v1/invoices/${String(draft.id)}/issue`, undefined, {
        'Idempotency-Key': `emitir-${item.code}-${String(note.id)}`,
      });
      expect(String(issued.number).startsWith(item.code === 'PO' ? `PF${yy}-` : `CF${yy}-`)).toBe(true);
      expect(await onHand(fx.lot)).toBe(before);
      expect(await invoiceMoves(String(draft.id))).toBe(0);
      expect(await bottles(placement)).toBe(bottlesBefore);

      const fresh = await json(ctx, 'GET', `/v1/delivery-notes/${String(note.id)}`);
      expect(fresh.invoicing_status).toBe('invoiced');
      expect((fresh.invoice as { id: string; number: string; status: string }).id).toBe(draft.id);
      expect((fresh.invoice as { number: string }).number).toBe(issued.number);
      expect((fresh.invoice as { status: string }).status).toBe('issued');
    }
  });

  it('acepta un albarán enviado y rechaza el que no se factura', async () => {
    const shipped = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(shipped.id)}/issue`);
    await json(ctx, 'POST', `/v1/delivery-notes/${String(shipped.id)}/dispatch`, { tracking_ref: 'SEG-9' });
    const fromShipped = await json(ctx, 'POST', '/v1/invoices', { from_delivery_notes: [String(shipped.id)] });
    expect(fromShipped.status).toBe('draft');
    expect((fromShipped.lines as unknown[]).length).toBe(1);

    const sample = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sample',
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '1', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(sample.id)}/issue`);
    await json(ctx, 'POST', `/v1/delivery-notes/${String(sample.id)}/not-invoiceable`, { reason: 'muestra' });
    const refused = await call(ctx, 'POST', '/v1/invoices', { from_delivery_notes: [String(sample.id)] });
    expect(refused.status).toBe(422);
  });

  it('cambia el almacén de salida mientras el albarán es borrador', async () => {
    const draft = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      legal_entity_id: fx.cvpo,
      customer_id: fx.cvpoBuyer,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    expect(draft.from_location_id).toBe(fx.bod);
    const moved = await json(ctx, 'PATCH', `/v1/delivery-notes/${String(draft.id)}`, { from_location_id: fx.tfrp });
    expect(moved.from_location_id).toBe(fx.tfrp);
    const again = await json(ctx, 'GET', `/v1/delivery-notes/${String(draft.id)}`);
    expect(again.from_location_id).toBe(fx.tfrp);
  });
});

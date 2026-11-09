import { describe, expect, it } from 'bun:test';
import { demoradoLines } from '../../src/core/catalog/tariff-rules';
import { planBottledDelta } from '../../src/core/inventory/bottled-allocate';
import { matchBottledLine } from '../../src/core/inventory/bottled-match';
import { BARRELS, DECLARED, bottledLines, sumLines } from '../../src/core/inventory/bottled-snapshot';
import { loadTariffs } from '../../src/core/catalog/load-tariffs';
import { loadBottledStock } from '../../src/core/inventory/load-bottled';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

describe('foto de envasado', () => {
  it('cuadra las botellas y los litros de cada hoja', () => {
    const lines = bottledLines();
    expect(sumLines(lines, 'caja')).toEqual(DECLARED.cajas);
    expect(sumLines(lines, 'nicho')).toEqual(DECLARED.nichos);
    expect(sumLines(lines, 'jaulon')).toEqual(DECLARED.jaulones);
    expect(sumLines(lines, 'palet')).toEqual(DECLARED.tfrp_lines);
    expect(DECLARED.tfrp_lines.volume_ml - DECLARED.tfrp_sheet_cell.volume_ml).toBe(54_000);
    const niches = new Set(lines.filter((line) => line.slot_kind === 'nicho').map((line) => line.niche_number));
    expect(niches.size).toBe(26);
    expect(lines.find((line) => line.wine_label === 'WINEOUT')?.not_for_sale).toBe(true);
    expect(lines.find((line) => line.wine_label === 'Melós 2019')?.lot_code).toBe('2019');
    expect(lines.find((line) => line.wine_label === 'Garnacha Pirotécnica 2023')?.lot_code).toBe('EGP2023');
    expect(lines.find((line) => line.wine_label === 'DEMORADO 2024')?.lot_code).toBe('L2024');
    expect(lines.find((line) => line.wine_label === 'DEMORADO 2024')?.bottle_ml).toBe(500);
  });

  it('deja Demorado en 2024 aunque tres PDF impriman 2023', () => {
    const lines = demoradoLines();
    expect(lines.map((line) => line.vintage)).toEqual([2024, 2024, 2024, 2024, 2024]);
    expect(lines.map((line) => line.lot)).toEqual(['L2024', 'L2024', 'L2024', 'L2024', 'L2024']);
    expect(lines.find((line) => line.list === 'final')?.pdfVintage).toBe(2023);
    expect(lines.find((line) => line.list === 'distributor')?.pdfVintage).toBe(2024);
    expect(lines.find((line) => line.list === 'custom-pyrene')?.currency).toBe('EUR');
    expect(lines.find((line) => line.list === 'custom-pyrene')?.price).toBe('13.00');
  });

  it('no casa un nombre a medias ni inventa el vino de FT', () => {
    const wines = [{ id: 'w1', code: 'MUSCAT', name: 'Muscat', color: 'white', organic: true }];
    const line = bottledLines().find((item) => item.wine_label === 'metodomuscat 19');
    expect(line).toBeTruthy();
    const matched = matchBottledLine(line!, wines, [], []);
    expect(matched.wineId).toBeNull();
    expect(matched.status).toBe('unmatched');
  });

  it('agota el nicho antes que el siguiente', () => {
    const rows = [
      { id: 'a', locationId: 'bod', lotId: 'l', productId: 'p', productState: 'packaged_labeled', bottleMl: 750, bottles: 4, lineNo: 2, nicheNumber: 14 },
      { id: 'b', locationId: 'bod', lotId: 'l', productId: 'p', productState: 'packaged_labeled', bottleMl: 750, bottles: 10, lineNo: 1, nicheNumber: 2 },
      { id: 'c', locationId: 'tfrp', lotId: 'l', productId: 'p', productState: 'packaged_labeled', bottleMl: 750, bottles: 100, lineNo: 1, nicheNumber: null },
    ];
    expect(planBottledDelta(rows, { locationId: 'bod', lotId: 'l', productId: 'p', productState: 'packaged_labeled', units: -6 })).toEqual([
      { placementId: 'b', units: -6, volumeMl: -4500 },
    ]);
  });
});

describe('carga de la foto', () => {
  it('crea bodega, barricas vacías y llenas, nichos y el desfase de palets', async () => {
    const ctx = await createTestApp();
    try {
      const report = await loadBottledStock(ctx.writer);
      expect(report.totals.cajas).toEqual({ bottles: 4251, litres: '3.134,25' });
      expect(report.totals.nichos).toEqual({ bottles: 2138, litres: '1.791,5' });
      expect(report.totals.jaulones).toEqual({ bottles: 7705, litres: '5.726,25' });
      expect(report.totals.tfrp).toEqual({ bottles: 8394, litres: '6.295,5' });
      expect(report.pallets).toEqual({ counted: 13, billed: 12, price_eur: '7.20' });
      expect(report.matched).toBe(0);
      const barrels = await ctx.writer.read<{ n: string; litres: string }>(`
        SELECT count(*)::VARCHAR AS n, coalesce(sum(volume_ml), 0)::VARCHAR AS litres
        FROM (
          SELECT v.id, coalesce(sum(m.volume_ml), 0) AS volume_ml
          FROM cellar.vessel v
          LEFT JOIN inventory.stock_move m ON m.vessel_id = v.id
          WHERE v.kind = 'barrel'
          GROUP BY v.id
        ) s
      `);
      expect(barrels[0]?.n).toBe(String(BARRELS.length));
      expect(barrels[0]?.litres).toBe('1825000');
      const empty = await ctx.writer.read<{ n: string }>(`
        SELECT count(*)::VARCHAR AS n FROM cellar.holder WHERE kind = 'nicho' AND code = 'NIC-04'
      `);
      expect(empty[0]?.n).toBe('1');
      const again = await loadBottledStock(ctx.writer);
      expect(again.already_loaded).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('descuenta el lote enlazado del almacén TFRP al facturar CVPO', async () => {
    const ctx = await createTestApp();
    try {
      const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
      const po = entities.find((row) => row.code === 'PO');
      expect(po).toBeTruthy();
      const wine = newId();
      const format = newId();
      const product = newId();
      const lot = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'bottled-match', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color) VALUES (CAST(${wine} AS UUID), 'ARCAL', 'Arcal', 'white')
        `);
        tx.write(sql`
          INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
          VALUES (CAST(${format} AS UUID), 'B075', 'Botella 0,75', 'bottle', 750)
        `);
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, unit, requires_lot)
          VALUES (CAST(${product} AS UUID), 'ARCAL-2023', 'Arcal 2023', 'wine', CAST(${wine} AS UUID), 2023, CAST(${format} AS UUID), 'ud', TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
          VALUES (CAST(${lot} AS UUID), CAST(${po!.id} AS UUID), '2023', 'bottled', CAST(${wine} AS UUID), 2023, 'opening_count')
        `);
      });
      const report = await loadBottledStock(ctx.writer);
      expect(report.matched).toBeGreaterThan(0);
      const before = await ctx.writer.read<{ bottles: string }>(sql`
        SELECT coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
        FROM cellar.bottled_move m
        JOIN cellar.bottled_placement p ON p.id = m.placement_id
        JOIN inventory.location loc ON loc.id = p.location_id
        WHERE p.lot_id = CAST(${lot} AS UUID) AND loc.code = 'TFRP'
      `);
      expect(Number(before[0]?.bottles)).toBe(1254);
      const { deductInvoicedBottles } = await import('../../src/core/inventory/bottled-ledger');
      await ctx.writer.withWrite({ type: 'system', id: 'invoice-bottles', requestId: newId() }, async (tx) => {
        await deductInvoicedBottles(tx, {
          invoiceId: newId(),
          number: 'FA-1',
          entityCode: 'CVPO',
          issueDate: '2026-11-10',
          actorId: 'test',
          lines: [{ id: newId(), productId: product, lotId: lot, quantity: '12', deliveryNoteLineId: null }],
        });
      });
      const after = await ctx.writer.read<{ bottles: string }>(sql`
        SELECT coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
        FROM cellar.bottled_move m
        JOIN cellar.bottled_placement p ON p.id = m.placement_id
        JOIN inventory.location loc ON loc.id = p.location_id
        WHERE p.lot_id = CAST(${lot} AS UUID) AND loc.code = 'TFRP'
      `);
      expect(Number(after[0]?.bottles)).toBe(1242);
      const tariffs = await loadTariffs(ctx.writer);
      const demorado = tariffs.loaded.flatMap((row) => row.prices > 0 ? [row.list] : []);
      expect(demorado).toContain('final');
      const price = await ctx.writer.read<{ price: string; vintage: string }>(sql`
        SELECT i.unit_price::VARCHAR AS price, p.vintage::VARCHAR AS vintage
        FROM catalog.price_list_item i
        JOIN catalog.price_list_version v ON v.id = i.version_id
        JOIN catalog.price_list l ON l.id = v.price_list_id
        JOIN catalog.product p ON p.id = i.product_id
        WHERE l.code = 'final' AND p.id = CAST(${product} AS UUID)
      `);
      expect(price[0]?.vintage).toBe('2023');
      expect(price[0]?.price).toBe('18.000000');
      const pyrene = await ctx.writer.read<{ currency: string }>(sql`
        SELECT currency FROM catalog.price_list WHERE code = 'custom-pyrene'
      `);
      expect(pyrene[0]?.currency).toBe('EUR');
    } finally {
      await ctx.close();
    }
  });
});

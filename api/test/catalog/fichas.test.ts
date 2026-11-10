import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { loadTariffs } from '../../src/core/catalog/load-tariffs';
import { listProductPrices } from '../../src/core/catalog/products';
import { reconcileFichas } from '../../src/core/catalog/reconcile';
import { stockReport } from '../../src/core/reports/stock';
import { listVessels } from '../../src/core/cellar/service/vessels';
import { listBalances } from '../../src/core/inventory/service/stock.service';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();

describe('fichas, vino en stock y tarifa vigente', () => {
  afterAll(async () => {
    await ctx.close();
  });

  it('agrupa el stock con el vino de la tabla lateral y separa enTreDicho', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    if (!po) throw new Error('Falta P.O.');
    const location = newId();
    const arcal = newId();
    const arcalYear = newId();
    const earlyWine = newId();
    const lateWine = newId();
    const arcalProduct = newId();
    const arcalLoose = newId();
    const earlyProduct = newId();
    const lateProduct = newId();
    const lotArcal = newId();
    const lotLoose = newId();
    const lotEarly = newId();
    const lotLate = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'overlay-read', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${location} AS UUID), 'BOD-VIN', 'Bodega vino', 'cellar', CAST(${po} AS UUID))
      `);
      const wine = (id: string, code: string, name: string) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
          VALUES (CAST(${id} AS UUID), ${code}, ${name}, 'red', 'wine', TRUE)
        `);
      };
      wine(arcal, 'ARCAL', 'Arcal');
      wine(arcalYear, 'ARCAL-2023', 'Arcal 2023');
      wine(earlyWine, 'ENTREDICHO', 'enTreDicho');
      wine(lateWine, 'ENTREDICHO-2324', 'enTreDicho 2023-2024');
      const product = (id: string, sku: string, name: string, wineId: string) => {
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
          VALUES (CAST(${id} AS UUID), ${sku}, ${name}, 'wine', CAST(${wineId} AS UUID), 2023, 'ud', TRUE, TRUE)
        `);
      };
      product(arcalProduct, 'ARCAL-B075', 'Arcal', arcal);
      product(arcalLoose, 'ARCAL-2023-SUELTO', 'Arcal 2023', arcalYear);
      product(earlyProduct, 'ENTREDICHO-B075', 'enTreDicho 2021', earlyWine);
      product(lateProduct, 'ENTREDICHO-2324-B075', 'enTreDicho 2023', earlyWine);
      tx.write(sql`
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
        VALUES
          (CAST(${lotArcal} AS UUID), CAST(${po} AS UUID), 'ARC-2023', 'bottled', CAST(${arcal} AS UUID), 2023, 'legacy'),
          (CAST(${lotLoose} AS UUID), CAST(${po} AS UUID), 'ARC-LOOSE', 'bottled', CAST(${arcalYear} AS UUID), 2023, 'legacy'),
          (CAST(${lotEarly} AS UUID), CAST(${po} AS UUID), 'E202122', 'bottled', CAST(${earlyWine} AS UUID), 2021, 'legacy'),
          (CAST(${lotLate} AS UUID), CAST(${po} AS UUID), '202324', 'bottled', CAST(${earlyWine} AS UUID), 2023, 'legacy')
      `);
      tx.write(sql`
        INSERT INTO catalog.wine_overlay (wine_id, merged_into_id, name, hidden)
        VALUES
          (CAST(${arcalYear} AS UUID), CAST(${arcal} AS UUID), NULL, TRUE),
          (CAST(${earlyWine} AS UUID), NULL, 'enTreDicho 2020-2022', FALSE)
      `);
      tx.write(sql`
        INSERT INTO catalog.product_overlay (product_id, wine_id, hidden)
        VALUES
          (CAST(${arcalLoose} AS UUID), CAST(${arcal} AS UUID), FALSE),
          (CAST(${lateProduct} AS UUID), CAST(${lateWine} AS UUID), FALSE)
      `);
      tx.write(sql`
        INSERT INTO inventory.lot_overlay (lot_id, wine_id)
        VALUES
          (CAST(${lotLoose} AS UUID), CAST(${arcal} AS UUID)),
          (CAST(${lotLate} AS UUID), CAST(${lateWine} AS UUID))
      `);
      const move = (productId: string, lotId: string, units: number) => {
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id,
            product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-06-01 12:00:00+02', 'opening', CAST(${location} AS UUID), CAST(${po} AS UUID),
            CAST(${lotId} AS UUID), CAST(${productId} AS UUID),
            'packaged_labeled', ${units}, ${units * 750}, 0, 'ops.data_repair', CAST(${newId()} AS UUID), 'overlay-test'
          )
        `);
      };
      move(arcalProduct, lotArcal, 10);
      move(arcalLoose, lotLoose, 5);
      move(earlyProduct, lotEarly, 4);
      move(lateProduct, lotLate, 7);
    });

    const report = await stockReport(ctx.writer, {
      from: '2026-01-01',
      to: '2026-11-09',
      groupBy: 'wine',
      compare: null,
      entity: 'PO',
      entities: [],
      po: true,
      cvpo: false,
    });
    const labels = report.series.map((row) => row.label).sort();
    expect(labels).toEqual(['Arcal', 'enTreDicho 2020-2022', 'enTreDicho 2023-2024']);
    const arcalRow = report.series.find((row) => row.label === 'Arcal');
    expect(arcalRow?.units).toBe('15');
    const balances = await listBalances(ctx.writer, {
      at: '2099-01-01T00:00:00.000Z',
      locationId: location,
      vesselId: null,
      owner: null,
      productId: null,
      lotId: null,
      state: null,
      limit: 20,
      cursor: null,
    });
    const byLot = new Map(balances.items.map((row) => {
      const shown = row as typeof row & { lot_code: string | null; wine_name: string | null };
      return [shown.lot_code, shown.wine_name];
    }));
    expect(byLot.get('ARC-LOOSE')).toBe('Arcal');
    expect(byLot.get('202324')).toBe('enTreDicho 2023-2024');
    expect(byLot.get('E202122')).toBe('enTreDicho 2020-2022');
  });

  it('el filtro en servicio no devuelve las bajas anotadas', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    if (!po) throw new Error('Falta P.O.');
    const location = newId();
    const live = newId();
    const retired = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'vessel-filter', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${location} AS UUID), 'BOD-VES', 'Bodega vasos', 'cellar', CAST(${po} AS UUID))
      `);
      tx.write(sql`
        INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id, status)
        VALUES
          (CAST(${live} AS UUID), 'BAR-T1', 'En servicio', 'barrel', 225000, 'oak', CAST(${location} AS UUID), 'in_service'),
          (CAST(${retired} AS UUID), 'BAR-T2', 'De baja', 'barrel', 225000, 'oak', CAST(${location} AS UUID), 'in_service')
      `);
      tx.write(sql`
        INSERT INTO cellar.vessel_overlay (vessel_id, status)
        VALUES (CAST(${retired} AS UUID), 'retired')
      `);
    });
    const serving = await listVessels(ctx.writer, new Request('http://localhost/v1/vessels?status=in_service&limit=100'));
    const retiredList = await listVessels(ctx.writer, new Request('http://localhost/v1/vessels?status=retired&limit=100'));
    expect(serving.items.map((row) => row.code)).toContain('BAR-T1');
    expect(serving.items.map((row) => row.code)).not.toContain('BAR-T2');
    expect(serving.total).toBe(serving.items.length);
    expect(retiredList.items.map((row) => row.code)).toContain('BAR-T2');
    expect(retiredList.total).toBe(retiredList.items.filter((row) => row.status === 'retired').length);
  });

  it('anota XPO y O1 sin actualizar filas referenciadas, y no oculta lo que tiene stock', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    if (!po) throw new Error('Falta P.O.');
    const location = newId();
    const xpo = newId();
    const interaction = newId();
    const oxidacion = newId();
    const ecloWine = newId();
    const nebbiaWine = newId();
    const o1 = newId();
    const lem = newId();
    const leo = newId();
    const duplicate = newId();
    const withStock = newId();
    const formatless = [newId(), newId(), newId()];
    const lotXpo = newId();
    const lotLem = newId();
    const lotLeo = newId();
    const list = newId();
    const version = newId();
    const draftVersion = newId();
    const otherLocation = newId();
    const series = newId();
    const note = newId();
    const invoice = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'fichas-seed', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${location} AS UUID), 'BOD-FIC', 'Bodega fichas', 'cellar', CAST(${po} AS UUID))
      `);
      const wine = (id: string, code: string, name: string) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
          VALUES (CAST(${id} AS UUID), ${code}, ${name}, 'red', 'wine', TRUE)
        `);
      };
      wine(xpo, 'XPO', 'XPO');
      wine(interaction, 'XPO-INTERACTION', 'XPO Interaction');
      wine(oxidacion, 'OXIDACION', 'Oxidación');
      wine(ecloWine, 'ECLO', 'Eclo');
      wine(nebbiaWine, 'NEBBIA', 'Nebbia');
      wine(o1, 'LA-GRAN-OXIDACION-O1', 'La Gran Oxidación O1');
      const product = (id: string, sku: string, name: string, wineId: string) => {
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
          VALUES (CAST(${id} AS UUID), ${sku}, ${name}, 'wine', CAST(${wineId} AS UUID), 2023, 'ud', TRUE, TRUE)
        `);
      };
      product(lem, 'LEM2023', 'O1 LEM', oxidacion);
      product(leo, 'LEO22023', 'O2 LEO', oxidacion);
      product(duplicate, 'LA-GRAN-OXIDACION-O1-2023-B050', 'O1 botella', o1);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES (
          CAST(${formatless[0]!} AS UUID), 'ECLO-2022', 'Eclo 2026', 'wine', CAST(${ecloWine} AS UUID),
          2026, 'ud', TRUE, TRUE
        )
      `);
      product(formatless[1]!, 'ENTREDICHO-2122', 'enTreDicho suelto', oxidacion);
      product(withStock, 'MOLINERA-2023', 'Molinera suelta', oxidacion);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES (
          CAST(${formatless[2]!} AS UUID), 'NEBBIA-2022', 'Nebbia suelta', 'wine', CAST(${nebbiaWine} AS UUID),
          2022, 'ud', TRUE, TRUE
        )
      `);
      tx.write(sql`
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
        VALUES
          (CAST(${lotXpo} AS UUID), CAST(${po} AS UUID), 'XPO-L1', 'bottled', CAST(${xpo} AS UUID), 2016, 'legacy'),
          (CAST(${lotLem} AS UUID), CAST(${po} AS UUID), 'LEM2023', 'bottled', CAST(${oxidacion} AS UUID), 2023, 'legacy'),
          (CAST(${lotLeo} AS UUID), CAST(${po} AS UUID), 'LEO22023', 'bottled', CAST(${oxidacion} AS UUID), 2022, 'legacy')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        VALUES (CAST(${list} AS UUID), 'custom-fichas', 'Fichas', 'EUR', FALSE, TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES (CAST(${version} AS UUID), CAST(${list} AS UUID), 1, DATE '2026-01-01', 'active', 'test')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES (CAST(${draftVersion} AS UUID), CAST(${list} AS UUID), 2, DATE '2026-02-01', 'draft', 'test')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES
          (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${lem} AS UUID), 1, 8),
          (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${formatless[0]!} AS UUID), 1, 14),
          (CAST(${newId()} AS UUID), CAST(${draftVersion} AS UUID), CAST(${formatless[2]!} AS UUID), 1, 9)
      `);
      tx.write(sql`
        INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
        VALUES (CAST(${otherLocation} AS UUID), 'BOD-FIC2', 'Otra bodega', 'cellar', CAST(${po} AS UUID))
      `);
      tx.write(sql`
        INSERT INTO sales.delivery_note (id, legal_entity_id, kind, from_location_id, to_location_id, created_by)
        VALUES (
          CAST(${note} AS UUID), CAST(${po} AS UUID), 'transfer',
          CAST(${location} AS UUID), CAST(${otherLocation} AS UUID), 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO sales.delivery_note_line (id, delivery_note_id, line_no, product_id, description, quantity)
        VALUES (CAST(${newId()} AS UUID), CAST(${note} AS UUID), 1, CAST(${formatless[1]!} AS UUID), 'enTreDicho', 1)
      `);
      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix)
        VALUES (CAST(${series} AS UUID), CAST(${po} AS UUID), 'invoice', 'T', 2026, 'TFIC')
      `);
      tx.write(sql`
        INSERT INTO billing.invoice (id, legal_entity_id, series_id, invoice_type, created_by)
        VALUES (CAST(${invoice} AS UUID), CAST(${po} AS UUID), CAST(${series} AS UUID), 'F2', 'test')
      `);
      tx.write(sql`
        INSERT INTO billing.invoice_line (id, invoice_id, line_no, product_id, description, quantity, unit_price, line_base, tax_code)
        VALUES (
          CAST(${newId()} AS UUID), CAST(${invoice} AS UUID), 1, CAST(${formatless[1]!} AS UUID),
          'enTreDicho', 1, 10, 10, 'IVA21'
        )
      `);
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, owner_entity_id, product_id,
          product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
        ) VALUES (
          CAST(${newId()} AS UUID), now(), 'opening', CAST(${location} AS UUID), CAST(${po} AS UUID),
          CAST(${withStock} AS UUID), 'packaged_labeled', 3, 2250, 0, 'ops.data_repair', CAST(${newId()} AS UUID), 'fichas-test'
        )
      `);
    });

    const blocked = await ctx.writer.withWrite({ type: 'system', id: 'fk', requestId: newId() }, async (tx) => {
      try {
        tx.write(sql`UPDATE catalog.product SET wine_id = CAST(${o1} AS UUID) WHERE id = CAST(${lem} AS UUID)`);
        return false;
      } catch (error) {
        return error instanceof Error && /referenced|foreign key/i.test(error.message);
      }
    }).catch((error: unknown) => error instanceof Error && /referenced|foreign key/i.test(error.message));
    expect(blocked).toBe(true);

    const dry = await reconcileFichas(ctx.writer, 'dry-run');
    expect(dry.mode).toBe('dry-run');
    expect(dry.xpo.some((line) => line.includes('XPO-INTERACTION'))).toBe(true);
    expect(dry.o1.some((line) => line.includes('LEM2023'))).toBe(true);
    expect(dry.kept.some((line) => line.includes('MOLINERA-2023') && line.includes('stock'))).toBe(true);
    expect(dry.kept.some((line) => line.includes('ECLO-2022') && line.includes('tarifa activa'))).toBe(true);
    expect(dry.hidden.some((line) => line.includes('ECLO-2022'))).toBe(false);
    expect(dry.hidden.some((line) => line.includes('ENTREDICHO-2122'))).toBe(true);
    expect(dry.hidden.some((line) => line.includes('NEBBIA-2022'))).toBe(true);
    expect(dry.kept.some((line) => line.includes('ENTREDICHO-2122') || line.includes('NEBBIA-2022'))).toBe(false);
    expect(dry.hidden.some((line) => line.includes('LA-GRAN-OXIDACION-O1-2023-B050'))).toBe(true);
    expect(dry.notes.some((line) => line.includes('O2'))).toBe(true);

    const applied = await reconcileFichas(ctx.writer, 'apply');
    expect(applied.skipped).toEqual([]);
    const stored = await ctx.writer.read<{ sku: string; wine: string }>(`
      SELECT p.sku, w.code AS wine
      FROM catalog.product p
      JOIN catalog.wine w ON w.id = p.wine_id
      WHERE p.sku IN ('LEM2023', 'LEO22023')
    `);
    const storedWine = new Map(stored.map((row) => [row.sku, row.wine]));
    expect(storedWine.get('LEM2023')).toBe('OXIDACION');
    expect(storedWine.get('LEO22023')).toBe('OXIDACION');
    const shown = await ctx.writer.read<{ sku: string; wine: string; hidden: boolean }>(`
      SELECT p.sku, w.code AS wine, COALESCE(po.hidden, FALSE) AS hidden
      FROM catalog.product p
      LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
      JOIN catalog.wine w ON w.id = COALESCE(po.wine_id, p.wine_id)
      WHERE p.sku IN ('LEM2023', 'LEO22023', 'LA-GRAN-OXIDACION-O1-2023-B050', 'ECLO-2022', 'MOLINERA-2023', 'NEBBIA-2022', 'ENTREDICHO-2122')
    `);
    const bySku = new Map(shown.map((row) => [row.sku, row]));
    expect(bySku.get('LEM2023')?.wine).toBe('LA-GRAN-OXIDACION-O1');
    expect(bySku.get('LEM2023')?.hidden).toBe(false);
    expect(bySku.get('LEO22023')?.wine).toBe('OXIDACION');
    expect(bySku.get('LA-GRAN-OXIDACION-O1-2023-B050')?.hidden).toBe(true);
    expect(bySku.get('ECLO-2022')?.hidden).toBe(false);
    expect(bySku.get('ECLO-2022')?.wine).toBe('ECLO');
    expect(bySku.get('ENTREDICHO-2122')?.hidden).toBe(true);
    expect(bySku.get('NEBBIA-2022')?.hidden).toBe(true);
    expect(bySku.get('MOLINERA-2023')?.hidden).toBe(false);
    const xpoVisible = await ctx.writer.read<{ code: string; active: boolean }>(`
      SELECT w.code, v.is_active AS active
      FROM catalog.wine w
      JOIN catalog.wine_visible v ON v.id = w.id
      WHERE w.code = 'XPO'
    `);
    expect(xpoVisible[0]?.active).toBe(false);
    const xpoRow = await ctx.writer.read<{ active: boolean }>(`SELECT is_active AS active FROM catalog.wine WHERE code = 'XPO'`);
    expect(xpoRow[0]?.active).toBe(true);
    const oxidacionVisible = await ctx.writer.read<{ active: boolean }>(`SELECT is_active AS active FROM catalog.wine_visible WHERE code = 'OXIDACION'`);
    expect(oxidacionVisible[0]?.active).toBe(true);
    const lotWine = await ctx.writer.read<{ code: string; wine: string }>(`
      SELECT l.code, w.code AS wine
      FROM inventory.lot l
      LEFT JOIN inventory.lot_overlay o ON o.lot_id = l.id
      JOIN catalog.wine w ON w.id = COALESCE(o.wine_id, l.wine_id)
      WHERE l.code IN ('LEM2023', 'LEO22023', 'XPO-L1')
    `);
    const lotMap = new Map(lotWine.map((row) => [row.code, row.wine]));
    expect(lotMap.get('LEM2023')).toBe('LA-GRAN-OXIDACION-O1');
    expect(lotMap.get('LEO22023')).toBe('OXIDACION');
    expect(lotMap.get('XPO-L1')).toBe('XPO-INTERACTION');
    const merged = await ctx.writer.read<{ sku: string }>(`
      SELECT into_product.sku
      FROM catalog.product_overlay po
      JOIN catalog.product drop_product ON drop_product.id = po.product_id
      JOIN catalog.product into_product ON into_product.id = po.merged_into_id
      WHERE drop_product.sku = 'LA-GRAN-OXIDACION-O1-2023-B050'
    `);
    expect(merged[0]?.sku).toBe('LEM2023');

    const again = await reconcileFichas(ctx.writer, 'apply');
    expect(again.skipped.some((line) => line.includes('Ya está aplicada'))).toBe(true);

    const undone = await reconcileFichas(ctx.writer, 'revert');
    expect(undone.mode).toBe('revert');
    const restored = await ctx.writer.read<{ wine: string }>(`
      SELECT w.code AS wine
      FROM catalog.product p
      LEFT JOIN catalog.product_overlay po ON po.product_id = p.id
      JOIN catalog.wine w ON w.id = COALESCE(po.wine_id, p.wine_id)
      WHERE p.sku = 'LEM2023'
    `);
    expect(restored[0]?.wine).toBe('OXIDACION');
    const xpoBack = await ctx.writer.read<{ active: boolean }>(`SELECT is_active AS active FROM catalog.wine_visible WHERE code = 'XPO'`);
    expect(xpoBack[0]?.active).toBe(true);
  });

  it('la ficha de precios se queda con la versión activa más reciente de cada tarifa', async () => {
    const product = newId();
    const wine = newId();
    const shop = newId();
    const pyrene = newId();
    const shopV1 = newId();
    const shopV2 = newId();
    const pyreneV1 = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'prices', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
        VALUES (CAST(${wine} AS UUID), 'PRECIO-TEST', 'Precio', 'red', 'wine', TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES (CAST(${product} AS UUID), 'PRECIO-B075', 'Precio', 'wine', CAST(${wine} AS UUID), 2023, 'ud', TRUE, TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        VALUES
          (CAST(${shop} AS UUID), 'custom-tienda-ficha', 'Tienda', 'EUR', TRUE, TRUE),
          (CAST(${pyrene} AS UUID), 'custom-pyrene-ficha', 'Pyrene', 'EUR', FALSE, TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES
          (CAST(${shopV1} AS UUID), CAST(${shop} AS UUID), 1, DATE '2026-01-01', 'active', 'test'),
          (CAST(${shopV2} AS UUID), CAST(${shop} AS UUID), 2, DATE '2026-06-01', 'active', 'test'),
          (CAST(${pyreneV1} AS UUID), CAST(${pyrene} AS UUID), 1, DATE '2026-01-01', 'active', 'test')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES
          (CAST(${newId()} AS UUID), CAST(${shopV1} AS UUID), CAST(${product} AS UUID), 1, 10),
          (CAST(${newId()} AS UUID), CAST(${shopV2} AS UUID), CAST(${product} AS UUID), 1, 12),
          (CAST(${newId()} AS UUID), CAST(${pyreneV1} AS UUID), CAST(${product} AS UUID), 1, 9)
      `);
    });
    const page = await listProductPrices(ctx.writer, new Request('http://localhost/v1/products/' + product + '/prices'), product);
    const versions = page.items.map((row) => `${row.code}:v${row.version}`).sort();
    expect(versions).toEqual(['custom-pyrene-ficha:v1', 'custom-tienda-ficha:v2']);
    expect(page.total).toBe(2);
  });

  it('casa Bobal serie Wild con EB2023 y deja Apañao 2024 sin decidir', async () => {
    const wild = newId();
    const apanao = newId();
    const eb = newId();
    const ao = newId();
    const plain = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'tariff-alias', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
        VALUES
          (CAST(${wild} AS UUID), 'BOBAL-WILD', 'Bobal wild', 'red', 'wine', TRUE),
          (CAST(${apanao} AS UUID), 'APANAO', 'Apañao', 'red', 'wine', TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES
          (CAST(${eb} AS UUID), 'EB2023', 'Bobal wild 2023', 'wine', CAST(${wild} AS UUID), 2023, 'ud', TRUE, TRUE),
          (CAST(${ao} AS UUID), 'APA-AO-2024', 'Apañao 2024', 'wine', CAST(${apanao} AS UUID), 2024, 'ud', TRUE, TRUE),
          (CAST(${plain} AS UUID), 'APANAO-2024', 'Apañao 2024', 'wine', CAST(${apanao} AS UUID), 2024, 'ud', TRUE, TRUE)
      `);
    });
    const tariffs = await loadTariffs(ctx.writer);
    const bobal = tariffs.unmatched.filter((row) => row.wine === 'Bobal serie Wild' && row.vintage === '2023');
    const apanaoLeft = tariffs.unmatched.filter((row) => row.wine === 'Apañao' && row.vintage === '2024');
    expect(bobal).toEqual([]);
    expect(apanaoLeft.length).toBeGreaterThan(0);
    const priced = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n
      FROM catalog.price_list_item i
      JOIN catalog.product p ON p.id = i.product_id
      WHERE p.sku = 'EB2023'
    `);
    const firstCount = Number(priced[0]?.n ?? 0);
    expect(firstCount).toBeGreaterThan(0);
    const apanaoPriced = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n
      FROM catalog.price_list_item i
      JOIN catalog.product p ON p.id = i.product_id
      WHERE p.sku IN ('APA-AO-2024', 'APANAO-2024')
    `);
    expect(Number(apanaoPriced[0]?.n ?? 0)).toBe(0);
    await ctx.writer.withWrite({ type: 'system', id: 'tariff-gap', requestId: newId() }, async (tx) => {
      tx.write(sql`
        DELETE FROM catalog.price_list_item
        WHERE product_id = CAST(${eb} AS UUID)
      `);
    });
    const again = await loadTariffs(ctx.writer);
    expect(again.unmatched.filter((row) => row.wine === 'Bobal serie Wild' && row.vintage === '2023')).toEqual([]);
    expect(again.unmatched.filter((row) => row.wine === 'Apañao' && row.vintage === '2024').length).toBeGreaterThan(0);
    const refilled = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n
      FROM catalog.price_list_item i
      JOIN catalog.product p ON p.id = i.product_id
      WHERE p.sku = 'EB2023'
    `);
    expect(Number(refilled[0]?.n ?? 0)).toBe(firstCount);
    const versions = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n
      FROM catalog.price_list_version v
      JOIN catalog.price_list l ON l.id = v.price_list_id
      WHERE l.code = 'distributor' AND v.notes LIKE 'tarifa-pedro-2026%'
    `);
    expect(Number(versions[0]?.n ?? 0)).toBe(1);
  });
});

import { describe, expect, it } from 'bun:test';

import { seedValuationPrices } from '../../src/core/inventory/valuation-seed';
import {
  chooseStoredPrice,
  currentVersion,
  exVatUnit,
  litresValue,
  mergePackaged,
  parseEur,
  previousPriceNote,
  unitsValue,
  wineTypeOf,
  type TariffPrice,
  type TariffVersion,
} from '../../src/core/inventory/valuation';
import { createTestApp } from '../helpers';
import { call, insertStockMove, jsonOf, seedCellar } from '../stock-api/fixture';

const SRC = '019a1000-0000-7000-8000-0000000000aa';

describe('precio de valoración', () => {
  const today = '2026-11-13';
  const current: TariffVersion = { id: 'v2', version: 2, validFrom: '2026-01-01', validTo: null, status: 'active' };
  const rows: TariffPrice[] = [
    { productId: 'p', unitPrice: '18.000000', minQty: '1', versionId: 'v2', version: 2, validFrom: '2026-01-01', status: 'active' },
    { productId: 'p', unitPrice: '10.000000', minQty: '1', versionId: 'v1', version: 1, validFrom: '2025-01-01', status: 'retired' },
    { productId: 'old', unitPrice: '7.500000', minQty: '1', versionId: 'v1', version: 1, validFrom: '2025-01-01', status: 'retired' },
    { productId: 'old', unitPrice: '12.000000', minQty: '1', versionId: 'v15', version: 2, validFrom: '2025-06-01', status: 'retired' },
    { productId: 'old', unitPrice: '99.000000', minQty: '1', versionId: 'draft', version: 3, validFrom: '2026-06-01', status: 'draft' },
    { productId: 'future', unitPrice: '4.000000', minQty: '1', versionId: 'soon', version: 4, validFrom: '2027-01-01', status: 'active' },
  ];

  it('usa la vigente, si no la anterior más reciente, y no inventa', () => {
    expect(currentVersion([
      { id: 'v1', version: 1, validFrom: '2025-01-01', validTo: '2026-01-01', status: 'retired' },
      current,
      { id: 'soon', version: 4, validFrom: '2027-01-01', validTo: null, status: 'active' },
    ], today)?.id).toBe('v2');
    expect(chooseStoredPrice(rows, 'p', current, today)).toMatchObject({ stored: '18.000000', origin: 'current', version: 2 });
    expect(chooseStoredPrice(rows, 'old', current, today)).toMatchObject({ stored: '12.000000', origin: 'previous', version: 2, validFrom: '2025-06-01' });
    expect(chooseStoredPrice(rows, 'future', current, today)).toBeNull();
    expect(chooseStoredPrice(rows, 'nadie', current, today)).toBeNull();
    expect(previousPriceNote(2, '2025-06-01')).toBe('Precio de tarifa anterior · v2 · 01/06/2025');
    expect(wineTypeOf('red')).toEqual({ code: 'red', label: 'Tinto' });
    expect(wineTypeOf('blanco')).toEqual({ code: 'white', label: 'Blanco' });
    expect(wineTypeOf(null)).toEqual({ code: 'unknown', label: 'Sin tipo' });
  });

  it('deja la base sin IVA y los importes a 2 decimales', () => {
    expect(exVatUnit('25.000000', true, '21')).toBe('20.66');
    expect(exVatUnit('18.000000', false, '21')).toBe('18.00');
    expect(unitsValue(10, '20.66')).toBe('206.60');
    expect(litresValue(16_000, '50.00')).toEqual({ litres: '16.00', value: '800.00' });
    expect(litresValue(936_000, '0.00')).toEqual({ litres: '936.00', value: '0.00' });
    expect(parseEur('1.234,56', 'price')).toBe('1234.56');
    expect(parseEur('50,5', 'price')).toBe('50.50');
    expect(() => parseEur('3.555', 'price')).toThrow(/2 decimales|no válido/);
  });

  it('cuenta una vez Arcal, La Gran Oxidación O1 y XPO aunque el libro no traiga la misma clave', () => {
    const map = [
      row({ location_code: 'BOD', product_id: 'arcal', lot_id: 'lot-2023', bottles: 912, volume_ml: 684_000, sku: 'ARCAL-2023' }),
      row({ location_code: 'TFRP', product_id: 'arcal', lot_id: 'lot-2023', bottles: 1254, volume_ml: 940_500, sku: 'ARCAL-2023' }),
      row({ location_code: 'BOD', product_id: 'o1', lot_id: 'lem', bottles: 70, volume_ml: 35_000, sku: 'LEM2023' }),
      row({ location_code: 'BOD', product_id: 'xpo', lot_id: 'l2021', bottles: 27, volume_ml: 20_250, sku: 'XPO-2016' }),
    ];
    const book = [
      row({ location_code: 'BOD', bottles: 912, volume_ml: 684_000 }),
      row({ location_code: 'TFRP', lot_id: 'otro-lote', bottles: 1254, volume_ml: 940_500 }),
      row({ location_code: 'BOD', lot_id: 'lem', bottles: 70, volume_ml: 35_000 }),
      row({ location_code: 'BOD', product_id: 'xpo', bottles: 27, volume_ml: 20_250 }),
    ];
    const merged = mergePackaged(map, book);
    expect(merged.reduce((sum, line) => sum + line.bottles, 0)).toBe(912 + 1254 + 70 + 27);
    expect(merged.filter((line) => line.sku === 'ARCAL-2023').map((line) => line.bottles).sort((a, b) => a - b)).toEqual([912, 1254]);
    expect(merged.find((line) => line.sku === 'LEM2023')?.bottles).toBe(70);
    expect(merged.find((line) => line.sku === 'XPO-2016')?.bottles).toBe(27);
    const distinct = mergePackaged(
      [
        row({ location_code: 'BOD', product_id: 'a', lot_id: 'shared', bottles: 4, volume_ml: 3_000 }),
        row({ location_code: 'BOD', product_id: 'b', lot_id: 'shared', bottles: 2, volume_ml: 1_500 }),
      ],
      [],
    );
    expect(distinct).toHaveLength(2);
    expect(distinct.reduce((sum, line) => sum + line.bottles, 0)).toBe(6);
  });
});

function row(partial: { location_code: string; bottles: number; volume_ml: number; product_id?: string; lot_id?: string; sku?: string }) {
  return {
    location_code: partial.location_code,
    product_id: partial.product_id ?? null,
    lot_id: partial.lot_id ?? null,
    bottles: partial.bottles,
    volume_ml: partial.volume_ml,
    sku: partial.sku ?? null,
  };
}

describe('valoración de existencias', () => {
  it('desglosa por almacén y vino, con tarifa anterior, precio fijado y lías a cero', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const oldProduct = '019a1000-0000-7000-8000-000000000043';
      const bareProduct = '019a1000-0000-7000-8000-000000000044';
      const lotOld = '019a1000-0000-7000-8000-000000000035';
      const list = '019a1000-0000-7000-8000-000000000050';
      const v1 = '019a1000-0000-7000-8000-000000000051';
      const v2 = '019a1000-0000-7000-8000-000000000052';
      const draft = '019a1000-0000-7000-8000-000000000053';
      const dam = '019a1000-0000-7000-8000-000000000060';
      const lias = '019a1000-0000-7000-8000-000000000061';
      const place = '019a1000-0000-7000-8000-000000000070';
      await ctx.client.query(`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, unit, default_tax_code, requires_lot)
        VALUES
          ('${oldProduct}', 'OLD-075', 'Tinto anterior', 'wine', '${cellar.wine}', 2024, '${cellar.format}', 'ud', 'IVA21', TRUE),
          ('${bareProduct}', 'BARE-075', 'Tinto sin tarifa', 'wine', '${cellar.wine}', 2024, '${cellar.format}', 'ud', 'IVA21', TRUE);
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin, status)
        VALUES ('${lotOld}', '${cellar.po}', 'L-OLD', 'bottled', '${cellar.wine}', 2024, 'reception', 'active');
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        VALUES ('${list}', 'distributor', 'Distribución', 'EUR', FALSE, TRUE);
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES
          ('${v1}', '${list}', 1, DATE '2025-01-01', 'retired', 'test'),
          ('${v2}', '${list}', 2, DATE '2026-01-01', 'active', 'test'),
          ('${draft}', '${list}', 3, DATE '2026-06-01', 'draft', 'test');
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES
          ('019a1000-0000-7000-8000-000000000081', '${v2}', '${cellar.product}', 1, 18.000000),
          ('019a1000-0000-7000-8000-000000000082', '${v1}', '${oldProduct}', 1, 7.500000),
          ('019a1000-0000-7000-8000-000000000083', '${draft}', '${oldProduct}', 1, 99.000000);
        INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id, status)
        VALUES
          ('${dam}', 'DAM-01', 'Damajuana 1', 'demijohn', 20000, 'glass', '${cellar.bod}', 'in_service'),
          ('${lias}', 'LIAS', 'Depósito lías', 'other', 1000000, 'plastic', '${cellar.bod}', 'in_service');
        INSERT INTO cellar.bottled_placement (
          id, location_id, slot_kind, slot_code, line_no, wine_label, product_id, lot_id, owner_entity_id,
          bottle_ml, product_state, match_status, source_sheet, source_row, photo_date
        ) VALUES (
          '${place}', '${cellar.vlc}', 'palet', 'PAL-1', 1, 'Tinto', '${cellar.product}', '${cellar.lotPack}', '${cellar.po}',
          750, 'packaged_labeled', 'matched', 'test', 1, DATE '2026-11-09'
        );
        INSERT INTO cellar.bottled_move (
          id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
        ) VALUES (
          '019a1000-0000-7000-8000-000000000071', TIMESTAMP '2026-11-09 12:00:00+01', '${place}', 6, 4500,
          'opening', '${cellar.lotPack}', 'cellar.bottled_placement', '${place}', 'test'
        );
      `);
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b1', cellar.bod, null, cellar.lotPack, cellar.product, cellar.po, 10, 7500));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b2', cellar.vlc, null, cellar.lotPack, cellar.product, cellar.po, 10, 7500));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b3', cellar.bod, null, lotOld, oldProduct, cellar.po, 4, 3000));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b4', cellar.bod, null, lotOld, bareProduct, cellar.po, 2, 1500));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b5', cellar.bod, dam, cellar.lotPo, null, cellar.po, 0, 16_000));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b6', cellar.bod, cellar.tankPo, cellar.lotPo, null, cellar.po, 0, 1_000_000));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b7', cellar.bod, lias, null, null, cellar.po, 0, 936_000));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000b8', cellar.bod, cellar.barrel, cellar.lotBarrel, null, cellar.po, 0, 300_000));

      const page = await jsonOf<Valuation>(await ctx.app.handle(call('GET', '/v1/stock/valuation?list=distributor')));
      const lines = page.groups.flatMap((group) => group.lines);
      const bod = lines.find((line) => line.location_code === 'BOD' && line.product_id === cellar.product);
      const vlc = lines.find((line) => line.location_code === 'VLC' && line.product_id === cellar.product);
      const old = lines.find((line) => line.product_id === oldProduct);
      const bare = lines.find((line) => line.product_id === bareProduct);
      const lees = lines.find((line) => line.vessel_code === 'LIAS');
      expect(bod).toMatchObject({ bottles: 10, litres: '7.50', unit_price: '18.00', value: '180.00', price_origin: 'current', price_note: 'Tarifa vigente' });
      expect(vlc).toMatchObject({ bottles: 6, value: '108.00' });
      expect(old).toMatchObject({
        bottles: 4,
        unit_price: '7.50',
        value: '30.00',
        price_origin: 'previous',
        price_note: 'Precio de tarifa anterior · v1 · 01/01/2025',
      });
      expect(bare).toMatchObject({ missing_price: true, value: null, price_note: 'Sin precio' });
      expect(lees).toMatchObject({ litres: '936.00', unit_price: '0.00', value: '0.00', price_origin: 'worthless', price_note: 'Sin valor' });
      const barrel = lines.find((line) => line.vessel_code === 'BAR-001');
      expect(barrel).toMatchObject({ kind: 'bulk', litres: '300.00', unit_price: '3.00', value: '900.00', price_note: 'Precio por litro' });
      expect(page.packaged).toMatchObject({ bottles: 22, value: '318.00', partial: true, missing: 1, previous: 1 });
      expect(page.demijohns.value).toBe('800.00');
      expect(page.bulk.value).toBe('3900.00');
      expect(page.total).toEqual({ value: '5018.00', partial: true });
      const wine = page.groups.find((group) => group.wine_name === 'Tinto Ejemplo');
      expect(wine?.lines.length).toBeGreaterThan(1);
      expect(wine?.value).toBe('5018.00');
      const tinto = page.types.find((type) => type.label === 'Tinto');
      expect(tinto?.value).toBe('5018.00');
      expect(tinto?.groups.some((group) => group.wine_name === 'Tinto Ejemplo')).toBe(true);
      expect(page.types.find((type) => type.label === 'Sin tipo')?.value).toBe('0.00');

      const fixed = await jsonOf<Valuation>(await ctx.app.handle(call('PUT', '/v1/stock/valuation-settings?list=distributor', {
        price: { product_id: cellar.product, list: 'distributor', unit_price: '9,00' },
      })));
      const fixedBod = fixed.groups.flatMap((group) => group.lines).find((line) => line.location_code === 'BOD' && line.product_id === cellar.product);
      expect(fixedBod).toMatchObject({ unit_price: '9.00', value: '90.00', price_origin: 'override', price_note: 'Precio de valoración' });

      const zero = await jsonOf<Valuation>(await ctx.app.handle(call('PUT', '/v1/stock/valuation-settings?list=distributor', {
        worthless: { subject: 'lot', subject_key: cellar.lotPack, enabled: true },
      })));
      const zeroed = zero.groups.flatMap((group) => group.lines).filter((line) => line.lot_id === cellar.lotPack);
      expect(zeroed.length).toBeGreaterThan(0);
      expect(zeroed.every((line) => line.value === '0.00' && line.price_note === 'Sin valor')).toBe(true);

      const denied = await ctx.app.handle(call('PUT', '/v1/stock/valuation-settings', {
        demijohn_eur_per_litre: '40,00',
      }, 'asesor@winecore.test'));
      expect(denied.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  it('precarga enTreDicho 23-24 y Bobal básico 2025 desde la añada que sí tiene tarifa', async () => {
    const ctx = await createTestApp();
    try {
      const wine = '019a1000-0000-7000-8000-000000000090';
      const format = '019a1000-0000-7000-8000-000000000091';
      const source = '019a1000-0000-7000-8000-000000000092';
      const target = '019a1000-0000-7000-8000-000000000093';
      const bobal2024 = '019a1000-0000-7000-8000-000000000094';
      const bobal2025 = '019a1000-0000-7000-8000-000000000095';
      const final = '019a1000-0000-7000-8000-000000000096';
      const shop = '019a1000-0000-7000-8000-000000000097';
      const finalVersion = '019a1000-0000-7000-8000-000000000098';
      const shopVersion = '019a1000-0000-7000-8000-000000000099';
      await ctx.client.query(`
        INSERT INTO catalog.wine (id, code, name, color, category) VALUES ('${wine}', 'ENTREDICHO', 'enTreDicho', 'red', 'wine');
        INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml) VALUES ('${format}', 'B075', 'Botella', 'bottle', 750);
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, unit, default_tax_code)
        VALUES
          ('${source}', 'E202122', 'enTreDicho 2021-22', 'wine', '${wine}', 2021, '${format}', 'ud', 'IVA21'),
          ('${target}', 'ENT-2324', 'enTreDicho 23-24', 'wine', '${wine}', 2023, '${format}', 'ud', 'IVA21'),
          ('${bobal2024}', 'EBO2024', 'Bobal basic 2024', 'wine', '${wine}', 2024, '${format}', 'ud', 'IVA21'),
          ('${bobal2025}', 'BOBAL-BASIC-2025', 'Bobal basic 2025', 'wine', '${wine}', 2025, '${format}', 'ud', 'IVA21');
        INSERT INTO catalog.price_list (id, code, name, tax_included, is_active) VALUES
          ('${final}', 'final', 'PVP', TRUE, TRUE),
          ('${shop}', 'shop', 'Tienda', FALSE, TRUE);
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by) VALUES
          ('${finalVersion}', '${final}', 1, DATE '2026-01-01', 'active', 'test'),
          ('${shopVersion}', '${shop}', 1, DATE '2026-01-01', 'active', 'test');
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price) VALUES
          ('019a1000-0000-7000-8000-0000000000c1', '${finalVersion}', '${source}', 1, 15.000000),
          ('019a1000-0000-7000-8000-0000000000c2', '${shopVersion}', '${source}', 1, 10.320000),
          ('019a1000-0000-7000-8000-0000000000c3', '${finalVersion}', '${bobal2024}', 1, 12.500000),
          ('019a1000-0000-7000-8000-0000000000c4', '${shopVersion}', '${bobal2024}', 1, 8.220000);
      `);
      await seedValuationPrices(ctx.writer);
      const rows = await ctx.client.query<{ sku: string; list_code: string; unit_price: string }>(`
        SELECT p.sku, v.list_code, CAST(v.unit_price AS VARCHAR) AS unit_price
        FROM inventory.valuation_price v
        JOIN catalog.product p ON p.id = v.product_id
        ORDER BY p.sku, v.list_code
      `);
      expect(rows).toEqual([
        { sku: 'BOBAL-BASIC-2025', list_code: 'final', unit_price: '10.33' },
        { sku: 'BOBAL-BASIC-2025', list_code: 'shop', unit_price: '8.22' },
        { sku: 'ENT-2324', list_code: 'final', unit_price: '12.40' },
        { sku: 'ENT-2324', list_code: 'shop', unit_price: '10.32' },
      ]);
      await seedValuationPrices(ctx.writer);
      const again = await ctx.client.query<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM inventory.valuation_price`);
      expect(Number(again[0]?.n)).toBe(4);
    } finally {
      await ctx.close();
    }
  });

  it('no dobla Arcal 2023, La Gran Oxidación O1 ni XPO Interaction 2016', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const arcal = '019a1000-0000-7000-8000-0000000000d1';
      const o1 = '019a1000-0000-7000-8000-0000000000d2';
      const xpo = '019a1000-0000-7000-8000-0000000000d3';
      const lotArcal = '019a1000-0000-7000-8000-0000000000d4';
      const lotO1 = '019a1000-0000-7000-8000-0000000000d5';
      const lotXpo = '019a1000-0000-7000-8000-0000000000d6';
      const lotOther = '019a1000-0000-7000-8000-0000000000d7';
      const list = '019a1000-0000-7000-8000-0000000000d8';
      const version = '019a1000-0000-7000-8000-0000000000d9';
      await ctx.client.query(`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, unit, default_tax_code, requires_lot)
        VALUES
          ('${arcal}', 'ARCAL-2023', 'Arcal 2023', 'wine', '${cellar.wine}', 2023, '${cellar.format}', 'ud', 'IVA21', TRUE),
          ('${o1}', 'LEM2023', 'La Gran Oxidación O1', 'wine', '${cellar.wine}', 2023, '${cellar.format}', 'ud', 'IVA21', TRUE),
          ('${xpo}', 'XPO-2016', 'XPO Interaction 2016', 'wine', '${cellar.wine}', 2016, '${cellar.format}', 'ud', 'IVA21', TRUE);
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin, status) VALUES
          ('${lotArcal}', '${cellar.po}', '2023', 'bottled', '${cellar.wine}', 2023, 'reception', 'active'),
          ('${lotO1}', '${cellar.po}', 'LEM2023', 'bottled', '${cellar.wine}', 2023, 'reception', 'active'),
          ('${lotXpo}', '${cellar.po}', 'L2021-E1001', 'bottled', '${cellar.wine}', 2016, 'reception', 'active'),
          ('${lotOther}', '${cellar.po}', 'OTRO-LOTE', 'bottled', '${cellar.wine}', 2023, 'reception', 'active');
        INSERT INTO catalog.price_list (id, code, name, tax_included, is_active)
        VALUES ('${list}', 'distributor', 'Distribución', FALSE, TRUE);
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES ('${version}', '${list}', 1, DATE '2026-01-01', 'active', 'test');
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price) VALUES
          ('019a1000-0000-7000-8000-0000000000e1', '${version}', '${arcal}', 1, 9.900000),
          ('019a1000-0000-7000-8000-0000000000e2', '${version}', '${xpo}', 1, 130.000000);
      `);
      await place(ctx.client, '019a1000-0000-7000-8000-0000000000e3', cellar.bod, arcal, lotArcal, cellar.po, 912, 684_000);
      await place(ctx.client, '019a1000-0000-7000-8000-0000000000e4', cellar.vlc, arcal, lotArcal, cellar.po, 1254, 940_500);
      await place(ctx.client, '019a1000-0000-7000-8000-0000000000e5', cellar.bod, o1, lotO1, cellar.po, 70, 35_000);
      await place(ctx.client, '019a1000-0000-7000-8000-0000000000e6', cellar.bod, xpo, lotXpo, cellar.po, 27, 20_250);
      await insertStockMove(ctx.client, packaged('019a1000-0000-7000-8000-0000000000e7', cellar.bod, null, null, cellar.po, 912, 684_000));
      await insertStockMove(ctx.client, packaged('019a1000-0000-7000-8000-0000000000e8', cellar.vlc, lotOther, null, cellar.po, 1254, 940_500));
      await insertStockMove(ctx.client, packaged('019a1000-0000-7000-8000-0000000000e9', cellar.bod, lotO1, null, cellar.po, 70, 35_000));
      await insertStockMove(ctx.client, move('019a1000-0000-7000-8000-0000000000ea', cellar.bod, null, null, xpo, cellar.po, 27, 20_250));

      const page = await jsonOf<Valuation>(await ctx.app.handle(call('GET', '/v1/stock/valuation?list=distributor')));
      const lines = page.groups.flatMap((group) => group.lines).filter((line) => line.kind === 'packaged');
      expect(lines.filter((line) => line.product_id === arcal).map((line) => line.bottles).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([912, 1254]);
      expect(lines.filter((line) => line.product_id === o1)).toEqual([expect.objectContaining({ bottles: 70, missing_price: true })]);
      expect(lines.find((line) => line.product_id === xpo)).toMatchObject({ bottles: 27, unit_price: '130.00', value: '3510.00' });
      expect(lines.some((line) => line.product_id == null)).toBe(false);
      expect(page.packaged.bottles).toBe(912 + 1254 + 70 + 27);
    } finally {
      await ctx.close();
    }
  });
});

async function place(
  client: { query(sql: string): Promise<unknown> },
  id: string,
  locationId: string,
  productId: string,
  lotId: string,
  ownerId: string,
  bottles: number,
  volume: number,
) {
  const moveId = `${id.slice(0, -1)}${(Number.parseInt(id.slice(-1), 16) + 8).toString(16)}`;
  await client.query(`
    INSERT INTO cellar.bottled_placement (
      id, location_id, slot_kind, slot_code, line_no, wine_label, product_id, lot_id, owner_entity_id,
      bottle_ml, product_state, match_status, source_sheet, source_row, photo_date
    ) VALUES (
      '${id}', '${locationId}', 'caja', 'CAJ-${id.slice(-2).toUpperCase()}', 1, 'Vino', '${productId}', '${lotId}', '${ownerId}',
      ${Math.round(volume / bottles)}, 'packaged_labeled', 'matched', 'test-${id.slice(-2)}', 1, DATE '2026-11-09'
    );
    INSERT INTO cellar.bottled_move (
      id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
    ) VALUES (
      '${moveId}', TIMESTAMP '2026-11-09 12:00:00+01', '${id}', ${bottles}, ${volume},
      'opening', '${lotId}', 'cellar.bottled_placement', '${id}', 'test'
    );
  `);
}

type Line = {
  kind: string;
  location_code: string;
  product_id: string | null;
  lot_id: string | null;
  vessel_code: string | null;
  bottles: number | null;
  litres: string;
  unit_price: string | null;
  value: string | null;
  price_origin: string | null;
  price_note: string | null;
  missing_price: boolean;
};

type Valuation = {
  groups: { wine_name: string; value: string | null; lines: Line[] }[];
  types: { label: string; value: string | null; groups: { wine_name: string }[] }[];
  packaged: { bottles: number; value: string | null; partial: boolean; missing: number; previous: number };
  demijohns: { value: string | null };
  bulk: { value: string | null };
  total: { value: string | null; partial: boolean };
};

function packaged(
  id: string,
  locationId: string,
  lotId: string | null,
  productId: string | null,
  ownerId: string,
  qty: number,
  volume: number,
) {
  return { ...move(id, locationId, null, lotId, productId, ownerId, qty, volume), productState: 'packaged_labeled' };
}

function move(
  id: string,
  locationId: string,
  vesselId: string | null,
  lotId: string | null,
  productId: string | null,
  ownerId: string,
  qty: number,
  volume: number,
) {
  return {
    id,
    occurredAt: '2026-11-09T12:00:00+01:00',
    moveType: 'opening',
    locationId,
    vesselId,
    ownerId,
    lotId,
    productId,
    productState: productId ? 'packaged_labeled' : 'wine',
    qtyUnits: qty,
    volumeMl: volume,
    sourceId: SRC,
  };
}

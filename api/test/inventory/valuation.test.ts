import { describe, expect, it } from 'bun:test';

import { seedValuationPrices } from '../../src/core/inventory/valuation-seed';
import {
  chooseStoredPrice,
  currentVersion,
  exVatUnit,
  litresValue,
  parseEur,
  previousPriceNote,
  unitsValue,
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
});

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
      expect(lines.some((line) => line.vessel_code === 'BAR-001')).toBe(false);
      expect(page.packaged).toMatchObject({ bottles: 22, value: '318.00', partial: true, missing: 1, previous: 1 });
      expect(page.demijohns.value).toBe('800.00');
      expect(page.bulk.value).toBe('3000.00');
      expect(page.total).toEqual({ value: '4118.00', partial: true });
      const wine = page.groups.find((group) => group.wine_name === 'Tinto Ejemplo');
      expect(wine?.lines.length).toBeGreaterThan(1);
      expect(wine?.value).toBe('4118.00');

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
});

type Line = {
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
  packaged: { bottles: number; value: string | null; partial: boolean; missing: number; previous: number };
  demijohns: { value: string | null };
  bulk: { value: string | null };
  total: { value: string | null; partial: boolean };
};

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

import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { CATALOG_WINES } from '../../src/core/catalog/catalog-snapshot';
import { loadCatalog } from '../../src/core/catalog/load-catalog';
import { ECI_LINES, demoradoLines } from '../../src/core/catalog/tariff-rules';
import { grossToBase, vatOnBase } from '../../src/core/catalog/vat-price';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

describe('IVA de la tarifa', () => {
  it('parte el PVP con IVA incluido en base y cuota', () => {
    const base = grossToBase('25.00');
    expect(base.toFixed(2)).toBe('20.66');
    const vat = vatOnBase(base);
    expect(vat.toFixed(2)).toBe('4.34');
    expect(base.plus(vat).toFixed(2)).toBe('25.00');
    expect(grossToBase(new Decimal('18.00')).plus(vatOnBase(grossToBase('18.00'))).toFixed(2)).toBe('18.00');
  });

  it('la plantilla ECI 2025 tiene cinco costes netos y Demorado sigue en 2024', () => {
    expect(ECI_LINES).toHaveLength(5);
    expect(ECI_LINES.map((line) => line.price)).toEqual(['9.75', '9.10', '10.50', '22.00', '18.25']);
    expect(demoradoLines().every((line) => line.vintage === 2024 && line.lot === 'L2024')).toBe(true);
    expect(CATALOG_WINES.filter((row) => !row.priced).map((row) => row.sku)).toEqual([
      'EE2024', 'ENT-2324', 'EN2025', 'ELL2025', 'EGP2023', 'MELOS-2019', 'BURRO', 'EEB2024', 'WINEOUT', 'APLATINAO', 'BOBAL-PLUS-2019', 'ENT-FT-2016', 'LEM2023',
      'BOBAL-BASIC-2025', 'APLATINAO-MAG', 'SASA-MAG', 'ARCAL-2017', 'ARCAL-4', 'ARCAL-MAG', 'PARRAS-MAG', 'JAEN-23', 'LAGARTOS', 'FT-LOTE', 'BFT-2009', 'ENT-MAG', 'BOBAL-ENT-MAG', 'BOTELLASOLD', 'MET-BOBAL', 'MET-MUSCAT', 'JAEN-NEGRO', 'METODOS-OLD', 'METODOS-FINAL', 'OTRAS-ANADAS', 'LAS-VIRGINIAS',
    ]);
  });

  it('desactiva los productos Holded y deja el precio que aún los cita', async () => {
    const ctx = await createTestApp();
    try {
      const cited = newId();
      const loose = newId();
      const listId = newId();
      const versionId = newId();
      const itemId = newId();
      const entity = (await ctx.writer.read<{ id: string }>(`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = 'PO'`))[0];
      const location = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'holded-products', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, unit, legacy_refs, for_sale)
          VALUES
            (CAST(${cited} AS UUID), 'HOLDED-CITADO', 'Holded citado', 'merchandise', 'ud', '{"source":"holded"}'::JSON, TRUE),
            (CAST(${loose} AS UUID), 'SKU17', 'Magnum sa&sa 2019 1,5 L', 'merchandise', 'ud', '{"source":"holded"}'::JSON, TRUE)
        `);
        tx.write(sql`
          INSERT INTO catalog.price_list (id, code, name)
          VALUES (CAST(${listId} AS UUID), 'custom-holded-test', 'Tarifa de prueba')
        `);
        tx.write(sql`
          INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
          VALUES (CAST(${versionId} AS UUID), CAST(${listId} AS UUID), 1, DATE '2026-01-01', 'active', 'test')
        `);
        tx.write(sql`
          INSERT INTO catalog.price_list_item (id, version_id, product_id, unit_price)
          VALUES (CAST(${itemId} AS UUID), CAST(${versionId} AS UUID), CAST(${loose} AS UUID), CAST(12 AS DECIMAL(14,6)))
        `);
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
          VALUES (CAST(${location} AS UUID), 'HLD', 'Histórico', 'own_warehouse', CAST(${entity!.id} AS UUID))
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, product_id, product_state,
            qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), TIMESTAMPTZ '2026-11-01 10:00:00+01', 'opening',
            CAST(${location} AS UUID), CAST(${entity!.id} AS UUID), CAST(${cited} AS UUID), 'goods',
            1, 0, 0, 'legacy.holded_product', CAST(${cited} AS UUID), 'test'
          )
        `);
      });
      const report = await loadCatalog(ctx.writer);
      expect(report.holded_archived).toBe(2);
      expect(report.holded_removed).toBe(0);
      expect(report.products).toBe(CATALOG_WINES.length);
      const left = await ctx.writer.read<{ sku: string; active: boolean; sale: boolean }>(sql`
        SELECT sku, is_active AS active, for_sale AS sale
        FROM catalog.product
        WHERE sku IN ('HOLDED-CITADO', 'SKU17', 'L2024', 'WINEOUT', 'SASA-MAG')
      `);
      const bySku = new Map(left.map((row) => [row.sku, row]));
      expect(bySku.get('HOLDED-CITADO')).toMatchObject({ active: false, sale: false });
      expect(bySku.get('SKU17')).toMatchObject({ active: false, sale: false });
      expect(bySku.get('SASA-MAG')).toMatchObject({ active: true, sale: true });
      expect(bySku.get('L2024')?.active).toBe(true);
      expect(bySku.get('WINEOUT')).toMatchObject({ active: true, sale: false });
      const price = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM catalog.price_list_item WHERE id = CAST(${itemId} AS UUID)
      `);
      expect(price[0]?.n).toBe('1');
    } finally {
      await ctx.close();
    }
  });
});

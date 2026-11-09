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
      'EE2024', 'ENT-2324', 'EN2025', 'BOBASTRELL', 'ELL2025', 'EGP2023', 'MELOS-2019', 'BURRO', 'EEB2024', 'WINEOUT', 'APLATINAO', 'BOBAL-PLUS-2019', 'ENT-FT-2016', 'LEM2023',
      'BOBAL-BASIC-2025', 'APLATINAO-MAG', 'SASA-MAG', 'ARCAL-2017', 'ARCAL-4', 'ARCAL-MAG', 'PARRAS-MAG', 'JAEN-23', 'LAGARTOS', 'FT-LOTE', 'BFT-2009', 'ENT-MAG', 'BOBAL-ENT-MAG', 'BOTELLASOLD', 'MET-BOBAL', 'MET-MUSCAT', 'JAEN-NEGRO', 'METODOS-OLD', 'METODOS-FINAL', 'OTRAS-ANADAS', 'LAS-VIRGINIAS',
    ]);
  });

  it('archiva un producto Holded citado y borra uno que no lo está', async () => {
    const ctx = await createTestApp();
    try {
      const cited = newId();
      const loose = newId();
      const entity = (await ctx.writer.read<{ id: string }>(`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = 'PO'`))[0];
      const location = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'holded-products', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.product (id, sku, name, kind, unit, legacy_refs)
          VALUES
            (CAST(${cited} AS UUID), 'HOLDED-CITADO', 'Holded citado', 'merchandise', 'ud', '{"source":"holded"}'::JSON),
            (CAST(${loose} AS UUID), 'HOLDED-SUELTO', 'Holded suelto', 'merchandise', 'ud', '{"source":"holded"}'::JSON)
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
      expect(report.holded_archived).toBe(1);
      expect(report.holded_removed).toBe(1);
      expect(report.products).toBe(CATALOG_WINES.length);
      const left = await ctx.writer.read<{ sku: string; active: boolean }>(sql`
        SELECT sku, is_active AS active FROM catalog.product WHERE sku IN ('HOLDED-CITADO', 'HOLDED-SUELTO', 'L2024', 'WINEOUT')
      `);
      const bySku = new Map(left.map((row) => [row.sku, row.active]));
      expect(bySku.get('HOLDED-CITADO')).toBe(false);
      expect(bySku.has('HOLDED-SUELTO')).toBe(false);
      expect(bySku.get('L2024')).toBe(true);
      expect(bySku.get('WINEOUT')).toBe(true);
      const wineout = await ctx.writer.read<{ sale: boolean }>(sql`SELECT for_sale AS sale FROM catalog.product WHERE sku = 'WINEOUT'`);
      expect(wineout[0]?.sale).toBe(false);
    } finally {
      await ctx.close();
    }
  });
});

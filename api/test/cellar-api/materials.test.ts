import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { call, counts, entityId, seedHolding, seedWarehouse, type TestApp } from './fixtures';
import { createTestApp } from '../helpers';

interface Cellar {
  po: string;
  locationId: string;
  tankId: string;
  lotId: string;
}

async function cellarOf(ctx: TestApp): Promise<Cellar> {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  const tank = await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-01',
    name: 'Depósito',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: String(location.body.id),
  });
  const lotId = await seedHolding(ctx, {
    entityId: po,
    warehouseId: warehouse,
    locationId: String(location.body.id),
    vesselId: String(tank.body.id),
    code: 'L25T01',
    volumeMl: 1_000_000,
  });
  return { po, locationId: String(location.body.id), tankId: String(tank.body.id), lotId };
}

async function materialCounts(ctx: TestApp): Promise<{ consumption: number; next: number }> {
  const rows = await ctx.writer.read<{ consumption: string; next: string }>(sql`
    SELECT
      (SELECT count(*) FROM cellar.material_consumption)::VARCHAR AS consumption,
      (SELECT next_value FROM core.number_series
        WHERE doc_type = 'cellar_operation' AND year = 2026 AND is_default
        LIMIT 1)::VARCHAR AS next
  `);
  return {
    consumption: Number(rows[0]?.consumption ?? 0),
    next: Number(rows[0]?.next ?? 0),
  };
}

describe('materiales de envasado', () => {
  it('lista por formato, stock a fecha y 600 botellas consumen corchos, cápsulas, cajas y un palé', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await cellarOf(ctx);
      const denied = await call(ctx, 'POST', '/v1/formats', {
        code: 'B075',
        name: 'Botella 0,75 L',
        container: 'bottle',
        nominal_volume_ml: 750,
        units_per_case: 6,
        cases_per_pallet: 112,
      }, 'bodega@winecore.test');
      expect(denied.status).toBe(403);

      const format = await call(ctx, 'POST', '/v1/formats', {
        code: 'B075',
        name: 'Botella 0,75 L',
        container: 'bottle',
        nominal_volume_ml: 750,
        units_per_case: 6,
        cases_per_pallet: 112,
      });
      expect(format.status).toBe(201);
      const formatId = String(format.body.id);
      const wine = await call(ctx, 'POST', '/v1/wines', {
        code: 'TINTO',
        name: 'Tinto Ejemplo',
        color: 'red',
      });
      const bottled = await call(ctx, 'POST', '/v1/products', {
        sku: 'TINTO075',
        name: 'Tinto botella 0,75',
        kind: 'wine',
        wine_id: wine.body.id,
        vintage: 2025,
        format_id: formatId,
        requires_lot: true,
      });
      expect(bottled.status).toBe(201);

      const names = [
        ['CORCHO', 'Corcho', 'unit'],
        ['CAPSULA', 'Cápsula de lacre', 'unit'],
        ['CAJA6', 'Caja de 6', 'case'],
        ['PALET', 'Palé', 'pallet'],
      ] as const;
      const materials: { sku: string; id: string }[] = [];
      for (const [sku, name, per] of names) {
        const product = await call(ctx, 'POST', '/v1/products', {
          sku,
          name,
          kind: 'packaging_material',
          unit: 'ud',
        });
        expect(product.status).toBe(201);
        const row = await call(ctx, 'POST', `/v1/formats/${formatId}/materials`, {
          material_product_id: product.body.id,
          per,
          quantity: '1.000',
        });
        expect(row.status).toBe(201);
        expect(row.body.per).toBe(per);
        materials.push({ sku, id: String(product.body.id) });
      }
      const listed = await call(ctx, 'GET', `/v1/formats/${formatId}/materials`);
      expect(listed.status).toBe(200);
      const items = listed.body.items as { sku: string; per: string; quantity: string }[];
      expect(items.map((row) => [row.sku, row.per, row.quantity])).toEqual([
        ['CAJA6', 'case', '1.000'],
        ['CAPSULA', 'unit', '1.000'],
        ['CORCHO', 'unit', '1.000'],
        ['PALET', 'pallet', '1.000'],
      ]);
      const corkLine = (listed.body.items as { id: string; sku: string }[]).find((row) => row.sku === 'CORCHO');
      const patched = await call(ctx, 'PATCH', `/v1/formats/${formatId}/materials/${corkLine?.id}`, {
        quantity: '2.000',
      });
      expect(patched.status).toBe(200);
      expect(patched.body.quantity).toBe('2.000');
      const restored = await call(ctx, 'PATCH', `/v1/formats/${formatId}/materials/${corkLine?.id}`, {
        quantity: '1.000',
      });
      expect(restored.body.quantity).toBe('1.000');
      const label = await call(ctx, 'POST', '/v1/products', { sku: 'ETIQUETA', name: 'Etiqueta', kind: 'packaging_material' });
      const extra = await call(ctx, 'POST', `/v1/formats/${formatId}/materials`, {
        material_product_id: label.body.id,
        per: 'unit',
        quantity: '1.000',
      });
      const removed = await call(ctx, 'DELETE', `/v1/formats/${formatId}/materials/${extra.body.id}`);
      expect(removed.status).toBe(200);
      const afterDelete = await call(ctx, 'GET', `/v1/formats/${formatId}/materials`);
      expect((afterDelete.body.items as unknown[]).length).toBe(4);
      const wineAsMaterial = await call(ctx, 'POST', `/v1/formats/${formatId}/materials`, {
        material_product_id: bottled.body.id,
        per: 'unit',
        quantity: '1.000',
      });
      expect(wineAsMaterial.status).toBe(422);
      expect(wineAsMaterial.body.code).toBe('WC_VALIDATION');

      const receipts: Record<string, number> = { CORCHO: 1000, CAPSULA: 1000, CAJA6: 200, PALET: 2 };
      for (const material of materials) {
        const receipt = await call(ctx, 'POST', '/v1/materials/receipts', {
          product_id: material.id,
          location_id: cellar.locationId,
          owner_entity_id: cellar.po,
          qty_units: receipts[material.sku],
          occurred_at: '2026-10-01T08:00:00Z',
        }, 'bodega@winecore.test');
        expect(receipt.status).toBe(201);
        expect(receipt.body.move_type).toBe('purchase_in');
        expect(receipt.body.product_state).toBe('goods');
      }
      const adminReceipt = await call(ctx, 'POST', '/v1/materials/receipts', {
        product_id: materials[0]?.id,
        location_id: cellar.locationId,
        qty_units: 1,
        occurred_at: '2026-10-01T08:00:00Z',
      }, 'admin@winecore.test');
      expect(adminReceipt.status).toBe(403);

      const before = await call(ctx, 'GET', `/v1/materials/stock?at=2026-10-01&owner=PO`);
      expect(before.status).toBe(200);
      const beforeQty = new Map((before.body.items as { sku: string; qty_units: number }[]).map((row) => [row.sku, row.qty_units]));
      expect(beforeQty.get('CORCHO')).toBe(1000);
      expect(beforeQty.get('PALET')).toBe(2);
      const empty = await call(ctx, 'GET', '/v1/materials/stock?at=2026-09-30&product_id=' + materials[0]?.id);
      expect((empty.body.items as unknown[]).length).toBe(0);

      const draft = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bottling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-10-20T10:00:00Z',
        fiscal_date: '2026-10-20',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L26100' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 450_000, product_state: 'wine' },
          {
            role: 'output',
            location_id: cellar.locationId,
            product_id: bottled.body.id,
            product_state: 'packaged_unlabeled',
            qty_units: 600,
            volume_ml: 450_000,
            nominal_volume_ml: 750,
            nc_code: '22042100',
          },
        ],
      }, 'bodega@winecore.test');
      expect(draft.status).toBe(201);

      const preview = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/preview`, undefined, 'bodega@winecore.test');
      expect(preview.status).toBe(200);
      const previewLines = preview.body.materials as { sku: string; per: string; quantity: number; short: boolean; warning: string | null }[];
      expect(previewLines.map((row) => [row.sku, row.per, row.quantity, row.short])).toEqual([
        ['CAJA6', 'case', 100, false],
        ['CAPSULA', 'unit', 600, false],
        ['CORCHO', 'unit', 600, false],
        ['PALET', 'pallet', 1, false],
      ]);
      expect(previewLines.every((row) => row.warning === null)).toBe(true);

      const policy = await call(ctx, 'PUT', '/v1/hygiene/policy', { bottling_checklist_required: false });
      expect(policy.status).toBe(200);
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('confirmed');
      const consumed = confirmed.body.material_consumption as { product_id: string; quantity: number }[];
      const byId = new Map(materials.map((row) => [row.id, row.sku]));
      expect(consumed.map((row) => [byId.get(row.product_id), row.quantity]).sort()).toEqual([
        ['CAJA6', 100],
        ['CAPSULA', 600],
        ['CORCHO', 600],
        ['PALET', 1],
      ]);

      const previewGoods = (preview.body.stock_moves as { product_state: string; product_id: string; qty_units: number; move_type: string; location_id: string }[])
        .filter((row) => row.product_state === 'goods');
      const confirmedGoods = (confirmed.body.stock_moves as { product_state: string; product_id: string; qty_units: number; move_type: string; location_id: string }[])
        .filter((row) => row.product_state === 'goods');
      const key = (row: { product_id: string; qty_units: number; move_type: string; location_id: string }) =>
        `${row.product_id}:${row.move_type}:${row.qty_units}:${row.location_id}`;
      expect(previewGoods.map(key).sort()).toEqual(confirmedGoods.map(key).sort());
      expect(confirmedGoods.map((row) => [byId.get(row.product_id), row.qty_units]).sort()).toEqual([
        ['CAJA6', -100],
        ['CAPSULA', -600],
        ['CORCHO', -600],
        ['PALET', -1],
      ]);

      const after = await call(ctx, 'GET', '/v1/materials/stock?at=2026-10-20&owner=PO');
      const afterQty = new Map((after.body.items as { sku: string; qty_units: number }[]).map((row) => [row.sku, row.qty_units]));
      expect(afterQty.get('CORCHO')).toBe(400);
      expect(afterQty.get('CAPSULA')).toBe(400);
      expect(afterQty.get('CAJA6')).toBe(100);
      expect(afterQty.get('PALET')).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('sin stock la vista previa avisa y la confirmación no escribe nada', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await cellarOf(ctx);
      const format = await call(ctx, 'POST', '/v1/formats', {
        code: 'B075',
        name: 'Botella 0,75 L',
        container: 'bottle',
        nominal_volume_ml: 750,
      });
      const wine = await call(ctx, 'POST', '/v1/wines', { code: 'TINTO', name: 'Tinto Ejemplo', color: 'red' });
      const bottled = await call(ctx, 'POST', '/v1/products', {
        sku: 'TINTO075',
        name: 'Tinto botella 0,75',
        kind: 'wine',
        wine_id: wine.body.id,
        vintage: 2025,
        format_id: format.body.id,
        requires_lot: true,
      });
      const cork = await call(ctx, 'POST', '/v1/products', { sku: 'CORCHO', name: 'Corcho', kind: 'packaging_material' });
      await call(ctx, 'POST', `/v1/formats/${format.body.id}/materials`, {
        material_product_id: cork.body.id,
        per: 'unit',
        quantity: '1.000',
      });
      const receipt = await call(ctx, 'POST', '/v1/materials/receipts', {
        product_id: cork.body.id,
        location_id: cellar.locationId,
        owner_entity_id: cellar.po,
        qty_units: 599,
        occurred_at: '2026-10-01T08:00:00Z',
      }, 'bodega@winecore.test');
      expect(receipt.status).toBe(201);

      const draft = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bottling',
        legal_entity_id: cellar.po,
        occurred_at: '2026-10-20T10:00:00Z',
        fiscal_date: '2026-10-20',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L26101' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 450_000, product_state: 'wine' },
          {
            role: 'output',
            location_id: cellar.locationId,
            product_id: bottled.body.id,
            product_state: 'packaged_unlabeled',
            qty_units: 600,
            volume_ml: 450_000,
            nominal_volume_ml: 750,
          },
        ],
      }, 'bodega@winecore.test');
      expect(draft.status).toBe(201);
      const before = await counts(ctx);
      const beforeMaterials = await materialCounts(ctx);

      const preview = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/preview`, undefined, 'bodega@winecore.test');
      expect(preview.status).toBe(200);
      const lines = preview.body.materials as { sku: string; quantity: number; available: number; shortfall: number; short: boolean; warning: string | null }[];
      expect(lines).toEqual([
        expect.objectContaining({
          sku: 'CORCHO',
          quantity: 600,
          available: 599,
          shortfall: 1,
          short: true,
        }),
      ]);
      expect(lines[0]?.warning).toContain('CORCHO');
      expect(await counts(ctx)).toEqual(before);
      expect(await materialCounts(ctx)).toEqual(beforeMaterials);

      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${draft.body.id}/confirm`, undefined, 'bodega@winecore.test');
      expect(confirmed.status).toBe(422);
      expect(confirmed.body.code).toBe('WC024');
      const details = confirmed.body.details as { materials: { sku: string; shortfall: number }[] };
      expect(details.materials).toEqual([expect.objectContaining({ sku: 'CORCHO', shortfall: 1 })]);
      expect(await counts(ctx)).toEqual(before);
      expect(await materialCounts(ctx)).toEqual(beforeMaterials);
      const still = await call(ctx, 'GET', `/v1/cellar-operations/${draft.body.id}`);
      expect(still.body.status).toBe('draft');
      expect(still.body.number).toBeNull();
      const stock = await call(ctx, 'GET', `/v1/materials/stock?at=2026-10-20&product_id=${cork.body.id}`);
      expect((stock.body.items as { qty_units: number }[])[0]?.qty_units).toBe(599);
    } finally {
      await ctx.close();
    }
  });
});

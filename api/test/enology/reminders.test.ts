import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { dispatchOutbox } from '../../src/core/events/dispatch';
import { runSeasonalReminders } from '../../src/core/enology/reminders';

describe('recordatorios estacionales', () => {
  it('avisa una vez el trasiego de invierno y el embotellado de verano', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'enology-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id, tax_warehouse_id)
          VALUES (
            CAST(${location} AS UUID), ${'BODENO'}, ${'Bodega sintetica'}, ${'cellar'},
            CAST(${po} AS UUID), CAST(${warehouse} AS UUID)
          )
        `);
      });
      await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId: location,
        vesselId: newId(),
        code: 'LOTE-ENO-1',
        volumeMl: 500_000,
      });

      const winter = await runSeasonalReminders(ctx.writer, new Date('2026-02-15T12:00:00Z'));
      expect(winter.emitted).toBe(1);
      expect((await runSeasonalReminders(ctx.writer, new Date('2026-03-01T12:00:00Z'))).emitted).toBe(0);
      const summer = await runSeasonalReminders(ctx.writer, new Date('2026-07-15T12:00:00Z'));
      expect(summer.emitted).toBe(1);

      await dispatchOutbox({
        writer: ctx.writer,
        config: ctx.config,
        now: () => new Date(Date.now() + 60_000),
        log: () => undefined,
      });
      const owner = await call(ctx, 'GET', '/v1/notifications?unread=true', undefined, 'owner@winecore.test');
      const cellar = await call(ctx, 'GET', '/v1/notifications?unread=true', undefined, 'bodega@winecore.test');
      const advisor = await call(ctx, 'GET', '/v1/notifications?unread=true', undefined, 'asesor@winecore.test');
      const ownerItems = owner.body.items as { kind: string }[];
      const cellarItems = cellar.body.items as { kind: string }[];
      const advisorItems = advisor.body.items as { kind: string }[];
      expect(ownerItems.filter((item) => item.kind === 'cellar.seasonal.reminder')).toHaveLength(2);
      expect(cellarItems.filter((item) => item.kind === 'cellar.seasonal.reminder')).toHaveLength(2);
      expect(advisorItems.filter((item) => item.kind === 'cellar.seasonal.reminder')).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('no repite el trasiego si el lote ya se trasegó en invierno', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = newId();
      const lot = newId();
      const operation = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'enology-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
          VALUES (CAST(${location} AS UUID), ${'BODENO2'}, ${'Bodega sintetica'}, ${'cellar'}, CAST(${po} AS UUID))
        `);
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, is_organic, status, origin)
          VALUES (
            CAST(${lot} AS UUID), CAST(${po} AS UUID), ${'LOTE-ENO-2'}, ${'wine'},
            2025, TRUE, ${'active'}, ${'opening_count'}
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            volume_ml, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${'2026-01-15T10:00:00Z'} AS TIMESTAMPTZ), ${'opening'},
            CAST(${location} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), ${'wine'},
            200000, ${'inventory.inventory_count'}, CAST(${newId()} AS UUID), ${'enology-test'}
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation (
            id, legal_entity_id, number, op_type, occurred_at, status, performed_by, confirmed_at, created_by
          ) VALUES (
            CAST(${operation} AS UUID), CAST(${po} AS UUID), ${'OB26-9001'}, ${'racking'},
            CAST(${'2026-02-10T10:00:00Z'} AS TIMESTAMPTZ), ${'confirmed'}, ${'sintetico'},
            CAST(${'2026-02-10T10:00:00Z'} AS TIMESTAMPTZ), ${'sintetico'}
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.operation_line (
            id, operation_id, role, lot_id, location_id, product_state, volume_ml
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${operation} AS UUID), ${'input'},
            CAST(${lot} AS UUID), CAST(${location} AS UUID), ${'wine'}, 200000
          )
        `);
      });
      const winter = await runSeasonalReminders(ctx.writer, new Date('2026-02-20T12:00:00Z'));
      expect(winter.emitted).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});

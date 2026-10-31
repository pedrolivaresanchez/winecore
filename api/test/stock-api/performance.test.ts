import { describe, expect, it } from 'bun:test';
import { generateSynthetic } from '../../db/synthetic';
import { createTestApp } from '../helpers';
import { call, jsonOf } from './fixture';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error(`uuid ${value}`);
  return `CAST('${value.toLowerCase()}' AS UUID)`;
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

describe('rendimiento de existencias', () => {
  it('responde los saldos de la escala x10 en menos de un segundo', async () => {
    const ctx = await createTestApp();
    try {
      const data = generateSynthetic({ seed: 2060, scale: 'x10' });
      const statements: string[] = ['BEGIN TRANSACTION'];
      for (const row of data.tax_warehouse) {
        statements.push(`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test, silicie_since, is_active, created_at)
          VALUES (
            ${uuid(row.id)}, ${uuid(row.legal_entity_id)}, ${q(row.cae)}, ${q(row.activity_code)}, ${q(row.name)},
            ${row.is_test ? 'TRUE' : 'FALSE'}, ${row.silicie_since ? `DATE ${q(row.silicie_since)}` : 'NULL'},
            ${row.is_active ? 'TRUE' : 'FALSE'}, CAST(${q(row.created_at)} AS TIMESTAMPTZ)
          )
        `);
      }
      for (const row of data.location) {
        statements.push(`
          INSERT INTO inventory.location (
            id, code, name, kind, tax_warehouse_id, operator_contact_id, controlling_entity_id, is_virtual, is_active, created_at
          ) VALUES (
            ${uuid(row.id)}, ${q(row.code)}, ${q(row.name)}, ${q(row.kind)},
            ${row.tax_warehouse_id ? uuid(row.tax_warehouse_id) : 'NULL'},
            ${row.operator_contact_id ? uuid(row.operator_contact_id) : 'NULL'},
            ${uuid(row.controlling_entity_id)},
            ${row.is_virtual ? 'TRUE' : 'FALSE'},
            ${row.is_active ? 'TRUE' : 'FALSE'},
            CAST(${q(row.created_at)} AS TIMESTAMPTZ)
          )
        `);
      }
      for (const row of data.lot) {
        statements.push(`
          INSERT INTO inventory.lot (
            id, producer_entity_id, code, kind, wine_id, vintage, is_organic, status, origin, notes, created_at
          ) VALUES (
            ${uuid(row.id)}, ${uuid(row.producer_entity_id)}, ${q(row.code)}, ${q(row.kind)},
            ${row.wine_id ? uuid(row.wine_id) : 'NULL'},
            ${row.vintage ?? 'NULL'},
            ${row.is_organic ? 'TRUE' : 'FALSE'},
            ${q(row.status)}, ${q(row.origin)},
            ${row.notes ? q(row.notes) : 'NULL'},
            CAST(${q(row.created_at)} AS TIMESTAMPTZ)
          )
        `);
      }
      for (const row of data.stock_move) {
        statements.push(`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
            product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id, created_by, created_at
          ) VALUES (
            ${uuid(row.id)}, CAST(${q(row.occurred_at)} AS TIMESTAMPTZ), ${q(row.move_type)},
            ${uuid(row.location_id)}, ${row.vessel_id ? uuid(row.vessel_id) : 'NULL'}, ${uuid(row.owner_entity_id)},
            ${row.lot_id ? uuid(row.lot_id) : 'NULL'}, ${row.product_id ? uuid(row.product_id) : 'NULL'},
            ${q(row.product_state)}, ${row.qty_units}, ${row.volume_ml}, ${row.mass_g},
            ${row.loss_kind ? q(row.loss_kind) : 'NULL'}, ${q(row.source_table)}, ${uuid(row.source_id)},
            ${q(row.created_by)}, CAST(${q(row.created_at)} AS TIMESTAMPTZ)
          )
        `);
      }
      statements.push('COMMIT');
      await ctx.client.query(statements.join(';\n'));

      const expected = data.stock_move.reduce((sum, move) => sum + move.volume_ml, 0);
      const started = performance.now();
      const response = await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-06-01T12:00:00Z&limit=1000'));
      const body = await jsonOf<{ items: { volume_ml: number }[]; total: number; next_cursor: string | null }>(response);
      const elapsed = performance.now() - started;
      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(1_000);
      expect(body.total).toBe(data.stock_move.length);
      expect(body.items).toHaveLength(data.stock_move.length);
      expect(body.next_cursor).toBeNull();
      expect(body.items.reduce((sum, item) => sum + item.volume_ml, 0)).toBe(expected);
    } finally {
      await ctx.close();
    }
  }, 30_000);
});

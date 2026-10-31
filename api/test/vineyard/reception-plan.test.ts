import { describe, expect, it } from 'bun:test';
import { planOperation } from '../../src/core/cellar/engine';
import type { ReceptionRequest, VesselState } from '../../src/core/cellar/types';

const vessel: VesselState = {
  id: 'vessel-1',
  kind: 'tank_storage',
  material: 'stainless_steel',
  capacity_ml: 8_000_000,
  lot_id: null,
  volume_ml: 0,
  owner_entity_id: 'entity-po',
  product_state: null,
  location_id: 'location-bod',
  status: 'in_service',
  tax_warehouse_id: 'warehouse-1',
  excise_product_key: null,
};

function request(patch: Partial<ReceptionRequest> = {}): ReceptionRequest {
  return {
    id: 'op-1',
    legal_entity_id: 'entity-po',
    occurred_at: '2026-09-20T08:30:00Z',
    fiscal_date: '2026-09-20',
    performed_by: 'Operario sintético',
    created_by: 'user-1',
    reason: null,
    approval_request_id: null,
    op_type: 'reception',
    vessel_id: vessel.id,
    mass_g: 1_000_000,
    lot_code: 'U26-P07',
    vintage: 2026,
    is_organic: true,
    notes: 'Variedad BOBAL',
    occupying_lot_id: null,
    ...patch,
  };
}

describe('plan de entrada de uva', () => {
  it('crea un lote de uva y una entrada en gramos, sin movimiento fiscal', () => {
    let n = 0;
    const plan = planOperation(request(), { vessels: new Map([[vessel.id, vessel]]) }, {
      newId: () => `id-${n += 1}`,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fiscalMoves).toEqual([]);
    expect(plan.newLots.map((lot) => ({ kind: lot.kind, origin: lot.origin, code: lot.code, is_organic: lot.is_organic }))).toEqual([
      { kind: 'grape', origin: 'reception', code: 'U26-P07', is_organic: true },
    ]);
    expect(plan.stockMoves.map((move) => ({
      move_type: move.move_type,
      product_state: move.product_state,
      mass_g: move.mass_g,
      volume_ml: move.volume_ml,
      vessel_id: move.vessel_id,
    }))).toEqual([
      { move_type: 'cellar_in', product_state: 'grape', mass_g: 1_000_000, volume_ml: 0, vessel_id: vessel.id },
    ]);
  });

  it('rechaza un recipiente que ya tiene vino o uva', () => {
    const withWine = planOperation(request(), {
      vessels: new Map([[vessel.id, { ...vessel, volume_ml: 1_000, lot_id: 'other', product_state: 'wine' }]]),
    }, { newId: () => 'id' });
    expect(withWine.ok).toBe(false);
    if (withWine.ok) return;
    expect(withWine.code).toBe('WC026');

    const withGrape = planOperation(request({ occupying_lot_id: 'grape-lot' }), {
      vessels: new Map([[vessel.id, vessel]]),
    }, { newId: () => 'id' });
    expect(withGrape.ok).toBe(false);
    if (withGrape.ok) return;
    expect(withGrape.code).toBe('WC026');
  });
});

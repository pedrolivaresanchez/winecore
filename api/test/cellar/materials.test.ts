import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import {
  allocateUnits,
  basisFor,
  casesFor,
  consumptionUnits,
  palletsFor,
} from '../../src/core/cellar/materials';

describe('cálculo de materiales de envasado', () => {
  it('redondea cajas y palés hacia arriba, y 600 botellas de 0,75 L dan 100 cajas y 1 palé', () => {
    expect(casesFor(600, 6)).toBe(100);
    expect(palletsFor(100, 112)).toBe(1);
    expect(basisFor('unit', 600, 6, 112)).toBe(600);
    expect(basisFor('case', 600, 6, 112)).toBe(100);
    expect(basisFor('pallet', 600, 6, 112)).toBe(1);

    expect(casesFor(1, 6)).toBe(1);
    expect(palletsFor(1, 112)).toBe(1);
    expect(casesFor(6, 6)).toBe(1);
    expect(casesFor(7, 6)).toBe(2);
    expect(palletsFor(2, 112)).toBe(1);
    expect(casesFor(672, 6)).toBe(112);
    expect(palletsFor(112, 112)).toBe(1);
    expect(casesFor(673, 6)).toBe(113);
    expect(palletsFor(113, 112)).toBe(2);
  });

  it('el consumo es la cantidad de la lista por la base, en unidades enteras', () => {
    expect(consumptionUnits(new Decimal('1.000'), 600)).toBe(600);
    expect(consumptionUnits(new Decimal('1.000'), 100)).toBe(100);
    expect(consumptionUnits(new Decimal('2'), 1)).toBe(2);
    expect(consumptionUnits(new Decimal('0.500'), 4)).toBe(2);
    expect(consumptionUnits(new Decimal('0.001'), 1)).toBeNull();
    expect(consumptionUnits(new Decimal('1.000'), 0)).toBeNull();
  });

  it('toma el stock primero de la ubicación del envasado y no parte el pedido si no llega', () => {
    const taken = allocateUnits(600, [
      { location_id: 'loc-b', qty_units: 1000 },
      { location_id: 'loc-a', qty_units: 100 },
    ], 'loc-a');
    expect(taken).toEqual([
      { location_id: 'loc-a', qty_units: 100 },
      { location_id: 'loc-b', qty_units: 500 },
    ]);
    expect(allocateUnits(10, [{ location_id: 'loc-a', qty_units: 10 }], 'loc-a')).toEqual([
      { location_id: 'loc-a', qty_units: 10 },
    ]);
    expect(allocateUnits(11, [{ location_id: 'loc-a', qty_units: 10 }], 'loc-a')).toBeNull();
  });
});

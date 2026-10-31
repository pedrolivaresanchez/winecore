import { describe, expect, it } from 'bun:test';
import { planOperation } from '../../src/core/cellar/engine';
import type { PressingRequest, FermentationEndRequest, FermentationStartRequest } from '../../src/core/cellar/types';
import { entriesFor } from '../../src/core/regulatory/silicie/entries';
import { asOk, header, holding, idSource, lot, stateOf, vessel } from '../cellar/helpers';
import { ctx, granel, move, uva } from '../silicie/support';

const grape = lot({
  id: 'lot-uva',
  code: 'UVA26A',
  kind: 'grape',
  excise_product_key: null,
  abv_pct: null,
  vintage: 2026,
});
const must = lot({
  id: 'lot-uva',
  code: 'UVA26A',
  kind: 'must',
  excise_product_key: 'GRANEL-TINTO',
  abv_pct: '12.50',
  vintage: 2026,
});

describe('prensado y fin de fermentación', () => {
  it('1000 kg de uva dan 750 L de mosto y 220 kg de orujo, y el fin de FA anota A15 y A32', () => {
    const tank = vessel({ id: 'inox-01', kind: 'tank_fermenter' });
    const pressing: PressingRequest = {
      ...header({ id: 'op-prensa', fiscal_date: '2027-09-02', occurred_at: '2027-09-02T08:00:00Z' }),
      op_type: 'crushing_pressing',
      lines: [
        {
          role: 'input',
          lot: grape,
          vessel_id: null,
          location_id: 'loc-bod',
          product_state: 'grape',
          mass_g: 1_000_000,
          volume_ml: 0,
        },
        {
          role: 'output',
          lot: grape,
          vessel_id: 'inox-01',
          volume_ml: 750_000,
          product_state: 'must',
        },
        {
          role: 'pomace',
          lot: grape,
          location_id: 'loc-bod',
          mass_g: 220_000,
        },
      ],
    };
    const pressed = asOk(planOperation(pressing, stateOf([tank]), idSource()));
    expect(pressed.pressingYield).toEqual({
      input_state: 'grape',
      input_mass_g: 1_000_000,
      input_volume_ml: 0,
      must_volume_ml: 750_000,
      pomace_mass_g: 220_000,
      must_yield: '75.000',
      must_yield_unit: 'l_per_100kg',
      pomace_yield: '0.220',
      pomace_yield_unit: 'mass_ratio',
    });
    expect(pressed.fiscalMoves).toEqual([]);
    expect(pressed.silicieFacts).toEqual([
      { kind: 'crushing', mass_g: 1_000_000, volume_ml: null, ledger_reference: 'UVA', abv_pct: null },
    ]);
    expect(pressed.lotUpdates).toEqual([{ lot_id: 'lot-uva', kind: 'must' }]);
    const out = pressed.stockMoves.find((row) => row.product_state === 'grape');
    const inn = pressed.stockMoves.find((row) => row.product_state === 'must');
    expect(out?.move_type).toBe('cellar_out');
    expect(out?.mass_g).toBe(-1_000_000);
    expect(inn?.move_type).toBe('cellar_in');
    expect(inn?.volume_ml).toBe(750_000);
    expect(pressed.vesselsAfter.map((row) => [row.id, row.product_state, row.volume_ml, row.lot_id])).toEqual([
      ['inox-01', 'must', 750_000, 'lot-uva'],
    ]);

    const started = asOk(planOperation({
      ...header({ id: 'op-fa', fiscal_date: '2027-09-03', occurred_at: '2027-09-03T08:00:00Z' }),
      op_type: 'fermentation_start',
      vessel_id: 'inox-01',
      lot: must,
      current_phase: null,
    } satisfies FermentationStartRequest, stateOf(pressed.vesselsAfter), idSource()));
    expect(started.stockMoves).toEqual([]);
    expect(started.fermentationPhase?.phase).toBe('alcoholic');

    const ending: FermentationEndRequest = {
      ...header({ id: 'op-fin', fiscal_date: '2027-09-18', occurred_at: '2027-09-18T08:00:00Z' }),
      op_type: 'fermentation_end',
      current_phase: 'alcoholic',
      abv_pct: '12.50',
      lines: [
        { role: 'input', lot: must, vessel_id: 'inox-01', volume_ml: 750_000, product_state: 'must', loss_kind: null },
        { role: 'output', lot: must, vessel_id: 'inox-01', volume_ml: 720_000, product_state: 'wine', loss_kind: null },
        { role: 'loss', lot: must, vessel_id: 'inox-01', volume_ml: 30_000, product_state: 'must', loss_kind: 'authorized' },
      ],
    };
    const ended = asOk(planOperation(ending, stateOf(pressed.vesselsAfter), idSource()));
    expect(ended.lotUpdates).toEqual([{ lot_id: 'lot-uva', kind: 'wine' }]);
    expect(ended.fermentationPhase?.phase).toBe('alcoholic_done');
    expect(ended.vesselsAfter.map((row) => [row.product_state, row.volume_ml])).toEqual([['wine', 720_000]]);
    expect(ended.fiscalMoves.map((row) => [row.move_type, row.volume_ml, row.excise_product_key, row.abv_pct])).toEqual([
      ['production', 720_000, 'GRANEL-TINTO', '12.50'],
    ]);
    expect(ended.silicieFacts).toEqual([
      {
        kind: 'elaboration_loss',
        mass_g: null,
        volume_ml: 30_000,
        ledger_reference: 'GRANEL-TINTO',
        abv_pct: '12.50',
      },
    ]);
    const wineIn = ended.stockMoves.find((row) => row.move_type === 'cellar_in');
    const mustOut = ended.stockMoves.find((row) => row.move_type === 'cellar_out');
    const lees = ended.stockMoves.find((row) => row.move_type === 'loss');
    expect(wineIn?.product_state).toBe('wine');
    expect(wineIn?.volume_ml).toBe(720_000);
    expect(mustOut?.product_state).toBe('must');
    expect(mustOut?.volume_ml).toBe(-720_000);
    expect(lees?.volume_ml).toBe(-30_000);

    const production = ended.fiscalMoves[0];
    if (!production) throw new Error('falta el A15');
    const crushing = pressed.silicieFacts[0];
    const loss = ended.silicieFacts[0];
    if (!crushing || !loss || crushing.mass_g === null || loss.volume_ml === null) throw new Error('faltan hechos');
    const entries = entriesFor(
      [
        move({
          id: production.id,
          moveType: 'production',
          productClass: 'bulk',
          exciseProductKey: 'GRANEL-TINTO',
          fiscalDate: '2027-09-18',
          volumeMl: production.volume_ml,
          justificationRef: 'PARTE-SINT',
          sourceId: 'op-fin',
          abvCenti: 1250,
        }),
      ],
      ctx({
        aggregation: 'monthly',
        ledgers: [uva(), granel('tinto')],
        hints: { [production.id]: { operationNumber: 'OB-SINT' } },
        facts: [
          {
            kind: 'crushing',
            id: 'prensa',
            date: '2027-09-02',
            massG: crushing.mass_g,
            justificationRef: 'PARTE-SINT',
            operationNumber: 'OB-SINT',
            sourceId: 'op-fin',
          },
          {
            kind: 'elaboration_loss',
            id: 'lias',
            date: '2027-09-18',
            volumeMl: loss.volume_ml,
            ledgerReference: 'GRANEL-TINTO',
            justificationRef: 'PARTE-SINT',
            operationNumber: 'OB-SINT',
            sourceId: 'op-fin',
            abvCenti: 1250,
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.entryKind)).toEqual(['A14', 'A15', 'A32']);
    expect(new Set(entries.map((entry) => entry.fields.numeroOperacion)).size).toBe(1);
    expect(entries.map((entry) => entry.fields.tipoOperacion)).toEqual(['V01', 'V01', 'V01']);
    const byKind = new Map(entries.map((entry) => [entry.entryKind, entry]));
    expect(byKind.get('A14')?.fields.cantidad).toBe(1_000_000);
    expect(byKind.get('A14')?.fields.unidadMedida).toBe('KGM');
    expect(byKind.get('A15')?.fields.cantidad).toBe(720_000);
    expect(byKind.get('A15')?.fields.unidadMedida).toBe('LTR');
    expect(byKind.get('A32')?.fields.cantidad).toBe(30_000);
    expect(byKind.get('A32')?.fields.diferenciaMenos).toBe('VB01');
  });

  it('el mosto conserva el volumen y el orujo se anota en g/L', () => {
    const source = holding('inox-02', must, 500_000, 'must');
    const dest = vessel({ id: 'inox-03' });
    const result = planOperation({
      ...header({ id: 'op-reprensa' }),
      op_type: 'crushing_pressing',
      lines: [
        {
          role: 'input',
          lot: must,
          vessel_id: 'inox-02',
          location_id: 'loc-bod',
          product_state: 'must',
          mass_g: 0,
          volume_ml: 500_000,
        },
        {
          role: 'output',
          lot: must,
          vessel_id: 'inox-03',
          volume_ml: 420_000,
          product_state: 'must',
        },
        {
          role: 'loss',
          lot: must,
          vessel_id: 'inox-02',
          volume_ml: 80_000,
          loss_kind: 'authorized',
          product_state: 'must',
        },
        { role: 'pomace', lot: must, location_id: 'loc-bod', mass_g: 40_000 },
      ],
    }, stateOf([source, dest]), idSource());
    const plan = asOk(result);
    expect(plan.pressingYield?.must_yield).toBe('0.840');
    expect(plan.pressingYield?.must_yield_unit).toBe('volume_ratio');
    expect(plan.pressingYield?.pomace_yield_unit).toBe('g_per_l');
    expect(plan.silicieFacts).toEqual([]);
    const signed = plan.stockMoves.reduce((total, row) => total + row.volume_ml, 0);
    expect(signed).toBe(-80_000);
  });

  it('rechaza orujo más pesado que la uva y un fin de FA sin grado', () => {
    const tank = vessel({ id: 'inox-01' });
    const heavy = planOperation({
      ...header(),
      op_type: 'crushing_pressing',
      lines: [
        {
          role: 'input',
          lot: grape,
          vessel_id: null,
          location_id: 'loc-bod',
          product_state: 'grape',
          mass_g: 1_000,
          volume_ml: 0,
        },
        { role: 'output', lot: grape, vessel_id: 'inox-01', volume_ml: 500, product_state: 'must' },
        { role: 'pomace', lot: grape, location_id: 'loc-bod', mass_g: 2_000 },
      ],
    }, stateOf([tank]), idSource());
    expect(heavy.ok).toBe(false);

    const full = holding('inox-01', must, 1_000, 'must');
    const noAbv = planOperation({
      ...header(),
      op_type: 'fermentation_end',
      current_phase: 'alcoholic',
      abv_pct: null,
      lines: [
        { role: 'input', lot: must, vessel_id: 'inox-01', volume_ml: 1_000, product_state: 'must', loss_kind: null },
        { role: 'output', lot: must, vessel_id: 'inox-01', volume_ml: 1_000, product_state: 'wine', loss_kind: null },
      ],
    } satisfies FermentationEndRequest, stateOf([full]), idSource());
    if (noAbv.ok) throw new Error('debía faltar el grado');
    expect(noAbv.code).toBe('WC_VALIDATION');
  });

  it('la maloláctica no empieza durante la alcohólica y no genera A15', () => {
    const wine = lot({ id: 'lot-vino', code: 'V26A', kind: 'wine', excise_product_key: 'GRANEL-TINTO', abv_pct: '13.00' });
    const tank = holding('inox-04', wine, 200_000, 'wine');
    const early = planOperation({
      ...header(),
      op_type: 'malolactic_start',
      vessel_id: 'inox-04',
      lot: wine,
      current_phase: 'alcoholic',
    } satisfies FermentationStartRequest, stateOf([tank]), idSource());
    if (early.ok) throw new Error('la FML no puede empezar');
    expect(early.code).toBe('WC_ILLEGAL_TRANSITION');

    const started = asOk(planOperation({
      ...header({ id: 'op-fml' }),
      op_type: 'malolactic_start',
      vessel_id: 'inox-04',
      lot: wine,
      current_phase: 'alcoholic_done',
    } satisfies FermentationStartRequest, stateOf([tank]), idSource()));
    expect(started.fermentationPhase?.phase).toBe('malolactic');
    expect(started.fiscalMoves).toEqual([]);

    const ended = asOk(planOperation({
      ...header({ id: 'op-fml-fin' }),
      op_type: 'malolactic_end',
      current_phase: 'malolactic',
      abv_pct: null,
      lines: [
        { role: 'input', lot: wine, vessel_id: 'inox-04', volume_ml: 200_000, product_state: 'wine', loss_kind: null },
        { role: 'output', lot: wine, vessel_id: 'inox-04', volume_ml: 198_000, product_state: 'wine', loss_kind: null },
        { role: 'loss', lot: wine, vessel_id: 'inox-04', volume_ml: 2_000, product_state: 'wine', loss_kind: 'authorized' },
      ],
    } satisfies FermentationEndRequest, stateOf([tank]), idSource()));
    expect(ended.fiscalMoves).toEqual([]);
    expect(ended.silicieFacts).toEqual([]);
    expect(ended.fermentationPhase?.phase).toBe('malolactic_done');
    expect(ended.vesselsAfter[0]?.volume_ml).toBe(198_000);
  });
});

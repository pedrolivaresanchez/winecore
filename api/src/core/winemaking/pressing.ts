import {
  applyContents,
  assertConserved,
  assertHeader,
  assertInService,
  assertLot,
  assertPositiveMl,
  assertSameWarehouse,
  fail,
  loadVessel,
  succeed,
  sumMl,
} from '../cellar/common';
import type {
  CellarState,
  IdSource,
  LossKind,
  PlanResult,
  PressingLine,
  PressingRequest,
  PressingYieldDraft,
  StockMoveDraft,
  VesselState,
} from '../cellar/types';
import { gramsPerLitre, litresPer100Kg, ratio3 } from './yields';

/**
 * Prensado: uva (g) o mosto (mL) → mosto (mL) en recipientes + orujo (g).
 * El mismo lote sigue (la partida no se parte). La uva genera el hecho A14;
 * el mosto no mueve el libro fiscal (silicie.md §5).
 */
export function planPressing(req: PressingRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado no tiene líneas.', { field: 'lines' });
  }

  const inputs: Extract<PressingLine, { role: 'input' }>[] = [];
  const outputs: Extract<PressingLine, { role: 'output' }>[] = [];
  const pomace: Extract<PressingLine, { role: 'pomace' }>[] = [];
  const losses: Extract<PressingLine, { role: 'loss' }>[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    const lotError = assertLot(line.lot, `${field}.lot`);
    if (lotError !== null) return lotError;
    if (line.role === 'input') {
      inputs.push(line);
    } else if (line.role === 'output') {
      outputs.push(line);
    } else if (line.role === 'pomace') {
      pomace.push(line);
    } else if (line.role === 'loss') {
      losses.push(line);
    } else {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la línea de prensado no es válida.', { field });
    }
  }

  if (inputs.length === 0 || outputs.length === 0) {
    return fail('WC020', 'WC020: el prensado necesita uva o mosto de entrada y mosto de salida.', {
      op_type: 'crushing_pressing',
    });
  }
  if (pomace.length !== 1) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado declara un único orujo.', { field: 'pomace' });
  }
  const solids = pomace[0];
  if (solids === undefined || !isPositiveInt(solids.mass_g)) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el orujo se anota en gramos enteros y positivos.', {
      field: 'pomace.mass_g',
    });
  }
  if (solids.location_id.trim() === '') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el orujo necesita una ubicación.', { field: 'pomace.location_id' });
  }

  const lotId = inputs[0]?.lot.id;
  if (lotId === undefined) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado no tiene líneas.', { field: 'lines' });
  }
  for (const line of [...inputs, ...outputs, ...pomace, ...losses]) {
    if (line.lot.id !== lotId) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado sigue con el mismo lote; mezclar es un ensamblaje.', {
        field: 'lot',
      });
    }
  }

  const inputState = inputs[0]?.product_state;
  if (inputState !== 'grape' && inputState !== 'must') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado entra como uva o como mosto.', { field: 'product_state' });
  }
  for (const line of inputs) {
    if (line.product_state !== inputState) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado no mezcla uva y mosto en la misma operación.', {
        field: 'product_state',
      });
    }
  }
  for (const line of outputs) {
    if (line.product_state !== 'must') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la salida del prensado es mosto.', { field: 'product_state' });
    }
    const volume = assertPositiveMl(line.volume_ml, 'output.volume_ml');
    if (volume !== null) return volume;
  }

  const outputMl = sumMl(outputs.map((line) => line.volume_ml));
  if (typeof outputMl !== 'number') return outputMl;

  const vessels: VesselState[] = [];
  for (const line of outputs) {
    const vessel = loadVessel(state, line.vessel_id);
    if ('ok' in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    vessels.push(vessel);
  }

  if (inputState === 'grape') {
    return planGrapePress(req, state, ids, inputs, outputs, solids, losses, outputMl, vessels);
  }
  return planMustPress(req, state, ids, inputs, outputs, solids, losses, outputMl, vessels);
}

function planGrapePress(
  req: PressingRequest,
  state: CellarState,
  ids: IdSource,
  inputs: readonly Extract<PressingLine, { role: 'input' }>[],
  outputs: readonly Extract<PressingLine, { role: 'output' }>[],
  solids: Extract<PressingLine, { role: 'pomace' }>,
  losses: readonly Extract<PressingLine, { role: 'loss' }>[],
  outputMl: number,
  vessels: readonly VesselState[],
): PlanResult {
  if (losses.length > 0) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado de uva no declara merma de volumen; el orujo va en masa.', {
      field: 'loss',
    });
  }
  let mass = 0;
  const stockMoves: StockMoveDraft[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const line = inputs[index];
    if (line === undefined) continue;
    if (line.volume_ml !== 0) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la uva se anota en gramos, no en mililitros.', {
        field: `lines.input.volume_ml`,
      });
    }
    if (!isPositiveInt(line.mass_g)) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la uva se anota en gramos enteros y positivos.', {
        field: 'mass_g',
      });
    }
    if (line.lot.kind !== 'grape') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el lote de la uva no es de uva.', { field: 'lot.kind' });
    }
    if (line.location_id.trim() === '') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la uva necesita una ubicación.', { field: 'location_id' });
    }
    mass += line.mass_g;
    if (!Number.isSafeInteger(mass)) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la masa total no cabe en un entero seguro.');
    }
    stockMoves.push(grapeOut(req, ids, line));
  }
  if (solids.mass_g > mass) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el orujo no puede pesar más que la uva.', {
      field: 'pomace.mass_g',
      mass_g: mass,
      pomace_mass_g: solids.mass_g,
    });
  }

  const warehouse = assertSameWarehouse(vessels);
  if (warehouse !== null) return warehouse;
  const after = applyContents(
    state,
    [],
    outputs.map((line) => ({
      vesselId: line.vessel_id,
      volume_ml: line.volume_ml,
      lot: line.lot,
      product_state: 'must' as const,
      owner_entity_id: line.lot.producer_entity_id,
    })),
  );
  if (!Array.isArray(after)) return after;

  for (const line of outputs) {
    const vessel = vessels.find((item) => item.id === line.vessel_id);
    if (vessel === undefined) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no existe.', { vessel_id: line.vessel_id });
    }
    stockMoves.push(mustIn(req, ids, vessel, line.lot.id, line.lot.producer_entity_id, line.volume_ml));
  }
  const yieldDraft: PressingYieldDraft = {
    input_state: 'grape',
    input_mass_g: mass,
    input_volume_ml: 0,
    must_volume_ml: outputMl,
    pomace_mass_g: solids.mass_g,
    must_yield: litresPer100Kg(outputMl, mass),
    must_yield_unit: 'l_per_100kg',
    pomace_yield: ratio3(solids.mass_g, mass),
    pomace_yield_unit: 'mass_ratio',
  };

  return succeed({
    stockMoves,
    fiscalMoves: [],
    newLots: [],
    lotEdges: [],
    vesselsAfter: after,
    silicieFacts: [{
      kind: 'crushing',
      mass_g: mass,
      volume_ml: null,
      ledger_reference: 'UVA',
      abv_pct: null,
    }],
    lotUpdates: [{ lot_id: inputs[0]?.lot.id ?? '', kind: 'must' }],
    pressingYield: yieldDraft,
  });
}

function planMustPress(
  req: PressingRequest,
  state: CellarState,
  ids: IdSource,
  inputs: readonly Extract<PressingLine, { role: 'input' }>[],
  outputs: readonly Extract<PressingLine, { role: 'output' }>[],
  solids: Extract<PressingLine, { role: 'pomace' }>,
  losses: readonly Extract<PressingLine, { role: 'loss' }>[],
  outputMl: number,
  outVessels: readonly VesselState[],
): PlanResult {
  const sources: { vessel: VesselState; volume_ml: number; lotId: string; owner: string }[] = [];
  for (const line of inputs) {
    if (line.mass_g !== 0) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el mosto de entrada se anota en mililitros.', { field: 'mass_g' });
    }
    const volume = assertPositiveMl(line.volume_ml, 'input.volume_ml');
    if (volume !== null) return volume;
    if (line.vessel_id === null || line.vessel_id.trim() === '') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el mosto de entrada está en un recipiente.', { field: 'vessel_id' });
    }
    if (line.lot.kind !== 'must') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el lote del mosto no es de mosto.', { field: 'lot.kind' });
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ('ok' in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    if (vessel.lot_id !== line.lot.id || vessel.product_state !== 'must') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no contiene ese mosto.', { vessel_id: vessel.id });
    }
    sources.push({
      vessel,
      volume_ml: line.volume_ml,
      lotId: line.lot.id,
      owner: vessel.owner_entity_id,
    });
  }

  let lossMl = 0;
  for (const line of losses) {
    const volume = assertPositiveMl(line.volume_ml, 'loss.volume_ml');
    if (volume !== null) return volume;
    if (line.product_state !== 'must' || line.loss_kind !== 'authorized') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la merma de prensado es mosto y autorizada.', { field: 'loss' });
    }
    lossMl += line.volume_ml;
    if (!Number.isSafeInteger(lossMl)) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el volumen total no cabe en un entero seguro.');
    }
  }

  const inputMl = sumMl(sources.map((row) => row.volume_ml));
  if (typeof inputMl !== 'number') return inputMl;
  const conserved = assertConserved(
    { inputs_ml: inputMl, outputs_ml: outputMl, losses_ml: lossMl },
    'crushing_pressing',
  );
  if (conserved !== null) return conserved;

  const touched = [...sources.map((row) => row.vessel), ...outVessels];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;
  const lot = inputs[0]?.lot;
  if (lot === undefined) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado no tiene líneas.', { field: 'lines' });
  }
  const after = applyContents(
    state,
    sources.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.volume_ml })),
    outputs.map((line) => ({
      vesselId: line.vessel_id,
      volume_ml: line.volume_ml,
      lot,
      product_state: 'must' as const,
      owner_entity_id: sources[0]?.owner ?? lot.producer_entity_id,
    })),
  );
  if (!Array.isArray(after)) return after;

  if (sources.length !== 1 && lossMl > 0) {
    return fail(
      'WC_VALIDATION',
      'WC_VALIDATION: la merma de un prensado de mosto con varios orígenes no se reparte; usa un solo recipiente.',
      { field: 'loss' },
    );
  }
  const stockMoves: StockMoveDraft[] = [];
  if (sources.length === 1) {
    const only = sources[0];
    if (only === undefined) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el prensado no tiene líneas.', { field: 'lines' });
    }
    const moved = only.volume_ml - lossMl;
    if (moved > 0) {
      stockMoves.push(mustMove(req, ids, only.vessel, only.lotId, only.owner, 'cellar_out', -moved, null));
    }
    if (lossMl > 0) {
      stockMoves.push(mustMove(req, ids, only.vessel, only.lotId, only.owner, 'loss', -lossMl, 'authorized'));
    }
  } else {
    for (const source of sources) {
      stockMoves.push(mustMove(req, ids, source.vessel, source.lotId, source.owner, 'cellar_out', -source.volume_ml, null));
    }
  }

  for (const line of outputs) {
    const vessel = outVessels.find((item) => item.id === line.vessel_id);
    if (vessel === undefined) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no existe.', { vessel_id: line.vessel_id });
    }
    stockMoves.push(mustIn(req, ids, vessel, lot.id, sources[0]?.owner ?? lot.producer_entity_id, line.volume_ml));
  }

  return succeed({
    stockMoves,
    fiscalMoves: [],
    newLots: [],
    lotEdges: [],
    vesselsAfter: after,
    pressingYield: {
      input_state: 'must',
      input_mass_g: 0,
      input_volume_ml: inputMl,
      must_volume_ml: outputMl,
      pomace_mass_g: solids.mass_g,
      must_yield: ratio3(outputMl, inputMl),
      must_yield_unit: 'volume_ratio',
      pomace_yield: gramsPerLitre(solids.mass_g, inputMl),
      pomace_yield_unit: 'g_per_l',
    },
  });
}

function grapeOut(
  req: PressingRequest,
  ids: IdSource,
  line: Extract<PressingLine, { role: 'input' }>,
): StockMoveDraft {
  return {
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: 'cellar_out',
    location_id: line.location_id,
    vessel_id: line.vessel_id,
    owner_entity_id: line.lot.producer_entity_id,
    lot_id: line.lot.id,
    product_id: null,
    product_state: 'grape',
    qty_units: 0,
    volume_ml: 0,
    mass_g: -line.mass_g,
    loss_kind: null,
    source_table: 'cellar.operation',
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  };
}

function mustIn(
  req: PressingRequest,
  ids: IdSource,
  vessel: VesselState,
  lotId: string,
  owner: string,
  volumeMl: number,
): StockMoveDraft {
  return {
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: 'cellar_in',
    location_id: vessel.location_id,
    vessel_id: vessel.id,
    owner_entity_id: owner,
    lot_id: lotId,
    product_id: null,
    product_state: 'must',
    qty_units: 0,
    volume_ml: volumeMl,
    mass_g: 0,
    loss_kind: null,
    source_table: 'cellar.operation',
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  };
}

function mustMove(
  req: PressingRequest,
  ids: IdSource,
  vessel: VesselState,
  lotId: string,
  owner: string,
  moveType: 'cellar_out' | 'loss',
  volumeMl: number,
  lossKind: LossKind | null,
): StockMoveDraft {
  return {
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: moveType,
    location_id: vessel.location_id,
    vessel_id: vessel.id,
    owner_entity_id: owner,
    lot_id: lotId,
    product_id: null,
    product_state: 'must',
    qty_units: 0,
    volume_ml: volumeMl,
    mass_g: 0,
    loss_kind: lossKind,
    source_table: 'cellar.operation',
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  };
}

function isPositiveInt(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

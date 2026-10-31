import {
  abvOk,
  applyContents,
  assertConserved,
  assertHeader,
  assertInService,
  assertLot,
  assertPositiveMl,
  assertSameWarehouse,
  bulkColour,
  fail,
  kindMatchesState,
  ledgerOf,
  loadVessel,
  succeed,
  sumMl,
} from '../cellar/common';
import type {
  BulkProductState,
  CellarState,
  FermentationEndRequest,
  FermentationPhaseName,
  FermentationStartRequest,
  FermentationVolumeLine,
  FiscalMoveDraft,
  IdSource,
  PlanResult,
  StockMoveDraft,
  VesselState,
} from '../cellar/types';

/**
 * Inicio de fermentación alcohólica (mosto) o maloláctica (vino).
 * No mueve volumen ni el libro fiscal: solo cambia la fase del lote.
 */
export function planFermentationStart(
  req: FermentationStartRequest,
  state: CellarState,
  _ids: IdSource,
): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  const lotError = assertLot(req.lot, 'lot');
  if (lotError !== null) return lotError;
  const vessel = loadVessel(state, req.vessel_id);
  if ('ok' in vessel) return vessel;
  const service = assertInService(vessel);
  if (service !== null) return service;
  if (vessel.volume_ml <= 0 || vessel.lot_id === null || vessel.product_state === null) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente está vacío.', { vessel_id: vessel.id });
  }
  if (vessel.lot_id !== req.lot.id) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el lote no es el que contiene el recipiente.', {
      vessel_id: vessel.id,
    });
  }

  if (req.op_type === 'fermentation_start') {
    if (vessel.product_state !== 'must' || !kindMatchesState(req.lot.kind, 'must')) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la fermentación alcohólica empieza sobre mosto.', {
        vessel_id: vessel.id,
      });
    }
    if (req.current_phase !== null) {
      return fail('WC_ILLEGAL_TRANSITION', 'WC_ILLEGAL_TRANSITION: la fermentación alcohólica ya está registrada.', {
        phase: req.current_phase,
      });
    }
    return phaseOnly(req, vessel.id, 'alcoholic');
  }

  if (vessel.product_state !== 'wine' || !kindMatchesState(req.lot.kind, 'wine')) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la fermentación maloláctica empieza sobre vino.', {
      vessel_id: vessel.id,
    });
  }
  if (req.current_phase === 'alcoholic') {
    return fail('WC_ILLEGAL_TRANSITION', 'WC_ILLEGAL_TRANSITION: la fermentación alcohólica no ha terminado.', {
      phase: req.current_phase,
    });
  }
  if (req.current_phase === 'malolactic' || req.current_phase === 'malolactic_done') {
    return fail('WC_ILLEGAL_TRANSITION', 'WC_ILLEGAL_TRANSITION: la fermentación maloláctica ya está registrada.', {
      phase: req.current_phase,
    });
  }
  return phaseOnly(req, vessel.id, 'malolactic');
}

/**
 * Fin de FA: mosto → vino del mismo lote, lías en merma, A15 del vino obtenido
 * y A32 (VB01) de la diferencia. Fin de FML: el vino sigue siendo vino; no hay
 * asiento nuevo (el A15 ya se anotó al terminar la alcohólica).
 */
export function planFermentationEnd(
  req: FermentationEndRequest,
  state: CellarState,
  ids: IdSource,
): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail('WC020', 'WC020: el fin de fermentación necesita entradas y salidas.', {
      op_type: req.op_type,
    });
  }

  const alcoholic = req.op_type === 'fermentation_end';
  const expectedIn: BulkProductState = alcoholic ? 'must' : 'wine';
  const expectedOut: BulkProductState = 'wine';
  const inputs: { line: FermentationVolumeLine; vessel: VesselState }[] = [];
  const outputs: { line: FermentationVolumeLine; vessel: VesselState }[] = [];
  const losses: FermentationVolumeLine[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    const lotError = assertLot(line.lot, `${field}.lot`);
    if (lotError !== null) return lotError;
    const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
    if (volume !== null) return volume;
    if (line.role === 'loss') {
      if (line.loss_kind !== 'authorized') {
        return fail('WC_VALIDATION', 'WC_VALIDATION: las lías de fermentación son merma autorizada.', { field });
      }
      if (line.product_state !== expectedIn) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: las lías salen del producto que fermenta.', { field });
      }
      losses.push(line);
      continue;
    }
    if (line.loss_kind !== null) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: solo la merma lleva tipo.', { field });
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ('ok' in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    const expectedKind = alcoholic ? 'must' : 'wine';
    if (line.lot.kind !== expectedKind) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el tipo de lote no coincide con el estado del producto.', { field });
    }
    if (line.role === 'input') {
      if (line.product_state !== expectedIn) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: la entrada no está en el estado esperado.', { field });
      }
      if (vessel.lot_id !== line.lot.id || vessel.product_state !== expectedIn) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no contiene ese producto.', {
          field,
          vessel_id: vessel.id,
        });
      }
      if (line.volume_ml !== vessel.volume_ml) {
        return fail(
          'WC_VALIDATION',
          'WC_VALIDATION: el fin de fermentación vacía el recipiente de origen; un trasiego parcial es otra operación.',
          { field, vessel_id: vessel.id },
        );
      }
      inputs.push({ line, vessel });
    } else if (line.role === 'output') {
      if (line.product_state !== expectedOut) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: la salida del fin de fermentación es vino.', { field });
      }
      outputs.push({ line, vessel });
    } else {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la línea de fermentación no es válida.', { field });
    }
  }

  if (inputs.length === 0 || outputs.length === 0) {
    return fail('WC020', `WC020: ${req.op_type} necesita entradas y salidas.`, { op_type: req.op_type });
  }
  const lot = inputs[0]?.line.lot;
  if (lot === undefined) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la fermentación no tiene líneas.', { field: 'lines' });
  }
  for (const row of [...inputs, ...outputs]) {
    if (row.line.lot.id !== lot.id) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el fin de fermentación sigue con el mismo lote.', { field: 'lot' });
    }
  }
  for (const line of losses) {
    if (line.lot.id !== lot.id) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: las lías son del mismo lote.', { field: 'lot' });
    }
  }

  const phaseError = assertEndPhase(req.current_phase, alcoholic);
  if (phaseError !== null) return phaseError;

  const inputMl = sumMl(inputs.map((row) => row.line.volume_ml));
  if (typeof inputMl !== 'number') return inputMl;
  const outputMl = sumMl(outputs.map((row) => row.line.volume_ml));
  if (typeof outputMl !== 'number') return outputMl;
  const lossMl = sumMl(losses.map((line) => line.volume_ml));
  if (typeof lossMl !== 'number') return lossMl;
  const conserved = assertConserved(
    { inputs_ml: inputMl, outputs_ml: outputMl, losses_ml: lossMl },
    req.op_type,
  );
  if (conserved !== null) return conserved;

  const touched = [...inputs.map((row) => row.vessel), ...outputs.map((row) => row.vessel)];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;
  const owner = inputs[0]?.vessel.owner_entity_id;
  if (owner === undefined) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: falta el propietario.');
  }

  const after = applyContents(
    state,
    inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.line.volume_ml })),
    outputs.map((row) => ({
      vesselId: row.vessel.id,
      volume_ml: row.line.volume_ml,
      lot,
      product_state: 'wine' as const,
      owner_entity_id: owner,
    })),
  );
  if (!Array.isArray(after)) return after;

  const stockMoves: StockMoveDraft[] = [];
  let attributed = 0;
  for (const row of inputs) {
    const lossHere = losses
      .filter((line) => line.vessel_id === row.vessel.id)
      .reduce((total, line) => total + line.volume_ml, 0);
    if (lossHere > row.line.volume_ml) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: las lías superan el volumen del recipiente.', {
        vessel_id: row.vessel.id,
      });
    }
    attributed += lossHere;
    const moved = row.line.volume_ml - lossHere;
    if (moved > 0) {
      stockMoves.push(volumeMove(req, ids, row.vessel, lot.id, owner, expectedIn, 'cellar_out', -moved, null));
    }
    if (lossHere > 0) {
      stockMoves.push(volumeMove(req, ids, row.vessel, lot.id, owner, expectedIn, 'loss', -lossHere, 'authorized'));
    }
  }
  if (attributed !== lossMl) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: las lías se atribuyen a un recipiente de entrada.', { field: 'loss' });
  }
  for (const row of outputs) {
    stockMoves.push(volumeMove(req, ids, row.vessel, lot.id, owner, 'wine', 'cellar_in', row.line.volume_ml, null));
  }

  const nextPhase: FermentationPhaseName = alcoholic ? 'alcoholic_done' : 'malolactic_done';
  const base = {
    stockMoves,
    fiscalMoves: [] as FiscalMoveDraft[],
    newLots: [],
    lotEdges: [],
    vesselsAfter: after,
    lotUpdates: alcoholic ? [{ lot_id: lot.id, kind: 'wine' as const }] : [],
    fermentationPhase: {
      lot_id: lot.id,
      vessel_id: outputs[0]?.vessel.id ?? inputs[0]?.vessel.id ?? req.lines[0]?.vessel_id ?? '',
      phase: nextPhase,
      previous_phase: req.current_phase,
    },
  };
  if (!alcoholic) {
    return succeed(base);
  }

  if (req.abv_pct === null || !abvOk(req.abv_pct) || req.abv_pct === '') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el fin de la fermentación alcohólica necesita el grado (A15).', {
      field: 'abv_pct',
    });
  }
  const reference = wineReference(outputs.map((row) => row.vessel), lot.excise_product_key);
  if (typeof reference !== 'string') return reference;
  const wh = outputs[0]?.vessel.tax_warehouse_id ?? inputs[0]?.vessel.tax_warehouse_id ?? null;
  if (wh === null) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no está en un almacén fiscal.', { field: 'vessel_id' });
  }
  const productClass = ledgerOf(outputs[0]?.vessel ?? inputs[0]!.vessel);
  const fiscal: FiscalMoveDraft = {
    id: ids.newId(),
    tax_warehouse_id: wh,
    fiscal_date: req.fiscal_date,
    physical_date: req.fiscal_date,
    move_type: 'production',
    product_class: productClass,
    lot_id: lot.id,
    product_id: null,
    volume_ml: outputMl,
    units: 0,
    abv_pct: req.abv_pct,
    excise_product_key: reference,
    nc_code: null,
    justification_type: 'internal',
    justification_ref: req.id,
    counterparty_contact_id: null,
    counterparty_excise_number: null,
    fiscal_trigger: 'operation',
    source_table: 'cellar.operation',
    source_id: req.id,
    source_line_id: null,
    silicie_entry_id: null,
    reverses_move_id: null,
    reason: req.reason,
    created_by: req.created_by,
  };
  return succeed({
    ...base,
    fiscalMoves: [fiscal],
    silicieFacts: lossMl > 0
      ? [{
        kind: 'elaboration_loss',
        mass_g: null,
        volume_ml: lossMl,
        ledger_reference: reference,
        abv_pct: req.abv_pct,
      }]
      : [],
  });
}

function phaseOnly(
  req: FermentationStartRequest,
  vesselId: string,
  phase: FermentationPhaseName,
): PlanResult {
  return succeed({
    stockMoves: [],
    fiscalMoves: [],
    newLots: [],
    lotEdges: [],
    vesselsAfter: [],
    fermentationPhase: {
      lot_id: req.lot.id,
      vessel_id: vesselId,
      phase,
      previous_phase: req.current_phase,
    },
  });
}

function assertEndPhase(phase: FermentationPhaseName | null, alcoholic: boolean): PlanResult | null {
  if (alcoholic) {
    if (phase === null || phase === 'alcoholic') return null;
    return fail('WC_ILLEGAL_TRANSITION', 'WC_ILLEGAL_TRANSITION: el mosto no está en fermentación alcohólica.', {
      phase,
    });
  }
  if (phase === 'malolactic') return null;
  return fail('WC_ILLEGAL_TRANSITION', 'WC_ILLEGAL_TRANSITION: el vino no está en fermentación maloláctica.', {
    phase,
  });
}

function wineReference(vessels: readonly VesselState[], lotKey: string | null): string | PlanResult {
  const colours = new Set<string>();
  const classes = new Set<string>();
  for (const vessel of vessels) {
    const colour = bulkColour(lotKey) ?? bulkColour(vessel.excise_product_key);
    if (colour === null) {
      return fail(
        'WC_VALIDATION',
        'WC_VALIDATION: falta el color del mayor fiscal del vino (TINTO, BLANCO o ROSADO).',
        { vessel_id: vessel.id },
      );
    }
    colours.add(colour);
    classes.add(ledgerOf(vessel) === 'bulk_wood' ? 'CRIANZA' : 'GRANEL');
  }
  if (colours.size !== 1 || classes.size !== 1) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el vino obtenido queda en un solo mayor fiscal.', {
      ledgers: [...classes].map((prefix) => [...colours].map((colour) => `${prefix}-${colour}`)).flat(),
    });
  }
  const prefix = [...classes][0];
  const colour = [...colours][0];
  if (prefix === undefined || colour === undefined) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: falta el mayor fiscal del vino.');
  }
  return `${prefix}-${colour}`;
}

function volumeMove(
  req: FermentationEndRequest,
  ids: IdSource,
  vessel: VesselState,
  lotId: string,
  owner: string,
  productState: BulkProductState,
  moveType: 'cellar_out' | 'cellar_in' | 'loss',
  volumeMl: number,
  lossKind: 'authorized' | null,
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
    product_state: productState,
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

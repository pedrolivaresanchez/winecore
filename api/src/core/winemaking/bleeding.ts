import {
  applyContents,
  assertHeader,
  assertInService,
  assertLot,
  assertPositiveMl,
  assertSameWarehouse,
  bulkStockMove,
  fail,
  isLotCode,
  kindMatchesState,
  loadVessel,
  resolveNewId,
  succeed,
} from '../cellar/common';
import type {
  BleedingRequest,
  BulkProductState,
  CellarState,
  FermentationVolumeLine,
  IdSource,
  LotDraft,
  LotRef,
  PlanResult,
  StockMoveDraft,
  VesselState,
} from '../cellar/types';
import { assertElaborationBalance, SILICIE_Q040 } from './balance';

/**
 * Sangrado: parte del mosto o vino de un depósito pasa a otro como lote hijo.
 * Conserva el volumen. No hay asiento SILICIE (Q-040).
 */
export function planBleeding(req: BleedingRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (req.new_lot === null || typeof req.new_lot !== 'object' || !isLotCode(req.new_lot.code ?? '')) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el sangrado crea un lote con código válido.', { field: 'new_lot.code' });
  }
  const parsed = parseVolumeLines(req.lines);
  if (!Array.isArray(parsed)) return parsed;
  const balance = assertElaborationBalance('bleeding', parsed.map((line) => ({ role: line.role, volume_ml: line.volume_ml })));
  if (balance !== null) return balance;

  const inputs: { line: FermentationVolumeLine; vessel: VesselState }[] = [];
  const outputs: { line: FermentationVolumeLine; vessel: VesselState }[] = [];
  const losses: FermentationVolumeLine[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const line = parsed[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    if (line.role === 'loss') {
      if (line.loss_kind !== 'authorized') {
        return fail('WC_VALIDATION', 'WC_VALIDATION: la merma del sangrado es autorizada.', { field });
      }
      losses.push(line);
      continue;
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ('ok' in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    if (line.role === 'input') {
      if (vessel.lot_id !== line.lot.id || vessel.product_state !== line.product_state) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no contiene ese lote.', { field, vessel_id: vessel.id });
      }
      if (line.volume_ml > vessel.volume_ml) {
        return fail('WC024', 'WC024: el sangrado pide más volumen del que hay.', {
          vessel_id: vessel.id,
          requested_ml: line.volume_ml,
          available_ml: vessel.volume_ml,
        });
      }
      inputs.push({ line, vessel });
    } else {
      outputs.push({ line, vessel });
    }
  }
  const parent = inputs[0]?.line.lot;
  const stateName = inputs[0]?.line.product_state;
  if (parent === undefined || stateName === undefined) {
    return fail('WC020', 'WC020: bleeding necesita entradas y salidas.', { op_type: 'bleeding' });
  }
  if (!kindMatchesState(parent.kind, stateName)) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el tipo de lote no coincide con el estado del producto.', { field: 'lot' });
  }
  for (const row of inputs) {
    if (row.line.lot.id !== parent.id || row.line.product_state !== stateName) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el sangrado sale de un solo lote.', { field: 'lot' });
    }
  }
  for (const line of losses) {
    if (line.lot.id !== parent.id || line.product_state !== stateName) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la merma es del lote de origen.', { field: 'loss' });
    }
    if (!inputs.some((row) => row.vessel.id === line.vessel_id)) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la merma se atribuye a un recipiente de entrada.', { vessel_id: line.vessel_id });
    }
  }
  for (const row of outputs) {
    if (row.line.product_state !== stateName) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el lote hijo conserva el estado del origen.', { field: 'product_state' });
    }
  }

  const touched = [...inputs.map((row) => row.vessel), ...outputs.map((row) => row.vessel)];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;
  const childId = resolveNewId(req.new_lot.id, ids);
  if (typeof childId !== 'string') return childId;
  if (childId === parent.id || parent.ancestor_lot_ids.includes(childId)) {
    return fail('WC030', 'WC030: la genealogía de lotes tendría un ciclo.', { child_lot_id: childId });
  }
  const owner = inputs[0]?.vessel.owner_entity_id ?? parent.producer_entity_id;
  const child: LotRef = {
    ...parent,
    id: childId,
    code: req.new_lot.code,
    ancestor_lot_ids: [],
  };
  const after = applyContents(
    state,
    inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.line.volume_ml })),
    outputs.map((row) => ({
      vesselId: row.vessel.id,
      volume_ml: row.line.volume_ml,
      lot: child,
      product_state: stateName,
      owner_entity_id: owner,
    })),
  );
  if (!Array.isArray(after)) return after;

  const stock = stockOf(req, ids, inputs, outputs, losses, parent.id, child.id, owner, stateName);
  if (!Array.isArray(stock)) return stock;
  const outputMl = outputs.reduce((total, row) => total + row.line.volume_ml, 0);
  const lot: LotDraft = {
    id: childId,
    producer_entity_id: parent.producer_entity_id,
    code: req.new_lot.code,
    kind: stateName === 'must' ? 'must' : 'wine',
    wine_id: parent.wine_id,
    vintage: parent.vintage,
    is_organic: parent.is_organic,
    status: 'active',
    origin: 'operation',
    created_by_operation_id: req.id,
    notes: null,
  };
  return succeed({
    stockMoves: stock,
    fiscalMoves: [],
    newLots: [lot],
    lotEdges: [{
      child_lot_id: childId,
      parent_lot_id: parent.id,
      operation_id: req.id,
      volume_ml: outputMl,
      mass_g: 0,
    }],
    vesselsAfter: after,
    notes: [SILICIE_Q040],
  });
}

function stockOf(
  req: BleedingRequest,
  ids: IdSource,
  inputs: readonly { line: FermentationVolumeLine; vessel: VesselState }[],
  outputs: readonly { line: FermentationVolumeLine; vessel: VesselState }[],
  losses: readonly FermentationVolumeLine[],
  parentId: string,
  childId: string,
  owner: string,
  productState: BulkProductState,
): StockMoveDraft[] | PlanResult {
  const moves: StockMoveDraft[] = [];
  for (const row of inputs) {
    const lossHere = losses.filter((line) => line.vessel_id === row.vessel.id).reduce((total, line) => total + line.volume_ml, 0);
    if (lossHere > row.line.volume_ml) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la merma supera el volumen sangrado.', { vessel_id: row.vessel.id });
    }
    const moved = row.line.volume_ml - lossHere;
    if (moved > 0) {
      moves.push(bulkStockMove(req, ids, {
        move_type: 'cellar_out',
        vessel: row.vessel,
        lot_id: parentId,
        product_state: productState,
        volume_ml: -moved,
        loss_kind: null,
        owner_entity_id: owner,
      }));
    }
    if (lossHere > 0) {
      moves.push(bulkStockMove(req, ids, {
        move_type: 'loss',
        vessel: row.vessel,
        lot_id: parentId,
        product_state: productState,
        volume_ml: -lossHere,
        loss_kind: 'authorized',
        owner_entity_id: owner,
      }));
    }
  }
  for (const row of outputs) {
    moves.push(bulkStockMove(req, ids, {
      move_type: 'cellar_in',
      vessel: row.vessel,
      lot_id: childId,
      product_state: productState,
      volume_ml: row.line.volume_ml,
      loss_kind: null,
      owner_entity_id: owner,
    }));
  }
  return moves;
}

function parseVolumeLines(lines: readonly FermentationVolumeLine[]): FermentationVolumeLine[] | PlanResult {
  if (!Array.isArray(lines) || lines.length === 0) {
    return fail('WC020', 'WC020: bleeding necesita entradas y salidas.', { op_type: 'bleeding' });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const lotError = assertLot(line.lot, `lines[${index}].lot`);
    if (lotError !== null) return lotError;
    const volume = assertPositiveMl(line.volume_ml, `lines[${index}].volume_ml`);
    if (volume !== null) return volume;
  }
  return [...lines];
}

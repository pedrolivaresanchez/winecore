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
  succeed,
  type Arrival,
  type Removal,
} from '../cellar/common';
import type {
  CellarState,
  IdSource,
  LotDraft,
  LotEdgeDraft,
  LotRef,
  PlanResult,
  PressingOffLine,
  PressingOffRequest,
  StockMoveDraft,
  VesselState,
} from '../cellar/types';
import { assertElaborationBalance, SILICIE_Q040 } from './balance';

/**
 * Descube: el vino yema y el de prensa salen del depósito con hollejos.
 * El mismo lote por defecto; un código nuevo parte un hijo. Orujos y lías
 * son merma. silicie.md no define el asiento (Q-040).
 */
export function planPressingOff(req: PressingOffRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail('WC020', 'WC020: pressing_off necesita entradas y salidas.', { op_type: 'pressing_off' });
  }
  const balance = assertElaborationBalance(
    'pressing_off',
    req.lines.map((line) => ({ role: line.role, volume_ml: line.volume_ml })),
  );
  if (balance !== null) return balance;

  const inputs: { line: PressingOffLine; vessel: VesselState }[] = [];
  const outputs: { line: PressingOffLine; vessel: VesselState }[] = [];
  const losses: PressingOffLine[] = [];
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
        return fail('WC_VALIDATION', 'WC_VALIDATION: los orujos y las lías del descube son merma autorizada.', { field });
      }
      losses.push(line);
      continue;
    }
    if (line.new_lot_code !== null && line.role !== 'output') {
      return fail('WC_VALIDATION', 'WC_VALIDATION: solo una salida puede crear un lote.', { field });
    }
    if (line.new_lot_code !== null && !isLotCode(line.new_lot_code)) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el código del lote nuevo no es válido.', { field });
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ('ok' in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    if (line.role === 'input') {
      if (vessel.lot_id !== line.lot.id || vessel.product_state !== line.product_state) {
        return fail('WC_VALIDATION', 'WC_VALIDATION: el recipiente no contiene ese lote.', { field });
      }
      if (line.volume_ml > vessel.volume_ml) {
        return fail('WC024', 'WC024: el descube pide más volumen del que hay.', { vessel_id: vessel.id });
      }
      inputs.push({ line, vessel });
    } else {
      outputs.push({ line, vessel });
    }
  }
  const parent = inputs[0]?.line.lot;
  const product = inputs[0]?.line.product_state;
  const stateName = product === 'must' || product === 'wine' ? product : undefined;
  if (parent === undefined || stateName === undefined) {
    return fail('WC020', 'WC020: pressing_off necesita entradas y salidas.', { op_type: 'pressing_off' });
  }
  if (!kindMatchesState(parent.kind, stateName)) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el tipo de lote no coincide con el estado del producto.', { field: 'lot' });
  }
  for (const row of [...inputs, ...outputs]) {
    if (row.line.lot.id !== parent.id || row.line.product_state !== stateName) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: el descube sale de un solo lote.', { field: 'lot' });
    }
  }

  const codes = [...new Set(outputs.map((row) => row.line.new_lot_code).filter((code): code is string => code !== null))];
  const childIds = new Map<string, string>();
  const newLots: LotDraft[] = [];
  const edges: LotEdgeDraft[] = [];
  for (const code of codes) {
    const id = ids.newId();
    if (id === parent.id || parent.ancestor_lot_ids.includes(id)) {
      return fail('WC030', 'WC030: la genealogía de lotes tendría un ciclo.', { child_lot_id: id });
    }
    childIds.set(code, id);
    const contributed = outputs
      .filter((row) => row.line.new_lot_code === code)
      .reduce((total, row) => total + row.line.volume_ml, 0);
    newLots.push({
      id,
      producer_entity_id: parent.producer_entity_id,
      code,
      kind: stateName === 'must' ? 'must' : 'wine',
      wine_id: parent.wine_id,
      vintage: parent.vintage,
      is_organic: parent.is_organic,
      status: 'active',
      origin: 'operation',
      created_by_operation_id: req.id,
      notes: null,
    });
    edges.push({
      child_lot_id: id,
      parent_lot_id: parent.id,
      operation_id: req.id,
      volume_ml: contributed,
      mass_g: 0,
    });
  }

  const owner = inputs[0]?.vessel.owner_entity_id ?? parent.producer_entity_id;
  const touched = [...inputs.map((row) => row.vessel), ...outputs.map((row) => row.vessel)];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;
  const removals: Removal[] = inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.line.volume_ml }));
  const arrivals: Arrival[] = outputs.map((row) => {
    const code = row.line.new_lot_code;
    const lot: LotRef = code === null
      ? parent
      : { ...parent, id: childIds.get(code) ?? parent.id, code, ancestor_lot_ids: [] };
    return {
      vesselId: row.vessel.id,
      volume_ml: row.line.volume_ml,
      lot,
      product_state: stateName,
      owner_entity_id: owner,
    };
  });
  const after = applyContents(state, removals, arrivals);
  if (!Array.isArray(after)) return after;

  const stock: StockMoveDraft[] = [];
  for (const row of inputs) {
    const lossHere = losses.filter((line) => line.vessel_id === row.vessel.id).reduce((total, line) => total + line.volume_ml, 0);
    if (lossHere > row.line.volume_ml) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la merma supera la entrada del descube.', { vessel_id: row.vessel.id });
    }
    const moved = row.line.volume_ml - lossHere;
    if (moved > 0) {
      stock.push(bulkStockMove(req, ids, {
        move_type: 'cellar_out',
        vessel: row.vessel,
        lot_id: parent.id,
        product_state: stateName,
        volume_ml: -moved,
        loss_kind: null,
        owner_entity_id: owner,
      }));
    }
    if (lossHere > 0) {
      stock.push(bulkStockMove(req, ids, {
        move_type: 'loss',
        vessel: row.vessel,
        lot_id: parent.id,
        product_state: stateName,
        volume_ml: -lossHere,
        loss_kind: 'authorized',
        owner_entity_id: owner,
      }));
    }
  }
  const unattributed = losses.reduce((total, line) => total + line.volume_ml, 0)
    - inputs.reduce((total, row) => total + losses.filter((line) => line.vessel_id === row.vessel.id).reduce((sum, line) => sum + line.volume_ml, 0), 0);
  if (unattributed !== 0) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la merma del descube se atribuye a un recipiente de entrada.', { field: 'loss' });
  }
  for (const row of outputs) {
    const code = row.line.new_lot_code;
    const lotId = code === null ? parent.id : childIds.get(code);
    if (!lotId) return fail('WC_VALIDATION', 'WC_VALIDATION: falta el lote de la salida.', { field: 'new_lot_code' });
    stock.push(bulkStockMove(req, ids, {
      move_type: 'cellar_in',
      vessel: row.vessel,
      lot_id: lotId,
      product_state: stateName,
      volume_ml: row.line.volume_ml,
      loss_kind: null,
      owner_entity_id: owner,
    }));
  }
  return succeed({
    stockMoves: stock,
    fiscalMoves: [],
    newLots,
    lotEdges: edges,
    vesselsAfter: after,
    notes: [SILICIE_Q040],
  });
}

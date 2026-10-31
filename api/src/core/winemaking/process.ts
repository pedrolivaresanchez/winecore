import {
  assertHeader,
  assertInService,
  assertLot,
  fail,
  loadVessel,
  succeed,
} from '../cellar/common';
import { money } from '../money';
import type { CellarState, DelestageRequest, IdSource, PlanResult, TemperatureControlRequest } from '../cellar/types';
import { assertElaborationBalance } from './balance';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Délestage: vaciado y retorno al mismo depósito. No mueve volumen. */
export function planDelestage(req: DelestageRequest, state: CellarState, _ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  const balance = assertElaborationBalance('delestage', []);
  if (balance !== null) return balance;
  const held = hold(req.vessel_id, req.lot, state, 'delestage');
  if (held !== true) return held;
  if (!INSTANT.test(req.started_at) || !INSTANT.test(req.ended_at)) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el délestage necesita inicio y fin.', { field: 'started_at' });
  }
  if (Date.parse(req.ended_at) < Date.parse(req.started_at)) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: el fin del délestage es anterior al inicio.', { field: 'ended_at' });
  }
  if (req.notes !== null && req.notes.trim() === '') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: las notas del délestage están vacías.', { field: 'notes' });
  }
  return succeed({ stockMoves: [], fiscalMoves: [], newLots: [], lotEdges: [], vesselsAfter: [] });
}

/** Corrección de consigna. No mueve volumen. */
export function planTemperatureControl(
  req: TemperatureControlRequest,
  state: CellarState,
  _ids: IdSource,
): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  const balance = assertElaborationBalance('temperature_control', []);
  if (balance !== null) return balance;
  const held = hold(req.vessel_id, req.lot, state, 'temperature_control');
  if (held !== true) return held;
  if (req.reason === null || req.reason.trim() === '') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la corrección de temperatura exige motivo.', { field: 'reason' });
  }
  const previous = setpoint(req.previous_setpoint_c, 'previous_setpoint_c');
  if (typeof previous !== 'string') return previous;
  const next = setpoint(req.new_setpoint_c, 'new_setpoint_c');
  if (typeof next !== 'string') return next;
  if (previous === next) {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la consigna nueva es igual que la anterior.', { field: 'new_setpoint_c' });
  }
  return succeed({ stockMoves: [], fiscalMoves: [], newLots: [], lotEdges: [], vesselsAfter: [] });
}

function hold(
  vesselId: string,
  lot: DelestageRequest['lot'],
  state: CellarState,
  op: string,
): PlanResult | true {
  const lotError = assertLot(lot, 'lot');
  if (lotError !== null) return lotError;
  const vessel = loadVessel(state, vesselId);
  if ('ok' in vessel) return vessel;
  const service = assertInService(vessel);
  if (service !== null) return service;
  if (vessel.lot_id !== lot.id || vessel.volume_ml <= 0) {
    return fail('WC_VALIDATION', `WC_VALIDATION: el recipiente no contiene el lote del ${op}.`, { vessel_id: vessel.id });
  }
  return true;
}

function setpoint(value: string, field: string): string | PlanResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail('WC_VALIDATION', 'WC_VALIDATION: falta la consigna.', { field });
  }
  try {
    const parsed = money.fromString(value.trim());
    if (parsed.decimalPlaces() > 1 || parsed.lt(money.fromString('-30')) || parsed.gt(money.fromString('40'))) {
      return fail('WC_VALIDATION', 'WC_VALIDATION: la consigna está fuera de -30 a 40 °C, con un decimal.', { field });
    }
    return parsed.toFixed(1);
  } catch {
    return fail('WC_VALIDATION', 'WC_VALIDATION: la consigna no es un decimal.', { field });
  }
}

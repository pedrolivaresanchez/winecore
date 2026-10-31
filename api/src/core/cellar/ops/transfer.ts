import {
  applyContents,
  assertConserved,
  assertHeader,
  assertIncidentApproval,
  assertInService,
  assertLot,
  assertPositiveMl,
  assertSameWarehouse,
  assignLosses,
  bulkStockMove,
  compareText,
  fail,
  fiscalLedgerChange,
  kindMatchesState,
  loadVessel,
  needsEnds,
  realizeFiscal,
  succeed,
  sumMl,
  warehouseId,
} from "../common";
import type { InputSlice } from "../common";
import type {
  BulkProductState,
  CellarState,
  IdSource,
  LossKind,
  PlanResult,
  StockMoveDraft,
  TransferRequest,
  VesselState,
} from "../types";

interface SourceLine extends InputSlice {
  product_state: BulkProductState;
}

/**
 * Trasiego: the lot does not change. Partial moves leave the remainder in the
 * source. Declared lees are loss lines and count toward WC020.
 */
export function planTransfer(req: TransferRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no tiene líneas.", { field: "lines" });
  }

  const inputs: SourceLine[] = [];
  const outputs: { vessel: VesselState; lotId: string; volume_ml: number; product_state: BulkProductState }[] = [];
  const explicitLosses: { vessel_id: string; volume_ml: number; lotId: string }[] = [];
  const unattributedLots: string[] = [];
  let unattributed = 0;
  const kinds: LossKind[] = [];
  const inputVessels = new Set<string>();
  const outputVessels = new Set<string>();

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
    if (volume !== null) return volume;

    if (line.role === "output" || line.role === "input") {
      const lotError = assertLot(line.lot, `${field}.lot`);
      if (lotError !== null) return lotError;
      const vessel = loadVessel(state, line.vessel_id);
      if ("ok" in vessel) return vessel;
      const service = assertInService(vessel);
      if (service !== null) return service;
      if (!kindMatchesState(line.lot.kind, line.product_state)) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de lote no coincide con el estado del producto.", {
          field,
        });
      }
      if (line.role === "input") {
        if (vessel.lot_id !== line.lot.id || vessel.product_state !== line.product_state) {
          return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la línea no es el que contiene el recipiente.", {
            field,
            vessel_id: vessel.id,
          });
        }
        inputs.push({ vessel, lot: line.lot, volume_ml: line.volume_ml, product_state: line.product_state });
        inputVessels.add(vessel.id);
      } else {
        outputs.push({
          vessel,
          lotId: line.lot.id,
          volume_ml: line.volume_ml,
          product_state: line.product_state,
        });
        outputVessels.add(vessel.id);
      }
      continue;
    }

    if (line.role !== "loss") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la línea de trasiego no es válida.", { field });
    }
    const lotError = assertLot(line.lot, `${field}.lot`);
    if (lotError !== null) return lotError;
    if (line.loss_kind !== "authorized" && line.loss_kind !== "incident") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la merma necesita un tipo (autorizada o incidencia).", { field });
    }
    kinds.push(line.loss_kind);
    if (line.vessel_id === null) {
      unattributed += line.volume_ml;
      unattributedLots.push(line.lot.id);
      continue;
    }
    const vessel = loadVessel(state, line.vessel_id);
    if ("ok" in vessel) return vessel;
    const service = assertInService(vessel);
    if (service !== null) return service;
    if (vessel.lot_id !== line.lot.id) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la merma no es el que contiene el recipiente.", {
        field,
        vessel_id: vessel.id,
      });
    }
    explicitLosses.push({ vessel_id: vessel.id, volume_ml: line.volume_ml, lotId: line.lot.id });
  }

  const approval = assertIncidentApproval(req, kinds);
  if (approval !== null) return approval;
  const distinctKinds = new Set(kinds);
  if (distinctKinds.size > 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: todas las mermas de la operación deben ser del mismo tipo.", {
      field: "loss_kind",
    });
  }

  const ends = needsEnds(inputs.length, outputs.length, "racking");
  if (ends !== null) return ends;

  const lotIds = new Set(inputs.map((row) => row.lot.id));
  if (lotIds.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el trasiego mantiene un único lote.", {
      lot_ids: [...lotIds],
    });
  }
  const lot = inputs[0]?.lot;
  if (lot === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el trasiego no tiene entradas.");
  }
  if (
    outputs.some((row) => row.lotId !== lot.id) ||
    explicitLosses.some((row) => row.lotId !== lot.id) ||
    unattributedLots.some((id) => id !== lot.id)
  ) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el trasiego mantiene el mismo lote y el mismo estado.", {
      lot_id: lot.id,
    });
  }
  const productState = inputs[0]?.product_state;
  if (
    productState === undefined ||
    inputs.some((row) => row.product_state !== productState) ||
    outputs.some((row) => row.product_state !== productState)
  ) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el trasiego no puede mezclar mosto y vino.");
  }

  for (const id of inputVessels) {
    if (outputVessels.has(id)) {
      return fail(
        "WC_VALIDATION",
        "WC_VALIDATION: el trasiego no puede usar el mismo recipiente como origen y destino.",
        { vessel_id: id },
      );
    }
  }

  const owners = new Set(inputs.map((row) => row.vessel.owner_entity_id));
  if (owners.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el trasiego no cambia el propietario del vino.", {
      owner_entity_ids: [...owners],
    });
  }
  const owner = inputs[0]?.vessel.owner_entity_id;
  if (owner === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el propietario del vino.");
  }
  for (const row of outputs) {
    if (row.vessel.volume_ml > 0 && row.vessel.owner_entity_id !== owner) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el destino tiene vino de otro propietario.", {
        vessel_id: row.vessel.id,
      });
    }
    if (row.vessel.volume_ml > 0 && row.vessel.product_state !== productState) {
      return fail("WC_VALIDATION", "WC_VALIDATION: el destino tiene un estado de producto distinto.", {
        vessel_id: row.vessel.id,
      });
    }
  }

  const touched = [...inputs.map((row) => row.vessel), ...outputs.map((row) => row.vessel)];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;

  const inputTotal = sumMl(inputs.map((row) => row.volume_ml));
  if (typeof inputTotal !== "number") return inputTotal;
  const outputTotal = sumMl(outputs.map((row) => row.volume_ml));
  if (typeof outputTotal !== "number") return outputTotal;
  const lossTotal = sumMl([
    ...explicitLosses.map((row) => row.volume_ml),
    unattributed,
  ].filter((value) => value > 0));
  if (typeof lossTotal !== "number") return lossTotal;
  const conserved = assertConserved(
    { inputs_ml: inputTotal, outputs_ml: outputTotal, losses_ml: lossTotal },
    "racking",
  );
  if (conserved !== null) return conserved;

  const after = applyContents(
    state,
    inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.volume_ml })),
    outputs.map((row) => ({
      vesselId: row.vessel.id,
      volume_ml: row.volume_ml,
      lot,
      product_state: productState,
      owner_entity_id: owner,
    })),
  );
  if (!Array.isArray(after)) return after;

  const assigned = assignLosses(inputs, explicitLosses, unattributed);
  if ("ok" in assigned) return assigned;

  const lossKind: LossKind | null = kinds[0] ?? null;
  const stockMoves: StockMoveDraft[] = [];
  const sources = [...groupInputs(inputs)].sort((a, b) => compareText(a.vessel.id, b.vessel.id));
  for (const source of sources) {
    const loss = assigned.byVessel.get(source.vessel.id) ?? 0;
    const moved = source.volume_ml - loss;
    if (moved > 0) {
      stockMoves.push(
        bulkStockMove(req, ids, {
          move_type: "cellar_out",
          vessel: source.vessel,
          lot_id: lot.id,
          product_state: productState,
          volume_ml: -moved,
          loss_kind: null,
          owner_entity_id: owner,
        }),
      );
    }
  }
  const lossVessels = [...assigned.byVessel.entries()].sort((a, b) => compareText(a[0], b[0]));
  for (const [vesselId, volume] of lossVessels) {
    if (volume <= 0 || lossKind === null) continue;
    const source = sources.find((row) => row.vessel.id === vesselId);
    if (source === undefined) continue;
    stockMoves.push(
      bulkStockMove(req, ids, {
        move_type: "loss",
        vessel: source.vessel,
        lot_id: lot.id,
        product_state: productState,
        volume_ml: -volume,
        loss_kind: lossKind,
        owner_entity_id: owner,
      }),
    );
  }
  const dests = [...groupOutputs(outputs)].sort((a, b) => compareText(a.vessel.id, b.vessel.id));
  for (const dest of dests) {
    stockMoves.push(
      bulkStockMove(req, ids, {
        move_type: "cellar_in",
        vessel: dest.vessel,
        lot_id: lot.id,
        product_state: productState,
        volume_ml: dest.volume_ml,
        loss_kind: null,
        owner_entity_id: owner,
      }),
    );
  }

  const intents = fiscalLedgerChange({
    product_state: productState,
    inputs,
    outputs: outputs.map((row) => ({ vessel: row.vessel, lot, volume_ml: row.volume_ml })),
    lossByVessel: assigned.byVessel,
    reason: req.reason,
  });
  if (!Array.isArray(intents)) return intents;
  const wh = warehouseId(touched);
  const fiscalMoves = wh === null ? [] : realizeFiscal(req, wh, intents, ids);

  return succeed({
    stockMoves,
    fiscalMoves,
    newLots: [],
    lotEdges: [],
    vesselsAfter: after,
  });
}

function groupInputs(rows: readonly SourceLine[]): SourceLine[] {
  const map = new Map<string, SourceLine>();
  for (const row of rows) {
    const prev = map.get(row.vessel.id);
    if (prev === undefined) map.set(row.vessel.id, row);
    else map.set(row.vessel.id, { ...prev, volume_ml: prev.volume_ml + row.volume_ml });
  }
  return [...map.values()];
}

function groupOutputs(
  rows: readonly { vessel: VesselState; volume_ml: number }[],
): { vessel: VesselState; volume_ml: number }[] {
  const map = new Map<string, { vessel: VesselState; volume_ml: number }>();
  for (const row of rows) {
    const prev = map.get(row.vessel.id);
    if (prev === undefined) map.set(row.vessel.id, { vessel: row.vessel, volume_ml: row.volume_ml });
    else map.set(row.vessel.id, { vessel: row.vessel, volume_ml: prev.volume_ml + row.volume_ml });
  }
  return [...map.values()];
}

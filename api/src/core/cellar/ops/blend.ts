import {
  applyContents,
  assertAcyclic,
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
  isLotCode,
  kindMatchesState,
  loadVessel,
  needsEnds,
  realizeFiscal,
  resolveBlendExciseKey,
  resolveNewId,
  sharedValue,
  sharedVintage,
  succeed,
  sumMl,
  vintagesDisagree,
  warehouseId,
} from "../common";
import type { InputSlice } from "../common";
import type {
  BlendRequest,
  BulkProductState,
  CellarState,
  IdSource,
  LossKind,
  LotDraft,
  LotEdgeDraft,
  LotRef,
  PlanResult,
  StockMoveDraft,
  VesselState,
} from "../types";

interface SourceLine extends InputSlice {
  product_state: BulkProductState;
}

/**
 * Ensamblaje without a formula. Several source lots become one new lot.
 * Each genealogy edge stores the millilitres that parent contributed
 * (the input), which is the blend proportion. Vintage is copied only when
 * every input has that same vintage.
 */
export function planBlend(req: BlendRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no tiene líneas.", { field: "lines" });
  }
  if (req.new_lot === null || typeof req.new_lot !== "object" || !isLotCode(req.new_lot.code)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el código del lote nuevo no es válido.", {
      field: "new_lot.code",
    });
  }

  const inputs: SourceLine[] = [];
  const outputs: { vessel: VesselState; volume_ml: number; product_state: BulkProductState }[] = [];
  const explicitLosses: { vessel_id: string; volume_ml: number }[] = [];
  let unattributed = 0;
  const kinds: LossKind[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
    if (volume !== null) return volume;
    if (line.product_state !== "must" && line.product_state !== "wine") {
      return fail("WC_VALIDATION", "WC_VALIDATION: el ensamblaje solo admite mosto o vino.", { field });
    }

    if (line.role === "input") {
      const lotError = assertLot(line.lot, `${field}.lot`);
      if (lotError !== null) return lotError;
      if (!kindMatchesState(line.lot.kind, line.product_state)) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de lote no coincide con el estado del producto.", {
          field,
        });
      }
      const vessel = loadVessel(state, line.vessel_id);
      if ("ok" in vessel) return vessel;
      const service = assertInService(vessel);
      if (service !== null) return service;
      if (vessel.lot_id !== line.lot.id || vessel.product_state !== line.product_state) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la línea no es el que contiene el recipiente.", {
          field,
          vessel_id: vessel.id,
        });
      }
      inputs.push({ vessel, lot: line.lot, volume_ml: line.volume_ml, product_state: line.product_state });
      continue;
    }

    if (line.role === "output") {
      const vessel = loadVessel(state, line.vessel_id);
      if ("ok" in vessel) return vessel;
      const service = assertInService(vessel);
      if (service !== null) return service;
      outputs.push({ vessel, volume_ml: line.volume_ml, product_state: line.product_state });
      continue;
    }

    if (line.role !== "loss") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la línea de ensamblaje no es válida.", { field });
    }
    const lotError = assertLot(line.lot, `${field}.lot`);
    if (lotError !== null) return lotError;
    if (line.loss_kind !== "authorized" && line.loss_kind !== "incident") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la merma necesita un tipo (autorizada o incidencia).", { field });
    }
    kinds.push(line.loss_kind);
    if (line.vessel_id === null) {
      unattributed += line.volume_ml;
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
    explicitLosses.push({ vessel_id: vessel.id, volume_ml: line.volume_ml });
  }

  const approval = assertIncidentApproval(req, kinds);
  if (approval !== null) return approval;
  if (new Set(kinds).size > 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: todas las mermas de la operación deben ser del mismo tipo.", {
      field: "loss_kind",
    });
  }

  const ends = needsEnds(inputs.length, outputs.length, "blend");
  if (ends !== null) return ends;

  const byLot = new Map<string, LotRef>();
  for (const row of inputs) byLot.set(row.lot.id, row.lot);
  if (byLot.size < 2) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el ensamblaje exige al menos dos lotes distintos.", {
      lot_ids: [...byLot.keys()],
    });
  }
  const parents = [...byLot.values()];
  const productState = sharedValue(inputs.map((row) => row.product_state));
  if (productState === null) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el ensamblaje no mezcla mosto con vino.");
  }
  if (outputs.some((row) => row.product_state !== productState)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la salida del ensamblaje debe tener el mismo estado que las entradas.");
  }
  const organic = parents.map((lot) => lot.is_organic);
  if (organic.some((flag) => flag) && organic.some((flag) => !flag)) {
    return fail(
      "WC_ECO_MIX",
      "WC_ECO_MIX: no se puede ensamblar un lote ecológico con uno que no lo es.",
      { lot_ids: parents.map((lot) => lot.id) },
    );
  }
  const owners = new Set(inputs.map((row) => row.vessel.owner_entity_id));
  if (owners.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el ensamblaje no cambia el propietario del vino.", {
      owner_entity_ids: [...owners],
    });
  }
  const owner = inputs[0]?.vessel.owner_entity_id;
  if (owner === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el propietario del vino.");
  }

  const touched = [...inputs.map((row) => row.vessel), ...outputs.map((row) => row.vessel)];
  const warehouse = assertSameWarehouse(touched);
  if (warehouse !== null) return warehouse;

  const inputTotal = sumMl(inputs.map((row) => row.volume_ml));
  if (typeof inputTotal !== "number") return inputTotal;
  const outputTotal = sumMl(outputs.map((row) => row.volume_ml));
  if (typeof outputTotal !== "number") return outputTotal;
  const lossVolumes = [...explicitLosses.map((row) => row.volume_ml), unattributed].filter((value) => value > 0);
  const lossTotal = lossVolumes.length === 0 ? 0 : sumMl(lossVolumes);
  if (typeof lossTotal !== "number") return lossTotal;
  const conserved = assertConserved(
    { inputs_ml: inputTotal, outputs_ml: outputTotal, losses_ml: lossTotal },
    "blend",
  );
  if (conserved !== null) return conserved;

  const excise = resolveBlendExciseKey(req.new_lot.excise_product_key, inputs, productState, warehouseId(touched));
  if (typeof excise === "object" && excise !== null) return excise;

  const childId = resolveNewId(req.new_lot.id, ids);
  if (typeof childId !== "string") return childId;
  const cycle = assertAcyclic(childId, parents);
  if (cycle !== null) return cycle;

  const child: LotRef = {
    id: childId,
    code: req.new_lot.code,
    kind: productState === "must" ? "must" : "wine",
    vintage: sharedVintage(parents),
    producer_entity_id: sharedValue(parents.map((lot) => lot.producer_entity_id)) ?? req.legal_entity_id,
    wine_id: req.new_lot.wine_id ?? sharedValue(parents.map((lot) => lot.wine_id)),
    is_organic: parents.every((lot) => lot.is_organic),
    ancestor_lot_ids: [],
    excise_product_key: excise,
    abv_pct: sharedValue(parents.map((lot) => lot.abv_pct)),
  };

  const after = applyContents(
    state,
    inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.volume_ml })),
    outputs.map((row) => ({
      vesselId: row.vessel.id,
      volume_ml: row.volume_ml,
      lot: child,
      product_state: productState,
      owner_entity_id: owner,
    })),
  );
  if (!Array.isArray(after)) return after;

  const assigned = assignLosses(inputs, explicitLosses, unattributed);
  if ("ok" in assigned) return assigned;

  const lossKind: LossKind | null = kinds[0] ?? null;
  const stockMoves: StockMoveDraft[] = [];
  const sources = groupByVessel(inputs).sort((a, b) => compareText(a.vessel.id, b.vessel.id));
  for (const source of sources) {
    const loss = assigned.byVessel.get(source.vessel.id) ?? 0;
    const moved = source.volume_ml - loss;
    if (moved > 0) {
      stockMoves.push(
        bulkStockMove(req, ids, {
          move_type: "cellar_out",
          vessel: source.vessel,
          lot_id: source.lot.id,
          product_state: productState,
          volume_ml: -moved,
          loss_kind: null,
          owner_entity_id: owner,
        }),
      );
    }
  }
  for (const [vesselId, volume] of [...assigned.byVessel.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    if (volume <= 0 || lossKind === null) continue;
    const source = sources.find((row) => row.vessel.id === vesselId);
    if (source === undefined) continue;
    stockMoves.push(
      bulkStockMove(req, ids, {
        move_type: "loss",
        vessel: source.vessel,
        lot_id: source.lot.id,
        product_state: productState,
        volume_ml: -volume,
        loss_kind: lossKind,
        owner_entity_id: owner,
      }),
    );
  }
  const dests = groupOutputs(outputs).sort((a, b) => compareText(a.vessel.id, b.vessel.id));
  for (const dest of dests) {
    stockMoves.push(
      bulkStockMove(req, ids, {
        move_type: "cellar_in",
        vessel: dest.vessel,
        lot_id: child.id,
        product_state: productState,
        volume_ml: dest.volume_ml,
        loss_kind: null,
        owner_entity_id: owner,
      }),
    );
  }

  const outputLots = outputs.map((row) => ({ ...row, lot: child }));
  const intents = fiscalLedgerChange({
    product_state: productState,
    inputs,
    outputs: outputLots,
    lossByVessel: assigned.byVessel,
    reason: req.reason,
  });
  if (!Array.isArray(intents)) return intents;
  const wh = warehouseId(touched);
  const fiscalMoves = wh === null ? [] : realizeFiscal(req, wh, intents, ids);

  const notes = vintagesDisagree(parents)
    ? "La añada no se hereda: las entradas no comparten añada."
    : null;
  const draft: LotDraft = {
    id: child.id,
    producer_entity_id: child.producer_entity_id,
    code: child.code,
    kind: child.kind,
    wine_id: child.wine_id,
    vintage: child.vintage,
    is_organic: child.is_organic,
    status: "active",
    origin: "operation",
    created_by_operation_id: req.id,
    notes,
  };

  const contributed = new Map<string, number>();
  for (const row of inputs) {
    contributed.set(row.lot.id, (contributed.get(row.lot.id) ?? 0) + row.volume_ml);
  }
  const lotEdges: LotEdgeDraft[] = [...contributed.entries()]
    .sort((a, b) => compareText(a[0], b[0]))
    .map(([parentId, volume]) => ({
      child_lot_id: child.id,
      parent_lot_id: parentId,
      operation_id: req.id,
      volume_ml: volume,
      mass_g: 0,
    }));

  return succeed({
    stockMoves,
    fiscalMoves,
    newLots: [draft],
    lotEdges,
    vesselsAfter: after,
  });
}

function groupByVessel(rows: readonly SourceLine[]): SourceLine[] {
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

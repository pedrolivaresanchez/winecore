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
  isLotCode,
  isNcCode,
  isSafeInt,
  loadVessel,
  needsEnds,
  realizeFiscal,
  resolveNewId,
  succeed,
  sumMl,
  warehouseId,
  ledgerOf,
} from "../common";
import type { FiscalIntent, InputSlice } from "../common";
import type {
  BottlingRequest,
  CellarState,
  IdSource,
  LossKind,
  LotDraft,
  LotEdgeDraft,
  PlanResult,
  StockMoveDraft,
  VesselState,
} from "../types";

/**
 * Envasado: bulk wine leaves the vessels and a new bottled lot enters a
 * location as whole units. WC023 requires volume_ml = qty_units × nominal
 * volume. WC020 requires bulk in = packaged volume + declared loss.
 * Fiscal: packaging_out_bulk is the bulk that enters (including lees) and
 * packaging_in_packaged is the wine obtained. Bottling lees are A32 and do
 * not create a fiscal `loss` row.
 */
export function planBottling(req: BottlingRequest, state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no tiene líneas.", { field: "lines" });
  }
  if (req.new_lot === null || typeof req.new_lot !== "object" || !isLotCode(req.new_lot.code)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el código del lote envasado no es válido.", {
      field: "new_lot.code",
    });
  }

  const inputs: InputSlice[] = [];
  const outputs: {
    location_id: string;
    product_id: string;
    product_state: "packaged_unlabeled" | "packaged_labeled";
    qty_units: number;
    volume_ml: number;
    nominal_volume_ml: number;
    excise_product_key: string | null;
    nc_code: string | null;
  }[] = [];
  const explicitLosses: { vessel_id: string; volume_ml: number }[] = [];
  let unattributed = 0;
  const kinds: LossKind[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;

    if (line.role === "input") {
      const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
      if (volume !== null) return volume;
      const lotError = assertLot(line.lot, `${field}.lot`);
      if (lotError !== null) return lotError;
      if (line.product_state !== "wine" || line.lot.kind !== "wine") {
        return fail("WC_VALIDATION", "WC_VALIDATION: solo se envasa vino.", { field });
      }
      const vessel = loadVessel(state, line.vessel_id);
      if ("ok" in vessel) return vessel;
      const service = assertInService(vessel);
      if (service !== null) return service;
      if (vessel.lot_id !== line.lot.id || vessel.product_state !== "wine") {
        return fail("WC_VALIDATION", "WC_VALIDATION: el lote de la línea no es el que contiene el recipiente.", {
          field,
          vessel_id: vessel.id,
        });
      }
      inputs.push({ vessel, lot: line.lot, volume_ml: line.volume_ml });
      continue;
    }

    if (line.role === "output") {
      if (!isSafeInt(line.qty_units) || line.qty_units <= 0) {
        return fail("WC_VALIDATION", "WC_VALIDATION: las unidades envasadas deben ser enteras y positivas.", {
          field: `${field}.qty_units`,
        });
      }
      if (!isSafeInt(line.nominal_volume_ml) || line.nominal_volume_ml <= 0) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el volumen nominal del formato no es válido.", {
          field: `${field}.nominal_volume_ml`,
        });
      }
      const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
      if (volume !== null) return volume;
      if (line.nominal_volume_ml !== 0 && line.qty_units > Math.floor(Number.MAX_SAFE_INTEGER / line.nominal_volume_ml)) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el volumen envasado no cabe en un entero seguro.", { field });
      }
      const expected = line.qty_units * line.nominal_volume_ml;
      if (line.volume_ml !== expected) {
        return fail(
          "WC023",
          `WC023: volumen ${line.volume_ml} mL incoherente con ${line.qty_units} unidades del formato (${line.nominal_volume_ml} mL).`,
          {
            volume_ml: line.volume_ml,
            qty_units: line.qty_units,
            nominal_volume_ml: line.nominal_volume_ml,
          },
        );
      }
      if (line.product_state !== "packaged_unlabeled" && line.product_state !== "packaged_labeled") {
        return fail("WC_VALIDATION", "WC_VALIDATION: el envasado debe indicar si sale etiquetado.", { field });
      }
      if (typeof line.product_id !== "string" || line.product_id.trim() === "") {
        return fail("WC_VALIDATION", "WC_VALIDATION: falta el producto envasado.", { field });
      }
      if (typeof line.location_id !== "string" || line.location_id.trim() === "") {
        return fail("WC_VALIDATION", "WC_VALIDATION: el envasado necesita una ubicación, no un recipiente.", {
          field,
        });
      }
      if (line.excise_product_key !== null && line.excise_product_key.trim() === "") {
        return fail("WC_VALIDATION", "WC_VALIDATION: la clave de impuesto especial no es válida.", { field });
      }
      if (line.nc_code !== null && !isNcCode(line.nc_code)) {
        return fail("WC_VALIDATION", "WC_VALIDATION: el código NC debe tener 8 dígitos.", { field });
      }
      outputs.push({
        location_id: line.location_id,
        product_id: line.product_id,
        product_state: line.product_state,
        qty_units: line.qty_units,
        volume_ml: line.volume_ml,
        nominal_volume_ml: line.nominal_volume_ml,
        excise_product_key: line.excise_product_key,
        nc_code: line.nc_code,
      });
      continue;
    }

    if (line.role !== "loss") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la línea de envasado no es válida.", { field });
    }
    const volume = assertPositiveMl(line.volume_ml, `${field}.volume_ml`);
    if (volume !== null) return volume;
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
  const ends = needsEnds(inputs.length, outputs.length, "bottling");
  if (ends !== null) return ends;
  if (outputs.length !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el envasado produce un solo lote de un producto.", {
      outputs: outputs.length,
    });
  }

  const lotIds = new Set(inputs.map((row) => row.lot.id));
  if (lotIds.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: envasar varios lotes es un ensamblaje.", {
      lot_ids: [...lotIds],
    });
  }
  const parent = inputs[0]?.lot;
  if (parent === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el envasado no tiene entradas.");
  }

  const owners = new Set(inputs.map((row) => row.vessel.owner_entity_id));
  if (owners.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el envasado no cambia el propietario del vino.", {
      owner_entity_ids: [...owners],
    });
  }
  const owner = inputs[0]?.vessel.owner_entity_id;
  if (owner === undefined) {
    return fail("WC_VALIDATION", "WC_VALIDATION: falta el propietario del vino.");
  }

  const warehouse = assertSameWarehouse(inputs.map((row) => row.vessel));
  if (warehouse !== null) return warehouse;

  const inputTotal = sumMl(inputs.map((row) => row.volume_ml));
  if (typeof inputTotal !== "number") return inputTotal;
  const output = outputs[0];
  if (output === undefined) {
    return fail("WC020", "WC020: bottling necesita entradas y salidas.", { op_type: "bottling" });
  }
  const lossVolumes = [...explicitLosses.map((row) => row.volume_ml), unattributed].filter((value) => value > 0);
  const lossTotal = lossVolumes.length === 0 ? 0 : sumMl(lossVolumes);
  if (typeof lossTotal !== "number") return lossTotal;
  const conserved = assertConserved(
    { inputs_ml: inputTotal, outputs_ml: output.volume_ml, losses_ml: lossTotal },
    "bottling",
  );
  if (conserved !== null) return conserved;

  const childId = resolveNewId(req.new_lot.id, ids);
  if (typeof childId !== "string") return childId;
  const cycle = assertAcyclic(childId, [parent]);
  if (cycle !== null) return cycle;

  const after = applyContents(
    state,
    inputs.map((row) => ({ vesselId: row.vessel.id, volume_ml: row.volume_ml })),
    [],
  );
  if (!Array.isArray(after)) return after;

  const assigned = assignLosses(inputs, explicitLosses, unattributed);
  if ("ok" in assigned) return assigned;

  const lossKind: LossKind | null = kinds[0] ?? null;
  const stockMoves: StockMoveDraft[] = [];
  const sources = groupInputs(inputs).sort((a, b) => compareText(a.vessel.id, b.vessel.id));
  for (const source of sources) {
    const loss = assigned.byVessel.get(source.vessel.id) ?? 0;
    const moved = source.volume_ml - loss;
    if (moved > 0) {
      stockMoves.push(
        bulkStockMove(req, ids, {
          move_type: "cellar_out",
          vessel: source.vessel,
          lot_id: parent.id,
          product_state: "wine",
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
        lot_id: parent.id,
        product_state: "wine",
        volume_ml: -volume,
        loss_kind: lossKind,
        owner_entity_id: owner,
      }),
    );
  }
  stockMoves.push({
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: "cellar_in",
    location_id: output.location_id,
    vessel_id: null,
    owner_entity_id: owner,
    lot_id: childId,
    product_id: output.product_id,
    product_state: output.product_state,
    qty_units: output.qty_units,
    volume_ml: output.volume_ml,
    mass_g: 0,
    loss_kind: null,
    source_table: "cellar.operation",
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  });

  const wh = warehouseId(inputs.map((row) => row.vessel));
  const intents: FiscalIntent[] = [];
  if (wh !== null) {
    const byLedger = new Map<string, { volume: number; vessel: VesselState }>();
    for (const source of sources) {
      const ledger = ledgerOf(source.vessel);
      const prev = byLedger.get(ledger);
      if (prev === undefined) byLedger.set(ledger, { volume: source.volume_ml, vessel: source.vessel });
      else byLedger.set(ledger, { volume: prev.volume + source.volume_ml, vessel: prev.vessel });
    }
    for (const [ledger, row] of [...byLedger.entries()].sort((a, b) => compareText(a[0], b[0]))) {
      intents.push({
        move_type: "packaging_out_bulk",
        product_class: ledger === "bulk_wood" ? "bulk_wood" : "bulk",
        lot_id: parent.id,
        product_id: null,
        volume_ml: -row.volume,
        units: 0,
        abv_pct: parent.abv_pct,
        excise_product_key: parent.excise_product_key ?? row.vessel.excise_product_key,
        nc_code: null,
        reason: null,
      });
    }
    intents.push({
      move_type: "packaging_in_packaged",
      product_class: "packaged",
      lot_id: childId,
      product_id: output.product_id,
      volume_ml: output.volume_ml,
      units: output.qty_units,
      abv_pct: parent.abv_pct,
      excise_product_key: output.excise_product_key,
      nc_code: output.nc_code,
      reason: null,
    });
  }
  const fiscalMoves = wh === null ? [] : realizeFiscal(req, wh, intents, ids);

  const draft: LotDraft = {
    id: childId,
    producer_entity_id: parent.producer_entity_id,
    code: req.new_lot.code,
    kind: "bottled",
    wine_id: parent.wine_id,
    vintage: parent.vintage,
    is_organic: parent.is_organic,
    status: "active",
    origin: "operation",
    created_by_operation_id: req.id,
    notes: null,
  };
  const edge: LotEdgeDraft = {
    child_lot_id: childId,
    parent_lot_id: parent.id,
    operation_id: req.id,
    volume_ml: inputTotal,
    mass_g: 0,
  };

  return succeed({
    stockMoves,
    fiscalMoves,
    newLots: [draft],
    lotEdges: [edge],
    vesselsAfter: after,
  });
}

function groupInputs(rows: readonly InputSlice[]): InputSlice[] {
  const map = new Map<string, InputSlice>();
  for (const row of rows) {
    const prev = map.get(row.vessel.id);
    if (prev === undefined) map.set(row.vessel.id, row);
    else map.set(row.vessel.id, { ...prev, volume_ml: prev.volume_ml + row.volume_ml });
  }
  return [...map.values()];
}

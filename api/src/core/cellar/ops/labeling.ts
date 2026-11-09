import {
  assertHeader,
  assertIncidentApproval,
  assertLot,
  fail,
  isSafeInt,
  realizeFiscal,
  succeed,
} from "../common";
import type { FiscalIntent } from "../common";
import type {
  CellarState,
  IdSource,
  LabelingRequest,
  LossKind,
  LotRef,
  PlanResult,
  StockMoveDraft,
} from "../types";

/**
 * Etiquetado: bottled stock leaves `packaged_unlabeled` and the bottles that
 * survive enter `packaged_labeled`. Same lot, no vessel. Breakage is a loss
 * of unlabeled units and, inside a CAE, a packaged fiscal loss.
 */
export function planLabeling(req: LabelingRequest, _state: CellarState, ids: IdSource): PlanResult {
  const header = assertHeader(req);
  if (header !== null) return header;
  if (req.op_type !== "labeling") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de operación no es válido.", { field: "op_type" });
  }
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no tiene líneas.", { field: "lines" });
  }
  if (req.tax_warehouse_id !== null && req.tax_warehouse_id.trim() === "") {
    return fail("WC_VALIDATION", "WC_VALIDATION: el establecimiento fiscal no es válido.", { field: "tax_warehouse_id" });
  }

  const inputs: Extract<LabelingRequest["lines"][number], { role: "input" }>[] = [];
  const outputs: Extract<LabelingRequest["lines"][number], { role: "output" }>[] = [];
  const losses: Extract<LabelingRequest["lines"][number], { role: "loss" }>[] = [];
  const kinds: LossKind[] = [];

  for (let index = 0; index < req.lines.length; index += 1) {
    const line = req.lines[index];
    if (line === undefined) continue;
    const field = `lines[${index}]`;
    const units = assertUnits(line.qty_units, line.volume_ml, line.nominal_volume_ml, field);
    if (units !== null) return units;
    if (line.role === "input" || line.role === "loss") {
      const lotError = assertLot(line.lot, `${field}.lot`);
      if (lotError !== null) return lotError;
      if (line.lot.kind !== "bottled" && line.lot.kind !== "wine") {
        return fail("WC_VALIDATION", "WC_VALIDATION: el etiquetado parte de un lote envasado.", { field });
      }
    }
    if (typeof line.location_id !== "string" || line.location_id.trim() === "") {
      return fail("WC_VALIDATION", "WC_VALIDATION: el etiquetado necesita una ubicación.", { field: `${field}.location_id` });
    }
    if (typeof line.product_id !== "string" || line.product_id.trim() === "") {
      return fail("WC_VALIDATION", "WC_VALIDATION: falta el producto envasado.", { field: `${field}.product_id` });
    }
    if (line.role === "input") {
      if (typeof line.owner_entity_id !== "string" || line.owner_entity_id.trim() === "") {
        return fail("WC_VALIDATION", "WC_VALIDATION: falta el propietario del jaulón.", { field: `${field}.owner_entity_id` });
      }
      inputs.push(line);
      continue;
    }
    if (line.role === "output") {
      outputs.push(line);
      continue;
    }
    if (line.role !== "loss") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la línea de etiquetado no es válida.", { field });
    }
    if (line.loss_kind !== "authorized" && line.loss_kind !== "incident") {
      return fail("WC_VALIDATION", "WC_VALIDATION: la rotura necesita un tipo (autorizada o incidencia).", { field });
    }
    kinds.push(line.loss_kind);
    losses.push(line);
  }

  const approval = assertIncidentApproval(req, kinds);
  if (approval !== null) return approval;
  if (inputs.length !== 1 || outputs.length !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el etiquetado tiene un origen y un destino.", {
      inputs: inputs.length,
      outputs: outputs.length,
    });
  }
  const source = inputs[0];
  const dest = outputs[0];
  if (source === undefined || dest === undefined) {
    return fail("WC020", "WC020: labeling necesita entradas y salidas.", { op_type: "labeling" });
  }
  const brokenUnits = losses.reduce((sum, line) => sum + line.qty_units, 0);
  const brokenVolume = losses.reduce((sum, line) => sum + line.volume_ml, 0);
  if (source.qty_units !== dest.qty_units + brokenUnits || source.volume_ml !== dest.volume_ml + brokenVolume) {
    return fail(
      "WC020",
      `WC020: las unidades no cuadran: entran ${source.qty_units}, salen ${dest.qty_units} y la rotura es ${brokenUnits}.`,
      { inputs: source.qty_units, outputs: dest.qty_units, losses: brokenUnits },
    );
  }
  const lotIds = new Set([source.lot.id, ...losses.map((line) => line.lot.id)]);
  if (lotIds.size !== 1) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el etiquetado no cambia de lote.", { lot_ids: [...lotIds] });
  }
  for (const line of losses) {
    if (line.location_id !== source.location_id || line.product_id !== source.product_id) {
      return fail("WC_VALIDATION", "WC_VALIDATION: la rotura sale del mismo jaulón.", { field: "lines" });
    }
  }

  const stockMoves: StockMoveDraft[] = [
    packagedMove(req, ids, {
      move_type: "cellar_out",
      location_id: source.location_id,
      owner_entity_id: source.owner_entity_id,
      lot: source.lot,
      product_id: source.product_id,
      product_state: "packaged_unlabeled",
      qty_units: -dest.qty_units,
      volume_ml: -dest.volume_ml,
      loss_kind: null,
    }),
    packagedMove(req, ids, {
      move_type: "cellar_in",
      location_id: dest.location_id,
      owner_entity_id: source.owner_entity_id,
      lot: source.lot,
      product_id: dest.product_id,
      product_state: "packaged_labeled",
      qty_units: dest.qty_units,
      volume_ml: dest.volume_ml,
      loss_kind: null,
    }),
  ];
  for (const line of losses) {
    stockMoves.push(packagedMove(req, ids, {
      move_type: "loss",
      location_id: line.location_id,
      owner_entity_id: source.owner_entity_id,
      lot: line.lot,
      product_id: line.product_id,
      product_state: "packaged_unlabeled",
      qty_units: -line.qty_units,
      volume_ml: -line.volume_ml,
      loss_kind: line.loss_kind,
    }));
  }

  const fiscal = req.tax_warehouse_id !== null && brokenVolume > 0
    ? realizeFiscal(req, req.tax_warehouse_id, [fiscalBreakage(source.lot, source.product_id, brokenVolume, brokenUnits, req.reason)], ids)
    : [];

  return succeed({ stockMoves, fiscalMoves: fiscal, newLots: [], lotEdges: [], vesselsAfter: [] });
}

function assertUnits(qty: number, volume: number, nominal: number, field: string): PlanResult | null {
  if (!isSafeInt(qty) || qty <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: las botellas deben ser enteras y positivas.", { field: `${field}.qty_units` });
  }
  if (!isSafeInt(nominal) || nominal <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen nominal del formato no es válido.", { field: `${field}.nominal_volume_ml` });
  }
  if (!isSafeInt(volume) || volume <= 0) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen debe ser mililitros enteros y positivos.", { field: `${field}.volume_ml` });
  }
  if (qty > Math.floor(Number.MAX_SAFE_INTEGER / nominal)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: el volumen etiquetado no cabe en un entero seguro.", { field });
  }
  if (volume !== qty * nominal) {
    return fail(
      "WC023",
      `WC023: volumen ${volume} mL incoherente con ${qty} unidades del formato (${nominal} mL).`,
      { volume_ml: volume, qty_units: qty, nominal_volume_ml: nominal },
    );
  }
  return null;
}

function packagedMove(
  req: LabelingRequest,
  ids: IdSource,
  args: {
    move_type: StockMoveDraft["move_type"];
    location_id: string;
    owner_entity_id: string;
    lot: LotRef;
    product_id: string;
    product_state: "packaged_unlabeled" | "packaged_labeled";
    qty_units: number;
    volume_ml: number;
    loss_kind: StockMoveDraft["loss_kind"];
  },
): StockMoveDraft {
  return {
    id: ids.newId(),
    occurred_at: req.occurred_at,
    move_type: args.move_type,
    location_id: args.location_id,
    vessel_id: null,
    owner_entity_id: args.owner_entity_id,
    lot_id: args.lot.id,
    product_id: args.product_id,
    product_state: args.product_state,
    qty_units: args.qty_units,
    volume_ml: args.volume_ml,
    mass_g: 0,
    loss_kind: args.loss_kind,
    source_table: "cellar.operation",
    source_id: req.id,
    source_line_id: null,
    reverses_move_id: null,
    created_by: req.created_by,
  };
}

function fiscalBreakage(lot: LotRef, productId: string, volumeMl: number, units: number, reason: string | null): FiscalIntent {
  return {
    move_type: "loss",
    product_class: "packaged",
    lot_id: lot.id,
    product_id: productId,
    volume_ml: -volumeMl,
    units: -units,
    abv_pct: lot.abv_pct,
    excise_product_key: lot.excise_product_key,
    nc_code: null,
    reason,
  };
}

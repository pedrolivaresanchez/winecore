import type {
  BulkProductState,
  CellarState,
  IdSource,
  LotKind,
  LotRef,
  OperationHeader,
  PlanResult,
  PlanSuccess,
  VesselState,
} from "../../src/core/cellar/types";

export const PO = "entity-po";
export const WH = "wh-sintetico";
export const LOC = "loc-bod";

export function lot(partial: Partial<LotRef> & Pick<LotRef, "id" | "code">): LotRef {
  return {
    kind: "wine",
    vintage: 2024,
    producer_entity_id: PO,
    wine_id: "wine-arcal",
    is_organic: true,
    ancestor_lot_ids: [],
    excise_product_key: "GRANEL-TINTO",
    abv_pct: "13.50",
    ...partial,
  };
}

export function vessel(partial: Partial<VesselState> & Pick<VesselState, "id">): VesselState {
  return {
    kind: "tank_storage",
    material: "stainless_steel",
    capacity_ml: 8_000_000,
    lot_id: null,
    volume_ml: 0,
    owner_entity_id: PO,
    product_state: null,
    location_id: LOC,
    status: "in_service",
    tax_warehouse_id: WH,
    excise_product_key: "GRANEL-TINTO",
    ...partial,
  };
}

export function barrel(partial: Partial<VesselState> & Pick<VesselState, "id">): VesselState {
  return vessel({
    kind: "barrel",
    material: "oak",
    capacity_ml: 225_000,
    excise_product_key: "CRIANZA-TINTO",
    ...partial,
  });
}

export function holding(
  id: string,
  lotRef: LotRef,
  volume_ml: number,
  product_state: BulkProductState = "wine",
  extra: Partial<VesselState> = {},
): VesselState {
  return vessel({
    id,
    lot_id: lotRef.id,
    volume_ml,
    product_state,
    ...extra,
  });
}

export function stateOf(vessels: readonly VesselState[]): CellarState {
  return { vessels: new Map(vessels.map((row) => [row.id, row])) };
}

export function header(partial: Partial<OperationHeader> = {}): OperationHeader {
  return {
    id: "op-1",
    legal_entity_id: PO,
    occurred_at: "2026-06-01T08:00:00Z",
    fiscal_date: "2026-06-01",
    performed_by: "operario-sintetico",
    created_by: "sistema-sintetico",
    reason: null,
    approval_request_id: null,
    ...partial,
  };
}

export function idSource(): IdSource {
  let n = 0;
  return {
    newId() {
      n += 1;
      return `id-${n}`;
    },
  };
}

export function asOk(result: PlanResult): PlanSuccess {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message} ${JSON.stringify(result.details ?? null)}`);
  }
  return result;
}

export function volumeOf(rows: readonly { volume_ml: number }[]): number {
  return rows.reduce((total, row) => total + row.volume_ml, 0);
}

export function mustLot(partial: Partial<LotRef> & Pick<LotRef, "id" | "code">): LotRef {
  return lot({ kind: "must" satisfies LotKind, excise_product_key: null, abv_pct: null, vintage: 2026, ...partial });
}

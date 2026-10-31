import { isAuthEnabled } from "@/auth/config";
import { getAccessToken } from "@/auth/tokens";
import { ApiError, api } from "@/lib/api";
import type { EntityChoice, EntityCode, Me } from "@/lib/types";

export type ProductState = "grape" | "must" | "wine" | "packaged_unlabeled" | "packaged_labeled" | "goods";
export type ProductClass = "bulk" | "bulk_wood" | "packaged";
export type CountKind = "opening" | "periodic" | "inspection" | "spot";
export type CountStatus = "draft" | "counting" | "review" | "approved" | "posted" | "cancelled";
export type CountMethod = "dipstick" | "flowmeter" | "level_gauge" | "unit_count" | "weight" | "estimate";

/**
 * Saldos de `inventory.stock_at` más las etiquetas de las tablas unidas
 * (ubicación, recipiente, lote, vino, producto) para poder pintar la pantalla.
 */
export type StockBalance = {
  location_id: string;
  location_code: string;
  location_name: string;
  vessel_id: string | null;
  vessel_code: string | null;
  vessel_capacity_ml: number | null;
  owner_entity_id: string;
  owner_code: EntityCode;
  lot_id: string | null;
  lot_code: string | null;
  vintage: number | null;
  product_id: string | null;
  product_name: string | null;
  wine_name: string | null;
  product_state: ProductState;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  nominal_volume_ml: number | null;
};

export type FiscalBalance = {
  tax_warehouse_id: string;
  tax_warehouse_name: string;
  legal_entity_id: string;
  product_class: ProductClass;
  excise_product_key: string | null;
  lot_id: string | null;
  lot_code: string | null;
  vintage: number | null;
  product_id: string | null;
  product_name: string | null;
  wine_name: string | null;
  volume_ml: number;
  units: number;
};

export type PhysicalMove = {
  id: string;
  occurred_at: string;
  move_type: string;
  location_id: string;
  location_code: string;
  location_name: string;
  vessel_id: string | null;
  vessel_code: string | null;
  owner_entity_id: string;
  owner_code: EntityCode;
  lot_id: string | null;
  lot_code: string | null;
  product_id: string | null;
  product_name: string | null;
  wine_name: string | null;
  vintage: number | null;
  product_state: ProductState;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  source_table: string;
  source_id: string;
  document_ref: string | null;
  justification_ref: string | null;
  silicie_entry_id: string | null;
  silicie_ref: string | null;
  created_by: string;
  period_locked: boolean;
  locked_until: string | null;
};

export type FiscalMove = {
  id: string;
  tax_warehouse_id: string;
  tax_warehouse_name: string;
  legal_entity_id: string;
  fiscal_date: string;
  physical_date: string | null;
  move_type: string;
  product_class: ProductClass;
  lot_id: string | null;
  lot_code: string | null;
  vintage: number | null;
  product_id: string | null;
  product_name: string | null;
  wine_name: string | null;
  volume_ml: number;
  units: number;
  excise_product_key: string | null;
  justification_type: string;
  justification_ref: string;
  fiscal_trigger: string;
  source_table: string;
  source_id: string;
  silicie_entry_id: string | null;
  silicie_ref: string | null;
  reason: string | null;
  created_by: string;
  period_locked: boolean;
  locked_until: string | null;
};

export type StockLocation = {
  id: string;
  code: string;
  name: string;
  kind: string;
  controlling_entity_id: string;
  is_active: boolean;
};

export type CountLine = {
  id: string;
  count_id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  vessel_id: string | null;
  vessel_code: string | null;
  vessel_capacity_ml: number | null;
  qr_token: string | null;
  owner_entity_id: string;
  owner_code: EntityCode;
  lot_id: string | null;
  lot_code: string | null;
  product_id: string | null;
  product_name: string | null;
  wine_name: string | null;
  vintage: number | null;
  product_state: ProductState;
  nominal_volume_ml: number | null;
  expected_qty_units: number;
  expected_volume_ml: number;
  counted_qty_units: number | null;
  counted_volume_ml: number | null;
  method: CountMethod | null;
  difference_reason: string | null;
  photo_attachment_id: string | null;
};

export type InventoryCount = {
  id: string;
  legal_entity_id: string;
  legal_entity_code: EntityCode;
  number: string | null;
  kind: CountKind;
  counted_at: string;
  location_ids: string[];
  location_codes: string[];
  status: CountStatus;
  approval_request_id: string | null;
  signed_by: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  difference_count: number;
  lines?: CountLine[];
};

export type CountLineInput = {
  id: string;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: ProductState;
  counted_qty_units: number | null;
  counted_volume_ml: number | null;
  method: CountMethod | null;
  difference_reason: string | null;
};

export type CountDraft = {
  kind: CountKind;
  counted_at: string;
  location_ids: string[];
  legal_entity_id: string;
  notes?: string;
};

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function ownerEntityId(filter: EntityChoice, entities: Me["entities"]): string | undefined {
  if (filter === "all") return undefined;
  return entities.find((entity) => entity.code === filter)?.id;
}

export function balancesPath(input: {
  at: string;
  locationId?: string;
  ownerEntityId?: string;
  productId?: string;
  lotId?: string;
  state?: string;
}): string {
  return `/v1/stock/balances${query({
    at: input.at,
    location_id: input.locationId,
    owner: input.ownerEntityId,
    product_id: input.productId,
    lot_id: input.lotId,
    state: input.state,
  })}`;
}

export function fiscalBalancesPath(input: { at: string; taxWarehouseId?: string; legalEntityId?: string }): string {
  return `/v1/stock/fiscal-balances${query({
    at: input.at,
    tax_warehouse_id: input.taxWarehouseId,
    legal_entity_id: input.legalEntityId,
  })}`;
}

export function movesPath(input: {
  book: "physical" | "fiscal";
  from?: string;
  to?: string;
  moveType?: string;
  lotId?: string;
  source?: string;
  locationId?: string;
  ownerEntityId?: string;
  legalEntityId?: string;
}): string {
  return `/v1/stock/moves${query({
    book: input.book,
    from: input.from,
    to: input.to,
    move_type: input.moveType,
    lot_id: input.lotId,
    source: input.source,
    location_id: input.locationId,
    owner: input.book === "physical" ? input.ownerEntityId : undefined,
    legal_entity_id: input.book === "fiscal" ? input.legalEntityId : undefined,
  })}`;
}

export function countsPath(legalEntityId?: string): string {
  return `/v1/inventory-counts${query({ legal_entity_id: legalEntityId })}`;
}

export function locationsPath(): string {
  return "/v1/locations";
}

export function getCount(id: string, signal?: AbortSignal) {
  return api<InventoryCount>(`/v1/inventory-counts/${id}`, { signal });
}

export function createCount(body: CountDraft, idempotencyKey: string) {
  return api<InventoryCount>("/v1/inventory-counts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function saveCountLines(id: string, lines: CountLineInput[]) {
  return api<InventoryCount>(`/v1/inventory-counts/${id}/lines`, {
    method: "PUT",
    body: JSON.stringify({ lines }),
  });
}

export function closeCount(id: string) {
  return api<InventoryCount>(`/v1/inventory-counts/${id}/close`, {
    method: "POST",
    body: "{}",
  });
}

export function requestCountPosting(id: string, idempotencyKey: string) {
  return api<InventoryCount>(`/v1/inventory-counts/${id}/post-request`, {
    method: "POST",
    body: "{}",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return (configured && configured.length > 0 ? configured : "/api").replace(/\/$/, "");
}

export async function fetchInspectionPdf(at: string): Promise<{ blob: Blob; sha256: string | null }> {
  const headers = new Headers({ Accept: "application/pdf" });
  if (isAuthEnabled) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/v1/stock/inspection-report?at=${encodeURIComponent(at)}`, {
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "WC_NETWORK", "No hay conexión. Comprueba la red e inténtalo de nuevo.");
  }
  if (!response.ok) {
    let payload: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = {};
    }
    throw new ApiError(response.status, payload.code ?? "WC_ERROR", payload.message ?? "No se ha podido generar el informe", payload.fields, payload.details);
  }
  const blob = await response.blob();
  return { blob, sha256: response.headers.get("X-Document-Sha256") };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function balanceKey(row: StockBalance): string {
  return [row.location_id, row.vessel_id ?? "", row.owner_entity_id, row.lot_id ?? "", row.product_id ?? "", row.product_state].join(":");
}

import { ApiError, api } from "@/lib/api";
import { formatLitres } from "@/lib/format";

export type VesselKind = "tank_storage" | "tank_fermenter" | "barrel" | "demijohn" | "ibc" | "other";
export type VesselMaterial = "stainless_steel" | "oak" | "glass" | "concrete" | "plastic" | "other";
export type VesselStatus = "in_service" | "out_of_service" | "retired";
export type ContentState = "fermenting" | "aging" | "holding";
export type OpType =
  | "racking"
  | "blend"
  | "filtration"
  | "bottling"
  | "labeling"
  | "addition"
  | "loss"
  | "destruction"
  | "cleaning"
  | "bleeding"
  | "pressing_off"
  | "delestage"
  | "temperature_control";

export type Vessel = {
  id: string;
  code: string;
  name: string;
  kind: VesselKind;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  material: VesselMaterial;
  location_id: string;
  location_code?: string;
  location_name?: string;
  zone: string | null;
  sisv_code: string | null;
  qr_token?: string | null;
  status: VesselStatus;
  state: string;
  lot_id: string | null;
  lot_code: string | null;
  wine_name: string | null;
  vintage: number | null;
  volume_ml: number;
  product_state: string | null;
  fill_pct: string;
  notes: string | null;
  alert?: string | null;
};

export type Holding = {
  lot_id: string;
  lot_code: string;
  wine_name: string;
  vintage: number | null;
  volume_ml: number;
};

export type OperationLine = {
  id: string;
  operation_id: string;
  role: "input" | "output" | "loss";
  lot_id: string;
  vessel_id: string | null;
  volume_ml: number;
  qty_units: number;
  mass_g: number;
  loss_kind: "authorized" | "incident" | null;
  product_state: string;
  notes: string | null;
};

export type CellarOperation = {
  id: string;
  number: string | null;
  op_type: string;
  occurred_at: string;
  status: "draft" | "confirmed" | "rectified" | "discarded";
  reason: string | null;
  performed_by: string;
  approval_request_id: string | null;
  lines?: OperationLine[];
};

export type CleaningRecord = {
  id: string;
  operation_id: string;
  vessel_id: string | null;
  active_substance: string;
  quantity: number;
  quantity_unit: string;
  efficacy_check: string;
  created_at: string;
};

export type Lot = {
  id: string;
  code: string;
  kind: "grape" | "must" | "wine" | "bottled" | string;
  wine_id?: string | null;
  wine_name: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: "active" | "depleted" | "closed" | string;
  origin: string;
  notes: string | null;
  positions: {
    vessel_code: string | null;
    volume_ml: number;
    location_code: string;
    location_name?: string;
  }[];
};

export type TraceNode = {
  lot_id: string;
  code: string;
  kind: string;
  vintage: number | null;
  depth: number;
  wine_name?: string | null;
  volume_ml?: number;
  mass_g?: number;
};

export type TraceEdge = {
  parent_lot_id: string;
  child_lot_id: string;
  parent_code?: string;
  child_code?: string;
  volume_ml: number;
  mass_g?: number;
};

export type VesselLabel = {
  code: string;
  qr_token: string;
  payload: string;
};

export type Traceability = {
  nodes: TraceNode[];
  edges: TraceEdge[];
  mermaid: string;
};

export const OP_TYPES: { id: OpType; label: string; hint: string }[] = [
  { id: "racking", label: "Trasiego", hint: "Mismo lote, otro depósito" },
  { id: "blend", label: "Ensamblaje", hint: "Varios lotes, lote nuevo" },
  { id: "filtration", label: "Filtración", hint: "Mismo vino, más limpio" },
  { id: "bottling", label: "Envasado", hint: "Granel a botellas" },
  { id: "labeling", label: "Etiquetado", hint: "Jaulón sin etiqueta" },
  { id: "addition", label: "Adición", hint: "Producto enológico" },
  { id: "loss", label: "Merma", hint: "Lías, derrame, rotura" },
  { id: "destruction", label: "Destrucción", hint: "Exige aprobación" },
  { id: "cleaning", label: "Limpieza", hint: "Depósito vacío" },
  { id: "bleeding", label: "Sangrado", hint: "Parte del depósito, lote nuevo" },
  { id: "pressing_off", label: "Descube", hint: "Yema y vino de prensa" },
  { id: "delestage", label: "Délestage", hint: "Sin mover volumen" },
  { id: "temperature_control", label: "Temperatura", hint: "Cambia la consigna" },
];

const KIND_LABEL: Record<VesselKind, string> = {
  tank_storage: "Depósito",
  tank_fermenter: "Fermentador",
  barrel: "Barrica",
  demijohn: "Damajuana",
  ibc: "IBC",
  other: "Otro",
};

const STATE_LABEL: Record<ContentState, string> = {
  fermenting: "En fermentación",
  aging: "En crianza",
  holding: "Con vino",
};

export function kindLabel(kind: VesselKind): string {
  return KIND_LABEL[kind] ?? kind;
}

export function holding(vessel: Vessel | undefined): Holding | null {
  if (!vessel || vessel.volume_ml <= 0 || !vessel.lot_id || !vessel.lot_code) return null;
  return {
    lot_id: vessel.lot_id,
    lot_code: vessel.lot_code,
    wine_name: vessel.wine_name ?? "",
    vintage: vessel.vintage,
    volume_ml: vessel.volume_ml,
  };
}

export function contentLabel(vessel: Vessel): string {
  if (vessel.status === "out_of_service") return "Fuera de servicio";
  if (vessel.status === "retired") return "Baja";
  if (vessel.volume_ml <= 0) return "Vacío";
  if (vessel.state === "fermenting" || vessel.product_state === "must") return "En fermentación";
  if (vessel.state === "aging") return "En crianza";
  return STATE_LABEL.holding;
}

export function fillPercent(vessel: Vessel): number {
  const parsed = Number(vessel.fill_pct);
  if (Number.isFinite(parsed) && vessel.capacity_ml > 0) return Math.max(0, Math.min(100, Math.round(parsed)));
  if (vessel.capacity_ml <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((vessel.volume_ml / vessel.capacity_ml) * 100)));
}

export function litresToMl(text: string): number {
  const cleaned = text.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1000);
}

export function mlToEdit(ml: number): string {
  const litres = ml / 1000;
  const text = litres.toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
  return text === "" ? "0" : text;
}

export function needsBalance(op: OpType | ""): boolean {
  return op === "racking" || op === "blend" || op === "filtration" || op === "bottling" || op === "bleeding" || op === "pressing_off";
}

export function conservation(inputMl: number, outputMl: number, lossMl: number): { ok: boolean; text: string } {
  const ok = inputMl === outputMl + lossMl;
  const entra = formatLitres(inputMl / 1000);
  const sale = formatLitres(outputMl / 1000);
  const merma = formatLitres(lossMl / 1000);
  if (ok) return { ok, text: `Entra ${entra} = sale ${sale} + merma ${merma}` };
  return {
    ok: false,
    text: `El volumen no cuadra: entran ${entra} y salen ${formatLitres((outputMl + lossMl) / 1000)} (WC020)`,
  };
}

const ERROR_COPY: Record<string, string> = {
  WC020: "El volumen no cuadra",
  WC021: "La fecha no vale: es futura o el periodo está cerrado",
  WC024: "No hay existencias suficientes en ese depósito",
  WC025: "Supera la capacidad del depósito",
  WC026: "El depósito contiene otro lote; usa Ensamblaje",
  WC028: "El cambio de mayor SILICIE (depósito ↔ barrica) no cuadra",
  WC030: "La genealogía de ese lote tendría un ciclo",
  WC_VESSEL_NOT_IN_SERVICE: "El depósito está fuera de servicio",
  WC_NOT_APPROVED: "Falta la aprobación de la merma",
  WC027: "El saldo fiscal no alcanza",
  WC032: "Esa operación no se puede confirmar ni rectificar",
};

export function cellarMessage(code: string, message?: string): string {
  const fallback = ERROR_COPY[code] ?? "No se ha podido guardar la operación";
  const raw = message?.trim() ? message.trim() : fallback;
  if (!code || code === "WC_ERROR") return raw;
  return raw.includes(code) ? raw : `${raw} (${code})`;
}

export function describeCellarError(error: ApiError): { code: string; message: string; vessel?: string; role?: string } {
  const details = error.details ?? {};
  const vessel = typeof details.vessel_code === "string" ? details.vessel_code : undefined;
  const role = typeof details.role === "string" ? details.role : undefined;
  return { code: error.code, message: cellarMessage(error.code, error.message), vessel, role };
}

export function errorText(error: unknown): { code: string; message: string; vessel?: string; role?: string } | null {
  if (!(error instanceof ApiError)) return null;
  return describeCellarError(error);
}

export function listVessels(signal?: AbortSignal) {
  return api<{ items: Vessel[]; next_cursor: string | null; total: number }>("/v1/vessels", { signal });
}

export function getVessel(code: string, signal?: AbortSignal) {
  return api<Vessel & { operations: CellarOperation[]; cleanings: CleaningRecord[] }>(`/v1/vessels/${code}`, { signal });
}

export function getLot(code: string, signal?: AbortSignal) {
  return api<Lot>(`/v1/lots/${code}`, { signal });
}

export function getTrace(code: string, signal?: AbortSignal) {
  return api<Traceability>(`/v1/lots/${code}/traceability?direction=both`, { signal });
}

export function createOperation(body: unknown) {
  return api<CellarOperation>("/v1/cellar-operations", { method: "POST", body: JSON.stringify(body) });
}

export function updateOperation(id: string, body: unknown) {
  return api<CellarOperation>(`/v1/cellar-operations/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export type PreviewMove = {
  move_type: string;
  vessel_id: string | null;
  lot_id: string | null;
  volume_ml: number;
  qty_units: number;
  product_state: string;
  loss_kind?: "authorized" | "incident" | null;
};

export type PreviewFiscalMove = {
  move_type: string;
  product_class: string;
  volume_ml: number;
  units: number;
  excise_product_key?: string | null;
};

export type PreviewLot = {
  code: string;
  kind: string;
  volume_ml?: number;
};

/** Corks, capsules, cases and pallets a bottling would consume. Absent on older APIs. */
export type PreviewMaterial = {
  sku: string;
  name: string;
  per: string;
  quantity: number;
  available: number;
  required_total?: number;
  shortfall?: number;
  short: boolean;
  warning: string | null;
};

/** Efectos que devolvería confirmar, sin escribir libros. */
export type OperationPreview = {
  stock_moves: PreviewMove[];
  fiscal_moves: PreviewFiscalMove[];
  new_lots: PreviewLot[];
  materials?: PreviewMaterial[];
};

export type LotListItem = {
  id: string;
  code: string;
  kind: string;
  wine_id?: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: string;
  volume_ml: number;
  qty_units: number;
  vessel_code: string | null;
  location_code: string | null;
};

export type Page<T> = { items: T[]; next_cursor: string | null; total: number };

export function listLots(query: { q?: string; kind?: string; vintage?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind) params.set("kind", query.kind);
  if (query.vintage) params.set("vintage", query.vintage);
  if (query.status) params.set("status", query.status);
  if (query.cursor) params.set("cursor", query.cursor);
  params.set("limit", String(query.limit ?? 50));
  const suffix = params.toString();
  return api<Page<LotListItem>>(`/v1/lots${suffix ? `?${suffix}` : ""}`, { signal });
}

export function getOperation(id: string, signal?: AbortSignal) {
  return api<CellarOperation & { lines?: OperationLine[]; cleaning?: CleaningRecord | null }>(
    `/v1/cellar-operations/${encodeURIComponent(id)}`,
    { signal },
  );
}

export function confirmOperation(id: string) {
  return api<CellarOperation>(`/v1/cellar-operations/${encodeURIComponent(id)}/confirm`, { method: "POST" });
}

export function previewOperation(id: string) {
  return api<OperationPreview>(`/v1/cellar-operations/${encodeURIComponent(id)}/preview`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function rectifyOperation(id: string, reason: string) {
  return api<CellarOperation>(`/v1/cellar-operations/${encodeURIComponent(id)}/rectify`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

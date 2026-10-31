import { entityName } from "@/lib/labels";
import type { EntityCode } from "@/lib/types";

export const PRODUCT_STATES = [
  { id: "wine", label: "Granel" },
  { id: "must", label: "Mosto" },
  { id: "packaged_unlabeled", label: "Sin etiquetar" },
  { id: "packaged_labeled", label: "Etiquetado" },
  { id: "grape", label: "Uva" },
  { id: "goods", label: "Mercancía" },
] as const;

export const PRODUCT_CLASSES = [
  { id: "bulk", label: "Granel" },
  { id: "bulk_wood", label: "Granel en madera" },
  { id: "packaged", label: "Envasado" },
] as const;

export const PHYSICAL_MOVE_TYPES = [
  { id: "opening", label: "Saldo de apertura" },
  { id: "cellar_in", label: "Entrada de bodega" },
  { id: "cellar_out", label: "Salida de bodega" },
  { id: "loss", label: "Merma" },
  { id: "delivery_out", label: "Salida por albarán" },
  { id: "transfer_in", label: "Entrada por traspaso" },
  { id: "return_in", label: "Devolución" },
  { id: "ownership_out", label: "Sale el propietario" },
  { id: "ownership_in", label: "Entra el propietario" },
  { id: "purchase_in", label: "Compra" },
  { id: "count_adjust_in", label: "Regularización de aforo (+)" },
  { id: "count_adjust_out", label: "Regularización de aforo (−)" },
  { id: "reversal", label: "Anulación" },
] as const;

export const FISCAL_MOVE_TYPES = [
  { id: "opening", label: "Saldo de apertura" },
  { id: "production", label: "Elaboración" },
  { id: "bulk_receipt", label: "Entrada de granel" },
  { id: "packaging_out_bulk", label: "Salida de granel por envasado" },
  { id: "packaging_in_packaged", label: "Entrada de envasado" },
  { id: "loss", label: "Merma" },
  { id: "destruction", label: "Destrucción" },
  { id: "exit_domestic", label: "Salida nacional" },
  { id: "exit_export", label: "Exportación" },
  { id: "exit_intra_eu", label: "Salida intracomunitaria" },
  { id: "exit_canary", label: "Salida a Canarias" },
  { id: "ledger_change_out", label: "Cambio de mayor (sale)" },
  { id: "ledger_change_in", label: "Cambio de mayor (entra)" },
  { id: "return_in", label: "Devolución" },
  { id: "regularization_in", label: "Regularización (+)" },
  { id: "regularization_out", label: "Regularización (−)" },
  { id: "reversal", label: "Anulación" },
] as const;

export const COUNT_KINDS = [
  { id: "opening", label: "Arranque" },
  { id: "periodic", label: "Periódico" },
  { id: "inspection", label: "Inspección" },
  { id: "spot", label: "Puntual" },
] as const;

export const COUNT_STATUSES = [
  { id: "draft", label: "Borrador", tone: "neutral" },
  { id: "counting", label: "Contando", tone: "info" },
  { id: "review", label: "En revisión", tone: "warning" },
  { id: "approved", label: "Aprobado", tone: "success" },
  { id: "posted", label: "Contabilizado", tone: "success" },
  { id: "cancelled", label: "Anulado", tone: "danger" },
] as const;

export const COUNT_METHODS = [
  { id: "dipstick", label: "Varilla" },
  { id: "flowmeter", label: "Caudalímetro" },
  { id: "level_gauge", label: "Nivel" },
  { id: "unit_count", label: "Recuento de unidades" },
  { id: "weight", label: "Peso" },
  { id: "estimate", label: "Estimación" },
] as const;

function labelOf(list: readonly { id: string; label: string }[], id: string | null | undefined): string {
  if (!id) return "—";
  return list.find((item) => item.id === id)?.label ?? id;
}

export function stateLabel(id: string | null | undefined): string {
  return labelOf(PRODUCT_STATES, id);
}

export function classLabel(id: string | null | undefined): string {
  return labelOf(PRODUCT_CLASSES, id);
}

export function physicalMoveLabel(id: string): string {
  return labelOf(PHYSICAL_MOVE_TYPES, id);
}

export function fiscalMoveLabel(id: string): string {
  return labelOf(FISCAL_MOVE_TYPES, id);
}

export function countKindLabel(id: string): string {
  return labelOf(COUNT_KINDS, id);
}

export function countStatusLabel(id: string): string {
  return labelOf(COUNT_STATUSES, id);
}

export function countStatusTone(id: string): "neutral" | "info" | "success" | "warning" | "danger" {
  return COUNT_STATUSES.find((item) => item.id === id)?.tone ?? "neutral";
}

export function methodLabel(id: string | null | undefined): string {
  return labelOf(COUNT_METHODS, id);
}

export function ownerLabel(code: EntityCode | null | undefined): string {
  if (!code) return "—";
  return entityName(code);
}

export function isPackaged(state: string): boolean {
  return state === "packaged_unlabeled" || state === "packaged_labeled" || state === "goods";
}

export function productLabel(row: {
  product_name?: string | null;
  wine_name?: string | null;
  vintage?: number | null;
}): string {
  if (row.product_name) return row.product_name;
  if (row.wine_name && row.vintage) return `${row.wine_name} ${row.vintage}`;
  return row.wine_name || "Sin producto";
}

export function sourceHref(table: string, id: string): string | null {
  if (table === "sales.delivery_note") return `/ventas/albaranes/${id}`;
  if (table === "billing.invoice") return `/facturas/${id}`;
  if (table === "cellar.operation") return `/bodega/operaciones/${id}`;
  if (table === "inventory.inventory_count") return `/stock/aforos/${id}`;
  return null;
}

import { formatDate, formatDateTime } from "@/lib/format";
import type { FiscalMove, PhysicalMove } from "@/pages/existencias/api";
import { classLabel, fiscalMoveLabel, physicalMoveLabel, productLabel, sourceHref } from "@/pages/existencias/labels";

export type MoveView = {
  id: string;
  when: string;
  whenDetail: string | null;
  moveType: string;
  moveTypeId: string;
  place: string;
  lot: string;
  product: string;
  volumeMl: number;
  units: number;
  document: string;
  href: string | null;
  justification: string;
  silicie: string;
  user: string;
  locked: boolean;
  lockedUntil: string | null;
  book: "physical" | "fiscal";
};

export function physicalView(row: PhysicalMove): MoveView {
  return {
    id: row.id,
    when: formatDateTime(row.occurred_at),
    whenDetail: null,
    moveType: physicalMoveLabel(row.move_type),
    moveTypeId: row.move_type,
    place: row.vessel_code ? `${row.vessel_code} · ${row.location_code}` : row.location_name,
    lot: row.lot_code ?? "—",
    product: productLabel(row),
    volumeMl: row.volume_ml,
    units: row.qty_units,
    document: row.document_ref,
    href: sourceHref(row.source_table, row.source_id, row.lot_code),
    justification: row.justification_ref ?? "—",
    silicie: row.silicie_ref ?? "—",
    user: row.created_by,
    locked: row.period_locked,
    lockedUntil: row.locked_until,
    book: "physical",
  };
}

export function fiscalView(row: FiscalMove): MoveView {
  const fiscal = formatDate(row.fiscal_date);
  const physical = row.physical_date ? formatDate(row.physical_date) : null;
  return {
    id: row.id,
    when: fiscal,
    whenDetail: physical && physical !== fiscal ? `Salida física ${physical}` : null,
    moveType: fiscalMoveLabel(row.move_type),
    moveTypeId: row.move_type,
    place: `${classLabel(row.product_class)} · ${row.excise_product_key ?? row.tax_warehouse_name}`,
    lot: row.lot_code ?? "—",
    product: productLabel(row),
    volumeMl: row.volume_ml,
    units: row.units,
    document: row.justification_ref,
    href: sourceHref(row.source_table, row.source_id),
    justification: row.justification_ref,
    silicie: row.silicie_ref ?? "—",
    user: row.created_by,
    locked: row.period_locked,
    lockedUntil: row.locked_until,
    book: "fiscal",
  };
}

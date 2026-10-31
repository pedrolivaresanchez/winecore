import type { Vessel } from '@/lib/cellar'
import { OP_TYPES, type OpType } from '@/lib/cellar'

export const GRID_LABELS = {
  addCalculation: 'Añadir cálculo',
  aggregation: () => 'Cálculo',
  aggregations: 'Cálculos',
  count: (n: number) => `${n}`,
  clearCalculation: 'Quitar cálculo',
  selectAll: 'Seleccionar todos',
  selectRow: 'Seleccionar fila',
  openRecord: 'Abrir',
  sortAscending: 'Ascendente',
  sortDescending: 'Descendente',
  columnOptions: 'Opciones de columna',
}

export function opLabel(op: string): string {
  return OP_TYPES.find((item) => item.id === op)?.label ?? op
}

export function materialLabel(material: Vessel['material'] | string): string {
  if (material === 'stainless_steel') return 'Acero'
  if (material === 'oak') return 'Roble'
  if (material === 'glass') return 'Vidrio'
  if (material === 'concrete') return 'Hormigón'
  if (material === 'plastic') return 'Plástico'
  return 'Otro'
}

export function vesselStatusLabel(status: string): string {
  if (status === 'out_of_service') return 'Fuera de servicio'
  if (status === 'retired') return 'Baja'
  return 'En servicio'
}

export function lotKindLabel(kind: string): string {
  if (kind === 'grape') return 'Uva'
  if (kind === 'must') return 'Mosto'
  if (kind === 'wine') return 'Vino'
  if (kind === 'bottled') return 'Envasado'
  return kind
}

export function lotStatusLabel(status: string): string {
  if (status === 'active') return 'Activo'
  if (status === 'depleted') return 'Agotado'
  if (status === 'closed') return 'Cerrado'
  return status
}

export function opStatusLabel(status: string): string {
  if (status === 'draft') return 'Borrador'
  if (status === 'confirmed') return 'Confirmada'
  if (status === 'rectified') return 'Rectificada'
  if (status === 'discarded') return 'Descartada'
  return status
}

export function opStatusTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'confirmed') return 'success'
  if (status === 'draft') return 'warning'
  if (status === 'discarded') return 'danger'
  return 'neutral'
}

export function vesselTone(vessel: Vessel): 'success' | 'warning' | 'neutral' | 'danger' | 'info' {
  if (vessel.status !== 'in_service') return 'danger'
  if (vessel.volume_ml <= 0) return 'neutral'
  if (vessel.state === 'fermenting' || vessel.product_state === 'must') return 'warning'
  if (vessel.state === 'aging') return 'info'
  return 'success'
}

const MOVE: Record<string, string> = {
  cellar_out: 'Sale',
  cellar_in: 'Entra',
  loss: 'Merma',
  opening: 'Existencia inicial',
}

const FISCAL: Record<string, string> = {
  ledger_change_out: 'Sale del mayor',
  ledger_change_in: 'Entra en el mayor',
  packaging_out_bulk: 'Sale el granel',
  packaging_in_packaged: 'Entran las botellas',
  loss: 'Merma fiscal',
  destruction: 'Destrucción fiscal',
}

const CLASS_LABEL: Record<string, string> = {
  bulk: 'granel',
  bulk_wood: 'madera',
  packaged: 'envasado',
}

const ROLE: Record<string, string> = {
  input: 'Entrada',
  output: 'Salida',
  loss: 'Merma',
}

export function moveLabel(type: string): string {
  return MOVE[type] ?? type
}

export function fiscalLabel(type: string): string {
  return FISCAL[type] ?? type
}

export function classLabel(value: string): string {
  return CLASS_LABEL[value] ?? value
}

export function roleLabel(role: string): string {
  return ROLE[role] ?? role
}

export function isOpType(value: string): value is OpType {
  return OP_TYPES.some((item) => item.id === value)
}

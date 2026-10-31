import { copy, fill } from '@/i18n'
import {
  CLASS_IDS,
  showDecimal,
  type ClosureType,
  type ConsumableKind,
  type EquipmentKind,
  type EquipmentRole,
  type PlateGrade,
  type Purpose,
  type SealType,
} from '@/pages/higiene/api'

export type HygieneTab = 'limpiezas' | 'filtraciones' | 'envasado' | 'equipos' | 'consumibles' | 'procedimientos'

export const GRID_LABELS = {
  addCalculation: copy.higiene.gridAdd,
  aggregation: () => copy.higiene.gridCount,
  aggregations: copy.higiene.gridAggregations,
  count: (n: number) => `${n}`,
  clearCalculation: copy.higiene.gridClear,
  selectAll: copy.higiene.selectAll,
  selectRow: copy.higiene.selectRow,
  openRecord: copy.higiene.openRecord,
  sortAscending: copy.higiene.asc,
  sortDescending: copy.higiene.desc,
  columnOptions: copy.higiene.columnOptions,
}

const DATE_LABELS = { clear: copy.higiene.dateClear, today: copy.higiene.dateToday, time: copy.higiene.dateTime }

export function dateLabels() {
  return DATE_LABELS
}

export function hygieneTabs(owner: boolean): { id: HygieneTab; path: string; label: string }[] {
  const tabs: { id: HygieneTab; path: string; label: string }[] = [
    { id: 'limpiezas', path: '/bodega/higiene', label: copy.higiene.cleanings },
    { id: 'filtraciones', path: '/bodega/higiene/filtraciones', label: copy.higiene.filtrations },
    { id: 'envasado', path: '/bodega/higiene/envasado', label: copy.higiene.bottling },
    { id: 'equipos', path: '/bodega/higiene/equipos', label: copy.higiene.equipment },
    { id: 'consumibles', path: '/bodega/higiene/consumibles', label: copy.higiene.consumables },
    { id: 'procedimientos', path: '/bodega/higiene/procedimientos', label: copy.higiene.procedures },
  ]
  return owner ? tabs : tabs.filter((tab) => tab.id !== 'procedimientos')
}

export function tabFromPath(pathname: string): HygieneTab {
  if (pathname.includes('/filtraciones')) return 'filtraciones'
  if (pathname.includes('/envasado')) return 'envasado'
  if (pathname.includes('/equipos')) return 'equipos'
  if (pathname.includes('/consumibles')) return 'consumibles'
  if (pathname.includes('/procedimientos')) return 'procedimientos'
  return 'limpiezas'
}

export function purposeLabel(purpose: string): string {
  if (purpose === 'disinfection') return copy.higiene.disinfection
  if (purpose === 'both') return copy.higiene.both
  return copy.higiene.cleaning
}

export function equipmentKindLabel(kind: string): string {
  const labels: Record<EquipmentKind, string> = {
    bottler: 'Llenadora',
    filter: 'Filtro',
    filter_housing: 'Carcasa',
    pump: 'Bomba',
    press: 'Prensa',
    destemmer: 'Despalilladora',
    other: copy.higiene.other,
  }
  return labels[kind as EquipmentKind] ?? kind
}

export function equipmentStatusLabel(status: string): string {
  if (status === 'out_of_service') return copy.higiene.outOfService
  if (status === 'retired') return copy.higiene.retired
  return copy.higiene.inService
}

export function classLabel(id: string): string {
  const labels: Record<(typeof CLASS_IDS)[number], string> = {
    tank_storage: 'Depósito',
    tank_fermenter: 'Fermentador',
    barrel: 'Barrica',
    demijohn: 'Damajuana',
    ibc: 'IBC',
    bottler: 'Llenadora',
    filter: 'Filtro',
    filter_housing: 'Carcasa',
    pump: 'Bomba',
    press: 'Prensa',
    destemmer: 'Despalilladora',
    other: copy.higiene.other,
  }
  return labels[id as (typeof CLASS_IDS)[number]] ?? id
}

export function consumableKindLabel(kind: string): string {
  if (kind === 'filter_plate') return copy.higiene.filterPlate
  if (kind === 'cleaning_product') return copy.higiene.cleaningProduct
  return copy.higiene.other
}

export function plateLabel(grade: string): string {
  if (grade === 'V00') return 'V00 desbaste'
  if (grade === 'V07') return 'V07 intermedia'
  if (grade === 'V13') return 'V13 amicróbica'
  return grade
}

export function closureLabel(value: string): string {
  if (value === 'agglomerated_cork') return copy.higiene.agglomerated
  return copy.higiene.natural
}

export function sealLabel(value: string): string {
  if (value === 'wax_seal') return copy.higiene.wax
  return copy.higiene.capsule
}

export function roleLabel(role: string): string {
  if (role === 'cleaned') return copy.higiene.cleaned
  return copy.higiene.used
}

export function doseText(min: string, max: string, unit: string): string {
  return fill(copy.higiene.doseHint, { min: showDecimal(min), max: showDecimal(max), unit })
}

const CAPACITY_UNIT: Record<string, string> = { ud: 'ud', l: 'l', hl: 'hl', ml: 'ml', plates: 'placas' }

export function capacityText(capacity: string | null, unit: string | null): string {
  if (!capacity || !unit) return '—'
  return `${showDecimal(capacity)} ${CAPACITY_UNIT[unit] ?? unit}`
}

export function matches(query: string, parts: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.join(' ').toLowerCase().includes(needle)
}

export function isPurpose(value: string): value is Purpose {
  return value === 'cleaning' || value === 'disinfection' || value === 'both'
}

export function isPlate(value: string): value is PlateGrade {
  return value === 'V00' || value === 'V07' || value === 'V13'
}

export function isClosure(value: string): value is ClosureType {
  return value === 'natural_cork' || value === 'agglomerated_cork'
}

export function isSeal(value: string): value is SealType {
  return value === 'capsule' || value === 'wax_seal'
}

export function isConsumableKind(value: string): value is ConsumableKind {
  return value === 'filter_plate' || value === 'cleaning_product' || value === 'other'
}

export function isEquipmentKind(value: string): value is EquipmentKind {
  return (['bottler', 'filter', 'filter_housing', 'pump', 'press', 'destemmer', 'other'] as string[]).includes(value)
}

export function isRole(value: string): value is EquipmentRole {
  return value === 'used' || value === 'cleaned'
}

export const VESSEL_CLASSES = ['tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc']
export const EQUIPMENT_CLASSES = ['bottler', 'filter', 'filter_housing', 'pump', 'press', 'destemmer', 'other']

import { copy } from '@/i18n'
import type { GridLabels } from '@/ui'
import type { Descriptor, DescriptorFamily, Subject } from '@/pages/catas/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GRID_LABELS: GridLabels = {
  addCalculation: copy.catas.grid.addCalculation,
  aggregation: () => copy.catas.grid.aggregation,
  aggregations: copy.catas.grid.aggregations,
  count: (n: number) => String(n),
  clearCalculation: copy.catas.grid.clearCalculation,
  selectAll: copy.catas.grid.selectAll,
  selectRow: copy.catas.grid.selectRow,
  openRecord: copy.catas.grid.openRecord,
  sortAscending: copy.catas.grid.sortAscending,
  sortDescending: copy.catas.grid.sortDescending,
  columnOptions: copy.catas.grid.columnOptions,
}

export const FAMILIES: DescriptorFamily[] = ['visual', 'nose', 'mouth', 'other']

export function isUuid(value: string): boolean {
  return UUID.test(value.trim())
}

export function scoreMax(scale: string): number {
  return scale === '0-100' ? 100 : 10
}

export function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

export function bag(group: 'subjects' | 'families' | 'option', code: string): string {
  const table = copy.catas[group] as Record<string, string>
  return table[code] ?? code.replaceAll('_', ' ')
}

export function subjectLabel(subject: string): string {
  return bag('subjects', subject)
}

export function familyLabel(family: string): string {
  return bag('families', family)
}

export function optionLabel(code: string): string {
  return bag('option', code)
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const text = value.toFixed(2).replace(/\.?0+$/, '')
  return text.replace('.', ',')
}

export function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const pct = Math.round(value * 1000) / 10
  const text = pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')
  return `${text} %`
}

export function descriptorName(descriptors: readonly Descriptor[], code: string): string {
  return descriptors.find((item) => item.code === code)?.name_es ?? optionLabel(code)
}

export function whereLabel(subject: Subject): 'parcel' | 'lot' | 'bottle' {
  if (subject === 'grape') return 'parcel'
  if (subject === 'bottle') return 'bottle'
  return 'lot'
}

export function dayInstant(day: string): string {
  return `${day}T12:00:00Z`
}

export function rangeStart(day: string): string {
  return `${day}T00:00:00Z`
}

export function rangeEnd(day: string): string {
  return `${day}T23:59:59Z`
}

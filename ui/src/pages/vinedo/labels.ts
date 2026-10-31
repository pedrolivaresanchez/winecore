import { copy } from '@/i18n'

export const SECTIONS = ['parcelas', 'maduracion', 'planificador', 'vendimias', 'recepcion', 'cuaderno'] as const
export type Section = (typeof SECTIONS)[number]

export function sectionOf(value: string | null): Section {
  if (value && (SECTIONS as readonly string[]).includes(value)) return value as Section
  return 'parcelas'
}

export function sectionLabel(id: Section): string {
  return copy.vinedo.sections[id]
}

export function civil(iso: string | null | undefined): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function ha(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '—'
  const [whole, frac] = number.toFixed(2).split('.')
  return `${whole},${frac} ha`
}

export function kilos(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '—'
  const [whole, frac] = number.toFixed(1).split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${grouped},${frac} kg`
}

export function dot(value: string): string {
  return value.trim().replace(',', '.')
}

export function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function organicLabel(status: string): string {
  if (status === 'organic') return copy.vinedo.organic
  if (status === 'in_conversion') return copy.vinedo.converting
  return copy.vinedo.conventional
}

export function ownershipLabel(value: string): string {
  if (value === 'leased') return copy.vinedo.leased
  if (value === 'supplier') return copy.vinedo.supplier
  return copy.vinedo.own
}

export function taskLabel(kind: string): string {
  const map = copy.vinedo.tasks as Record<string, string>
  return map[kind] ?? kind
}

export function weatherLabel(value: string | null): string {
  if (!value) return '—'
  const map = copy.vinedo.weather as Record<string, string>
  return map[value] ?? value
}

export function planStatusLabel(status: string): string {
  const map = copy.vinedo.planStatus as Record<string, string>
  return map[status] ?? status
}

export function seedLabel(value: string | null): string {
  if (!value) return '—'
  const map = copy.vinedo.seeds as Record<string, string>
  return map[value] ?? value
}

export function sanitaryLabel(value: string | null): string {
  if (!value) return '—'
  const map = copy.vinedo.sanitary as Record<string, string>
  return map[value] ?? value
}

export function containerLabel(value: string): string {
  const map = copy.vinedo.containers as Record<string, string>
  return map[value] ?? value
}

export function weighingLabel(value: string): string {
  return value === 'estimated' ? copy.vinedo.estimated : copy.vinedo.weighed
}

export function grapeStateLabel(value: string): string {
  const map = copy.vinedo.grapeState as Record<string, string>
  return map[value] ?? value
}

export function decisionLabel(value: string): string {
  const map = copy.vinedo.decisions as Record<string, string>
  return map[value] ?? value
}

export function receptionStatusLabel(status: string): string {
  const map = copy.vinedo.receptionStatus as Record<string, string>
  return map[status] ?? status
}

export function cueLabel(status: string): string {
  const map = copy.vinedo.cueStatus as Record<string, string>
  return map[status] ?? status
}

export function kindLabel(kind: string): string {
  const map = copy.vinedo.productKinds as Record<string, string>
  return map[kind] ?? kind
}

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

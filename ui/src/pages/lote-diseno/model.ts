import { copy, fill } from '@/i18n'
import { formatPercent } from '@/lib/format'

export type DestinationKind = 'reference' | 'new_collection' | 'pending'
export type Vinification = 'blanco' | 'tinto' | 'rosado' | 'orange' | 'otro'
export type InoculationKind = 'espontanea' | 'comercial'
export type AgingMethod = 'deposito' | 'barrica' | 'damajuana_intemperie' | 'sin_crianza'
export type PracticeSide = 'applied' | 'not' | 'clear'

export interface PracticeInfo {
  code: string
  name_es: string
  intervention: boolean
}

export interface ParcelRef {
  id: string
  code: string
  name: string
}

export interface DesignInput {
  destination_kind: DestinationKind
  wine_id: string | null
  product_id: string | null
  collection_name: string | null
  vinification: Vinification
  destemmed: boolean
  inoculation_kind: InoculationKind
  yeast_product_id: string | null
  yeast_lot_code: string | null
  yeast_name: string | null
  practices_applied: string[]
  practices_not_applied: string[]
  no_intervention: boolean
  aging_method: AgingMethod
  aging_duration_days: number | null
  single_plot: boolean
  parcel_id: string | null
  label_number: number | null
  notes: string | null
}

export interface DesignView {
  lot_id: string
  lot_code: string
  origin_parcels: ParcelRef[]
  single_plot_allowed: boolean
  practice_catalog: PracticeInfo[]
  design: DesignInput | null
  updated_at: string | null
  updated_by: string | null
}

export interface RecipeAddition {
  product_id: string | null
  product_name: string | null
  quantity: number | null
  quantity_unit: string | null
  dose: number
  dose_unit: string
  dose_g_per_hl: number | null
  purpose: string | null
}

export interface BlendShare {
  lot_id: string
  lot_code: string
  volume_ml: number
  mass_g: number
  percent: number
}

export interface RecipeStep {
  position: number
  op_type: string
  offset_days: number
  duration_hours: number | null
  temperature_c: number | null
  additions: RecipeAddition[]
  blend_proportions: BlendShare[]
  parameters: Record<string, unknown>
  source_operation_id: string | null
}

export interface RecipeSummary {
  id: string
  code: string
  name: string
  status: string
  source_lot_id: string | null
  source_lot_code: string | null
  notes: string | null
  latest_version_no: number | null
  latest_version_status: string | null
  published_version_no: number | null
  step_count: number
  updated_at: string | null
}

export interface RecipeVersion {
  id: string
  version_no: number
  status: string
  design: Record<string, unknown>
  published_at: string | null
  published_by: string | null
  steps: RecipeStep[]
}

export interface RecipeDetail extends RecipeSummary {
  created_at: string | null
  versions: RecipeVersion[]
}

export interface PlanStep {
  position: number
  op_type: string
  target_date: string
  offset_days: number
  duration_hours: number | null
  temperature_c: number | null
  additions: RecipeAddition[]
  blend_proportions: BlendShare[]
  parameters: Record<string, unknown>
  status: 'suggested'
}

export interface PlanView {
  id: string
  lot_id: string
  lot_code: string
  recipe_id: string
  recipe_code: string
  version_id: string
  version_no: number
  start_date: string
  creates_operations: false
  steps: PlanStep[]
}

export interface Deviation {
  kind: 'missing_step' | 'extra_operation' | 'type_mismatch' | 'parameter' | 'design'
  position: number | null
  op_type: string | null
  field: string | null
  expected: unknown
  actual: unknown
}

export interface DeviationReport {
  lot_id: string
  lot_code: string
  recipe_id: string
  version_id: string
  version_no: number
  expected_count: number
  actual_count: number
  matched: boolean
  deviations: Deviation[]
}

export interface VintageMetrics {
  vintage: number
  harvest_date: string | null
  kg: number | null
  yield_kg_ha: number | null
  varieties: string[]
  ripeness: Array<{
    checked_at: string | null
    probable_abv: number | null
    total_acidity: number | null
    sanitary_status: string | null
    sensory_notes: string | null
  }>
  intake_sanitary_notes: string | null
  analyses: {
    abv: number | null
    total_acidity: number | null
    ph: number | null
    free_so2: number | null
    total_so2: number | null
    volatile_acidity: number | null
    total_polyphenol_index: number | null
  } | null
  tasting_score: number | null
  tasting_count: number
  weather_notes: string | null
}

export interface VintageGroup {
  id: string
  code: string
  name: string
  vintages: VintageMetrics[]
}

export interface VintageReport {
  missing: string[]
  filter: {
    parcel_id: string | null
    wine_id: string | null
    vintage_from: number | null
    vintage_to: number | null
  }
  by_parcel: Array<VintageGroup & { parcel_id: string; area_ha: number | null }>
  by_wine: Array<VintageGroup & { wine_id: string }>
}

export interface NamedRef {
  id: string
  name: string
  code?: string
  wine_id?: string | null
}

export interface AdditionDraft {
  key: string
  product_id: string | null
  product_name: string
  dose: string
  dose_unit: string
  purpose: string
}

export interface BlendDraft {
  key: string
  lot_id: string
  lot_code: string
  percent: string
  volume_ml: number
  mass_g: number
}

export interface StepDraft {
  key: string
  op_type: string
  offset_days: string
  duration_hours: string
  temperature_c: string
  additions: AdditionDraft[]
  blends: BlendDraft[]
  parameters: Record<string, unknown>
  source_operation_id: string | null
}

export const OP_ORDER = [
  'reception',
  'bulk_reception',
  'crushing_pressing',
  'fermentation_end',
  'racking',
  'blend',
  'filtration',
  'addition',
  'stabilization',
  'cleaning',
  'sampling',
  'bottling',
  'labeling',
  'loss',
  'destruction',
] as const

export const DOSE_UNITS = ['g/hl', 'mg/l', 'g/l'] as const

const OPS: Record<string, string> = {
  reception: copy.lote.ops.reception,
  bulk_reception: copy.lote.ops.bulk_reception,
  crushing_pressing: copy.lote.ops.crushing_pressing,
  fermentation_end: copy.lote.ops.fermentation_end,
  racking: copy.lote.ops.racking,
  blend: copy.lote.ops.blend,
  filtration: copy.lote.ops.filtration,
  addition: copy.lote.ops.addition,
  stabilization: copy.lote.ops.stabilization,
  cleaning: copy.lote.ops.cleaning,
  sampling: copy.lote.ops.sampling,
  bottling: copy.lote.ops.bottling,
  labeling: copy.lote.ops.labeling,
  loss: copy.lote.ops.loss,
  destruction: copy.lote.ops.destruction,
}

const FIELDS: Record<string, string> = {
  op_type: copy.lote.fields.op_type,
  temperature_c: copy.lote.fields.temperature_c,
  duration_hours: copy.lote.fields.duration_hours,
  blend_proportions: copy.lote.fields.blend_proportions,
  additions: copy.lote.fields.additions,
  destination_kind: copy.lote.fields.destination_kind,
  vinification: copy.lote.fields.vinification,
  destemmed: copy.lote.fields.destemmed,
  inoculation_kind: copy.lote.fields.inoculation_kind,
  aging_method: copy.lote.fields.aging_method,
  aging_duration_days: copy.lote.fields.aging_duration_days,
  single_plot: copy.lote.fields.single_plot,
  label_number: copy.lote.fields.label_number,
  no_intervention: copy.lote.fields.no_intervention,
  practices_applied: copy.lote.fields.practices_applied,
  practices_not_applied: copy.lote.fields.practices_not_applied,
}

const AGING: Record<string, string> = {
  deposito: copy.lote.agingDeposit,
  barrica: copy.lote.agingBarrel,
  damajuana_intemperie: copy.lote.agingDemijohn,
  sin_crianza: copy.lote.agingNone,
}

const VINIFICATION: Record<string, string> = {
  blanco: copy.lote.blanco,
  tinto: copy.lote.tinto,
  rosado: copy.lote.rosado,
  orange: copy.lote.orange,
  otro: copy.lote.otro,
}

const DESTINATION: Record<string, string> = {
  reference: copy.lote.reference,
  new_collection: copy.lote.newCollection,
  pending: copy.lote.pending,
}

const INOCULATION: Record<string, string> = {
  espontanea: copy.lote.spontaneous,
  comercial: copy.lote.commercial,
}

const DEVIATION: Record<string, string> = {
  missing_step: copy.lote.missingStep,
  extra_operation: copy.lote.extraOperation,
  type_mismatch: copy.lote.typeMismatch,
  parameter: copy.lote.parameter,
  design: copy.lote.designDiff,
}

const DOSE_LABEL: Record<string, string> = {
  'g/hl': 'g/hL',
  'mg/l': 'mg/L',
  'g/l': 'g/L',
}

let keySeq = 0

export function nextKey(): string {
  keySeq += 1
  return `k${keySeq}`
}

export function emptyDesign(): DesignInput {
  return {
    destination_kind: 'pending',
    wine_id: null,
    product_id: null,
    collection_name: null,
    vinification: 'tinto',
    destemmed: true,
    inoculation_kind: 'espontanea',
    yeast_product_id: null,
    yeast_lot_code: null,
    yeast_name: null,
    practices_applied: [],
    practices_not_applied: [],
    no_intervention: false,
    aging_method: 'sin_crianza',
    aging_duration_days: null,
    single_plot: false,
    parcel_id: null,
    label_number: null,
    notes: null,
  }
}

export function cloneDesign(input: DesignInput): DesignInput {
  return {
    ...input,
    practices_applied: [...input.practices_applied],
    practices_not_applied: [...input.practices_not_applied],
  }
}

export function opName(type: string): string {
  return OPS[type] ?? type
}

export function fieldName(field: string | null): string {
  if (!field) return '—'
  return FIELDS[field] ?? field
}

export function deviationKind(kind: string): string {
  return DEVIATION[kind] ?? kind
}

export function agingName(value: string): string {
  return AGING[value] ?? value
}

export function vinificationName(value: string): string {
  return VINIFICATION[value] ?? value
}

export function destinationName(value: string): string {
  return DESTINATION[value] ?? value
}

export function inoculationName(value: string): string {
  return INOCULATION[value] ?? value
}

export function doseUnitLabel(unit: string): string {
  return DOSE_LABEL[unit] ?? unit
}

export function statusName(status: string): string {
  if (status === 'published') return copy.lote.published
  if (status === 'draft') return copy.lote.draft
  return status
}

export function formatQty(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const [whole, frac] = value.toFixed(digits).split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (!frac || /^0+$/.test(frac)) return grouped
  return `${grouped},${frac.replace(/0+$/, '')}`
}

export function formatCivil(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function doseLabel(item: RecipeAddition): string {
  const name = item.product_name || copy.lote.additions
  if (item.dose_g_per_hl != null) return `${name} · ${formatQty(item.dose_g_per_hl)} g/hL`
  return `${name} · ${formatQty(item.dose)} ${doseUnitLabel(item.dose_unit)}`
}

export function blendLabel(item: BlendShare): string {
  return `${item.lot_code || item.lot_id} ${formatPercent(item.percent)}`
}

export function stepMeta(step: {
  offset_days: number
  duration_hours: number | null
  temperature_c: number | null
  target_date?: string
}): string {
  const parts = [fill('{days} d', { days: String(step.offset_days) })]
  if (step.target_date) parts.push(formatCivil(step.target_date))
  if (step.duration_hours != null) parts.push(`${formatQty(step.duration_hours)} ${copy.lote.hours}`)
  if (step.temperature_c != null) parts.push(`${formatQty(step.temperature_c)} °C`)
  return parts.join(' · ')
}

export function valueLabel(field: string | null, value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? copy.lote.yes : copy.lote.no
  if (typeof value === 'number') return formatQty(value, 2)
  if (typeof value === 'string') {
    if (field === 'aging_method') return agingName(value)
    if (field === 'vinification') return vinificationName(value)
    if (field === 'destination_kind') return destinationName(value)
    if (field === 'inoculation_kind') return inoculationName(value)
    if (field === 'op_type' || field == null) return opName(value)
    return value
  }
  return String(value)
}

export function setPractice(input: DesignInput, catalog: PracticeInfo[], code: string, side: PracticeSide): DesignInput {
  const intervention = new Set(catalog.filter((item) => item.intervention).map((item) => item.code))
  let applied = input.practices_applied.filter((item) => item !== code)
  let notApplied = input.practices_not_applied.filter((item) => item !== code)
  if (side === 'applied') applied = [...applied, code]
  if (side === 'not') notApplied = [...notApplied, code]
  if (code === 'sin_intervencion' && side === 'applied') {
    const moved = applied.filter((item) => intervention.has(item))
    applied = applied.filter((item) => !intervention.has(item))
    notApplied = [...new Set([...notApplied, ...moved])]
  } else if (side === 'applied' && intervention.has(code)) {
    applied = applied.filter((item) => item !== 'sin_intervencion')
  }
  return {
    ...input,
    practices_applied: applied,
    practices_not_applied: notApplied,
    no_intervention: applied.includes('sin_intervencion'),
  }
}

export function singlePlotMessage(allowed: boolean, parcels: ParcelRef[], single: boolean): string | null {
  if (!single || allowed) return null
  return parcels.length > 1 ? copy.lote.singleMany : copy.lote.singleNone
}

function blankToNull(value: string | null): string | null {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}

export function normalizeDesign(input: DesignInput): DesignInput {
  const commercial = input.inoculation_kind === 'comercial'
  const single = input.single_plot
  const reference = input.destination_kind === 'reference'
  const collection = input.destination_kind === 'new_collection'
  return {
    ...input,
    wine_id: reference ? input.wine_id : null,
    product_id: reference ? input.product_id : null,
    collection_name: collection ? blankToNull(input.collection_name) : null,
    yeast_product_id: commercial ? input.yeast_product_id : null,
    yeast_lot_code: commercial ? blankToNull(input.yeast_lot_code) : null,
    yeast_name: commercial ? blankToNull(input.yeast_name) : null,
    aging_duration_days: input.aging_method === 'sin_crianza' ? null : input.aging_duration_days,
    parcel_id: single ? input.parcel_id : null,
    label_number: single ? 1 : input.label_number,
    notes: blankToNull(input.notes),
    no_intervention: input.practices_applied.includes('sin_intervencion'),
  }
}

export function validateDesign(input: DesignInput, view: Pick<DesignView, 'origin_parcels' | 'single_plot_allowed'>): Record<string, string> {
  const errors: Record<string, string> = {}
  const next = normalizeDesign(input)
  if (next.destination_kind === 'reference' && !next.wine_id && !next.product_id) errors.wine_id = copy.lote.referenceRequired
  if (next.destination_kind === 'new_collection' && (!next.collection_name || next.collection_name.length < 2)) {
    errors.collection_name = copy.lote.nameRequired
  }
  if (next.inoculation_kind === 'comercial') {
    if (!next.yeast_lot_code) errors.yeast_lot_code = copy.lote.yeastLotRequired
    if (!next.yeast_product_id && !next.yeast_name) errors.yeast_name = copy.lote.yeastRequired
  }
  if (next.single_plot) {
    const message = singlePlotMessage(view.single_plot_allowed, view.origin_parcels, true)
    if (message) errors.parcel_id = message
    else if (!next.parcel_id) errors.parcel_id = copy.lote.parcelRequired
    else if (!view.origin_parcels.some((parcel) => parcel.id === next.parcel_id)) errors.parcel_id = copy.lote.singleWrong
  } else if (next.label_number === 1) {
    errors.label_number = copy.lote.labelReserved
  }
  return errors
}

export function draftsFromSteps(steps: RecipeStep[]): StepDraft[] {
  return steps.map((step) => ({
    key: nextKey(),
    op_type: step.op_type,
    offset_days: String(step.offset_days),
    duration_hours: step.duration_hours == null ? '' : String(step.duration_hours),
    temperature_c: step.temperature_c == null ? '' : String(step.temperature_c),
    additions: step.additions.map((item) => ({
      key: nextKey(),
      product_id: item.product_id,
      product_name: item.product_name ?? '',
      dose: String(item.dose),
      dose_unit: DOSE_UNITS.includes(item.dose_unit as (typeof DOSE_UNITS)[number]) ? item.dose_unit : 'g/hl',
      purpose: item.purpose ?? '',
    })),
    blends: step.blend_proportions.map((item) => ({
      key: nextKey(),
      lot_id: item.lot_id,
      lot_code: item.lot_code,
      percent: String(item.percent),
      volume_ml: item.volume_ml,
      mass_g: item.mass_g,
    })),
    parameters: { ...step.parameters },
    source_operation_id: step.source_operation_id,
  }))
}

export function emptyStep(): StepDraft {
  return {
    key: nextKey(),
    op_type: 'racking',
    offset_days: '0',
    duration_hours: '',
    temperature_c: '',
    additions: [],
    blends: [],
    parameters: {},
    source_operation_id: null,
  }
}

export function emptyAddition(): AdditionDraft {
  return { key: nextKey(), product_id: null, product_name: '', dose: '', dose_unit: 'g/hl', purpose: '' }
}

export function emptyBlend(): BlendDraft {
  return { key: nextKey(), lot_id: '', lot_code: '', percent: '', volume_ml: 0, mass_g: 0 }
}

function optionalNumber(raw: string, min: number, max: number): number | null | 'invalid' {
  const text = raw.trim()
  if (text === '') return null
  const value = Number(text.replace(',', '.'))
  if (!Number.isFinite(value) || value < min || value > max) return 'invalid'
  return value
}

export function stepsFromDrafts(drafts: StepDraft[]): { steps: RecipeStep[] } | { error: string } {
  const steps: RecipeStep[] = []
  for (const [index, draft] of drafts.entries()) {
    const offset = Number(draft.offset_days)
    if (!Number.isInteger(offset) || offset < 0 || offset > 3650) return { error: copy.lote.offsetInvalid }
    const duration = optionalNumber(draft.duration_hours, 0, 100_000)
    if (duration === 'invalid') return { error: copy.lote.durationInvalid }
    const temperature = optionalNumber(draft.temperature_c, -10, 50)
    if (temperature === 'invalid') return { error: copy.lote.temperatureInvalid }
    const additions: RecipeAddition[] = []
    for (const item of draft.additions) {
      const name = item.product_name.trim()
      const doseText = item.dose.trim()
      if (name === '' && doseText === '' && item.purpose.trim() === '') continue
      const dose = Number(doseText.replace(',', '.'))
      if (!Number.isFinite(dose) || dose <= 0) return { error: copy.lote.doseInvalid }
      if (!DOSE_UNITS.includes(item.dose_unit as (typeof DOSE_UNITS)[number])) return { error: copy.lote.doseInvalid }
      additions.push({
        product_id: item.product_id,
        product_name: name || null,
        quantity: null,
        quantity_unit: null,
        dose,
        dose_unit: item.dose_unit,
        dose_g_per_hl: null,
        purpose: item.purpose.trim().slice(0, 40) || null,
      })
    }
    const blends: BlendShare[] = []
    for (const item of draft.blends) {
      const percentText = item.percent.trim()
      if (item.lot_id === '' && percentText === '') continue
      if (!item.lot_id) return { error: copy.lote.blendLot }
      const percent = Number(percentText.replace(',', '.'))
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: copy.lote.percentInvalid }
      blends.push({
        lot_id: item.lot_id,
        lot_code: item.lot_code,
        volume_ml: item.volume_ml,
        mass_g: item.mass_g,
        percent,
      })
    }
    steps.push({
      position: index + 1,
      op_type: draft.op_type,
      offset_days: offset,
      duration_hours: duration,
      temperature_c: temperature,
      additions,
      blend_proportions: draft.op_type === 'blend' ? blends : [],
      parameters: draft.parameters,
      source_operation_id: draft.source_operation_id,
    })
  }
  return { steps }
}

export function designOf(version: RecipeVersion | undefined): DesignInput | null {
  const record = version?.design
  if (!record || record.present !== true) return null
  const base = emptyDesign()
  return {
    ...base,
    destination_kind: (record.destination_kind as DestinationKind) || base.destination_kind,
    wine_id: typeof record.wine_id === 'string' ? record.wine_id : null,
    product_id: typeof record.product_id === 'string' ? record.product_id : null,
    collection_name: typeof record.collection_name === 'string' ? record.collection_name : null,
    vinification: (record.vinification as Vinification) || base.vinification,
    destemmed: Boolean(record.destemmed),
    inoculation_kind: (record.inoculation_kind as InoculationKind) || base.inoculation_kind,
    yeast_name: typeof record.yeast_name === 'string' ? record.yeast_name : null,
    yeast_lot_code: typeof record.yeast_lot_code === 'string' ? record.yeast_lot_code : null,
    no_intervention: Boolean(record.no_intervention),
    aging_method: (record.aging_method as AgingMethod) || base.aging_method,
    aging_duration_days: typeof record.aging_duration_days === 'number' ? record.aging_duration_days : null,
    single_plot: Boolean(record.single_plot),
    label_number: typeof record.label_number === 'number' ? record.label_number : null,
    practices_applied: Array.isArray(record.practices_applied) ? record.practices_applied.filter((item): item is string => typeof item === 'string') : [],
    practices_not_applied: Array.isArray(record.practices_not_applied) ? record.practices_not_applied.filter((item): item is string => typeof item === 'string') : [],
    notes: typeof record.notes === 'string' ? record.notes : null,
  }
}

export function destinationText(input: DesignInput, wines: NamedRef[], products: NamedRef[]): string {
  if (input.destination_kind === 'new_collection') return input.collection_name || copy.lote.newCollection
  if (input.destination_kind === 'pending') return copy.lote.pending
  const wine = wines.find((item) => item.id === input.wine_id)
  const product = products.find((item) => item.id === input.product_id)
  return [wine?.name, product?.name].filter(Boolean).join(' · ') || copy.lote.reference
}

export function practiceName(catalog: PracticeInfo[], code: string): string {
  return catalog.find((item) => item.code === code)?.name_es ?? code
}

export function sanitaryName(value: string | null): string {
  if (value === 'good') return copy.lote.sanitaryGood
  if (value === 'fair') return copy.lote.sanitaryFair
  if (value === 'poor') return copy.lote.sanitaryPoor
  return value || '—'
}

export function lastRipeness(metrics: VintageMetrics) {
  return metrics.ripeness[metrics.ripeness.length - 1]
}

export function isOwner(roles: { role: string }[]): boolean {
  return roles.some((role) => role.role === 'owner')
}

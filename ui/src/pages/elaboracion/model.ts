import { copy } from '@/i18n'

export function phaseLabel(phase: string): string {
  if (phase in copy.elaboracion.phaseName) {
    return copy.elaboracion.phaseName[phase as keyof typeof copy.elaboracion.phaseName]
  }
  return phase
}

export type CurvePoint = {
  at: string
  density: string | null
  temperature_c: string | null
  residual_sugar_gl: string | null
}

export type PhaseName =
  | 'cold_soak'
  | 'aqueous_maceration'
  | 'skin_maceration'
  | 'post_fermentation_maceration'
  | 'alcoholic_fermentation'
  | 'malolactic_fermentation'
  | 'natural_cold_stabilisation'
  | 'forced_cold_stabilisation'
  | 'protein_stabilisation'
  | 'aging'

export type PhaseStatus = 'in_progress' | 'completed' | 'stopped'

export type LotPhase = {
  id: string
  lot_id: string
  vessel_id: string | null
  phase: PhaseName | string
  status: PhaseStatus | string
  started_at: string | null
  ended_at: string | null
  inoculation: 'spontaneous' | 'commercial' | null
  inoculum_product_id: string | null
  target_temp_c: string | null
  aging_method: 'tank' | 'barrel' | 'demijohn_outdoor' | null
  end_evidence: 'sensory' | 'analysis' | 'both' | null
  end_analysis_id: string | null
  observations: string | null
}

export type AnalysisResult = {
  parameter: string
  value: string
  unit: string
  name_es?: string
  out_of_spec?: boolean
}

export type AnalysisMarks = {
  volatile?: boolean
  volatile_overlap?: boolean
  dry?: boolean
  malolactic_finished?: boolean
}

export type Analysis = {
  id: string
  lot_id: string | null
  vessel_id: string | null
  kind: string
  sampled_at: string
  result_at?: string | null
  lab: string
  lab_name: string | null
  lab_contact_id?: string | null
  sample_operation_id?: string | null
  out_of_spec?: boolean
  results?: AnalysisResult[]
  marks?: AnalysisMarks
  flags?: { parameter_code?: string; category?: string }[]
}

export type Evolution = {
  lot_id: string
  analyses: Analysis[]
  readings: CurvePoint[]
  phases: Array<Pick<LotPhase, 'id' | 'phase' | 'status' | 'started_at' | 'ended_at' | 'inoculation' | 'target_temp_c' | 'aging_method' | 'end_evidence' | 'observations'>>
}

export type Page<T> = { items: T[]; next_cursor: string | null; total?: number }

export const PHASES: PhaseName[] = [
  'cold_soak',
  'aqueous_maceration',
  'skin_maceration',
  'post_fermentation_maceration',
  'alcoholic_fermentation',
  'malolactic_fermentation',
  'natural_cold_stabilisation',
  'forced_cold_stabilisation',
  'protein_stabilisation',
  'aging',
]

export const FERMENTATIONS = new Set<PhaseName>(['alcoholic_fermentation', 'malolactic_fermentation'])
export const COLD_PHASES = new Set<PhaseName>(['natural_cold_stabilisation', 'forced_cold_stabilisation'])

export const PARAMETERS: { code: string; unit: string; scale: number }[] = [
  { code: 'abv', unit: '% vol', scale: 2 },
  { code: 'total_acidity', unit: 'g/L', scale: 2 },
  { code: 'volatile_acidity', unit: 'g/L', scale: 2 },
  { code: 'ph', unit: 'pH', scale: 2 },
  { code: 'free_so2', unit: 'mg/L', scale: 1 },
  { code: 'total_so2', unit: 'mg/L', scale: 1 },
  { code: 'glucose_fructose', unit: 'g/L', scale: 2 },
  { code: 'malic_acid', unit: 'g/L', scale: 2 },
  { code: 'dry_extract', unit: 'g/L', scale: 2 },
  { code: 'total_polyphenol_index', unit: 'IPT', scale: 1 },
  { code: 'polymerization_index', unit: '%', scale: 1 },
  { code: 'turbidity', unit: 'NTU', scale: 1 },
]

export const ANALYSIS_KINDS = ['control', 'fml_pack', 'pre_bottling', 'grape', 'must', 'other'] as const

export function localInputNow(date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toInstant(local: string): string {
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

/** Acepta coma decimal. Devuelve null si está vacío o no cabe en la escala. */
export function decimalOrNull(text: string, scale: number): string | null {
  const cleaned = text.trim().replace(/\s/g, '')
  if (!cleaned) return null
  const normalised = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null
  const fraction = normalised.split('.')[1] ?? ''
  if (fraction.length > scale) return null
  return normalised
}

export function showDecimal(value: string | number | null | undefined, digits: number): string {
  if (value == null || value === '') return '—'
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toFixed(digits).replace('.', ',')
}

import { api, apiText } from '@/lib/api'

export type GrapeVariety = {
  id: string
  code: string
  name: string
  color: string
  is_active: boolean
}

export type ParcelVariety = {
  id: string
  variety: string
  color: string
  area_ha: string
  planting_year: number | null
  rootstock: string | null
}

export type Parcel = {
  id: string
  code: string
  name: string
  ownership: string
  supplier_contact_id: string | null
  sigpac: string
  area_ha: string
  vineyard_register_ref: string | null
  organic_status: string
  is_organic: boolean
  organic_since: string | null
  conversion_started_on: string | null
  appellation: string | null
  altitude_m: number | null
  soil: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  varieties: ParcelVariety[]
}

export type ParcelSummary = {
  total_area_ha: string
  parcel_count: number
  simplified_notebook_max_ha: number
  simplified_notebook_confirmed: boolean
  question: string
  within_threshold: boolean
}

export type FieldTask = {
  id: string
  parcel_code: string
  done_on: string | null
  kind: string
  operator_name: string | null
  hours: string | null
  notes: string | null
  source: string
  created_at: string
}

export type MaturityCheck = {
  id: string
  parcel_code: string
  checked_at: string
  author: string
  sensory_notes: string | null
  estimated_days_to_harvest: number | null
  sanitary_status: string | null
  probable_abv: string
  total_acidity: string
  sugar_gl: string | null
  ph: string | null
  seed_color: string | null
  seed_crunch: boolean | null
  skin_astringency: number | null
  skin_color_release: number | null
  pulp_sweetness: number | null
  pulp_acidity: number | null
  phenolic_maturity: number | null
  photo_attachment_id: string | null
  source: string
  created_at: string
}

export type Harvest = {
  id: string
  parcel_code: string
  vintage: number
  harvested_on: string | null
  variety: string
  estimated_kg: string | null
  crew_size: number | null
  notes: string | null
  reception_operation_id: string | null
  closed: boolean
  created_at: string
}

export type HarvestSummaryRow = {
  parcel_code: string | null
  grower_contact_id: string | null
  variety_code: string
  area_ha: string | null
  net_kg: string
  yield_kg_ha: string | null
  organic_kg: string
  conventional_kg: string
}

export type HarvestSummary = {
  campaign: number
  rows: HarvestSummaryRow[]
  totals: { net_kg: string; organic_kg: string; conventional_kg: string }
}

export type CrewDay = {
  day: string | null
  people: number
  notes: string | null
}

export type HarvestPlan = {
  id: string
  parcel_code: string
  vintage: number
  ripeness_ready_on: string | null
  weather_risk: string | null
  weather_note: string | null
  crew_needed: number | null
  earliest_on: string | null
  latest_on: string | null
  suggested_on: string | null
  rationale: string | null
  status: string
}

export type GrapeIntake = {
  container: string
  container_count: number | null
  container_nominal_kg: string | null
  weighing: string
  sanitary_state: string
  botrytis_pct: string | null
  storm_damage: boolean
  overripe: boolean
  raisined: boolean
  microbial_notes: string | null
  decision: string
  grape_temperature_c: string | null
}

export type ReceptionTicket = {
  weighed_at: string
  fiscal_date: string
  variety_code: string
  gross_kg: string
  tare_kg: string
  net_kg: string
  net_g: number
  probable_abv: string
  sanitary_status: string
  is_organic: boolean
  organic_label_checked: boolean
  has_do: boolean
  appellation: string | null
  accompanying_doc: string | null
  destination_vessel_id: string
  lot_code: string
  vintage: number
  source:
    | { kind: 'parcels'; lines: { parcel_id: string; parcel_code: string; kg: string; grams: number }[] }
    | { kind: 'grower'; contact_id: string }
  lot_id: string | null
  silicie_entry_id: string | null
  intake: GrapeIntake
}

export type SilicieEntry = {
  id: string | null
  entry_kind: string
  mass_g: number
  unidad: string
  regimen_fiscal: string
  tipo_justificante: string
  referencia: string
  movement_date: string
  numero_justificante: string | null
  numero_referencia_interno: string | null
  status: string | null
}

export type Reception = {
  id: string
  number: string | null
  status: string
  legal_entity_id: string
  occurred_at: string
  performed_by: string
  rectifies_operation_id: string | null
  reason: string | null
  ticket: ReceptionTicket | null
  silicie: SilicieEntry | null
}

export type ReceptionPreview = {
  stock_moves: { move_type: string; product_state: string | null; mass_g: number; volume_ml: number }[]
  lot: { id?: string; code?: string } | null
  silicie: SilicieEntry | null
}

export type NotebookProduct = {
  id: string
  commercial_name: string
  registration_number: string | null
  active_substances: string
  is_organic_approved: boolean
  safety_interval_days: number
  max_dose: string
  max_dose_unit: string
  product_kind: string
  nutrient_npk: string | null
  notes: string | null
  is_active: boolean
}

export type NotebookWarning = {
  code: string
  message: string
  parcel_code: string
  event_on: string
  source: string
  safety_interval_days: number
  interval_ends_on: string
}

export type Treatment = {
  id: string
  parcel_id: string
  parcel_code: string
  sigpac: string
  parcel_area_ha: string
  parcel_is_organic: boolean
  applied_on: string
  campaign: number | null
  kind: string
  crop: string
  variety: string | null
  operator_name: string
  applicator_ropo: string | null
  advisor_name: string | null
  product_id: string | null
  product_name: string
  product_registration: string | null
  is_organic_approved: boolean
  dose: string
  dose_unit: string
  max_dose: string | null
  treated_area_ha: string
  method: string
  target: string | null
  equipment_roma: string | null
  safety_interval_days: number | null
  efficacy: string | null
  cue_recorded_at: string | null
  cue: { required: boolean; status: string; warn_on: string | null; due_on: string | null }
  warnings: NotebookWarning[]
  notes: string | null
}

export type CueItem = {
  treatment_id: string
  parcel_code: string
  applied_on: string
  warn_on: string | null
  due_on: string | null
  status: string
}

type Page<T> = { items: T[]; total?: number }

export function listVarieties(signal?: AbortSignal) {
  return api<Page<GrapeVariety>>('/v1/grape-varieties', { signal })
}

export function listParcels(signal?: AbortSignal) {
  return api<Page<Parcel>>('/v1/parcels', { signal })
}

export function parcelSummary(signal?: AbortSignal) {
  return api<ParcelSummary>('/v1/parcels/summary', { signal })
}

export function getParcel(code: string, signal?: AbortSignal) {
  return api<Parcel>(`/v1/parcels/${encodeURIComponent(code)}`, { signal })
}

export function createParcel(body: Record<string, unknown>) {
  return api<Parcel>('/v1/parcels', { method: 'POST', body: JSON.stringify(body) })
}

export function updateParcel(code: string, body: Record<string, unknown>) {
  return api<Parcel>(`/v1/parcels/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function listFieldTasks(parcel: string | null, signal?: AbortSignal) {
  const query = parcel ? `?parcel_code=${encodeURIComponent(parcel)}` : ''
  return api<Page<FieldTask>>(`/v1/field-tasks${query}`, { signal })
}

export function createFieldTask(body: Record<string, unknown>) {
  return api<FieldTask>('/v1/field-tasks', { method: 'POST', body: JSON.stringify(body) })
}

export function listMaturity(parcel: string | null, signal?: AbortSignal) {
  const query = parcel ? `?parcel_code=${encodeURIComponent(parcel)}` : ''
  return api<Page<MaturityCheck>>(`/v1/maturity-checks${query}`, { signal })
}

export function createMaturity(body: Record<string, unknown>) {
  return api<MaturityCheck>('/v1/maturity-checks', { method: 'POST', body: JSON.stringify(body) })
}

export function uploadParcelPhoto(parcelId: string, file: File) {
  const body = new FormData()
  body.set('file', file)
  body.set('table', 'vineyard.parcel')
  body.set('row_id', parcelId)
  body.set('role', 'photo')
  return api<{ id: string }>('/v1/attachments', { method: 'POST', body })
}

export function listHarvests(campaign: string, signal?: AbortSignal) {
  const query = campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''
  return api<Page<Harvest>>(`/v1/harvests${query}`, { signal })
}

export function createHarvest(body: Record<string, unknown>) {
  return api<Harvest>('/v1/harvests', { method: 'POST', body: JSON.stringify(body) })
}

export function closeHarvest(id: string, receptionId: string) {
  return api<Harvest>(`/v1/harvests/${id}/close`, {
    method: 'POST',
    body: JSON.stringify({ reception_operation_id: receptionId }),
  })
}

export function harvestSummary(campaign: string, signal?: AbortSignal) {
  return api<HarvestSummary>(`/v1/harvests/summary?campaign=${encodeURIComponent(campaign)}`, { signal })
}

export function listCrew(from: string, to: string, signal?: AbortSignal) {
  return api<Page<CrewDay>>(`/v1/crew-availability?from=${from}&to=${to}`, { signal })
}

export function putCrew(day: string, body: { people: number; notes: string | null }) {
  return api<CrewDay>(`/v1/crew-availability/${day}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteCrew(day: string) {
  return api<{ day: string; deleted: boolean }>(`/v1/crew-availability/${day}`, { method: 'DELETE' })
}

export function listPlans(campaign: string, signal?: AbortSignal) {
  const query = campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''
  return api<Page<HarvestPlan>>(`/v1/harvest-plans${query}`, { signal })
}

export function createPlan(body: Record<string, unknown>) {
  return api<HarvestPlan>('/v1/harvest-plans', { method: 'POST', body: JSON.stringify(body) })
}

export function suggestPlan(id: string) {
  return api<HarvestPlan>(`/v1/harvest-plans/${id}/suggest`, { method: 'POST' })
}

export function confirmPlan(id: string) {
  return api<HarvestPlan>(`/v1/harvest-plans/${id}/confirm`, { method: 'POST' })
}

export function cancelPlan(id: string) {
  return api<HarvestPlan>(`/v1/harvest-plans/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
}

export function listReceptions(signal?: AbortSignal) {
  return api<Page<Reception>>('/v1/grape-receptions', { signal })
}

export function createReception(body: Record<string, unknown>) {
  return api<Reception>('/v1/grape-receptions', { method: 'POST', body: JSON.stringify(body) })
}

export function updateReception(id: string, body: Record<string, unknown>) {
  return api<Reception>(`/v1/grape-receptions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function previewReception(id: string) {
  return api<ReceptionPreview>(`/v1/grape-receptions/${id}/preview`, { method: 'POST' })
}

export function confirmReception(id: string) {
  return api<Reception>(`/v1/grape-receptions/${id}/confirm`, { method: 'POST' })
}

export function rectifyReception(id: string, reason: string) {
  return api<Reception>(`/v1/grape-receptions/${id}/rectify`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function listProducts(signal?: AbortSignal) {
  return api<Page<NotebookProduct>>('/v1/vineyard-notebook/products', { signal })
}

export function createProduct(body: Record<string, unknown>) {
  return api<NotebookProduct>('/v1/vineyard-notebook/products', { method: 'POST', body: JSON.stringify(body) })
}

export function listTreatments(campaign: string, signal?: AbortSignal) {
  const query = campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''
  return api<{ items: Treatment[] }>(`/v1/treatments${query}`, { signal })
}

export function createTreatments(body: Record<string, unknown>) {
  return api<{ treatments: Treatment[] }>('/v1/treatments', { method: 'POST', body: JSON.stringify(body) })
}

export function patchTreatment(id: string, body: Record<string, unknown>) {
  return api<Treatment>(`/v1/treatments/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function listCue(signal?: AbortSignal) {
  return api<{ as_of: string; items: CueItem[] }>('/v1/vineyard-notebook/cue-pending', { signal })
}

export async function downloadNotebook(campaign: string) {
  const text = await apiText(`/v1/treatments/export?campaign=${encodeURIComponent(campaign)}`)
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cuaderno-${campaign}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

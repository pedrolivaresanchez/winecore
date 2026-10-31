import { ApiError, api, apiText } from '@/lib/api'
import { madridInputToIso } from '@/pages/existencias/time'

export const CODE_RE = /^[A-Z0-9-]{2,20}$/

export const DOSE_UNITS = ['g/hl', 'mg/l', 'g/l', 'pct', 'ml/l', 'ppm'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

export const PURPOSES = ['cleaning', 'disinfection', 'both'] as const
export type Purpose = (typeof PURPOSES)[number]

export const EQUIPMENT_KINDS = ['bottler', 'filter', 'filter_housing', 'pump', 'press', 'destemmer', 'other'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

export const EQUIPMENT_STATUSES = ['in_service', 'out_of_service', 'retired'] as const
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number]

export const CAPACITY_UNITS = ['ud', 'l', 'hl', 'ml', 'plates'] as const
export type CapacityUnit = (typeof CAPACITY_UNITS)[number]

export const CONSUMABLE_KINDS = ['filter_plate', 'cleaning_product', 'other'] as const
export type ConsumableKind = (typeof CONSUMABLE_KINDS)[number]

export const PLATE_GRADES = ['V00', 'V07', 'V13'] as const
export type PlateGrade = (typeof PLATE_GRADES)[number]

export const CLOSURE_TYPES = ['natural_cork', 'agglomerated_cork'] as const
export type ClosureType = (typeof CLOSURE_TYPES)[number]

export const SEAL_TYPES = ['capsule', 'wax_seal'] as const
export type SealType = (typeof SEAL_TYPES)[number]

export const EQUIPMENT_ROLES = ['used', 'cleaned'] as const
export type EquipmentRole = (typeof EQUIPMENT_ROLES)[number]

export const CLASS_IDS = [
  'tank_storage',
  'tank_fermenter',
  'barrel',
  'demijohn',
  'ibc',
  'bottler',
  'filter',
  'filter_housing',
  'pump',
  'press',
  'destemmer',
  'other',
] as const

export type Procedure = {
  id: string
  code: string
  name: string
  purpose: Purpose
  product_name: string
  product_id: string | null
  active_substance: string
  dose_min: string
  dose_max: string
  dose_unit: DoseUnit
  concentration: string | null
  contact_time_min: number
  rinse_required: boolean
  applicable_classes: string[]
  effluent_destination: string
  effluent_note: string
  is_active: boolean
}

export type Equipment = {
  id: string
  code: string
  name: string
  kind: EquipmentKind
  capacity: string | null
  capacity_unit: string | null
  maintenance_notes: string | null
  status: EquipmentStatus | string
}

export type Consumable = {
  product_id: string
  consumable_kind: ConsumableKind | string
  sku: string
  name: string
  unit: string
  created_at: string
}

export type CatalogProduct = {
  id: string
  sku: string
  name: string
  kind: string
  unit: string
  is_stock_tracked?: boolean
  requires_lot?: boolean
  is_active?: boolean
}

export type ContactHit = { id: string; legal_name: string }
export type Place = { id: string; code: string; name: string }
export type Page<T> = { items: T[]; next_cursor: string | null; total?: number }

export type OperationHeader = {
  id: string
  legal_entity_id: string
  number: string | null
  op_type: string
  occurred_at: string
  status: string
  performed_by: string
}

export type AppccCleaning = {
  record_kind: string
  occurred_on: string
  operator: string
  procedure_code: string
  procedure_name: string
  purpose: string
  product_name: string
  actual_dose: string
  actual_dose_unit: string
  actual_contact_time_min: number
  rinsed: boolean
  notes: string | null
  effluent_destination: string
  effluent_note: string
  operation_number: string | null
  vessel_code: string | null
  equipment_code: string | null
}

export type AppccCheck = {
  record_kind: string
  occurred_on: string
  operation_number: string | null
  operator: string
  bottles_disinfected: boolean
  disinfection_procedure_name: string | null
  fill_rejects: number
  closure_rejects: number
  label_rejects: number
  closure_type: string
  closure_label: string
  seal_type: string
  seal_label: string
  equipment_code: string
  equipment_name: string
  notes: string | null
}

export type AppccMaintenance = {
  occurred_on: string
  operator: string
  notes: string
  next_due_on: string | null
  equipment_code: string
  equipment_name: string
  equipment_kind: string
}

export type AppccFiltration = {
  occurred_on: string
  operator: string
  plate_grade: string
  plate_grade_label: string
  plate_format: string
  plate_count: number
  equipment_code: string | null
  supplier_name: string | null
  notes: string | null
}

export type AppccReport = {
  title: string
  period: { from: string; to: string }
  generated_at: string
  environmental_note: string
  cleanings: AppccCleaning[]
  disinfections: AppccCleaning[]
  bottling_checks: AppccCheck[]
  equipment_maintenance: AppccMaintenance[]
  filtrations: AppccFiltration[]
}

export type BottlingCheck = {
  id: string
  operation_id: string
  bottles_disinfected: boolean
  disinfection_procedure_id: string | null
  fill_rejects: number
  closure_rejects: number
  label_rejects: number
  equipment_id: string
  closure_type: ClosureType
  seal_type: SealType
  closure_label: string
  seal_label: string
  notes: string | null
  operator: string
  filled_by: string
  filled_at: string
}

export type Policy = { bottling_checklist_required: boolean }

export type StockHit = { product_id: string | null; qty_units: number; product_state: string }

export function todayMadrid(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function yearStart(): string {
  return `${todayMadrid().slice(0, 4)}-01-01`
}

/** An instant that is already in the past, so the API accepts it. */
export function pastInstant(day: string): string {
  if (day === todayMadrid()) return new Date(Date.now() - 60_000).toISOString()
  return madridInputToIso(`${day}T08:00`)
}

export function decimal3(text: string): string | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  const [whole, frac = ''] = cleaned.split('.')
  return `${whole}.${frac.padEnd(3, '0')}`
}

export function showDecimal(value: string): string {
  const [whole, frac = ''] = value.split('.')
  const trimmed = frac.replace(/0+$/, '')
  return trimmed ? `${whole},${trimmed}` : whole ?? value
}

export function wholeNumber(text: string, max = 1_000_000): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  const value = Number(text.trim())
  if (!Number.isSafeInteger(value) || value > max) return null
  return value
}

export function errorFields(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.fields) return error.fields
  return {}
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const first = error.fields ? Object.values(error.fields)[0] : undefined
    return first || error.message || fallback
  }
  return fallback
}

export function cleaningRows(report: AppccReport): AppccCleaning[] {
  const extra = report.disinfections.filter((row) => row.record_kind === 'cleaning_log' && row.purpose === 'disinfection')
  return [...report.cleanings, ...extra]
}

export function listProcedures(active: 'true' | 'false' | '' = '', signal?: AbortSignal) {
  const suffix = active ? `?active=${active}` : ''
  return api<{ items: Procedure[] }>(`/v1/hygiene/procedures${suffix}`, { signal })
}

export function getProcedure(id: string, signal?: AbortSignal) {
  return api<Procedure>(`/v1/hygiene/procedures/${id}`, { signal })
}

export function createProcedure(body: Record<string, unknown>) {
  return api<Procedure>('/v1/hygiene/procedures', { method: 'POST', body: JSON.stringify(body) })
}

export function patchProcedure(id: string, body: Record<string, unknown>) {
  return api<Procedure>(`/v1/hygiene/procedures/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function listEquipment(signal?: AbortSignal) {
  return api<{ items: Equipment[] }>('/v1/hygiene/equipment', { signal })
}

export function getEquipment(id: string, signal?: AbortSignal) {
  return api<Equipment>(`/v1/hygiene/equipment/${id}`, { signal })
}

export function createEquipment(body: Record<string, unknown>) {
  return api<Equipment>('/v1/hygiene/equipment', { method: 'POST', body: JSON.stringify(body) })
}

export function patchEquipment(id: string, body: Record<string, unknown>) {
  return api<Equipment>(`/v1/hygiene/equipment/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function addMaintenance(id: string, body: Record<string, unknown>) {
  return api<{ id: string }>(`/v1/hygiene/equipment/${id}/maintenance`, { method: 'POST', body: JSON.stringify(body) })
}

export function linkOperationEquipment(operationId: string, body: { equipment_id: string; role: EquipmentRole }) {
  return api(`/v1/hygiene/operations/${operationId}/equipment`, { method: 'POST', body: JSON.stringify(body) })
}

export function listConsumables(signal?: AbortSignal) {
  return api<{ items: Consumable[] }>('/v1/hygiene/consumables', { signal })
}

export function registerConsumable(body: { product_id: string; consumable_kind: ConsumableKind }) {
  return api<Consumable>('/v1/hygiene/consumables', { method: 'POST', body: JSON.stringify(body) })
}

export function createReceipt(body: Record<string, unknown>) {
  return api<{ id: string; balance_units: number }>('/v1/hygiene/consumable-receipts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createCleaningLog(body: Record<string, unknown>) {
  return api<{ id: string }>('/v1/hygiene/cleaning-logs', { method: 'POST', body: JSON.stringify(body) })
}

export function createFiltration(body: Record<string, unknown>) {
  return api<{ id: string }>('/v1/hygiene/filtrations', { method: 'POST', body: JSON.stringify(body) })
}

export async function getBottlingCheck(operationId: string, signal?: AbortSignal): Promise<BottlingCheck | null> {
  try {
    return await api<BottlingCheck>(`/v1/hygiene/bottling-checks/${operationId}`, { signal })
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'WC_NOT_FOUND')) return null
    throw error
  }
}

export function putBottlingCheck(operationId: string, body: Record<string, unknown>) {
  return api<BottlingCheck>(`/v1/hygiene/bottling-checks/${operationId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function getPolicy(signal?: AbortSignal) {
  return api<Policy>('/v1/hygiene/policy', { signal })
}

export function putPolicy(required: boolean) {
  return api<Policy>('/v1/hygiene/policy', {
    method: 'PUT',
    body: JSON.stringify({ bottling_checklist_required: required }),
  })
}

export function fetchAppcc(from: string, to: string, signal?: AbortSignal) {
  return api<AppccReport>(`/v1/hygiene/appcc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal })
}

export async function downloadAppcc(from: string, to: string) {
  const text = await apiText(`/v1/hygiene/appcc?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`)
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'appcc.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function listOperations(
  query: { op_type?: string; status?: string; limit?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  if (query.op_type) params.set('op_type', query.op_type)
  if (query.status) params.set('status', query.status)
  params.set('limit', String(query.limit ?? 50))
  return api<Page<OperationHeader>>(`/v1/cellar-operations?${params}`, { signal })
}

export function listProducts(signal?: AbortSignal) {
  return api<Page<CatalogProduct>>('/v1/products?kind=packaging_material&active=true&limit=100', { signal })
}

export function listSuppliers(signal?: AbortSignal) {
  return api<Page<ContactHit>>('/v1/contacts?role=supplier&limit=100', { signal })
}

export function listPlaces(signal?: AbortSignal) {
  return api<Page<Place>>('/v1/locations?limit=100', { signal })
}

export function listStock(at: string, signal?: AbortSignal) {
  return api<Page<StockHit>>(`/v1/stock/balances?at=${encodeURIComponent(at)}&state=goods`, { signal })
}

import { isAuthEnabled } from '@/auth/config'
import { getAccessToken } from '@/auth/tokens'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'

export type Issue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  item_id?: string
}

export type SubmissionFile = {
  kind: string
  exercise_year: number
  filename: string
  sha256: string
}

export type SubmissionEntry = {
  id: string
  local_seq: number
  entry_kind: string
  movement_date: string
  reference: string
  status: string
  aeat_entry_number: string | null
}

export type Submission = {
  id: string
  flow: string
  legal_entity_id: string
  tax_warehouse_id: string | null
  kind: string
  period_start: string | null
  period_end: string | null
  status: string
  phase: string
  content_sha256: string
  external_ref: string | null
  approval_request_id: string | null
  rectifies_submission_id: string | null
  ready_for_approval: boolean
  blocks_approval: boolean
  validation: { errors: Issue[]; warnings: Issue[] }
  files: SubmissionFile[]
  summary: { entry_count: number; litres: string }
  entries: SubmissionEntry[]
  created_by: string
  successor_id: string | null
}

export type ObligationWarehouse = {
  id: string
  code: string
  name: string
  activity: string
  entity_id: string
}

export type Obligation = {
  id: string
  legal_entity_id: string
  flow: string
  title: string
  period_start: string | null
  period_end: string | null
  due_date: string
  legal_basis: string
  status: string
  submission_id: string | null
  display: string
  tax_warehouse_id: string | null
  tax_warehouse: ObligationWarehouse | null
  tax_warehouses: ObligationWarehouse[]
}

export type Ledger = {
  id: string
  taxWarehouseId: string
  reference: string
  description: string
  productClass: string
  epigrafe: string | null
  epigrafeCode: string | null
  ncCode: string
  validatedBy: string | null
  isActive: boolean
}

export type LocationRow = {
  id: string
  code: string
  name: string
  tax_warehouse_id: string | null
  controlling_entity_id: string
  is_active: boolean
}

export type ApprovalPeek = {
  id: string
  status: string
  requested_by?: { id?: string; display_name?: string }
  can_decide?: boolean
  reason_cannot_decide?: string | null
}

function day(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  return value.slice(0, 10)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  return value
}

export function submissionOf(row: Submission): Submission {
  return {
    ...row,
    period_start: day(row.period_start),
    period_end: day(row.period_end),
    files: row.files ?? [],
    entries: (row.entries ?? []).map((entry) => ({
      ...entry,
      movement_date: day(entry.movement_date) ?? '',
    })),
    validation: {
      errors: row.validation?.errors ?? [],
      warnings: row.validation?.warnings ?? [],
    },
    summary: row.summary ?? { entry_count: 0, litres: '0' },
    successor_id: row.successor_id ?? null,
  }
}

export function obligationOf(row: Obligation): Obligation {
  return {
    ...row,
    period_start: day(row.period_start),
    period_end: day(row.period_end),
    due_date: day(row.due_date) ?? '',
    tax_warehouse_id: row.tax_warehouse_id ?? null,
    tax_warehouse: row.tax_warehouse ?? null,
    tax_warehouses: row.tax_warehouses ?? [],
  }
}

export function obligationWarehouse(item: Pick<Obligation, 'tax_warehouse' | 'tax_warehouses'>): string | null {
  if (item.tax_warehouse?.name) return item.tax_warehouse.name
  const names = (item.tax_warehouses ?? []).map((warehouse) => warehouse.name).filter((name) => name.length > 0)
  return names.length > 0 ? names.join(' · ') : null
}

export function ledgerOf(row: Record<string, unknown>): Ledger {
  const pick = (camel: string, snake: string) => row[camel] ?? row[snake]
  return {
    id: String(pick('id', 'id') ?? ''),
    taxWarehouseId: String(pick('taxWarehouseId', 'tax_warehouse_id') ?? ''),
    reference: String(pick('reference', 'reference') ?? ''),
    description: String(pick('description', 'description') ?? ''),
    productClass: String(pick('productClass', 'product_class') ?? ''),
    epigrafe: text(pick('epigrafe', 'epigrafe')),
    epigrafeCode: text(pick('epigrafeCode', 'epigrafe_code')),
    ncCode: String(pick('ncCode', 'nc_code') ?? ''),
    validatedBy: text(pick('validatedBy', 'validated_by')),
    isActive: pick('isActive', 'is_active') !== false,
  }
}

function root(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured && configured.length > 0 ? configured : '/api').replace(/\/$/, '')
}

function authHeaders(): Headers {
  const headers = new Headers()
  if (isAuthEnabled) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

async function failed(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as { code?: string; message?: string; fields?: Record<string, string> }
    return new ApiError(response.status, payload.code ?? 'WC_ERROR', payload.message ?? copy.api.generic, payload.fields)
  } catch {
    return new ApiError(response.status, 'WC_ERROR', copy.api.generic)
  }
}

export function submissionsPath(entityId?: string): string {
  const params = new URLSearchParams({ limit: '50' })
  if (entityId) params.set('entity', entityId)
  return `/v1/regulatory/submissions?${params.toString()}`
}

export function obligationsPath(input: { entityId?: string; flow?: string; from: string; to: string }): string {
  const params = new URLSearchParams({ from: input.from, to: input.to })
  if (input.entityId) params.set('entity', input.entityId)
  if (input.flow) params.set('flow', input.flow)
  return `/v1/regulatory/obligations?${params.toString()}`
}

export async function createSubmission(input: {
  legalEntityId: string
  taxWarehouseId: string
  periodStart: string
  periodEnd: string
  aggregation: 'monthly' | 'none'
}): Promise<Submission> {
  const row = await api<Submission>('/v1/regulatory/submissions', {
    method: 'POST',
    body: JSON.stringify({
      legal_entity_id: input.legalEntityId,
      tax_warehouse_id: input.taxWarehouseId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      aggregation: input.aggregation,
    }),
  })
  return submissionOf(row)
}

export async function postAction(id: string, action: string, body?: unknown): Promise<Submission> {
  const row = await api<Submission>(`/v1/regulatory/submissions/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
  return submissionOf(row)
}

export async function syncObligations(input?: { legalEntityId: string; year: number }): Promise<void> {
  await api('/v1/regulatory/obligations/sync', {
    method: 'POST',
    body: JSON.stringify(
      input ? { legal_entity_id: input.legalEntityId, year: input.year } : {},
    ),
  })
}

export async function uploadReceipt(submissionId: string, file: File): Promise<{ id: string }> {
  const form = new FormData()
  form.set('file', file)
  form.set('table', 'regulatory.submission')
  form.set('row_id', submissionId)
  form.set('role', 'official_receipt')
  return api('/v1/attachments', { method: 'POST', body: form })
}

export async function downloadSubmissionFile(id: string, file: { kind: string; exercise_year: number; filename: string }): Promise<void> {
  const params = new URLSearchParams({ exercise: String(file.exercise_year) })
  if (file.kind === 'anulaciones') params.set('part', 'anulaciones')
  const headers = authHeaders()
  headers.set('Accept', 'text/csv, application/json')
  let response: Response
  try {
    response = await fetch(`${root()}/v1/regulatory/submissions/${id}/file?${params.toString()}`, {
      headers,
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'WC_NETWORK', copy.api.offline)
  }
  if (!response.ok) throw await failed(response)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function validateLedger(id: string, advisorRef: string): Promise<void> {
  await api(`/v1/silicie-ledgers/${id}/validate`, {
    method: 'POST',
    body: JSON.stringify({ advisor_ref: advisorRef }),
  })
}

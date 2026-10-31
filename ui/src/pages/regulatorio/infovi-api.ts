import { isAuthEnabled } from '@/auth/config'
import { getAccessToken } from '@/auth/tokens'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'

export type InfoviIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  item_id?: string
}

export type InfoviLine = {
  family: string
  color: string
  category: string
  opening_l: string
  entries_l: string
  exits_l: string
  closing_l: string
  reconciles: boolean
}

export type InfoviFiling = {
  id: string
  legal_entity_id: string
  tax_warehouse_id: string
  period_start: string
  period_end: string
  due_date: string
  status: string
  phase: string
  content_sha256: string
  external_ref: string | null
  approval_request_id: string | null
  rectifies_filing_id: string | null
  successor_id: string | null
  ready_for_approval: boolean
  blocks_approval: boolean
  validation: { errors: InfoviIssue[]; warnings: InfoviIssue[] }
  lines: InfoviLine[]
  grape: { operation_id: string; day: string; variety: string | null; parcel_codes: string[]; kg: string | null }[]
  production: {
    campaign: string
    must_l: string
    wine_l: string
    average_hl: string | null
    campaigns_with_data: number
  }
  bottling_l: string
  sales_l: string
  reconciliation: { ok: boolean; unbalanced: number }
  blocked_note: string
  files: { filename: string; sha256: string }[]
  installation_name: string
}

export type InfoviMonth = {
  month: string
  period_start: string
  period_end: string
  due_date: string
  filing: InfoviFiling | null
}

export type TaxWarehouse = {
  id: string
  name: string
  entity: { id: string; code: string; legal_name: string }
}

export function infoviPath(input: { entityId: string; warehouseId: string; month: string }): string {
  const params = new URLSearchParams({
    entity: input.entityId,
    tax_warehouse_id: input.warehouseId,
    month: input.month,
  })
  return `/v1/regulatory/infovi?${params.toString()}`
}

export function prepareInfovi(input: { entityId: string; warehouseId: string; month: string }): Promise<InfoviFiling> {
  return api('/v1/regulatory/infovi', {
    method: 'POST',
    body: JSON.stringify({
      legal_entity_id: input.entityId,
      tax_warehouse_id: input.warehouseId,
      month: input.month,
    }),
  })
}

export function postInfovi(id: string, action: string, body?: unknown): Promise<InfoviFiling> {
  return api(`/v1/regulatory/infovi/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export async function uploadInfoviReceipt(filingId: string, file: File): Promise<{ id: string }> {
  const form = new FormData()
  form.set('file', file)
  form.set('table', 'regulatory.infovi_filing')
  form.set('row_id', filingId)
  form.set('role', 'official_receipt')
  return api('/v1/attachments', { method: 'POST', body: form })
}

export async function downloadInfovi(id: string, filename: string): Promise<void> {
  const headers = new Headers()
  if (isAuthEnabled) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  headers.set('Accept', 'text/csv, application/json')
  let response: Response
  try {
    response = await fetch(`${root()}/v1/regulatory/infovi/${id}/file`, { headers, cache: 'no-store' })
  } catch {
    throw new ApiError(0, 'WC_NETWORK', copy.api.offline)
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string; message?: string }
    throw new ApiError(response.status, payload.code ?? 'WC_ERROR', payload.message ?? copy.api.generic)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function root(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured && configured.length > 0 ? configured : '/api').replace(/\/$/, '')
}

import { isAuthEnabled } from '@/auth/config'
import { getAccessToken } from '@/auth/tokens'
import { ApiError, api, apiBlob, apiText } from '@/lib/api'
import { copy } from '@/i18n'
import type { Expense, ExpenseCategory, ExpenseDraft, ExpensePage, ExpenseQuery } from '@/pages/gastos/types'

function root(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured && configured.length > 0 ? configured : '/api').replace(/\/$/, '')
}

export function expenseQuery(query: ExpenseQuery): string {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.entity) params.set('entity', query.entity)
  if (query.month) params.set('month', query.month)
  if (query.category) params.set('category', query.category)
  if (query.q) params.set('q', query.q.slice(0, 80))
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', String(query.limit ?? 50))
  return `/v1/supplier-invoices?${params.toString()}`
}

export function listCategories(signal?: AbortSignal) {
  return api<{ items: ExpenseCategory[] }>('/v1/expense-categories', { signal })
}

export function listExpenses(query: ExpenseQuery, signal?: AbortSignal) {
  return api<ExpensePage>(expenseQuery(query), { signal })
}

export function getExpense(id: string, signal?: AbortSignal) {
  return api<Expense>(`/v1/supplier-invoices/${id}`, { signal })
}

function money(value: string): string {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed)) return value.trim()
  return parsed.toFixed(2)
}

export function patchBody(draft: ExpenseDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    supplier_invoice_number: draft.supplier_invoice_number.trim(),
    issue_date: draft.issue_date,
    accounting_date: draft.accounting_date || draft.issue_date,
    due_date: draft.due_date || null,
    subtotal: money(draft.subtotal || '0'),
    tax_total: money(draft.tax_total || '0'),
    withholding_total: money(draft.withholding_total || '0'),
    total: money(draft.total || '0'),
    payment_method: draft.payment_method || null,
    notes: draft.notes.trim() || null,
    lines: draft.lines.map((line) => ({
      description: line.description.trim() || 'Gasto',
      quantity: line.quantity || '1.000',
      unit_price: money(line.unit_price || line.line_base || '0'),
      line_base: money(line.line_base || '0'),
      vat_rate: money(line.vat_rate || '0'),
      vat_quota: money(line.vat_quota || '0'),
      withholding_rate: money(line.withholding_rate || '0'),
      vat_deductible_pct: money(line.vat_deductible_pct || '100'),
      expense_account: line.expense_account.trim(),
    })),
  }
  if (draft.supplier_id) body.supplier_id = draft.supplier_id
  if (draft.category_code) body.category_code = draft.category_code
  return body
}

export function patchExpense(id: string, draft: ExpenseDraft, version: string) {
  return api<Expense>(`/v1/supplier-invoices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patchBody(draft)),
    headers: { 'If-Match': version },
  })
}

export function validateExpense(id: string, version: string) {
  return api<Expense>(`/v1/supplier-invoices/${id}/validate`, {
    method: 'POST',
    headers: { 'If-Match': version },
  })
}

export function approveExpense(id: string, version: string) {
  return api<Expense>(`/v1/supplier-invoices/${id}/approve`, {
    method: 'POST',
    headers: { 'If-Match': version },
  })
}

export function rejectExpense(id: string, version: string, reason: string) {
  return api<Expense>(`/v1/supplier-invoices/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    headers: { 'If-Match': version },
  })
}

export async function downloadBook(entity: string, period: string) {
  const csv = await apiText(`/v1/supplier-invoices/export?entity=${encodeURIComponent(entity)}&period=${encodeURIComponent(period)}`)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `libro-recibidas-${entity}-${period}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

async function readXhrError(xhr: XMLHttpRequest): Promise<ApiError> {
  let payload: { code?: unknown; message?: unknown; fields?: unknown } = {}
  try {
    payload = JSON.parse(xhr.responseText) as typeof payload
  } catch {
    payload = {}
  }
  const code = typeof payload.code === 'string' ? payload.code : 'WC_ERROR'
  const message = typeof payload.message === 'string' ? payload.message : copy.api.generic
  const fields =
    payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields)
      ? Object.fromEntries(
          Object.entries(payload.fields as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : undefined
  return new ApiError(xhr.status, code, message, fields)
}

export function captureExpense(
  file: File,
  entity: string,
  idempotencyKey: string,
  onProgress: (percent: number) => void,
): Promise<Expense> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.set('file', file)
    form.set('entity', entity)
    form.set('source', file.type.startsWith('image/') ? 'photo' : 'upload')
    xhr.open('POST', `${root()}/v1/supplier-invoices/capture`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('Idempotency-Key', idempotencyKey)
    if (isAuthEnabled) {
      const token = getAccessToken()
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.upload.onload = () => onProgress(100)
    xhr.onerror = () => reject(new ApiError(0, 'WC_NETWORK', copy.api.offline))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Expense)
        } catch {
          reject(new ApiError(xhr.status, 'WC_BAD_RESPONSE', copy.api.invalid))
        }
        return
      }
      void readXhrError(xhr).then(reject)
    }
    xhr.send(form)
  })
}

export async function attachmentObjectUrl(id: string): Promise<{ url: string; mime: string }> {
  try {
    const { blob } = await apiBlob(`/v1/attachments/${id}`, { headers: { Accept: '*/*' } })
    return { url: URL.createObjectURL(blob), mime: blob.type }
  } catch (error) {
    if (error instanceof ApiError && error.status > 0) throw new ApiError(error.status, error.code, copy.gastos.noDocument)
    throw error
  }
}

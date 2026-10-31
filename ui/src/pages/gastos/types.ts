export const EXPENSE_STATUSES = ['captured', 'validated', 'approved', 'rejected', 'duplicate'] as const

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export type ConfidenceKey =
  | 'supplier_name'
  | 'supplier_tax_id'
  | 'number'
  | 'issue_date'
  | 'due_date'
  | 'lines'
  | 'vat'
  | 'totals'

export type ExpenseLine = {
  line_no: number
  description: string
  quantity: string
  unit_price: string
  line_base: string
  vat_rate: string
  vat_quota: string
  withholding_rate: string
  vat_deductible_pct: string
  expense_account: string
}

export type Expense = {
  id: string
  legal_entity_id: string
  legal_entity_code: string
  supplier_id: string | null
  supplier_name: string | null
  supplier_tax_id: string | null
  supplier_invoice_number: string | null
  issue_date: string | null
  accounting_date: string | null
  due_date: string | null
  source: string
  status: ExpenseStatus | string
  category_code: string | null
  category_suggested: boolean
  organic_relevant: boolean
  currency: string
  subtotal: string | null
  tax_total: string | null
  withholding_total: string
  total: string | null
  payment_method: string | null
  notes: string | null
  ocr_confidence: number
  confidence: Partial<Record<ConfidenceKey, number>>
  extractor: string | null
  model: string | null
  totals_ok: boolean
  warnings: string[]
  duplicate_of_id: string | null
  rejection_reason: string | null
  attachment_id: string | null
  lines: ExpenseLine[]
  validated_at: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type ExpensePage = {
  items: Expense[]
  next_cursor: string | null
  total: number
}

export type ExpenseQuery = {
  status?: string
  entity?: string
  cursor?: string
  limit?: number
}

export type ExpenseDraft = {
  supplier_id: string
  supplier_name: string
  supplier_tax_id: string
  supplier_invoice_number: string
  issue_date: string
  accounting_date: string
  due_date: string
  category_code: string
  subtotal: string
  tax_total: string
  withholding_total: string
  total: string
  payment_method: string
  notes: string
  lines: ExpenseLine[]
}

export type SupplierOption = { id: string; legal_name: string; tax_id: string | null }

function amountOf(value: string): number {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function recomputeTotals(draft: ExpenseDraft): ExpenseDraft {
  const base = round2(draft.lines.reduce((sum, line) => sum + amountOf(line.line_base), 0))
  const vat = round2(draft.lines.reduce((sum, line) => sum + amountOf(line.vat_quota), 0))
  const held = round2(
    draft.lines.reduce((sum, line) => sum + (amountOf(line.line_base) * amountOf(line.withholding_rate)) / 100, 0),
  )
  return {
    ...draft,
    subtotal: base.toFixed(2),
    tax_total: vat.toFixed(2),
    withholding_total: held.toFixed(2),
    total: round2(base + vat - held).toFixed(2),
  }
}

export function totalsDrift(draft: ExpenseDraft): boolean {
  const fresh = recomputeTotals(draft)
  return (
    Math.abs(amountOf(draft.subtotal) - amountOf(fresh.subtotal)) > 0.01 ||
    Math.abs(amountOf(draft.tax_total) - amountOf(fresh.tax_total)) > 0.01 ||
    Math.abs(amountOf(draft.withholding_total) - amountOf(fresh.withholding_total)) > 0.01 ||
    Math.abs(amountOf(draft.total) - amountOf(fresh.total)) > 0.01
  )
}

export function blankLine(account: string, lineNo: number): ExpenseLine {
  return {
    line_no: lineNo,
    description: '',
    quantity: '1.000',
    unit_price: '0.00',
    line_base: '0.00',
    vat_rate: '21.00',
    vat_quota: '0.00',
    withholding_rate: '0.00',
    vat_deductible_pct: '100.00',
    expense_account: account,
  }
}

export function draftFrom(expense: Expense): ExpenseDraft {
  return {
    supplier_id: expense.supplier_id ?? '',
    supplier_name: expense.supplier_name ?? '',
    supplier_tax_id: expense.supplier_tax_id ?? '',
    supplier_invoice_number: expense.supplier_invoice_number ?? '',
    issue_date: expense.issue_date ?? '',
    accounting_date: expense.accounting_date ?? expense.issue_date ?? '',
    due_date: expense.due_date ?? '',
    category_code: expense.category_code ?? '',
    subtotal: expense.subtotal ?? '',
    tax_total: expense.tax_total ?? '',
    withholding_total: expense.withholding_total ?? '0.00',
    total: expense.total ?? '',
    payment_method: expense.payment_method ?? '',
    notes: expense.notes ?? '',
    lines: expense.lines.map((line) => ({ ...line })),
  }
}

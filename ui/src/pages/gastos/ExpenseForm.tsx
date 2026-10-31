import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { Badge, Button, DatePicker, InfoTip, Input, Select } from '@/ui'
import { Plus, Trash2 } from '@/ui/icons'
import { accountFor, categoryLabel, confidenceLow, confidenceMark, CATEGORIES } from '@/pages/gastos/catalog'
import { blankLine, recomputeTotals, type Expense, type ExpenseDraft, type ExpenseLine, type SupplierOption } from '@/pages/gastos/types'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function amount(value: string): number {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

const DATE_LABELS = { clear: 'Borrar', today: 'Hoy' }

function hintFor(key: Parameters<typeof confidenceMark>[0], expense: Expense): string | undefined {
  return confidenceMark(key, expense.confidence)
}

function Confidence({ text }: { text?: string }) {
  if (!text) return null
  return <p className="text-caption text-warning-700">{text}</p>
}

export function ExpenseForm({
  expense,
  draft,
  suppliers,
  errors,
  disabled,
  onChange,
  onCreateSupplier,
}: {
  expense: Expense
  draft: ExpenseDraft
  suppliers: SupplierOption[]
  errors: Record<string, string>
  disabled: boolean
  onChange: (next: ExpenseDraft) => void
  onCreateSupplier: () => void
}) {
  const low = Object.values(expense.confidence).some((value) => confidenceLow(value))

  function setLine(index: number, patch: Partial<ExpenseLine>, quotaFromRate: boolean) {
    const lines = draft.lines.map((line, lineIndex) => {
      if (lineIndex !== index) return line
      const next = { ...line, ...patch }
      if (quotaFromRate) {
        next.vat_quota = round2((amount(next.line_base) * amount(next.vat_rate)) / 100).toFixed(2)
        next.unit_price = amount(next.line_base).toFixed(2)
        next.quantity = next.quantity || '1.000'
      }
      return next
    })
    onChange(recomputeTotals({ ...draft, lines }))
  }

  function setCategory(code: string) {
    const account = accountFor(code)
    onChange({
      ...draft,
      category_code: code,
      lines: account ? draft.lines.map((line) => ({ ...line, expense_account: account })) : draft.lines,
    })
  }

  function pickSupplier(id: string) {
    const supplier = suppliers.find((item) => item.id === id)
    onChange({
      ...draft,
      supplier_id: id,
      supplier_name: supplier?.legal_name ?? draft.supplier_name,
      supplier_tax_id: supplier?.tax_id ?? draft.supplier_tax_id,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        <h2 className="flex items-center gap-1.5 border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">
          {copy.gastos.data}
          {low ? <InfoTip label={copy.gastos.data}>{copy.gastos.confidenceHint}</InfoTip> : null}
        </h2>
        <div className="grid gap-3 p-4">
          <Field id="gasto-contacto" label={copy.gastos.supplier} error={errors.supplier_id}>
            <Select
              id="gasto-contacto"
              value={draft.supplier_id}
              disabled={disabled}
              onChange={(event) => pickSupplier(event.target.value)}
            >
              <option value="">{copy.gastos.unmatched}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.supplier_id ? null : (
              <Field id="gasto-nombre" label={copy.gastos.supplier} error={errors.supplier_name}>
                <Input
                  id="gasto-nombre"
                  value={draft.supplier_name}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, supplier_name: event.target.value })}
                />
                <Confidence text={hintFor('supplier_name', expense)} />
              </Field>
            )}
            <div className={draft.supplier_id ? 'sm:col-span-2' : undefined}>
            <Field id="gasto-nif" label={copy.gastos.taxId} error={errors.supplier_tax_id}>
              <Input
                id="gasto-nif"
                value={draft.supplier_tax_id}
                disabled={disabled}
                className="font-mono"
                onChange={(event) => {
                  const tax = event.target.value
                  const match = suppliers.find(
                    (supplier) => (supplier.tax_id ?? '').toUpperCase() === tax.replace(/[\s.-]/g, '').toUpperCase(),
                  )
                  onChange({
                    ...draft,
                    supplier_tax_id: tax,
                    supplier_id: match?.id ?? '',
                    supplier_name: match?.legal_name ?? draft.supplier_name,
                  })
                }}
              />
              <Confidence text={hintFor('supplier_tax_id', expense)} />
            </Field>
            </div>
          </div>
          {!draft.supplier_id && !disabled ? (
            <Button type="button" variant="secondary" size="sm" onClick={onCreateSupplier}>
              {copy.gastos.createSupplier}
            </Button>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="gasto-numero" label={copy.gastos.number} error={errors.supplier_invoice_number}>
              <Input
                id="gasto-numero"
                value={draft.supplier_invoice_number}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, supplier_invoice_number: event.target.value })}
              />
              <Confidence text={hintFor('number', expense)} />
            </Field>
            <Field id="gasto-fecha" label={copy.gastos.issueDate} error={errors.issue_date}>
              <DatePicker
                value={draft.issue_date || null}
                disabled={disabled}
                locale="es"
                timeZone="Europe/Madrid"
                labels={DATE_LABELS}
                className="w-full"
                onChange={(next) => {
                  const issue = next ?? ''
                  onChange({
                    ...draft,
                    issue_date: issue,
                    accounting_date:
                      draft.accounting_date === draft.issue_date || !draft.accounting_date ? issue : draft.accounting_date,
                  })
                }}
              />
              <Confidence text={hintFor('issue_date', expense)} />
            </Field>
            <Field id="gasto-contable" label={copy.gastos.accountingDate} error={errors.accounting_date}>
              <DatePicker
                value={draft.accounting_date || null}
                disabled={disabled}
                locale="es"
                timeZone="Europe/Madrid"
                labels={DATE_LABELS}
                className="w-full"
                onChange={(next) => onChange({ ...draft, accounting_date: next ?? '' })}
              />
            </Field>
            <Field id="gasto-vence" label={copy.gastos.dueDate} error={errors.due_date}>
              <DatePicker
                value={draft.due_date || null}
                disabled={disabled}
                locale="es"
                timeZone="Europe/Madrid"
                labels={DATE_LABELS}
                className="w-full"
                onChange={(next) => onChange({ ...draft, due_date: next ?? '' })}
              />
              <Confidence text={hintFor('due_date', expense)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="gasto-categoria" label={copy.gastos.category} error={errors.category_code}>
              <Select
                id="gasto-categoria"
                className="w-full"
                value={draft.category_code}
                disabled={disabled}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">{copy.gastos.category}</option>
                {CATEGORIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {categoryLabel(item.code)}
                  </option>
                ))}
              </Select>
              {expense.category_suggested ? (
                <Badge tone="neutral" size="sm" className="justify-self-start">
                  {copy.gastos.suggested}
                </Badge>
              ) : null}
            </Field>
            <Field id="gasto-pago" label={copy.gastos.payment}>
              <Select
                id="gasto-pago"
                value={draft.payment_method}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, payment_method: event.target.value })}
              >
                <option value="">—</option>
                {Object.entries(copy.gastos.payments).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="gasto-base" label={copy.gastos.base} error={errors.subtotal}>
              <Input
                id="gasto-base"
                inputMode="decimal"
                value={draft.subtotal}
                disabled={disabled}
                className="font-mono"
                onChange={(event) => onChange({ ...draft, subtotal: event.target.value })}
              />
            </Field>
            <Field id="gasto-cuota" label={copy.gastos.quota} error={errors.tax_total}>
              <Input
                id="gasto-cuota"
                inputMode="decimal"
                value={draft.tax_total}
                disabled={disabled}
                className="font-mono"
                onChange={(event) => onChange({ ...draft, tax_total: event.target.value })}
              />
              <Confidence text={hintFor('vat', expense)} />
            </Field>
            <Field id="gasto-retencion" label={copy.gastos.withholding} error={errors.withholding_total}>
              <Input
                id="gasto-retencion"
                inputMode="decimal"
                value={draft.withholding_total}
                disabled={disabled}
                className="font-mono"
                onChange={(event) => onChange({ ...draft, withholding_total: event.target.value })}
              />
            </Field>
            <Field id="gasto-total" label={copy.gastos.total} error={errors.total}>
              <Input
                id="gasto-total"
                inputMode="decimal"
                value={draft.total}
                disabled={disabled}
                className="font-mono"
                onChange={(event) => onChange({ ...draft, total: event.target.value })}
              />
              <Confidence text={hintFor('totals', expense)} />
            </Field>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        <div className="flex items-center gap-1.5 border-b border-border-subtle px-4 py-2">
          <h2 className="text-caption text-text-tertiary">{copy.gastos.lines}</h2>
          {hintFor('lines', expense) ? <span className="text-caption text-warning-700">{hintFor('lines', expense)}</span> : null}
          {!disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() =>
                onChange(
                  recomputeTotals({
                    ...draft,
                    lines: [...draft.lines, blankLine(accountFor(draft.category_code) ?? '629', draft.lines.length + 1)],
                  }),
                )
              }
            >
              <Plus strokeWidth={iconStroke} />
              {copy.gastos.addLine}
            </Button>
          ) : null}
        </div>
        <ul>
          {draft.lines.map((line, index) => (
            <li key={`${line.line_no}-${index}`} className={cn('grid gap-3 px-4 py-3', index > 0 && 'border-t border-border-subtle')}>
              <Field id={`linea-desc-${index}`} label={fill(copy.gastos.line, { n: String(index + 1) })} error={index === 0 ? errors.lines : undefined}>
                <Input
                  id={`linea-desc-${index}`}
                  value={line.description}
                  disabled={disabled}
                  onChange={(event) => setLine(index, { description: event.target.value }, false)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field id={`linea-base-${index}`} label={copy.gastos.base}>
                  <Input
                    id={`linea-base-${index}`}
                    inputMode="decimal"
                    value={line.line_base}
                    disabled={disabled}
                    className="font-mono"
                    onChange={(event) => setLine(index, { line_base: event.target.value }, true)}
                  />
                </Field>
                <Field id={`linea-iva-${index}`} label={copy.gastos.vat}>
                  <Input
                    id={`linea-iva-${index}`}
                    inputMode="decimal"
                    value={line.vat_rate}
                    disabled={disabled}
                    className="font-mono"
                    onChange={(event) => setLine(index, { vat_rate: event.target.value }, true)}
                  />
                </Field>
                <Field id={`linea-cuota-${index}`} label={copy.gastos.quota}>
                  <Input
                    id={`linea-cuota-${index}`}
                    inputMode="decimal"
                    value={line.vat_quota}
                    disabled={disabled}
                    className="font-mono"
                    onChange={(event) => setLine(index, { vat_quota: event.target.value }, false)}
                  />
                </Field>
                <Field id={`linea-cuenta-${index}`} label={copy.gastos.account}>
                  <Input
                    id={`linea-cuenta-${index}`}
                    value={line.expense_account}
                    disabled={disabled}
                    className="font-mono"
                    onChange={(event) => setLine(index, { expense_account: event.target.value }, false)}
                  />
                </Field>
              </div>
              {!disabled && draft.lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(recomputeTotals({ ...draft, lines: draft.lines.filter((_, lineIndex) => lineIndex !== index) }))}
                >
                  <Trash2 strokeWidth={iconStroke} />
                  {copy.gastos.removeLine}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

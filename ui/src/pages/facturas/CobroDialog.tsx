import { useEffect, useState } from 'react'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { accountsPath, createPayment, paymentsPath, reversePayment, type BankAccount, type Payment, type PaymentPage } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { moneyOf, textFromCents, todayMadrid } from '@/pages/cobros/money'
import {
  INVOICE_METHODS,
  canCollectInvoice,
  cobroAmountText,
  invoiceMethodLabel,
  methodNeedsAccount,
  outstandingCents,
  parseCobroCents,
  type InvoiceMethod,
} from '@/pages/facturas/cobro'
import { day } from '@/pages/facturas/format'
import type { Invoice } from '@/pages/facturas/types'
import { Alert, Button, Checkbox, ConfirmDialog, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Select, Textarea, useToast } from '@/ui'

const CASH_LIMIT = 100_000

export function CobroButton({ me, invoice, onChanged }: { me: Me; invoice: Invoice; onChanged: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  if (!canCollectInvoice(invoice, allows(me, 'finance.write'))) return null
  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        {copy.cobros.register}
      </Button>
      <CobroDialog
        invoice={invoice}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(outstanding, warnings) => {
          setOpen(false)
          if (warnings[0]) {
            toast(copy.cobros.saved, { tone: 'warning', description: warnings[0] })
          } else if (outstanding && outstanding !== '0.00') {
            toast(fill(copy.cobros.partial, { amount: moneyOf(outstanding) }), { tone: 'success' })
          } else {
            toast(copy.cobros.saved, { tone: 'success' })
          }
          onChanged()
        }}
      />
    </>
  )
}

export function InvoicePayments({ me, invoice, onChanged }: { me: Me; invoice: Invoice; onChanged: () => void }) {
  const toast = useToast()
  const canRead = allows(me, 'finance.read')
  const canReverse = allows(me, 'finance.manage')
  const payments = useApi<PaymentPage>(
    canRead && (invoice.status === 'issued' || invoice.status === 'voided')
      ? paymentsPath({ direction: 'in', invoiceId: invoice.id }, null, 100)
      : null,
  )
  const [undo, setUndo] = useState<Payment | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const items = payments.data?.items ?? []
  if (!canRead || (items.length === 0 && !payments.error)) return null

  async function reverse() {
    if (!undo || reason.trim().length < 3) {
      setError(copy.cobros.reasonHint)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await reversePayment(undo.id, reason.trim())
      setUndo(null)
      toast(copy.cobros.reversedToast, { tone: 'success' })
      payments.reload()
      onChanged()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-2">
      <h3 className="text-label font-medium text-ink-900">{copy.cobros.title}</h3>
      {payments.error ? (
        <p className="text-label text-text-secondary">
          {payments.error.message}{' '}
          <button type="button" className="underline underline-offset-2" onClick={payments.reload}>
            {copy.facturas.reload}
          </button>
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border-subtle">
          {items.map((payment) => (
            <li key={payment.id} className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink-900">
                  <span className="tabular-nums">{day(payment.value_date)}</span>
                  {' · '}
                  {invoiceMethodLabel(payment.method)}
                  {' · '}
                  <span className="tabular-nums">{moneyOf(payment.amount)}</span>
                </p>
                {payment.notes ? <p className="truncate text-caption text-text-tertiary">{payment.notes}</p> : null}
                {payment.status === 'reversed' ? <p className="text-caption text-text-tertiary">{copy.cobros.reversed}</p> : null}
              </div>
              {canReverse && payment.status === 'registered' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setUndo(payment)
                    setReason('')
                    setError(null)
                  }}
                >
                  {copy.cobros.reverse}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={undo != null}
        title={copy.cobros.reverseTitle}
        body={
          <div className="grid gap-3">
            <p>{copy.cobros.reverseBody}</p>
            <Textarea
              aria-label={copy.cobros.reason}
              value={reason}
              rows={3}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-caption text-text-tertiary">{copy.cobros.reasonHint}</p>
            {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          </div>
        }
        confirmLabel={copy.cobros.reverse}
        danger
        busy={saving}
        onClose={() => { if (!saving) setUndo(null) }}
        onConfirm={() => void reverse()}
      />
    </section>
  )
}

function CobroDialog({
  invoice,
  open,
  onClose,
  onSaved,
}: {
  invoice: Invoice
  open: boolean
  onClose: () => void
  onSaved: (outstanding: string | null, warnings: string[]) => void
}) {
  const pending = outstandingCents(invoice.total, invoice.amount_paid)
  const accounts = useApi<{ items: BankAccount[] }>(open ? accountsPath(invoice.entity_code || invoice.legal_entity_id) : null)
  const [date, setDate] = useState<string | null>(todayMadrid())
  const [amount, setAmount] = useState(cobroAmountText(pending))
  const [method, setMethod] = useState<InvoiceMethod>('transfer')
  const [account, setAccount] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [cashOk, setCashOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const needsAccount = methodNeedsAccount(method)
  const cents = parseCobroCents(amount)
  const cashWarn = method === 'cash' && cents != null && cents > CASH_LIMIT
  const accountItems = accounts.data?.items

  useEffect(() => {
    if (!open) return
    setDate(todayMadrid())
    setAmount(cobroAmountText(outstandingCents(invoice.total, invoice.amount_paid)))
    setMethod('transfer')
    setAccount(null)
    setNote('')
    setCashOk(false)
    setError(null)
  }, [open, invoice.id, invoice.total, invoice.amount_paid])

  useEffect(() => {
    if (!open || !needsAccount || account !== null) return
    if (!accountItems) return
    const preferred = accountItems.find((item) => item.is_default) ?? accountItems[0]
    setAccount(preferred?.id ?? '')
  }, [open, needsAccount, account, accountItems])

  async function save() {
    setError(null)
    const today = todayMadrid()
    if (!date || date > today) {
      setError(copy.cobros.futureDate)
      return
    }
    if (!invoice.customer_id) return
    const parsed = parseCobroCents(amount)
    if (parsed == null || parsed <= 0) {
      setError(copy.cobros.needAmount)
      return
    }
    const due = outstandingCents(invoice.total, invoice.amount_paid)
    if (parsed > due) {
      setError(copy.cobros.overOutstanding)
      return
    }
    if (cashWarn && !cashOk) {
      setError(copy.cobros.cashWarning)
      return
    }
    setSaving(true)
    try {
      const saved = await createPayment({
        direction: 'in',
        method,
        amount: textFromCents(parsed),
        value_date: date,
        counterparty_id: invoice.customer_id,
        legal_entity_id: invoice.legal_entity_id,
        bank_account_id: needsAccount && account ? account : null,
        notes: note.trim() || null,
        allocations: [{ target_table: 'billing.invoice', target_id: invoice.id, amount: textFromCents(parsed) }],
      })
      const line = saved.allocations.find((item) => item.target_id === invoice.id)
      onSaved(line?.outstanding ?? null, saved.warnings ?? [])
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="cobro-factura-title" size="sm">
      <DialogHeader titleId="cobro-factura-title" title={copy.cobros.register} onClose={onClose} />
      <DialogBody>
        <div data-screen="cobro-factura" className="grid gap-3 pb-2">
          {cashWarn ? <Alert tone="warning">{copy.cobros.cashWarning}</Alert> : null}
          <Field id="factura-cobro-fecha" label={copy.cobros.valueDate}>
            <DatePicker
              value={date}
              onChange={setDate}
              size="md"
              className="w-full"
              locale="es"
              timeZone="Europe/Madrid"
              labels={{ clear: copy.cobros.clearDate, today: copy.cobros.today }}
            />
          </Field>
          <Field id="factura-cobro-importe" label={copy.cobros.amount}>
            <Input
              id="factura-cobro-importe"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={() => {
                const parsed = parseCobroCents(amount)
                if (parsed != null) setAmount(cobroAmountText(parsed))
              }}
            />
          </Field>
          <Field id="factura-cobro-forma" label={copy.cobros.method}>
            <Select
              id="factura-cobro-forma"
              className="w-full"
              value={method}
              onChange={(event) => setMethod(event.target.value as InvoiceMethod)}
            >
              {INVOICE_METHODS.map((item) => (
                <option key={item} value={item}>
                  {invoiceMethodLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          {needsAccount ? (
            <Field id="factura-cobro-cuenta" label={copy.cobros.account}>
              <Select
                id="factura-cobro-cuenta"
                className="w-full"
                value={account ?? ''}
                onChange={(event) => setAccount(event.target.value)}
              >
                <option value="">{copy.cobros.accountNone}</option>
                {(accountItems ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.bank_name} · {fill(copy.cobros.ibanMasked, { last4: item.iban_last4 })}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="factura-cobro-nota" label={copy.cobros.note}>
            <Textarea
              id="factura-cobro-nota"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {cashWarn ? <Checkbox checked={cashOk} onChange={setCashOk} label={copy.cobros.cashConfirm} /> : null}
        </div>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.cobros.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.cobros.register}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

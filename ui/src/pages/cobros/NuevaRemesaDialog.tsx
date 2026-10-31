import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, Select } from '@/ui'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useEntity } from '@/app/entity-context'
import { accountsPath, createRemittance, receivablesPath, type BankAccount, type Receivables, type RemittanceKind } from '@/lib/finance'
import { formatDate } from '@/lib/format'
import type { Me } from '@/lib/types'
import { centsOf, entityCode, moneyOf, textFromCents, todayMadrid } from '@/pages/cobros/money'

export function NuevaRemesaDialog({
  me,
  open,
  onClose,
  onCreated,
}: {
  me: Me
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { entityCode: scope } = useEntity()
  const accounts = useApi<{ items: BankAccount[] }>(open ? accountsPath(scope) : null)
  const docs = useApi<Receivables>(open ? receivablesPath(scope, null) : null)
  const [kind, setKind] = useState<RemittanceKind>('direct_debit')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState<string | null>(todayMadrid())
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const list = useMemo(() => accounts.data?.items ?? [], [accounts.data])
  const account = list.find((item) => item.id === accountId) ?? null

  useEffect(() => {
    if (!open) return
    setKind('direct_debit')
    setDate(todayMadrid())
    setPicked({})
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (accountId && list.some((item) => item.id === accountId)) return
    const next = list.find((item) => item.is_default) ?? list[0]
    if (next) setAccountId(next.id)
  }, [accountId, list, open])

  const documents = useMemo(() => {
    if (!account || kind !== 'direct_debit') return []
    return (docs.data?.groups ?? []).flatMap((group) =>
      group.items
        .filter((item) => item.legal_entity_id === account.legal_entity_id && item.target_table === 'billing.invoice' && group.contact_id)
        .map((item) => ({ ...item, customer: group.customer_name, contactId: group.contact_id as string })),
    )
  }, [account, docs.data, kind])

  function toggle(id: string, outstanding: string, on: boolean) {
    setPicked((current) => {
      const next = { ...current }
      if (on) next[id] = centsOf(outstanding)
      else delete next[id]
      return next
    })
  }

  async function save() {
    setError(null)
    if (!account || !date) return
    if (date < todayMadrid()) {
      setError(copy.cobros.pastDate)
      return
    }
    const chosen = documents.filter((item) => picked[item.target_id])
    if (kind === 'credit_transfer') {
      setError(copy.cobros.noPayables)
      return
    }
    if (chosen.length === 0) {
      setError(copy.cobros.needItems)
      return
    }
    const code = entityCode(account.legal_entity_id, me.entities)
    if (!code) {
      setError(copy.cobros.needAccount)
      return
    }
    setSaving(true)
    try {
      const created = await createRemittance({
        legal_entity_id: code,
        kind,
        bank_account_id: account.id,
        execution_date: date,
        items: chosen.map((item) => ({
          target_table: item.target_table,
          target_id: item.target_id,
          amount: textFromCents(picked[item.target_id] ?? centsOf(item.outstanding)),
        })),
      })
      onCreated(created.id)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="remesa-nueva-title" size="lg">
      <DialogHeader titleId="remesa-nueva-title" title={copy.cobros.newRemittance} onClose={onClose} />
      <DialogBody>
        <div data-screen="cobros-remesa-nueva" className="grid gap-4 pb-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="remesa-clase" label={copy.cobros.kind}>
              <Select id="remesa-clase" className="w-full" value={kind} onChange={(event) => setKind(event.target.value as RemittanceKind)}>
                <option value="direct_debit">{copy.cobros.directDebit}</option>
                <option value="credit_transfer">{copy.cobros.creditTransfer}</option>
              </Select>
            </Field>
            <Field id="remesa-cuenta" label={copy.cobros.account}>
              <Select id="remesa-cuenta" className="w-full" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {list.length === 0 ? <option value="">{copy.cobros.noAccounts}</option> : null}
                {list.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.bank_name} · {item.iban_last4}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="remesa-fecha" label={copy.cobros.executionDate}>
              <DatePicker
                value={date}
                onChange={setDate}
                className="w-full"
                locale="es"
                timeZone="Europe/Madrid"
                labels={{ clear: copy.cobros.clearDate, today: copy.cobros.today }}
              />
            </Field>
          </div>
          {kind === 'credit_transfer' ? <p className="text-label text-text-secondary">{copy.cobros.noPayables}</p> : null}
          {list.length === 0 ? <p className="text-label text-text-secondary">{copy.cobros.noAccountsHint}</p> : null}
          <ul className="divide-y divide-border-subtle">
            {documents.map((item) => (
              <li key={item.target_id} className="flex items-center gap-3 py-2">
                <Checkbox
                  size="sm"
                  checked={Boolean(picked[item.target_id])}
                  onChange={(on) => toggle(item.target_id, item.outstanding, on)}
                  ariaLabel={item.document_number}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label text-ink-900">{item.document_number}</p>
                  <p className="truncate text-caption text-text-tertiary">
                    {item.customer}
                    {item.due_date ? ` · ${formatDate(item.due_date)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-label">{moneyOf(item.outstanding)}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.cobros.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.cobros.newRemittance}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

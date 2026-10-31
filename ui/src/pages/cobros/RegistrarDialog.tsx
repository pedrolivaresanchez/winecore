import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Select } from '@/ui'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useEntity } from '@/app/entity-context'
import {
  createPayment,
  receivablesPath,
  type Direction,
  type PaymentMethod,
  type ReceivableItem,
  type Receivables,
} from '@/lib/finance'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { centsOf, entityLabel, moneyOf, textFromCents, todayMadrid } from '@/pages/cobros/money'

const METHODS: PaymentMethod[] = ['transfer', 'direct_debit', 'card', 'cash', 'stripe', 'compensation', 'other']
const CASH_LIMIT = 100_000

type Line = {
  item: ReceivableItem
  checked: boolean
  cents: number
}

export function RegistrarDialog({
  me,
  open,
  direction,
  contactId,
  entityId,
  onClose,
  onSaved,
}: {
  me: Me
  open: boolean
  direction: Direction
  contactId: string | null
  entityId: string | null
  onClose: () => void
  onSaved: (warnings: string[]) => void
}) {
  const { entityCode } = useEntity()
  const scope = entityId ? (me.entities.find((entity) => entity.id === entityId)?.code ?? entityCode) : entityCode
  const data = useApi<Receivables>(open ? receivablesPath(scope, null, contactId) : null)
  const canWrite = allows(me, 'finance.write')
  const [dir, setDir] = useState<Direction>(direction)
  const [contact, setContact] = useState(contactId ?? '')
  const [entity, setEntity] = useState(entityId ?? '')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [date, setDate] = useState<string | null>(todayMadrid())
  const [reference, setReference] = useState('')
  const [amountMode, setAmountMode] = useState<'auto' | 'manual'>('auto')
  const [amountText, setAmountText] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [cashOk, setCashOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const customers = useMemo(
    () => (data.data?.groups ?? []).filter((group) => group.contact_id).map((group) => ({ id: group.contact_id as string, name: group.customer_name })),
    [data.data],
  )

  useEffect(() => {
    if (!open) return
    setDir(direction)
    setContact(contactId ?? '')
    setEntity(entityId ?? '')
    setMethod('transfer')
    setDate(todayMadrid())
    setReference('')
    setAmountMode('auto')
    setAmountText('')
    setLines([])
    setCashOk(false)
    setError(null)
  }, [open, direction, contactId, entityId])

  useEffect(() => {
    if (!open || !data.data) return
    const items = (contact
      ? data.data.groups.filter((group) => group.contact_id === contact).flatMap((group) => group.items)
      : []
    )
      .filter((item) => !entity || item.legal_entity_id === entity)
      .filter((item) => (dir === 'in' ? item.target_table !== 'purchasing.supplier_invoice' : false))
    setLines(items.map((item) => ({ item, checked: false, cents: centsOf(item.outstanding) })))
    setAmountMode('auto')
    setAmountText('')
  }, [open, data.data, contact, entity, dir])

  const checked = lines.filter((line) => line.checked)
  const allocated = checked.reduce((sum, line) => sum + line.cents, 0)
  const amountCents = amountMode === 'auto' ? allocated : centsOf(amountText)
  const entities = [...new Set(lines.map((line) => line.item.legal_entity_id))]
  const cashWarn = method === 'cash' && amountCents > CASH_LIMIT

  function toggle(targetId: string, on: boolean) {
    setLines((current) => {
      const next = current.map((line) => {
        if (line.item.target_id !== targetId) return line
        if (!on) return { ...line, checked: false }
        const others = current.filter((item) => item.checked && item.item.target_id !== targetId).reduce((sum, item) => sum + item.cents, 0)
        const room = amountMode === 'manual' ? Math.max(0, centsOf(amountText) - others) : centsOf(line.item.outstanding)
        const cents = Math.min(centsOf(line.item.outstanding), room || centsOf(line.item.outstanding))
        return { ...line, checked: cents > 0, cents }
      })
      return next
    })
  }

  function setLineCents(targetId: string, text: string) {
    const parsed = centsOf(text)
    setLines((current) => current.map((line) => (line.item.target_id === targetId ? { ...line, cents: parsed, checked: parsed > 0 } : line)))
  }

  async function save() {
    setError(null)
    if (!canWrite) return
    const today = todayMadrid()
    if (!date || date > today) {
      setError(copy.cobros.futureDate)
      return
    }
    if (!contact) {
      setError(copy.cobros.needAllocation)
      return
    }
    if (dir === 'out') {
      setError(copy.cobros.noPayables)
      return
    }
    if (checked.length === 0 || allocated <= 0) {
      setError(copy.cobros.needAllocation)
      return
    }
    if (amountCents <= 0) {
      setError(copy.cobros.needAllocation)
      return
    }
    if (allocated > amountCents) {
      setError(copy.cobros.overAllocated)
      return
    }
    if (checked.some((line) => line.cents > centsOf(line.item.outstanding))) {
      setError(copy.cobros.overOutstanding)
      return
    }
    if (cashWarn && !cashOk) {
      setError(copy.cobros.cashWarning)
      return
    }
    const legal = entity || checked[0]?.item.legal_entity_id
    const code = legal ? entityCodeOf(legal, me) : scope
    if (!code) {
      setError(copy.cobros.mixedEntity)
      return
    }
    if (checked.some((line) => line.item.legal_entity_id !== (entity || checked[0]?.item.legal_entity_id))) {
      setError(copy.cobros.mixedEntity)
      return
    }
    setSaving(true)
    try {
      const saved = await createPayment({
        direction: dir,
        method,
        amount: textFromCents(amountCents),
        value_date: date,
        counterparty_id: contact,
        legal_entity_id: code,
        reference: reference.trim() || null,
        allocations: checked.map((line) => ({
          target_table: line.item.target_table,
          target_id: line.item.target_id,
          amount: textFromCents(line.cents),
        })),
      })
      onSaved(saved.warnings ?? [])
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  const title = dir === 'out' ? copy.cobros.registerPay : copy.cobros.register
  const shownAmount = amountMode === 'auto' ? (allocated ? textFromCents(allocated).replace('.', ',') : '') : amountText

  return (
    <Dialog open={open} onClose={onClose} labelledBy="registrar-title" size="lg">
      <DialogHeader titleId="registrar-title" title={title} onClose={onClose} />
      <DialogBody>
        <div data-screen="cobros-dialogo" className="grid gap-4 pb-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {cashWarn ? <Alert tone="warning">{copy.cobros.cashWarning}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cobro-cliente" label={copy.cobros.customer}>
              <Select id="cobro-cliente" className="w-full" value={contact} onChange={(event) => setContact(event.target.value)}>
                <option value="">{copy.cobros.customer}</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cobro-tipo" label={copy.cobros.direction}>
              <Select id="cobro-tipo" className="w-full" value={dir} onChange={(event) => setDir(event.target.value as Direction)}>
                <option value="in">{copy.cobros.collection}</option>
                <option value="out">{copy.cobros.payment}</option>
              </Select>
            </Field>
            <Field id="cobro-forma" label={copy.cobros.method}>
              <Select id="cobro-forma" className="w-full" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                {METHODS.map((item) => (
                  <option key={item} value={item}>
                    {copy.cobros.methods[item]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cobro-fecha" label={copy.cobros.valueDate}>
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
            <Field id="cobro-importe" label={copy.cobros.amount}>
              <Input
                id="cobro-importe"
                inputMode="decimal"
                value={shownAmount}
                onChange={(event) => {
                  setAmountMode('manual')
                  setAmountText(event.target.value)
                }}
              />
            </Field>
            <Field id="cobro-ref" label={copy.cobros.reference}>
              <Input id="cobro-ref" value={reference} maxLength={140} onChange={(event) => setReference(event.target.value)} />
            </Field>
          </div>
          {entities.length > 1 ? (
            <Field id="cobro-entidad" label={copy.cobros.entity}>
              <Select id="cobro-entidad" className="w-full" value={entity} onChange={(event) => setEntity(event.target.value)}>
                <option value="">{copy.entity.all}</option>
                {entities.map((id) => (
                  <option key={id} value={id}>
                    {entityLabel(id, me.entities)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div>
            <h3 className="text-caption text-text-tertiary">{copy.cobros.allocate}</h3>
            {dir === 'out' ? <p className="mt-2 text-label text-text-secondary">{copy.cobros.noPayables}</p> : null}
            {dir === 'in' && contact && lines.length === 0 && !data.loading ? (
              <p className="mt-2 text-label text-text-secondary">{copy.cobros.noDocuments}</p>
            ) : null}
            <ul className="mt-2 divide-y divide-border-subtle">
              {lines.map((line) => {
                const tooMuch = line.checked && line.cents > centsOf(line.item.outstanding)
                return (
                  <li key={line.item.target_id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                    <Checkbox
                      size="sm"
                      checked={line.checked}
                      onChange={(on) => toggle(line.item.target_id, on)}
                      ariaLabel={line.item.document_number}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-label text-ink-900">{line.item.document_number}</span>
                        {line.item.source_label ? (
                          <span className="text-caption text-text-tertiary">{line.item.source_label}</span>
                        ) : null}
                      </div>
                      <p className="text-caption text-text-tertiary">
                        {line.item.due_date ? `${copy.cobros.due} ${formatDate(line.item.due_date)} · ` : ''}
                        {copy.cobros.outstanding} {moneyOf(line.item.outstanding)}
                        {entities.length > 1 ? ` · ${entityLabel(line.item.legal_entity_id, me.entities)}` : ''}
                      </p>
                    </div>
                    <Input
                      aria-label={copy.cobros.amount}
                      inputMode="decimal"
                      size="sm"
                      className="w-full sm:w-28"
                      invalid={tooMuch}
                      value={textFromCents(line.cents).replace('.', ',')}
                      onChange={(event) => setLineCents(line.item.target_id, event.target.value)}
                    />
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-caption text-text-tertiary">
              {copy.cobros.allocated} {moneyOf(textFromCents(allocated))} · {copy.cobros.unallocated}{' '}
              {moneyOf(textFromCents(Math.max(0, amountCents - allocated)))}
            </p>
            {cashWarn ? (
              <div className="mt-3">
                <Checkbox checked={cashOk} onChange={setCashOk} label={copy.cobros.cashConfirm} />
              </div>
            ) : null}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.cobros.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.cobros.saveCollection}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function entityCodeOf(id: string, me: Me): string {
  return me.entities.find((entity) => entity.id === id)?.code ?? id
}

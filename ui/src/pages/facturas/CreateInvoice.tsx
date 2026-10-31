import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { listContacts, type ContactSummary } from '@/lib/contacts'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Button, Chip, DatePicker, Drawer, DrawerBody, DrawerHeader, InfoTip, Input, Select, Textarea, useToast } from '@/ui'
import { createInvoice } from '@/pages/facturas/api'
import { DATE_LABELS, blankLine, entityLabel, linePayload, uuidsOf } from '@/pages/facturas/format'
import { LineEditor } from '@/pages/facturas/lines'
import type { LineDraft, SourceKind } from '@/pages/facturas/types'

const SOURCES: { id: SourceKind; label: string }[] = [
  { id: 'notes', label: copy.facturas.sourceNotes },
  { id: 'order', label: copy.facturas.sourceOrder },
  { id: 'lines', label: copy.facturas.sourceLines },
]

export function CreateInvoice({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const desktop = useMinWidth(768)
  const { filter } = useEntity()
  useChromeTitle(copy.facturas.new)
  const [source, setSource] = useState<SourceKind>('notes')
  const [entityId, setEntityId] = useState(() => {
    if (filter === 'all') return me.entities[0]?.id ?? ''
    return me.entities.find((item) => item.code === filter)?.id ?? me.entities[0]?.id ?? ''
  })
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customers, setCustomers] = useState<ContactSummary[]>([])
  const [customerOpen, setCustomerOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState<'es' | 'en'>('es')
  const [noteIds, setNoteIds] = useState('')
  const [orderId, setOrderId] = useState('')
  const [operationDate, setOperationDate] = useState<string | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const query = customerQuery.trim()
    if (customerId || query.length < 2) {
      setCustomers([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      listContacts({ role: 'customer', q: query, limit: 20 }, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) setCustomers(page.items)
        })
        .catch((err: unknown) => {
          if (!isAbortError(err)) setCustomers([])
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [customerId, customerQuery])

  if (!allows(me, 'billing.write')) return <NoPermission />

  async function submit() {
    setError(null)
    const notes = uuidsOf(noteIds)
    const body = {
      description: description.trim() || undefined,
      language,
      operation_date: operationDate,
      legal_entity_id: source === 'lines' ? entityId || undefined : undefined,
      customer_id: source === 'lines' ? customerId || undefined : undefined,
      from_delivery_notes: source === 'notes' ? notes : undefined,
      from_order: source === 'order' ? orderId.trim() : undefined,
      lines: source === 'lines' ? linePayload(lines) : undefined,
    }
    if (source === 'notes' && notes.length === 0) {
      setError(copy.facturas.noteIds)
      return
    }
    if (source === 'order' && !orderId.trim()) {
      setError(copy.facturas.orderId)
      return
    }
    if (source === 'lines' && (!entityId || !customerId || lines.some((line) => !line.productId.trim()))) {
      setError(copy.facturas.product)
      return
    }
    setSaving(true)
    try {
      const created = await createInvoice(body)
      toast(copy.facturas.created)
      navigate(`/facturas/${created.id}`)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  const form = (
    <form
      className="grid gap-4"
      data-screen="facturas-nueva"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy.facturas.type}>
          {SOURCES.map((item) => (
            <Chip key={item.id} pressed={source === item.id} active={source === item.id} onClick={() => setSource(item.id)}>
              {item.label}
            </Chip>
          ))}
        </div>
        <InfoTip label={copy.facturas.stockLabel}>{copy.facturas.stockTip}</InfoTip>
      </div>
      {source === 'lines' ? (
        <>
          <Field id="entidad-factura" label={copy.facturas.entity}>
            <Select id="entidad-factura" size="sm" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {me.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entityLabel(entity.code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cliente-factura" label={copy.facturas.customer}>
            <div className="relative">
              <Input
                id="cliente-factura"
                size="sm"
                value={customerId ? customerName : customerQuery}
                placeholder={copy.facturas.search}
                autoComplete="off"
                role="combobox"
                aria-expanded={customerOpen}
                aria-controls="clientes-factura"
                onChange={(event) => {
                  setCustomerId('')
                  setCustomerName('')
                  setCustomerQuery(event.target.value)
                  setCustomerOpen(true)
                }}
                onFocus={() => setCustomerOpen(true)}
              />
              {customerOpen && !customerId && customers.length > 0 ? (
                <ul id="clientes-factura" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-subtle bg-surface shadow-(--shadow-float)">
                  {customers.map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        className="w-full px-2 py-1.5 text-left text-label text-ink-900 hover:bg-fill-hover"
                        onClick={() => {
                          setCustomerId(customer.id)
                          setCustomerName(customer.legal_name)
                          setCustomerOpen(false)
                        }}
                      >
                        {customer.legal_name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Field>
        </>
      ) : null}
      <Field id="descripcion-nueva" label={copy.facturas.description}>
        <Input id="descripcion-nueva" size="sm" value={description} placeholder={copy.facturas.description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field id="idioma-nueva" label={copy.facturas.language}>
        <Select id="idioma-nueva" size="sm" value={language} onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'es')}>
          <option value="es">{copy.facturas.spanish}</option>
          <option value="en">{copy.facturas.english}</option>
        </Select>
      </Field>
      <Field id="operacion-nueva" label={copy.facturas.operationDate}>
        <DatePicker value={operationDate} labels={DATE_LABELS} onChange={setOperationDate} />
      </Field>
      {source === 'notes' ? (
        <Field id="albaranes-factura" label={copy.facturas.noteIds}>
          <Textarea id="albaranes-factura" value={noteIds} onChange={(event) => setNoteIds(event.target.value)} />
        </Field>
      ) : null}
      {source === 'order' ? (
        <Field id="pedido-factura" label={copy.facturas.orderId}>
          <Input id="pedido-factura" size="sm" value={orderId} onChange={(event) => setOrderId(event.target.value)} />
        </Field>
      ) : null}
      {source === 'lines' ? (
        <div className="grid gap-3">
          <LineEditor lines={lines} showProduct onChange={setLines} />
          <Button type="button" variant="secondary" size="sm" onClick={() => setLines((current) => [...current, blankLine()])}>
            {copy.facturas.addLine}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {copy.facturas.create}
        </Button>
      </div>
    </form>
  )

  if (!desktop) {
    return (
      <Drawer open onClose={() => navigate('/facturas')} labelledBy="nueva-factura" size="lg">
        <DrawerHeader titleId="nueva-factura" title={copy.facturas.new} onClose={() => navigate('/facturas')} />
        <DrawerBody>{form}</DrawerBody>
      </Drawer>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 md:px-8">
        <header className="flex items-center gap-2">
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.facturas.new}</h1>
        </header>
        {form}
      </div>
    </div>
  )
}

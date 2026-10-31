import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { listContacts, type ContactSummary } from '@/lib/contacts'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import type { EntityChoice, Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  DatePicker,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  Select,
  useMenuOpen,
  useToast,
  type BadgeTone,
  type GridColumn,
} from '@/ui'
import { exportBook, listInvoices, listPendingDeliveries, requestBatch } from '@/pages/facturas/api'
import { DATE_LABELS, day, deliveryLabel, deliveryTone, entityLabel, money, paymentLabel, statusLabel, statusTone, verifactuLabel } from '@/pages/facturas/format'
import type { DeliveryStatus, InvoiceListItem, InvoiceQuery } from '@/pages/facturas/types'

const COLUMN_KEY = 'winecore.columns.invoices'
const COLUMN_IDS = ['number', 'date', 'entity', 'customer', 'base', 'total', 'paid', 'due', 'delivery', 'status', 'payment', 'verifactu', 'type'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_HIDDEN = new Set<ColumnId>(['base', 'paid', 'due', 'payment', 'verifactu', 'type'])

const STATUS_PILLS = [
  { id: '', label: copy.facturas.all },
  { id: 'draft', label: copy.facturas.draft },
  { id: 'issued', label: copy.facturas.issued },
  { id: 'voided', label: copy.facturas.voided },
] as const

function readHidden(): Set<ColumnId> {
  const raw = readStorage(COLUMN_KEY)
  if (!raw) return new Set(DEFAULT_HIDDEN)
  try {
    const parsed = JSON.parse(raw) as ColumnId[]
    return new Set(parsed.filter((id) => COLUMN_IDS.includes(id)))
  } catch {
    return new Set(DEFAULT_HIDDEN)
  }
}

function entityCodeOf(params: URLSearchParams, rail: EntityChoice): '' | 'PO' | 'CVPO' {
  const raw = params.get('entity')
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

function monthRange(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(last).padStart(2, '0')}` }
}

export function InvoiceList({ me }: { me: Me }) {
  useChromeTitle(copy.facturas.title)
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const { filter: rail, entities } = useEntity()
  const [params, setParams] = useSearchParams()
  const canWrite = allows(me, 'billing.write')
  const status = params.get('status') ?? ''
  const entityCode = entityCodeOf(params, rail)
  const customerId = params.get('customer') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const deliveryFilter = params.get('delivery') ?? ''
  const verifactu = params.get('verifactu') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim().toLowerCase())
  const [items, setItems] = useState<InvoiceListItem[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({
    number: 240,
    date: 120,
    entity: 96,
    customer: 280,
    base: 110,
    total: 120,
    paid: 110,
    due: 120,
    delivery: 168,
    status: 120,
    payment: 120,
    verifactu: 120,
    type: 80,
  })
  const [customers, setCustomers] = useState<ContactSummary[]>([])
  const [pending, setPending] = useState<Map<string, DeliveryStatus>>(new Map())
  const [deliveryKnown, setDeliveryKnown] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [batching, setBatching] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim().toLowerCase()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    const controller = new AbortController()
    listContacts({ role: 'customer', limit: 100 }, controller.signal)
      .then((page) => setCustomers(page.items))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setCustomers([])
      })
    return () => controller.abort()
  }, [])

  const entityId = entityCode ? entities.find((item) => item.code === entityCode)?.id ?? '' : ''
  const query = useMemo<InvoiceQuery>(
    () => ({
      status,
      entity: entityId,
      customerId,
      from,
      to,
      verifactuStatus: verifactu === 'pendiente' ? 'pending' : undefined,
      limit: 50,
    }),
    [customerId, entityId, from, status, to, verifactu],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    listInvoices(query, controller.signal)
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setTotal(page.total)
        setCursor(page.next_cursor)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    listPendingDeliveries(controller.signal)
      .then((rows) => {
        if (!active) return
        setPending(new Map(rows.map((row) => [row.invoice_id, row.delivery_status])))
        setDeliveryKnown(true)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setDeliveryKnown(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, query])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (next.toString() === params.toString()) return
    setParams(next)
    setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listInvoices({ ...query, cursor })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleColumn(id: ColumnId) {
    if (id === 'number') return
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const deliveryOf = useCallback((row: InvoiceListItem): DeliveryStatus | null => {
    if (row.status !== 'issued' && row.status !== 'voided') return null
    const known = pending.get(row.id)
    if (known) return known
    if (deliveryKnown && row.status === 'issued') return 'sent'
    return null
  }, [deliveryKnown, pending])

  const visible = items.filter((row) => {
    const delivery = deliveryOf(row)
    if (deliveryFilter && delivery !== deliveryFilter) return false
    if (!debounced) return true
    const haystack = `${row.number ?? ''} ${row.customer_name ?? ''}`.toLowerCase()
    return haystack.includes(debounced)
  })

  const columns = useMemo<GridColumn<InvoiceListItem>[]>(() => {
    const all: GridColumn<InvoiceListItem>[] = [
      { id: 'number', header: copy.facturas.number, cell: (row) => row.imported ? <span className="inline-flex items-center gap-1.5">{row.number || copy.facturas.draft}<Badge tone="neutral">Holded</Badge></span> : (row.number || copy.facturas.draft) },
      { id: 'date', header: copy.facturas.date, cell: (row) => day(row.issue_date) },
      { id: 'entity', header: copy.facturas.entity, cell: (row) => entityLabel(row.entity_code) },
      { id: 'customer', header: copy.facturas.customer, cell: (row) => row.customer_name || '—' },
      { id: 'base', header: copy.facturas.base, align: 'right', cell: (row) => money(row.subtotal) },
      { id: 'total', header: copy.facturas.total, align: 'right', cell: (row) => money(row.total) },
      { id: 'paid', header: copy.facturas.paid, align: 'right', cell: (row) => money(row.amount_paid) },
      { id: 'due', header: copy.facturas.due, cell: (row) => day(row.first_due_date) },
      {
        id: 'delivery',
        header: copy.facturas.delivery,
        cell: (row) => {
          const delivery = deliveryOf(row)
          if (!delivery) return '—'
          return <Badge tone={deliveryTone(delivery) as BadgeTone}>{deliveryLabel(delivery)}</Badge>
        },
      },
      {
        id: 'status',
        header: copy.facturas.status,
        cell: (row) => <Badge tone={statusTone(row.status) as BadgeTone}>{statusLabel(row.status)}</Badge>,
      },
      { id: 'payment', header: copy.facturas.payment, cell: (row) => paymentLabel(row.payment_status) },
      {
        id: 'verifactu',
        header: copy.facturas.verifactu,
        cell: (row) => verifactuLabel(row.verifactu_record_id),
      },
      { id: 'type', header: copy.facturas.type, cell: (row) => row.invoice_type },
    ]
    const concealed = verifactu === 'pendiente' ? new Set([...hidden].filter((id) => id !== 'verifactu')) : hidden
    return all.filter((column) => !concealed.has(column.id as ColumnId))
  }, [deliveryOf, hidden, verifactu])

  const filtersActive = Boolean(debounced || status || entityCode || customerId || from || to || deliveryFilter || verifactu)
  const screen = loading ? 'facturas-cargando' : visible.length === 0 ? 'facturas-vacio' : 'facturas'
  const labels: Record<ColumnId, string> = {
    number: copy.facturas.number,
    date: copy.facturas.date,
    entity: copy.facturas.entity,
    customer: copy.facturas.customer,
    base: copy.facturas.base,
    total: copy.facturas.total,
    paid: copy.facturas.paid,
    due: copy.facturas.due,
    delivery: copy.facturas.delivery,
    status: copy.facturas.status,
    payment: copy.facturas.payment,
    verifactu: copy.facturas.verifactu,
    type: copy.facturas.type,
  }

  async function exportPeriod() {
    if (!entityCode || !entityId) {
      toast(copy.facturas.exportNeed)
      return
    }
    const range = from && to ? { from, to } : monthRange()
    setExporting(true)
    try {
      const csv = await exportBook(entityCode, range.from, range.to)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `libro-emitidas-${entityCode}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setExporting(false)
    }
  }

  async function issueSelected() {
    const ids = items.filter((row) => picked.has(row.id) && row.status === 'draft').map((row) => row.id)
    const entitiesIn = new Set(items.filter((row) => ids.includes(row.id)).map((row) => row.legal_entity_id))
    if (ids.length === 0 || entitiesIn.size !== 1) {
      toast(copy.facturas.batchEmpty)
      return
    }
    setBatching(true)
    try {
      await requestBatch(ids)
      toast(copy.facturas.batchPending)
      setPicked(new Set())
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setBatching(false)
    }
  }

  if (!allows(me, 'billing.read')) return <NoPermission />

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.facturas.title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportPeriod()}>
            {copy.facturas.export}
          </Button>
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/facturas/nueva')}>
              {copy.facturas.new}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-facturas"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.facturas.search}
            aria-label={copy.facturas.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <GlassMenu
            open={columnsMenu.open}
            onOpenChange={columnsMenu.setOpen}
            placement="bottom-start"
            panelClassName="min-w-[200px]"
            trigger={
              <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.facturas.columns}>
                {copy.facturas.columns}
              </MenuChip>
            }
          >
            {COLUMN_IDS.map((id) => (
              <MenuItem key={id} checked={!hidden.has(id)} disabled={id === 'number'} onClick={() => toggleColumn(id)}>
                {labels[id]}
              </MenuItem>
            ))}
          </GlassMenu>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/facturas/nueva')}>
              {copy.facturas.new}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {STATUS_PILLS.map((pill) => (
            <Chip key={pill.id || 'all'} pressed={status === pill.id} active={status === pill.id} onClick={() => setFilter('status', pill.id)}>
              {pill.label}
            </Chip>
          ))}
          <Chip pressed={entityCode === 'PO'} active={entityCode === 'PO'} onClick={() => setFilter('entity', entityCode === 'PO' ? 'all' : 'PO')}>
            {copy.entity.po}
          </Chip>
          <Chip pressed={entityCode === 'CVPO'} active={entityCode === 'CVPO'} onClick={() => setFilter('entity', entityCode === 'CVPO' ? 'all' : 'CVPO')}>
            {copy.entity.cvpo}
          </Chip>
          <Select
            id="filtro-cliente"
            size="sm"
            aria-label={copy.facturas.customer}
            value={customerId}
            onChange={(event) => setFilter('customer', event.target.value)}
          >
            <option value="">{copy.facturas.customer}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.legal_name}
              </option>
            ))}
          </Select>
          <DatePicker size="sm" value={from || null} placeholder={copy.facturas.from} labels={DATE_LABELS} onChange={(value) => setFilter('from', value ?? '')} />
          <DatePicker size="sm" value={to || null} placeholder={copy.facturas.to} labels={DATE_LABELS} onChange={(value) => setFilter('to', value ?? '')} />
          <Chip
            pressed={verifactu === 'pendiente'}
            active={verifactu === 'pendiente'}
            onClick={() => setFilter('verifactu', verifactu === 'pendiente' ? '' : 'pendiente')}
          >
            {copy.facturas.verifactu}
          </Chip>
          <Select
            id="filtro-envio"
            size="sm"
            aria-label={copy.facturas.delivery}
            value={deliveryFilter}
            onChange={(event) => setFilter('delivery', event.target.value)}
          >
            <option value="">{copy.facturas.delivery}</option>
            <option value="pending">{copy.facturas.deliveryPending}</option>
            <option value="sent">{copy.facturas.deliverySent}</option>
            <option value="failed">{copy.facturas.deliveryFailed}</option>
            <option value="no_recipient">{copy.facturas.deliveryNone}</option>
          </Select>
        </div>
      </div>

      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState
            title={`${copy.error.load} (${error.code})`}
            detail={error.message}
            onRetry={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={{
            addCalculation: copy.facturas.gridAdd,
            aggregation: () => copy.facturas.gridCount,
            aggregations: copy.facturas.gridAggregations,
            count: (n: number) => `${n}`,
            clearCalculation: copy.facturas.gridClear,
            selectAll: copy.facturas.selectAll,
            selectRow: copy.facturas.selectRow,
            openRecord: copy.facturas.openRecord,
            sortAscending: copy.facturas.gridAsc,
            sortDescending: copy.facturas.gridDesc,
            columnOptions: copy.facturas.gridColumn,
          }}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/facturas/${row.id}`)}
          rowHref={(row) => `/facturas/${row.id}`}
          total={debounced || deliveryFilter ? visible.length : total}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.facturas.noMatch : copy.facturas.empty}
              description={filtersActive ? undefined : copy.facturas.emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/facturas/nueva')}>
                    {copy.facturas.new}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {cursor || picked.size > 0 ? (
        <div className={cn('flex h-10 shrink-0 items-center gap-2 border-t border-border-subtle', FRAME_GUTTER)}>
          {picked.size > 0 ? (
            <>
              <span className="text-label text-text-secondary">{fill(copy.facturas.selected, { n: String(picked.size) })}</span>
              {canWrite ? (
                <Button type="button" variant="primary" size="sm" loading={batching} onClick={() => void issueSelected()}>
                  {copy.facturas.batch}
                </Button>
              ) : null}
            </>
          ) : null}
          {cursor ? (
            <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
              {copy.table.loadMore}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

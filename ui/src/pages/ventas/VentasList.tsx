import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import { productAliases, useSalesCatalog } from '@/lib/sales-catalog'
import {
  CHANNELS,
  DELIVERY_KINDS,
  DELIVERY_STATUSES,
  ORDER_STATUSES,
  QUOTE_STATUSES,
  channelLabel,
  deliveryStatusLabel,
  docPath,
  docTitle,
  formatAmount,
  formatIsoDate,
  invoicingLabel,
  kindLabel,
  listDeliveries,
  listOrders,
  listQuotes,
  orderStatusLabel,
  quoteStatusLabel,
  sourceLabel,
  type DeliveryNote,
  type DocKind,
  type Quote,
  type SalesOrder,
} from '@/lib/sales'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt, Search } from '@/ui/icons'
import {
  Button,
  Badge,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  Select,
  useMenuOpen,
  type GridColumn,
} from '@/ui'
import { CreateDelivery, CreateDocument } from '@/pages/ventas/dialogs'

type Row = {
  id: string
  number: string
  customer: string
  channel: string
  status: string
  date: string
  total: string
  entity: string
  source: string
  kind: string
  invoicing: string
  route: string
  proforma: string
  imported: boolean
}

const GRID_LABELS = {
  addCalculation: copy.sales.grid.add,
  aggregation: () => copy.sales.grid.count,
  aggregations: copy.sales.grid.aggregations,
  count: (n: number) => `${n}`,
  clearCalculation: copy.sales.grid.clear,
  selectAll: copy.sales.selectAll,
  selectRow: copy.sales.selectRow,
  openRecord: copy.sales.openRecord,
  sortAscending: copy.sales.grid.asc,
  sortDescending: copy.sales.grid.desc,
  columnOptions: copy.sales.grid.column,
}

export function VentasList({ me, doc, creating = false }: { me: Me; doc: DocKind; creating?: boolean }) {
  useChromeTitle(copy.sales.title)
  const navigate = useNavigate()
  const columnsMenu = useMenuOpen()
  const [params, setParams] = useSearchParams()
  const { filter, entities } = useEntity()
  const entityId = filter === 'all' ? '' : entities.find((item) => item.code === filter)?.id ?? ''
  const status = params.get('status') ?? ''
  const channel = params.get('channel') ?? ''
  const kind = params.get('kind') ?? ''
  const invoiced = params.get('invoiced') ?? ''
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [notes, setNotes] = useState<DeliveryNote[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState(creating)
  const [formKey, setFormKey] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(doc))

  const lines = doc === 'quote' ? quotes.flatMap((item) => item.lines) : doc === 'order' ? orders.flatMap((item) => item.lines) : notes.flatMap((item) => item.lines)
  const aliases = useMemo(() => productAliases(lines), [lines])
  const catalog = useSalesCatalog(aliases)
  const canWrite = allows(me, 'sales.write')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim().toLowerCase()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    setDialog(creating)
  }, [creating])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const done = (nextCursor: string | null) => {
      if (!active) return
      setCursor(nextCursor)
      setError(null)
      setLoading(false)
    }
    const fail = (err: unknown) => {
      if (!active || isAbortError(err)) return
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
      setLoading(false)
    }
    if (doc === 'quote') {
      listQuotes(null, controller.signal)
        .then((page) => {
          if (!active) return
          setQuotes(page.items)
          done(page.next_cursor)
        })
        .catch(fail)
    } else if (doc === 'order') {
      listOrders({ status, entity: entityId, channel, cursor: null }, controller.signal)
        .then((page) => {
          if (!active) return
          setOrders(page.items)
          done(page.next_cursor)
        })
        .catch(fail)
    } else {
      listDeliveries({ kind, status, invoiced, cursor: null }, controller.signal)
        .then((page) => {
          if (!active) return
          setNotes(page.items)
          done(page.next_cursor)
        })
        .catch(fail)
    }
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, channel, doc, entityId, invoiced, kind, status])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
    setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      if (doc === 'quote') {
        const page = await listQuotes(cursor)
        setQuotes((current) => [...current, ...page.items])
        setCursor(page.next_cursor)
      } else if (doc === 'order') {
        const page = await listOrders({ status, entity: entityId, channel, cursor })
        setOrders((current) => [...current, ...page.items])
        setCursor(page.next_cursor)
      } else {
        const page = await listDeliveries({ kind, status, invoiced, cursor })
        setNotes((current) => [...current, ...page.items])
        setCursor(page.next_cursor)
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
  }

  const rows = useMemo(() => {
    const needle = debounced
    const match = (parts: string[]) => !needle || parts.join(' ').toLowerCase().includes(needle)
    if (doc === 'quote') {
      return quotes.flatMap((item) => {
        if (status && item.status !== status) return []
        if (entityId && item.legal_entity_id !== entityId) return []
        const customer = item.customer_name?.trim() || catalog.customerName(item.customer_id)
        if (!match([item.number ?? '', customer, item.notes ?? ''])) return []
        return [{
          id: item.id,
          number: item.number ?? copy.sales.draft,
          customer,
          channel: channelLabel(item.channel),
          status: quoteStatusLabel(item.status),
          date: formatIsoDate(item.issue_date),
          total: formatAmount(item.total),
          entity: '',
          source: '',
          kind: item.is_proforma ? copy.sales.proforma : copy.sales.quotes,
          invoicing: '',
          route: '',
          proforma: item.is_proforma ? copy.sales.proforma : '—',
          imported: item.imported === true,
        }]
      })
    }
    if (doc === 'order') {
      return orders.flatMap((item) => {
        const customer = catalog.customerName(item.customer_id)
        if (!match([item.number ?? '', customer, item.notes ?? ''])) return []
        return [{
          id: item.id,
          number: item.number ?? copy.sales.draft,
          customer,
          channel: channelLabel(item.channel),
          status: orderStatusLabel(item.status),
          date: formatIsoDate(item.order_date),
          total: formatAmount(item.total),
          entity: item.entity_code ?? '—',
          source: sourceLabel(item.source),
          kind: '',
          invoicing: invoicingLabel(item.invoicing_status),
          route: '',
          proforma: '',
          imported: false,
        }]
      })
    }
    return notes.flatMap((item) => {
      if (entityId && item.legal_entity_id !== entityId) return []
      const customer = item.customer_name?.trim() || catalog.customerName(item.customer_id)
      const from = catalog.locations.find((location) => location.id === item.from_location_id)?.code ?? '—'
      const to = item.to_location_id ? catalog.locations.find((location) => location.id === item.to_location_id)?.code ?? '—' : customer
      if (!match([item.number ?? '', customer, from, to])) return []
      return [{
        id: item.id,
        number: item.number ?? copy.sales.draft,
        customer,
        channel: channelLabel(item.channel),
        status: deliveryStatusLabel(item.status),
        date: formatIsoDate(item.issue_date),
        total: '',
        entity: '',
        source: '',
        kind: kindLabel(item.kind),
        invoicing: invoicingLabel(item.invoicing_status),
        route: `${from} → ${to}`,
        proforma: '',
        imported: item.imported === true,
      }]
    })
  }, [catalog, debounced, doc, entityId, notes, orders, quotes, status])

  const columns = useMemo(() => columnsFor(doc).filter((column) => !hidden.has(column.id)), [doc, hidden])
  const filtersActive = Boolean(debounced || status || channel || kind || invoiced || entityId)
  const emptyTitle = filtersActive ? copy.sales.noMatch : doc === 'quote' ? copy.sales.emptyQuotes : doc === 'order' ? copy.sales.emptyOrders : copy.sales.emptyDeliveries
  const emptyHint = doc === 'quote' ? copy.sales.emptyQuotesHint : doc === 'order' ? copy.sales.emptyOrdersHint : copy.sales.emptyDeliveriesHint
  const screen = loading ? 'ventas-cargando' : rows.length === 0 ? 'ventas-vacio' : 'ventas-lista'

  function openCreate() {
    setFormKey((value) => value + 1)
    setDialog(true)
  }

  function closeCreate() {
    setDialog(false)
    if (creating) navigate(docPath(doc))
  }

  function created(id: string) {
    setDialog(false)
    navigate(`${docPath(doc)}/${id}`)
  }

  if (!allows(me, 'sales.read')) return <NoPermission />

  const newLabel = doc === 'quote' ? copy.sales.newQuote : doc === 'order' ? copy.sales.newOrder : copy.sales.newDelivery
  const statuses = doc === 'quote' ? QUOTE_STATUSES.filter((value) => value === 'draft' || value === 'sent' || value === 'converted') : doc === 'order' ? ORDER_STATUSES : DELIVERY_STATUSES
  const statusLabel = doc === 'quote' ? quoteStatusLabel : doc === 'order' ? orderStatusLabel : deliveryStatusLabel

  return (
    <div data-screen={screen} data-doc={doc} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="shrink-0 text-label font-medium text-ink-900">{copy.sales.title}</h1>
        <nav aria-label={copy.sales.title} className="flex h-full min-w-0 items-end gap-1 overflow-x-auto">
          <DocTab current={doc} doc="quote" onClick={() => navigate(docPath('quote'))} />
          <DocTab current={doc} doc="order" onClick={() => navigate(docPath('order'))} />
          <DocTab current={doc} doc="delivery" onClick={() => navigate(docPath('delivery'))} />
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              {newLabel}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            size="sm"
            type="search"
            value={q}
            placeholder={copy.sales.search}
            aria-label={copy.sales.search}
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
              <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.sales.columns}>
                {copy.sales.columns}
              </MenuChip>
            }
          >
            {columnsFor(doc).map((column) => (
              <MenuItem
                key={column.id}
                checked={!hidden.has(column.id)}
                disabled={column.id === 'number'}
                onClick={() => {
                  setHidden((current) => {
                    const next = new Set(current)
                    if (next.has(column.id)) next.delete(column.id)
                    else next.add(column.id)
                    writeStorage(columnKey(doc), JSON.stringify([...next]))
                    return next
                  })
                }}
              >
                {column.header}
              </MenuItem>
            ))}
          </GlassMenu>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              {newLabel}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <div className="flex items-center gap-1.5 md:hidden">
            <Chip pressed={doc === 'quote'} active={doc === 'quote'} onClick={() => navigate(docPath('quote'))}>
              {copy.sales.quotes}
            </Chip>
            <Chip pressed={doc === 'order'} active={doc === 'order'} onClick={() => navigate(docPath('order'))}>
              {copy.sales.orders}
            </Chip>
            <Chip pressed={doc === 'delivery'} active={doc === 'delivery'} onClick={() => navigate(docPath('delivery'))}>
              {copy.sales.deliveries}
            </Chip>
          </div>
          <Chip pressed={status === ''} active={status === ''} onClick={() => setFilter('status', '')}>
            {copy.sales.all}
          </Chip>
          {statuses.map((value) => (
            <Chip key={value} pressed={status === value} active={status === value} onClick={() => setFilter('status', status === value ? '' : value)}>
              {statusLabel(value)}
            </Chip>
          ))}
          {doc === 'order' ? (
            <Select size="sm" aria-label={copy.sales.channel} value={channel} onChange={(event) => setFilter('channel', event.target.value)}>
              <option value="">{copy.sales.channel}</option>
              {CHANNELS.map((code) => (
                <option key={code} value={code}>
                  {channelLabel(code)}
                </option>
              ))}
            </Select>
          ) : null}
          {doc === 'delivery' ? (
            <Select size="sm" aria-label={copy.sales.kind} value={kind} onChange={(event) => setFilter('kind', event.target.value)}>
              <option value="">{copy.sales.kind}</option>
              {DELIVERY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {kindLabel(value)}
                </option>
              ))}
            </Select>
          ) : null}
          {doc === 'delivery' ? (
            <Select size="sm" aria-label={copy.sales.invoicing} value={invoiced} onChange={(event) => setFilter('invoiced', event.target.value)}>
              <option value="">{copy.sales.invoicing}</option>
              <option value="false">{copy.sales.notInvoiced}</option>
              <option value="true">{copy.sales.invoiced}</option>
              <option value="not_invoiceable">{copy.sales.notInvoiceableStatus}</option>
            </Select>
          ) : null}
        </div>
      </div>

      {error && rows.length === 0 ? (
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
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widthsFor(doc)}
          onResize={() => undefined}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`${docPath(doc)}/${row.id}`)}
          rowHref={(row) => `${docPath(doc)}/${row.id}`}
          scrollKey={`ventas-${doc}`}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={emptyTitle}
              description={filtersActive ? undefined : emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={openCreate}>
                    {newLabel}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {cursor ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}

      {dialog && doc !== 'delivery' ? (
        <CreateDocument
          key={formKey}
          doc={doc}
          customers={catalog.customers}
          onClose={closeCreate}
          onCreated={created}
        />
      ) : null}
      {dialog && doc === 'delivery' ? (
        <CreateDelivery
          key={formKey}
          customers={catalog.customers}
          onClose={closeCreate}
          onCreated={created}
        />
      ) : null}
    </div>
  )
}

function DocTab({ current, doc, onClick }: { current: DocKind; doc: DocKind; onClick: () => void }) {
  const active = current === doc
  return (
    <button
      type="button"
      className={cn(
        'h-8 shrink-0 border-b-2 px-2 text-label',
        active ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
      )}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {docTitle(doc)}
    </button>
  )
}

function columnKey(doc: DocKind) {
  return `winecore.columns.sales.${doc}`
}

function readHidden(doc: DocKind): Set<string> {
  const raw = readStorage(columnKey(doc))
  const fallback = doc === 'quote' ? ['proforma'] : doc === 'order' ? ['source'] : ['channel']
  if (!raw) return new Set(fallback)
  try {
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set(fallback)
  }
}

function columnsFor(doc: DocKind): GridColumn<Row>[] {
  const number: GridColumn<Row> = {
    id: 'number',
    header: copy.sales.number,
    cell: (row) => row.imported ? <span className="inline-flex items-center gap-1.5">{row.number}<Badge size="sm" tone="neutral">Holded</Badge></span> : row.number,
  }
  const customer: GridColumn<Row> = { id: 'customer', header: copy.sales.customer, cell: (row) => row.customer }
  const channel: GridColumn<Row> = { id: 'channel', header: copy.sales.channel, cell: (row) => row.channel }
  const status: GridColumn<Row> = { id: 'status', header: copy.sales.status, cell: (row) => row.status }
  const date: GridColumn<Row> = { id: 'date', header: copy.sales.date, cell: (row) => row.date }
  if (doc === 'quote') {
    return [
      number,
      customer,
      channel,
      status,
      date,
      { id: 'total', header: copy.sales.total, align: 'right', cell: (row) => row.total },
      { id: 'proforma', header: copy.sales.proforma, cell: (row) => row.proforma },
    ]
  }
  if (doc === 'order') {
    return [
      number,
      customer,
      channel,
      status,
      { id: 'entity', header: copy.sales.entity, cell: (row) => row.entity },
      date,
      { id: 'total', header: copy.sales.total, align: 'right', cell: (row) => row.total },
      { id: 'source', header: copy.sales.source, cell: (row) => row.source },
      { id: 'invoicing', header: copy.sales.invoicing, cell: (row) => row.invoicing },
    ]
  }
  return [
    number,
    { id: 'kind', header: copy.sales.kind, cell: (row) => row.kind },
    customer,
    status,
    { id: 'route', header: copy.sales.route, cell: (row) => row.route },
    { id: 'invoicing', header: copy.sales.invoicing, cell: (row) => row.invoicing },
    date,
    channel,
  ]
}

function widthsFor(doc: DocKind): Record<string, number> {
  if (doc === 'delivery') return { number: 160, kind: 120, customer: 220, status: 120, route: 160, invoicing: 140, date: 120 }
  return { number: 160, customer: 240, channel: 150, status: 120, entity: 90, date: 120, total: 120, source: 110, invoicing: 140, proforma: 110 }
}

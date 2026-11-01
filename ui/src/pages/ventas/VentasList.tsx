import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { copy, fill } from '@/i18n'
import { ApiError, api } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { formatMoney } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import { productAliases, useSalesCatalog } from '@/lib/sales-catalog'
import {
  CHANNELS,
  ORDER_STATUSES,
  channelLabel,
  docPath,
  formatAmount,
  formatIsoDate,
  invoicingLabel,
  orderStatusLabel,
  sourceLabel,
  type SalesOrder,
} from '@/lib/sales'
import { entityTone, statusTone } from '@/lib/status-tones'
import type { EntityChoice, Me } from '@/lib/types'
import { CreateDocument } from '@/pages/ventas/dialogs'
import { SalesHeader, SalesSwitch } from '@/pages/ventas/SalesTabs'
import { DownloadSimple } from '@/ui/icons'
import {
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  StatusPill,
  useCursorPages,
  useGridFilterLink,
  useMenuOpen,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'

type ColumnId = 'number' | 'customer' | 'channel' | 'entity' | 'date' | 'total' | 'status' | 'invoicing' | 'source'

const SIZES = [25, 50, 100, 200] as const
const COLUMN_KEY = 'winecore.columns.sales.order'
const DEFAULT_HIDDEN: ColumnId[] = ['source']

const GRID_LABELS = {
  addCalculation: copy.sales.grid.add,
  aggregation: () => copy.sales.grid.count,
  aggregations: copy.sales.grid.aggregations,
  count: (n: number) => n.toLocaleString('es'),
  clearCalculation: copy.sales.grid.clear,
  selectAll: copy.sales.selectAll,
  selectRow: copy.sales.selectRow,
  openRecord: copy.sales.openRecord,
  sortAscending: copy.sales.grid.asc,
  sortDescending: copy.sales.grid.desc,
  columnOptions: copy.sales.grid.column,
}

function readHidden(): Set<ColumnId> {
  const raw = readStorage(COLUMN_KEY)
  if (!raw) return new Set(DEFAULT_HIDDEN)
  try {
    return new Set(JSON.parse(raw) as ColumnId[])
  } catch {
    return new Set(DEFAULT_HIDDEN)
  }
}

/** The rail picks the entity; `?entity=all` overrides it for this list only. */
function entityOf(raw: string | null, rail: EntityChoice): string {
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

function entityName(code: string | null): string {
  if (code === 'PO') return copy.entity.po
  if (code === 'CVPO') return copy.entity.cvpo
  return code || '—'
}

/**
 * Pedidos: only WineCore has them, so this list reads `/v1/sales-orders` page by page. That
 * endpoint filters by one status, entity and channel and does not count or search; the search
 * box narrows the page on screen.
 */
export function VentasList({ me, creating = false }: { me: Me; creating?: boolean }) {
  useChromeTitle(copy.sales.title)
  const navigate = useNavigate()
  const toast = useToast()
  const desktop = useMinWidth(768)
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
  const [params, setParams] = useSearchParams()
  const { filter: rail, entities } = useEntity()
  const status = ORDER_STATUSES.includes(params.get('status') as SalesOrder['status']) ? params.get('status') ?? '' : ''
  const channel = params.get('channel') ?? ''
  const entity = entityOf(params.get('entity'), rail)
  const entityId = entity ? entities.find((item) => item.code === entity)?.id ?? '' : ''
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState(creating)
  const [formKey, setFormKey] = useState(0)
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({
    number: 160,
    customer: 260,
    channel: 140,
    entity: 100,
    date: 110,
    total: 130,
    status: 150,
    invoicing: 150,
    source: 110,
  })
  const canWrite = allows(me, 'sales.write')

  const pages = useCursorPages<SalesOrder>({
    queryKey: [status, entityId, channel].join('|'),
    storageKey: 'sales-orders',
    sizes: SIZES,
    fetchPage: ({ cursor, limit, signal }) => {
      const query = new URLSearchParams({ limit: String(limit) })
      if (status) query.set('status', status)
      if (entityId) query.set('entity', entityId)
      if (channel) query.set('channel', channel)
      if (cursor) query.set('cursor', cursor)
      return api<{ items: SalesOrder[]; next_cursor: string | null }>(`/v1/sales-orders?${query}`, { signal })
    },
  })

  const lines = useMemo(() => pages.items.flatMap((item) => item.lines), [pages.items])
  const aliases = useMemo(() => productAliases(lines), [lines])
  const catalog = useSalesCatalog(aliases)

  useEffect(() => {
    setDialog(creating)
  }, [creating])

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    if (!needle) return pages.items
    return pages.items.filter((item) =>
      [item.number ?? '', catalog.customerName(item.customer_id), item.customer_order_ref ?? '', item.notes ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [catalog, needle, pages.items])

  function setFilter(id: string, value: FilterValue) {
    const next = new URLSearchParams(params)
    const raw = typeof value === 'string' ? value : ''
    if (raw) next.set(id, raw)
    else if (id === 'entity' && rail !== 'all') next.set('entity', 'all')
    else next.delete(id)
    setParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const key of ['status', 'channel', 'entity']) next.delete(key)
    if (rail !== 'all') next.set('entity', 'all')
    setParams(next)
    setQ('')
  }

  function toggleColumn(id: ColumnId) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const filters: FilterDef[] = [
    {
      id: 'status',
      label: copy.sales.status,
      kind: 'single',
      options: ORDER_STATUSES.map((value) => ({ value, label: orderStatusLabel(value), tone: statusTone(value) })),
    },
    {
      id: 'entity',
      label: copy.salesDocs.entity,
      kind: 'single',
      options: entities.map((item) => ({ value: item.code, label: entityName(item.code), tone: entityTone(item.code) })),
    },
    {
      id: 'channel',
      label: copy.sales.channel,
      kind: 'single',
      options: CHANNELS.map((code) => ({ value: code, label: channelLabel(code) })),
    },
  ]

  const allColumns: (GridColumn<SalesOrder> & { id: ColumnId })[] = [
    { id: 'number', header: copy.sales.number, cell: (row) => row.number ?? copy.sales.draft },
    { id: 'customer', header: copy.sales.customer, cell: (row) => catalog.customerName(row.customer_id) },
    { id: 'channel', header: copy.sales.channel, cell: (row) => channelLabel(row.channel) },
    {
      id: 'entity',
      header: copy.salesDocs.entity,
      filterValue: (row) => entityName(row.entity_code),
      cell: (row) => (row.entity_code ? <StatusPill tone={entityTone(row.entity_code)}>{entityName(row.entity_code)}</StatusPill> : '—'),
    },
    { id: 'date', header: copy.sales.date, cell: (row) => formatIsoDate(row.order_date) },
    { id: 'total', header: copy.sales.total, align: 'right', cell: (row) => formatAmount(row.total) },
    {
      id: 'status',
      header: copy.sales.status,
      filterValue: (row) => orderStatusLabel(row.status),
      cell: (row) => <StatusPill tone={statusTone(row.status)}>{orderStatusLabel(row.status)}</StatusPill>,
    },
    {
      id: 'invoicing',
      header: copy.sales.invoicing,
      filterValue: (row) => invoicingLabel(row.invoicing_status),
      cell: (row) => <StatusPill tone={statusTone(row.invoicing_status)}>{invoicingLabel(row.invoicing_status)}</StatusPill>,
    },
    { id: 'source', header: copy.sales.source, cell: (row) => sourceLabel(row.source) },
  ]
  const columns = allColumns.filter((column) => column.id === 'number' || !hidden.has(column.id))

  const chosen = rows.filter((row) => picked.has(row.id))
  function exportSelection() {
    downloadCsv(
      'pedidos-seleccion.csv',
      [copy.sales.number, copy.sales.customer, copy.sales.channel, copy.salesDocs.entity, copy.sales.date, copy.sales.total, copy.sales.status, copy.sales.invoicing],
      chosen.map((row) => [
        row.number ?? copy.sales.draft,
        catalog.customerName(row.customer_id),
        channelLabel(row.channel),
        entityName(row.entity_code),
        row.order_date,
        row.total ?? '',
        orderStatusLabel(row.status),
        invoicingLabel(row.invoicing_status),
      ]),
    )
    toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
  }
  const actions: SelectionAction[] = [{ id: 'export', label: copy.lists.bulk.exportCsv, icon: DownloadSimple, onRun: exportSelection }]

  const pageSum = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
  const filtersActive = Boolean(needle || status || channel || entity)
  const loadingFirst = pages.loading && pages.items.length === 0 && !pages.error
  const screen = loadingFirst ? 'ventas-cargando' : rows.length === 0 ? 'ventas-vacio' : 'ventas-lista'
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  function openCreate() {
    setFormKey((value) => value + 1)
    setDialog(true)
  }

  function closeCreate() {
    setDialog(false)
    if (creating) navigate(docPath('order'))
  }

  if (!allows(me, 'sales.read')) return <NoPermission />

  const createButton = canWrite ? (
    <Button type="button" variant="primary" size="sm" onClick={openCreate}>
      {copy.sales.newOrder}
    </Button>
  ) : null

  return (
    <div data-screen={screen} data-doc="order" className="flex min-h-0 flex-1 flex-col">
      <SalesHeader current="order" actions={createButton} />

      <FilterBar
        leading={<SalesSwitch current="order" />}
        search={{ id: 'buscar-pedidos', value: q, onChange: setQ, placeholder: copy.sales.search }}
        filters={filters}
        values={{ status, entity, channel }}
        onChange={setFilter}
        onClear={clearFilters}
        grid={desktop ? gridFilters : undefined}
        selection={{
          count: picked.size,
          pageCount: rows.length,
          onSelectAll: () => setPicked(new Set(rows.map((row) => row.id))),
          onClear: () => setPicked(new Set()),
          actions,
        }}
        trailing={
          <>
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-end"
              className="max-md:hidden"
              panelClassName="min-w-[200px]"
              trigger={
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.sales.columns}>
                  {copy.sales.columns}
                </MenuChip>
              }
            >
              {allColumns
                .filter((column) => column.id !== 'number')
                .map((column) => (
                  <MenuItem key={column.id} checked={!hidden.has(column.id)} onClick={() => toggleColumn(column.id)}>
                    {column.header}
                  </MenuItem>
                ))}
            </GlassMenu>
            {createButton ? <span className="md:hidden">{createButton}</span> : null}
          </>
        }
      />

      {error && pages.items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`${docPath('order')}/${row.id}`)}
          rowHref={(row) => `${docPath('order')}/${row.id}`}
          total={pages.total ?? undefined}
          loading={pages.loading}
          filterLink={gridFilters}
          scrollKey={pages.pageKey}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.sales.noMatch : copy.sales.emptyOrders}
              description={filtersActive ? undefined : copy.sales.emptyOrdersHint}
              action={!filtersActive && createButton ? createButton : undefined}
            />
          }
        />
      )}

      <Pagination {...pages.pagination} detail={rows.length > 0 ? `${copy.sales.total} ${formatMoney(pageSum)}` : undefined} />

      {dialog ? <CreateDocument key={formKey} doc="order" customers={catalog.customers} onClose={closeCreate} onCreated={(id) => navigate(`${docPath('order')}/${id}`)} /> : null}
    </div>
  )
}

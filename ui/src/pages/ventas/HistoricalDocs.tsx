import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import type { LegacyDocument } from '@/lib/legacy'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'
import { day, entityLabel, money } from '@/pages/facturas/format'
import { listHoldedDocuments, moneySum, rowMatches, statusOptions, useHoldedDetail, useHoldedPage } from '@/pages/facturas/holded-detail'
import { HoldedDrawerBody, HoldedFilters, HoldedTotals } from '@/pages/facturas/holded-ui'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt, Search } from '@/ui/icons'
import { Badge, Button, DataGrid, Drawer, DrawerHeader, EmptyState, Input, type BadgeTone, type GridColumn } from '@/ui'

const GRID_LABELS = {
  addCalculation: 'Añadir cálculo',
  aggregation: () => 'Cálculo',
  aggregations: 'Cálculos',
  count: (n: number) => `${n}`,
  clearCalculation: 'Quitar cálculo',
  selectAll: 'Seleccionar todos',
  selectRow: 'Seleccionar fila',
  openRecord: 'Ver documento',
  sortAscending: 'Ascendente',
  sortDescending: 'Descendente',
  columnOptions: 'Opciones de columna',
}

function statusTone(status: string): BadgeTone {
  const key = status.trim().toLowerCase()
  if (key === 'facturado' || key === 'aceptado') return 'success'
  if (key === 'pendiente') return 'warning'
  return 'neutral'
}

export function HistoricalDocs({ me, kind }: { me: Me; kind: 'quote' | 'delivery' }) {
  const docKind = kind === 'quote' ? 'quote' : 'delivery_note'
  const title = kind === 'quote' ? copy.sales.quotes : copy.sales.deliveries
  useChromeTitle(title)
  const navigate = useNavigate()
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<LegacyDocument | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const scope = `${docKind}\0${entity}`
  const [seenScope, setSeenScope] = useState(scope)
  if (seenScope !== scope) {
    setSeenScope(scope)
    setStatus('')
    setOpen(null)
  }
  const activeStatus = seenScope === scope ? status : ''
  const page = useHoldedPage(listHoldedDocuments, {
    kind: docKind,
    entity,
    q: debounced,
    status: activeStatus,
    from,
    to,
  })
  const [widths, setWidths] = useState<Record<string, number>>({
    number: 140,
    date: 120,
    customer: 280,
    total: 120,
    status: 160,
    entity: 90,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const visible = useMemo(
    () => page.items.filter((row) => rowMatches(row, { status: activeStatus, from, to })),
    [activeStatus, from, page.items, to],
  )
  const statuses = useMemo(() => statusOptions(page.items, activeStatus), [activeStatus, page.items])
  const filtering = Boolean(activeStatus || from || to || debounced)

  const columns = useMemo<GridColumn<LegacyDocument>[]>(
    () => [
      { id: 'number', header: copy.sales.number, cell: (row) => row.number },
      { id: 'date', header: copy.sales.date, cell: (row) => day(row.issue_date) },
      { id: 'customer', header: copy.sales.customer, cell: (row) => row.counterparty_name },
      { id: 'total', header: copy.sales.total, align: 'right', cell: (row) => money(row.total) },
      {
        id: 'status',
        header: copy.sales.status,
        cell: (row) => <Badge tone={statusTone(row.status_holded)}>{row.status_holded || '—'}</Badge>,
      },
      { id: 'entity', header: copy.sales.entity, cell: (row) => entityLabel(row.entity_code) },
    ],
    [],
  )

  if (!allows(me, 'sales.read') && !allows(me, 'billing.read') && !allows(me, 'reports.read')) return <NoPermission />

  const bookPath = kind === 'quote' ? '/ventas/presupuestos?libro=winecore' : '/ventas/albaranes?libro=winecore'
  const screen = page.loading && page.items.length === 0
    ? 'ventas-holded-cargando'
    : visible.length === 0
      ? 'ventas-holded-vacio'
      : 'ventas-holded'
  const gridTotal = visible.length === page.items.length ? page.total : visible.length

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="truncate text-label font-medium text-ink-900">{title}</h1>
        <div className="ml-auto">
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate(bookPath)}>
            {copy.facturas.winecoreBook}
          </Button>
        </div>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-ventas-holded"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.sales.search}
            aria-label={copy.sales.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <HoldedFilters
            id="estado-ventas-holded"
            statusLabel={copy.sales.status}
            allLabel={copy.sales.all}
            status={activeStatus}
            statuses={statuses}
            onStatus={setStatus}
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
          />
        </div>
      </div>
      <p className={cn('shrink-0 border-b border-border-subtle py-2 text-caption text-text-tertiary', FRAME_GUTTER)}>
        {copy.facturas.holdedHint}
      </p>
      {page.loading && page.items.length === 0 ? null : (
        <HoldedTotals count={visible.length} total={moneySum(visible.map((row) => row.total))} />
      )}
      {page.error && page.items.length === 0 ? (
        <div className="p-4">
          <ErrorState
            title={`${copy.error.load} (${page.error.code})`}
            detail={page.error.message}
            onRetry={page.reload}
          />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setOpen(row)}
          total={gridTotal}
          loading={page.loading}
          empty={
            <EmptyState
              size="sm"
              title={filtering ? copy.sales.noMatch : kind === 'quote' ? copy.sales.emptyQuotes : copy.sales.emptyDeliveries}
              description={copy.facturas.holdedHint}
            />
          }
        />
      )}
      {page.cursor ? (
        <div className="flex h-10 shrink-0 items-center border-t border-border-subtle px-3 sm:px-4">
          <Button type="button" variant="ghost" size="sm" loading={page.loadingMore} onClick={() => void page.loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}
      <Drawer open={open != null} onClose={() => setOpen(null)} labelledBy="doc-holded" size="xl">
        {open ? <DocumentDrawer key={open.id} row={open} onClose={() => setOpen(null)} /> : null}
      </Drawer>
    </div>
  )
}

function DocumentDrawer({ row, onClose }: { row: LegacyDocument; onClose: () => void }) {
  const detail = useHoldedDetail(row.id, 'documents')
  return (
    <>
      <DrawerHeader titleId="doc-holded" title={row.number} onClose={onClose} />
      <HoldedDrawerBody
        hint={copy.facturas.holdedHint}
        showPdf={detail.showPdf}
        pdfBusy={detail.pdfBusy}
        pdfError={detail.pdfError}
        onPdf={() => void detail.openPdf()}
        detailState={detail.state}
        lines={detail.lines}
        fields={[
          { label: copy.sales.date, value: day(row.issue_date) },
          { label: copy.sales.customer, value: row.counterparty_name },
          { label: copy.sales.total, value: money(row.total) },
          { label: copy.sales.status, value: row.status_holded || '—' },
          { label: copy.sales.entity, value: entityLabel(row.entity_code) },
        ]}
      />
    </>
  )
}

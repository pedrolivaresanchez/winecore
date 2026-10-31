import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import type { LegacyInvoice } from '@/lib/legacy'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'
import { day, entityLabel, money } from '@/pages/facturas/format'
import { listHoldedInvoices, moneySum, rowMatches, statusOptions, useHoldedDetail, useHoldedPage } from '@/pages/facturas/holded-detail'
import { HoldedDrawerBody, HoldedFilters, HoldedTotals } from '@/pages/facturas/holded-ui'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { FileText, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  DataGrid,
  Drawer,
  DrawerHeader,
  EmptyState,
  Input,
  SegmentedControl,
  type BadgeTone,
  type GridColumn,
} from '@/ui'
import { iconStroke } from '@/lib/motion'

const GRID_LABELS = {
  addCalculation: 'Añadir cálculo',
  aggregation: () => 'Cálculo',
  aggregations: 'Cálculos',
  count: (n: number) => `${n}`,
  clearCalculation: 'Quitar cálculo',
  selectAll: 'Seleccionar todos',
  selectRow: 'Seleccionar fila',
  openRecord: 'Ver factura',
  sortAscending: 'Ascendente',
  sortDescending: 'Descendente',
  columnOptions: 'Opciones de columna',
}

function statusTone(status: string): BadgeTone {
  const key = status.trim().toLowerCase()
  if (key === 'pagado' || key === 'cobrado') return 'success'
  if (key === 'vencido') return 'danger'
  if (key === 'pendiente') return 'warning'
  return 'neutral'
}

export function HoldedList({ me, book = 'both' }: { me: Me; book?: 'both' | 'purchases' }) {
  useChromeTitle(book === 'purchases' ? copy.gastos.title : copy.facturas.holdedTitle)
  const navigate = useNavigate()
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const [params, setParams] = useSearchParams()
  // Abonos (número CN o total negativo) siguen en Ventas. No hay un libro aparte.
  const kind = book === 'purchases' || params.get('tipo') === 'compra' ? 'purchase' : 'sale'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<LegacyInvoice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const scope = `${kind}\0${entity}`
  const [seenScope, setSeenScope] = useState(scope)
  if (seenScope !== scope) {
    setSeenScope(scope)
    setStatus('')
    setOpen(null)
  }
  const activeStatus = seenScope === scope ? status : ''
  const page = useHoldedPage(listHoldedInvoices, {
    kind,
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
    pending: 120,
    status: 140,
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

  function setKind(next: 'sale' | 'purchase') {
    const query = new URLSearchParams(params)
    if (next === 'purchase') query.set('tipo', 'compra')
    else query.delete('tipo')
    setParams(query)
  }

  const columns = useMemo<GridColumn<LegacyInvoice>[]>(
    () => [
      { id: 'number', header: copy.facturas.number, cell: (row) => row.number },
      { id: 'date', header: copy.facturas.date, cell: (row) => day(row.issue_date) },
      { id: 'customer', header: copy.facturas.customer, cell: (row) => row.counterparty_name },
      { id: 'total', header: copy.facturas.total, align: 'right', cell: (row) => money(row.total) },
      { id: 'pending', header: copy.facturas.pendingAmount, align: 'right', cell: (row) => money(row.pending) },
      {
        id: 'status',
        header: copy.facturas.status,
        cell: (row) => <Badge tone={statusTone(row.status_holded)}>{row.status_holded}</Badge>,
      },
      { id: 'entity', header: copy.facturas.entity, cell: (row) => entityLabel(row.entity_code) },
    ],
    [],
  )

  if (
    !allows(me, 'billing.read')
    && !allows(me, 'reports.read')
    && !allows(me, 'finance.read')
    && !allows(me, 'sales.read')
    && !allows(me, 'purchasing.read')
  ) {
    return <NoPermission />
  }

  const screen = page.loading && page.items.length === 0
    ? 'facturas-cargando'
    : visible.length === 0
      ? 'facturas-holded-vacio'
      : 'facturas-holded'
  const gridTotal = visible.length === page.items.length ? page.total : visible.length

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <FileText className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <div className="min-w-0">
          <h1 className="truncate text-label font-medium text-ink-900">{book === 'purchases' ? copy.gastos.title : copy.facturas.holdedTitle}</h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate(book === 'purchases' ? '/gastos?libro=nuevos' : '/facturas?libro=emitidas')}
          >
            {copy.facturas.winecoreBook}
          </Button>
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          {book === 'both' ? (
            <SegmentedControl
              size="sm"
              aria-label={copy.facturas.holdedTitle}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'sale', content: copy.facturas.salesBook },
                { value: 'purchase', content: copy.facturas.purchaseBook },
              ]}
            />
          ) : null}
          <Input
            id="buscar-facturas-holded"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.facturas.search}
            aria-label={copy.facturas.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <HoldedFilters
            id="estado-facturas-holded"
            statusLabel={copy.facturas.status}
            allLabel={copy.facturas.all}
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
      {page.items.length > 0 || (!page.loading && page.error == null) ? (
        <HoldedTotals
          count={visible.length}
          total={moneySum(visible.map((row) => row.total))}
          pending={moneySum(visible.map((row) => row.pending))}
        />
      ) : null}

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
              title={filtering ? copy.facturas.noMatch : copy.facturas.holdedEmpty}
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

      <Drawer open={open != null} onClose={() => setOpen(null)} labelledBy="factura-holded" size="xl">
        {open ? <InvoiceDrawer key={open.id} row={open} onClose={() => setOpen(null)} /> : null}
      </Drawer>
    </div>
  )
}

function InvoiceDrawer({ row, onClose }: { row: LegacyInvoice; onClose: () => void }) {
  const detail = useHoldedDetail(row.id, 'invoices')
  return (
    <>
      <DrawerHeader titleId="factura-holded" title={row.number} onClose={onClose} />
      <HoldedDrawerBody
        hint={copy.facturas.holdedHint}
        showPdf={detail.showPdf}
        pdfBusy={detail.pdfBusy}
        pdfError={detail.pdfError}
        onPdf={() => void detail.openPdf()}
        detailState={detail.state}
        lines={detail.lines}
        fields={[
          { label: copy.facturas.date, value: day(row.issue_date) },
          { label: copy.facturas.customer, value: row.counterparty_name },
          { label: copy.facturas.total, value: money(row.total) },
          { label: copy.facturas.pendingAmount, value: money(row.pending) },
          { label: copy.facturas.status, value: row.status_holded },
          { label: copy.facturas.entity, value: entityLabel(row.entity_code) },
        ]}
      />
    </>
  )
}

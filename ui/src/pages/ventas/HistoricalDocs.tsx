import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { listLegacyDocuments, type LegacyDocument } from '@/lib/legacy'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'
import { day, entityLabel, money } from '@/pages/facturas/format'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt, Search } from '@/ui/icons'
import { Badge, Button, DataGrid, Drawer, DrawerBody, DrawerHeader, EmptyState, Input, type BadgeTone, type GridColumn } from '@/ui'

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
  const [items, setItems] = useState<LegacyDocument[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<LegacyDocument | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    listLegacyDocuments({ kind: docKind, entity, q: debounced, limit: 50 }, controller.signal)
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
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, debounced, docKind, entity])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listLegacyDocuments({ kind: docKind, entity, q: debounced, cursor, limit: 50 })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
  }

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
  const screen = loading ? 'ventas-holded-cargando' : items.length === 0 ? 'ventas-holded-vacio' : 'ventas-holded'

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
        </div>
      </div>
      <p className={cn('shrink-0 border-b border-border-subtle py-2 text-caption text-text-tertiary', FRAME_GUTTER)}>
        {copy.facturas.holdedHint}
      </p>
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
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setOpen(row)}
          total={total}
          loading={loading}
          empty={<EmptyState size="sm" title={kind === 'quote' ? copy.sales.emptyQuotes : copy.sales.emptyDeliveries} description={copy.facturas.holdedHint} />}
        />
      )}
      {cursor ? (
        <div className="flex h-10 shrink-0 items-center border-t border-border-subtle px-3 sm:px-4">
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}
      <Drawer open={open != null} onClose={() => setOpen(null)} labelledBy="doc-holded">
        {open ? (
          <>
            <DrawerHeader titleId="doc-holded" title={open.number} onClose={() => setOpen(null)} />
            <DrawerBody>
              <p className="text-caption text-text-tertiary">{copy.facturas.holdedHint}</p>
              <dl className="mt-4 grid gap-3">
                <Field label={copy.sales.date} value={day(open.issue_date)} />
                <Field label={copy.sales.customer} value={open.counterparty_name} />
                <Field label={copy.sales.total} value={money(open.total)} />
                <Field label={copy.sales.status} value={open.status_holded || '—'} />
                <Field label={copy.sales.entity} value={entityLabel(open.entity_code)} />
              </dl>
            </DrawerBody>
          </>
        ) : null}
      </Drawer>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label text-ink-900">{value}</dd>
    </div>
  )
}

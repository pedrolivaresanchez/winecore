import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { listLegacyInvoices, type LegacyInvoice } from '@/lib/legacy'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'
import { day, entityLabel, money } from '@/pages/facturas/format'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { FileText, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  DataGrid,
  EmptyState,
  Drawer,
  DrawerBody,
  DrawerHeader,
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

export function HoldedList({ me }: { me: Me }) {
  useChromeTitle(copy.facturas.holdedTitle)
  const navigate = useNavigate()
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const [params, setParams] = useSearchParams()
  const kind = params.get('tipo') === 'compra' ? 'purchase' : 'sale'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const [items, setItems] = useState<LegacyInvoice[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<LegacyInvoice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    listLegacyInvoices({ kind, entity, q: debounced, limit: 50 }, controller.signal)
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
  }, [attempt, debounced, entity, kind])

  function setKind(next: 'sale' | 'purchase') {
    const query = new URLSearchParams(params)
    if (next === 'purchase') query.set('tipo', 'compra')
    else query.delete('tipo')
    setParams(query)
    setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listLegacyInvoices({ kind, entity, q: debounced, cursor, limit: 50 })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
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

  if (!allows(me, 'billing.read') && !allows(me, 'reports.read') && !allows(me, 'finance.read') && !allows(me, 'sales.read')) {
    return <NoPermission />
  }

  const screen = loading ? 'facturas-cargando' : items.length === 0 ? 'facturas-holded-vacio' : 'facturas-holded'

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <FileText className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <div className="min-w-0">
          <h1 className="truncate text-label font-medium text-ink-900">{copy.facturas.holdedTitle}</h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/facturas?libro=emitidas')}>
            {copy.facturas.winecoreBook}
          </Button>
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
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
          empty={<EmptyState size="sm" title={copy.facturas.holdedEmpty} description={copy.facturas.holdedHint} />}
        />
      )}
      {cursor ? (
        <div className="flex h-10 shrink-0 items-center border-t border-border-subtle px-3 sm:px-4">
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}

      <Drawer open={open != null} onClose={() => setOpen(null)} labelledBy="factura-holded">
        {open ? (
          <>
            <DrawerHeader titleId="factura-holded" title={open.number} onClose={() => setOpen(null)} />
            <DrawerBody>
              <p className="text-caption text-text-tertiary">{copy.facturas.holdedHint}</p>
              <dl className="mt-4 grid gap-3">
                <Field label={copy.facturas.date} value={day(open.issue_date)} />
                <Field label={copy.facturas.customer} value={open.counterparty_name} />
                <Field label={copy.facturas.total} value={money(open.total)} />
                <Field label={copy.facturas.pendingAmount} value={money(open.pending)} />
                <Field label={copy.facturas.status} value={open.status_holded} />
                <Field label={copy.facturas.entity} value={entityLabel(open.entity_code)} />
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

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  Select,
  SkeletonRows,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import type { EntityChoice, Me } from '@/lib/types'
import { downloadBook, listExpenses } from '@/pages/gastos/api'
import { CATEGORIES, categoryLabel, currentQuarter, monthOptions, quarterOf, statusLabel, statusTone } from '@/pages/gastos/catalog'
import type { Expense, ExpenseQuery } from '@/pages/gastos/types'

const COLUMN_KEY = 'winecore.columns.expenses'
const COLUMN_IDS = ['supplier', 'tax_id', 'number', 'issue_date', 'entity', 'category', 'total', 'status'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_HIDDEN = new Set<ColumnId>(['tax_id'])

const GRID_LABELS = {
  addCalculation: 'Añadir cálculo',
  aggregation: () => 'Cálculo',
  aggregations: 'Cálculos',
  count: (n: number) => `${n}`,
  clearCalculation: 'Quitar cálculo',
  selectAll: 'Seleccionar todos',
  selectRow: 'Seleccionar fila',
  openRecord: 'Abrir gasto',
  sortAscending: 'Ascendente',
  sortDescending: 'Descendente',
  columnOptions: 'Opciones de columna',
}

const COLUMN_LABELS: Record<ColumnId, string> = {
  supplier: copy.gastos.supplier,
  tax_id: copy.gastos.taxId,
  number: copy.gastos.number,
  issue_date: copy.gastos.issueDate,
  entity: copy.gastos.entity,
  category: copy.gastos.category,
  total: copy.gastos.total,
  status: copy.gastos.status,
}

const STATUS_PILLS: { id: string; label: string }[] = [
  { id: '', label: copy.gastos.statusAll },
  { id: 'captured', label: copy.gastos.queue },
  { id: 'validated', label: copy.gastos.statuses.validated },
  { id: 'approved', label: copy.gastos.statuses.approved },
  { id: 'rejected', label: copy.gastos.statuses.rejected },
  { id: 'duplicate', label: copy.gastos.statuses.duplicate },
]

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

function entityOf(params: URLSearchParams, rail: EntityChoice): string {
  const raw = params.get('entity')
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

function money(value: string | null): string {
  if (!value) return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatMoney(parsed) : value
}

function matches(row: Expense, q: string, month: string, category: string): boolean {
  if (category && row.category_code !== category) return false
  if (month && !(row.issue_date ?? row.accounting_date ?? '').startsWith(month)) return false
  if (!q) return true
  const haystack = `${row.supplier_name ?? ''} ${row.supplier_tax_id ?? ''} ${row.supplier_invoice_number ?? ''}`.toLowerCase()
  return haystack.includes(q.toLowerCase())
}

export function ExpenseList({ me }: { me: Me }) {
  useChromeTitle(copy.gastos.title)
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const desktop = useMinWidth(768)
  const { filter: rail } = useEntity()
  const [params, setParams] = useSearchParams()
  const canWrite = allows(me, 'purchasing.write')
  const status = params.get('status') ?? ''
  const entity = entityOf(params, rail)
  const month = params.get('month') ?? ''
  const category = params.get('category') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q)
  const [items, setItems] = useState<Expense[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ supplier: 260, number: 140, total: 120, status: 140 })
  const [exporting, setExporting] = useState(false)
  const months = useMemo(() => monthOptions(), [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const query = useMemo<ExpenseQuery>(() => ({ status, entity, limit: 50 }), [entity, status])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    listExpenses(query, controller.signal)
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
  }, [query, attempt])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
    if (key === 'status' || key === 'entity') setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listExpenses({ ...query, cursor })
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
    if (id === 'supplier') return
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const visible = useMemo(
    () => items.filter((row) => matches(row, debounced, month, category)),
    [category, debounced, items, month],
  )
  const clientFiltered = Boolean(debounced || month || category)
  const shownTotal = clientFiltered ? visible.length : total

  const columns = useMemo<GridColumn<Expense>[]>(() => {
    const all: GridColumn<Expense>[] = [
      { id: 'supplier', header: copy.gastos.supplier, cell: (row) => row.supplier_name || '—' },
      { id: 'tax_id', header: copy.gastos.taxId, cell: (row) => row.supplier_tax_id || '—' },
      { id: 'number', header: copy.gastos.number, cell: (row) => row.supplier_invoice_number || '—' },
      { id: 'issue_date', header: copy.gastos.issueDate, cell: (row) => (row.issue_date ? formatDate(row.issue_date) : '—') },
      { id: 'entity', header: copy.gastos.entity, cell: (row) => row.legal_entity_code },
      { id: 'category', header: copy.gastos.category, cell: (row) => categoryLabel(row.category_code) },
      { id: 'total', header: copy.gastos.total, align: 'right', cell: (row) => money(row.total) },
      {
        id: 'status',
        header: copy.gastos.status,
        cell: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>,
      },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden])

  const filtersActive = Boolean(debounced || status || entity || month || category)
  const emptyTitle = filtersActive ? copy.gastos.noMatch : copy.gastos.empty
  const screen = loading ? 'gastos-cargando' : visible.length === 0 && !filtersActive ? 'gastos-vacio' : 'gastos'

  async function exportBook() {
    if (!entity) {
      toast(copy.gastos.bookNeedsEntity)
      return
    }
    setExporting(true)
    try {
      await downloadBook(entity, month ? quarterOf(month) ?? currentQuarter() : currentQuarter())
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.gastos.failed)
    } finally {
      setExporting(false)
    }
  }

  if (!allows(me, 'purchasing.read')) return <NoPermission />

  const addButton = canWrite ? (
    <Button type="button" variant="primary" size="sm" onClick={() => navigate('/gastos/capturar')}>
      {copy.gastos.add}
    </Button>
  ) : null

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.gastos.title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportBook()}>
            {copy.gastos.book}
          </Button>
          {addButton}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-gastos"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.gastos.search}
            aria-label={copy.gastos.search}
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
              <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.gastos.columns}>
                {copy.gastos.columns}
              </MenuChip>
            }
          >
            {COLUMN_IDS.map((id) => (
              <MenuItem key={id} checked={!hidden.has(id)} disabled={id === 'supplier'} onClick={() => toggleColumn(id)}>
                {COLUMN_LABELS[id]}
              </MenuItem>
            ))}
          </GlassMenu>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">{addButton}</div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {STATUS_PILLS.map((pill) => (
            <Chip key={pill.id || 'all'} pressed={status === pill.id} active={status === pill.id} onClick={() => setFilter('status', pill.id)}>
              {pill.label}
            </Chip>
          ))}
          <Chip pressed={!entity} active={!entity} onClick={() => setFilter('entity', 'all')}>
            {copy.entity.all}
          </Chip>
          <Chip pressed={entity === 'PO'} active={entity === 'PO'} onClick={() => setFilter('entity', entity === 'PO' ? 'all' : 'PO')}>
            {copy.entity.po}
          </Chip>
          <Chip pressed={entity === 'CVPO'} active={entity === 'CVPO'} onClick={() => setFilter('entity', entity === 'CVPO' ? 'all' : 'CVPO')}>
            {copy.entity.cvpo}
          </Chip>
          <Select id="filtro-mes" size="sm" aria-label={copy.gastos.month} value={month} onChange={(event) => setFilter('month', event.target.value)}>
            <option value="">{copy.gastos.month}</option>
            {months.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select
            id="filtro-categoria"
            size="sm"
            aria-label={copy.gastos.category}
            value={category}
            onChange={(event) => setFilter('category', event.target.value)}
          >
            <option value="">{copy.gastos.category}</option>
            {CATEGORIES.map((item) => (
              <option key={item.code} value={item.code}>
                {categoryLabel(item.code)}
              </option>
            ))}
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
      ) : desktop ? (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/gastos/${row.id}`)}
          rowHref={(row) => `/gastos/${row.id}`}
          total={shownTotal}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={emptyTitle}
              description={filtersActive ? undefined : copy.gastos.emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/gastos/capturar')}>
                    {copy.gastos.add}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2">
              <SkeletonRows rows={6} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Receipt strokeWidth={iconStroke} />}
              title={emptyTitle}
              description={filtersActive ? undefined : copy.gastos.emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/gastos/capturar')}>
                    {copy.gastos.add}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-2 p-3">
              {visible.map((row) => (
                <li key={row.id}>
                  <a
                    href={`/gastos/${row.id}`}
                    className="flex items-start gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-(--shadow-card)"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label font-medium text-ink-900">{row.supplier_name || '—'}</span>
                      <span className="mt-0.5 block truncate text-caption text-text-tertiary">
                        {[row.supplier_invoice_number, row.issue_date ? formatDate(row.issue_date) : null, row.legal_entity_code]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="mt-1 block truncate text-caption text-text-secondary">{categoryLabel(row.category_code)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-label font-medium text-ink-900">{money(row.total)}</span>
                      <Badge size="sm" tone={statusTone(row.status)}>
                        {statusLabel(row.status)}
                      </Badge>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cursor ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

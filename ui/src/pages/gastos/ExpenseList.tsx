import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { FRAME_GUTTER } from '@/ui/frame'
import { DownloadSimple, Receipt } from '@/ui/icons'
import {
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  SkeletonRows,
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
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { allows } from '@/lib/permissions'
import { entityTone, statusTone } from '@/lib/status-tones'
import { readStorage, writeStorage } from '@/lib/storage'
import type { EntityChoice, Me } from '@/lib/types'
import { downloadBook, listCategories, listExpenses } from '@/pages/gastos/api'
import { CATEGORIES, categoryLabel, currentQuarter, monthOptions, quarterOf, statusLabel } from '@/pages/gastos/catalog'
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

const STATUSES = ['captured', 'validated', 'approved', 'rejected', 'duplicate'] as const

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

export function ExpenseList({ me }: { me: Me }) {
  useChromeTitle(copy.gastos.title)
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
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
  const [categories, setCategories] = useState<{ code: string; name: string }[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ supplier: 260, number: 140, total: 120, status: 140 })
  const [exporting, setExporting] = useState(false)
  const months = useMemo(() => monthOptions(), [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    const current = params.get('q') ?? ''
    if (current === debounced) return
    const next = new URLSearchParams(params)
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    setParams(next, { replace: true })
  }, [debounced, params, setParams])

  useEffect(() => {
    const controller = new AbortController()
    listCategories(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setCategories(page.items.map((item) => ({ code: item.code, name: item.name })))
        }
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setCategories(CATEGORIES.map((item) => ({ code: item.code, name: categoryLabel(item.code) })))
      })
    return () => controller.abort()
  }, [])

  const categoryOptions = useMemo(
    () => categories ?? CATEGORIES.map((item) => ({ code: item.code, name: categoryLabel(item.code) })),
    [categories],
  )
  const query = useMemo<ExpenseQuery>(
    () => ({ status, entity, month, category, q: debounced }),
    [category, debounced, entity, month, status],
  )

  const pages = useCursorPages<Expense>({
    queryKey: JSON.stringify(query),
    storageKey: 'expenses',
    fetchPage: ({ cursor, limit, signal }) => listExpenses({ ...query, cursor: cursor ?? undefined, limit }, signal),
  })
  const items = pages.items
  const loading = pages.loading && items.length === 0
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: copy.gastos.status,
        kind: 'single',
        display: 'chips',
        options: STATUSES.map((value) => ({
          value,
          label: value === 'captured' ? copy.gastos.queue : statusLabel(value),
          tone: statusTone(value),
        })),
      },
      {
        id: 'entity',
        label: copy.gastos.entity,
        kind: 'single',
        options: [
          { value: 'PO', label: copy.entity.po, tone: entityTone('PO') },
          { value: 'CVPO', label: copy.entity.cvpo, tone: entityTone('CVPO') },
        ],
      },
      { id: 'month', label: copy.gastos.month, kind: 'single', options: months },
      {
        id: 'category',
        label: copy.gastos.category,
        kind: 'single',
        options: categoryOptions.map((item) => ({ value: item.code, label: item.name })),
      },
    ],
    [categoryOptions, months],
  )

  function setFilter(key: string, value: FilterValue) {
    const next = new URLSearchParams(params)
    if (typeof value === 'string' && value) next.set(key, value)
    else if (key === 'entity' && rail !== 'all') next.set('entity', 'all')
    else next.delete(key)
    setParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const key of ['status', 'month', 'category', 'q']) next.delete(key)
    if (rail !== 'all') next.set('entity', 'all')
    else next.delete('entity')
    setParams(next)
    setQ('')
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

  function categoryName(code: string | null): string {
    if (!code) return '—'
    return categoryOptions.find((item) => item.code === code)?.name ?? categoryLabel(code)
  }

  const columns = useMemo<GridColumn<Expense>[]>(() => {
    const nameOf = (code: string | null) => {
      if (!code) return '—'
      return categoryOptions.find((item) => item.code === code)?.name ?? categoryLabel(code)
    }
    const all: GridColumn<Expense>[] = [
      { id: 'supplier', header: copy.gastos.supplier, cell: (row) => row.supplier_name || '—' },
      { id: 'tax_id', header: copy.gastos.taxId, cell: (row) => row.supplier_tax_id || '—' },
      { id: 'number', header: copy.gastos.number, cell: (row) => row.supplier_invoice_number || '—' },
      { id: 'issue_date', header: copy.gastos.issueDate, cell: (row) => (row.issue_date ? formatDate(row.issue_date) : '—') },
      {
        id: 'entity',
        header: copy.gastos.entity,
        filterValue: (row) => row.legal_entity_code,
        cell: (row) => <StatusPill tone={entityTone(row.legal_entity_code)}>{row.legal_entity_code}</StatusPill>,
      },
      { id: 'category', header: copy.gastos.category, cell: (row) => nameOf(row.category_code) },
      { id: 'total', header: copy.gastos.total, align: 'right', cell: (row) => money(row.total) },
      {
        id: 'status',
        header: copy.gastos.status,
        filterValue: (row) => statusLabel(row.status),
        cell: (row) => <StatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusPill>,
      },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [categoryOptions, hidden])

  const chosen = items.filter((item) => picked.has(item.id))

  function exportSelection() {
    downloadCsv(
      'gastos-seleccion.csv',
      COLUMN_IDS.map((id) => COLUMN_LABELS[id]),
      chosen.map((row) => [
        row.supplier_name,
        row.supplier_tax_id,
        row.supplier_invoice_number,
        row.issue_date,
        row.legal_entity_code,
        categoryName(row.category_code),
        row.total,
        statusLabel(row.status),
      ]),
    )
    toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
  }

  const actions: SelectionAction[] = [{ id: 'export', label: copy.lists.bulk.exportCsv, icon: DownloadSimple, onRun: exportSelection }]

  const filtersActive = Boolean(debounced || status || entity || month || category)
  const emptyTitle = filtersActive ? copy.gastos.noMatch : copy.gastos.empty
  const screen = loading ? 'gastos-cargando' : items.length === 0 && !filtersActive ? 'gastos-vacio' : 'gastos'

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

  const empty = (
    <EmptyState
      size="sm"
      icon={desktop ? undefined : <Receipt strokeWidth={iconStroke} />}
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
  )

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

      <FilterBar
        search={{ id: 'buscar-gastos', value: q, onChange: setQ, placeholder: copy.gastos.search }}
        filters={filters}
        values={{ status, entity, month, category }}
        onChange={setFilter}
        onClear={clearFilters}
        grid={desktop ? gridFilters : undefined}
        selection={{
          count: picked.size,
          pageCount: items.length,
          onSelectAll: () => setPicked(new Set(items.map((item) => item.id))),
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
            <span className="md:hidden">{addButton}</span>
          </>
        }
      />

      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : desktop ? (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/gastos/${row.id}`)}
          rowHref={(row) => `/gastos/${row.id}`}
          total={pages.total ?? undefined}
          loading={pages.loading}
          filterLink={gridFilters}
          empty={empty}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2">
              <SkeletonRows rows={6} />
            </div>
          ) : items.length === 0 ? (
            empty
          ) : (
            <ul className="flex flex-col gap-2 p-3">
              {items.map((row) => (
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
                      <span className="mt-1 block truncate text-caption text-text-secondary">{categoryName(row.category_code)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-label font-medium text-ink-900">{money(row.total)}</span>
                      <StatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusPill>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Pagination {...pages.pagination} />
    </div>
  )
}

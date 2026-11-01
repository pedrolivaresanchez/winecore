import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { listContacts } from '@/lib/contacts'
import { downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { docPath } from '@/lib/sales'
import { entityTone, originTone, statusTone, type StatusTone } from '@/lib/status-tones'
import { readStorage, writeStorage } from '@/lib/storage'
import type { EntityChoice, Me } from '@/lib/types'
import { DocumentModal } from '@/pages/documents/DocumentModal'
import { docKey, parseDocKey, type RecordDoc } from '@/pages/documents/doc-key'
import {
  DELIVERY_STATES,
  SALES_SORTS,
  VERIFACTU_STATES,
  listSalesDocuments,
  modalSourceOf,
  type DeliveryState,
  type SalesDirection,
  type SalesDocKind,
  type SalesDocumentItem,
  type SalesDocumentPage,
  type SalesSort,
  type VerifactuState,
} from '@/pages/documents/sales-documents'
import { useDocParam } from '@/pages/documents/use-doc-param'
import { exportBook, requestBatch } from '@/pages/facturas/api'
import { downloadBook } from '@/pages/gastos/api'
import { currentQuarter, quarterOf } from '@/pages/gastos/catalog'
import { SalesHeader, SalesSwitch } from '@/pages/ventas/SalesTabs'
import { FRAME_GUTTER } from '@/ui/frame'
import { DownloadSimple, FileText, Receipt, Send } from '@/ui/icons'
import {
  Badge,
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
  useGridFilterLink,
  useMenuOpen,
  usePageSize,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridAggregation,
  type GridColumn,
  type SelectionAction,
  type SortDir,
} from '@/ui'

type Book = 'invoice' | 'purchase' | 'quote' | 'delivery_note'
type ColumnId = 'number' | 'date' | 'customer' | 'entity' | 'total' | 'pending' | 'due' | 'status' | 'verifactu' | 'delivery'

const SIZES = [25, 50, 100, 200] as const
const LIST_KEYS = ['q', 'status', 'entity', 'origin', 'from', 'to', 'customer', 'verifactu', 'delivery', 'page']
const DEFAULT_HIDDEN: Record<Book, ColumnId[]> = {
  invoice: ['due', 'verifactu', 'delivery'],
  purchase: ['due'],
  quote: ['due'],
  delivery_note: [],
}

const GRID_LABELS = {
  addCalculation: copy.sales.grid.add,
  aggregation: () => copy.salesDocs.sum,
  aggregations: copy.sales.grid.aggregations,
  count: (n: number) => n.toLocaleString('es'),
  clearCalculation: copy.sales.grid.clear,
  selectAll: copy.sales.selectAll,
  selectRow: copy.sales.selectRow,
  openRecord: copy.salesDocs.openRecord,
  sortAscending: copy.sales.grid.asc,
  sortDescending: copy.sales.grid.desc,
  columnOptions: copy.sales.grid.column,
}

const VERIFACTU_TONE: Record<VerifactuState, StatusTone> = { pending: 'warning', accepted: 'success', rejected: 'pink' }
const DELIVERY_TONE: Record<DeliveryState, StatusTone> = {
  pending: 'warning',
  sent: 'success',
  failed: 'danger',
  no_recipient: 'warning',
  none: 'neutral',
}

function bookOf(kind: SalesDocKind, direction: SalesDirection): Book {
  return kind === 'invoice' && direction === 'purchase' ? 'purchase' : kind
}

function columnKey(book: Book): string {
  return `winecore.columns.sales-documents.${book}`
}

function readHidden(book: Book): Set<ColumnId> {
  const raw = readStorage(columnKey(book))
  if (!raw) return new Set(DEFAULT_HIDDEN[book])
  try {
    return new Set(JSON.parse(raw) as ColumnId[])
  } catch {
    return new Set(DEFAULT_HIDDEN[book])
  }
}

/** The rail picks the entity; `?entity=all` overrides it for this list only. */
function entityOf(params: URLSearchParams, rail: EntityChoice): string {
  const raw = params.get('entity')
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

function listOf(raw: string | null): string[] {
  return (raw ?? '').split(',').map((value) => value.trim()).filter(Boolean)
}

/** The panel links here with `?verifactu=pendiente`. */
function verifactuOf(raw: string | null): VerifactuState | '' {
  const value = raw === 'pendiente' ? 'pending' : raw
  return VERIFACTU_STATES.includes(value as VerifactuState) ? (value as VerifactuState) : ''
}

function money(value: string | null): string {
  if (value == null) return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatMoney(parsed) : value
}

function day(value: string | null): string {
  return value ? formatDate(value) : '—'
}

function entityName(code: string): string {
  if (code === 'PO') return copy.entity.po
  if (code === 'CVPO') return copy.entity.cvpo
  return code || '—'
}

function monthRange(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(last).padStart(2, '0')}` }
}

function saveText(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function canRead(me: Me, book: Book): boolean {
  const permissions = book === 'purchase'
    ? ['purchasing.read', 'reports.read', 'finance.read']
    : book === 'invoice'
      ? ['billing.read', 'reports.read', 'finance.read', 'sales.read']
      : ['sales.read', 'billing.read', 'reports.read', 'finance.read']
  return permissions.some((permission) => allows(me, permission))
}

/**
 * One list per book, Holded's history and WineCore's own documents together, read from
 * `/v1/sales-documents`. Filters, sort and page live in the URL; the open document in `?doc=`.
 */
export function SalesDocumentList({ me, kind, direction = 'sale' }: { me: Me; kind: SalesDocKind; direction?: SalesDirection }) {
  const book = bookOf(kind, direction)
  const title = copy.salesDocs.titles[book]
  useChromeTitle(book === 'invoice' || book === 'purchase' ? title : copy.sales.title)
  const navigate = useNavigate()
  const toast = useToast()
  const desktop = useMinWidth(768)
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
  const opened = useDocParam()
  const { filter: rail } = useEntity()
  const [params, setParams] = useSearchParams()
  const tracked = book === 'invoice'
  const salesDoc = kind === 'quote' ? 'quote' : 'delivery'

  const statusParam = params.get('status') ?? ''
  const statuses = useMemo(() => listOf(statusParam), [statusParam])
  const entity = entityOf(params, rail)
  const origin = params.get('origin') === 'holded' || params.get('origin') === 'winecore' ? params.get('origin') ?? '' : ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const customer = params.get('customer') ?? ''
  const verifactu = tracked ? verifactuOf(params.get('verifactu')) : ''
  const delivery = tracked && DELIVERY_STATES.includes(params.get('delivery') as DeliveryState) ? (params.get('delivery') as DeliveryState) : ''
  const sortRaw = params.get('sort') as SalesSort | null
  const sort: SalesSort = sortRaw && SALES_SORTS.includes(sortRaw) && (sortRaw !== 'pending' || kind === 'invoice') ? sortRaw : 'date'
  const dir: SortDir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1)
  const [pageSize, setPageSize] = usePageSize(`sales-documents.${book}`, SIZES, 50)

  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const [data, setData] = useState<SalesDocumentPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(() => readHidden(book))
  const [aggregation, setAggregation] = useState<Record<string, GridAggregation | undefined>>({ total: 'sum', pending: 'sum' })
  const [widths, setWidths] = useState<Record<string, number>>({
    number: 170,
    date: 110,
    customer: 280,
    entity: 100,
    total: 130,
    pending: 130,
    due: 120,
    status: 160,
    verifactu: 120,
    delivery: 150,
  })
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if ((params.get('q') ?? '') === debounced) return
    const next = new URLSearchParams(params)
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    next.delete('page')
    setParams(next, { replace: true })
  }, [debounced, params, setParams])

  const query = useMemo(() => {
    const next = new URLSearchParams({ kind, limit: String(pageSize), offset: String((page - 1) * pageSize) })
    if (direction === 'purchase') next.set('direction', 'purchase')
    if (debounced) next.set('q', debounced)
    if (statuses.length > 0) next.set('status', statuses.join(','))
    if (entity) next.set('entity', entity)
    if (origin) next.set('origin', origin)
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (customer) next.set('customer_id', customer)
    if (verifactu) next.set('verifactu', verifactu)
    if (delivery) next.set('delivery', delivery)
    if (sort !== 'date' || dir !== 'desc') {
      next.set('sort', sort)
      next.set('dir', dir)
    }
    return next.toString()
  }, [customer, debounced, delivery, dir, direction, entity, from, kind, origin, page, pageSize, sort, statuses, to, verifactu])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    listSalesDocuments(new URLSearchParams(query), controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setData(next)
        setError(null)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return
        setError(reason instanceof ApiError ? reason : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => controller.abort()
  }, [attempt, query])

  useEffect(() => {
    setPicked(new Set())
  }, [query])

  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? null

  useEffect(() => {
    if (!data || data.items.length > 0 || data.total === 0 || page === 1) return
    const next = new URLSearchParams(params)
    next.set('page', String(Math.max(1, Math.ceil(data.total / pageSize))))
    setParams(next, { replace: true })
  }, [data, page, pageSize, params, setParams])

  const contactRole = book === 'purchase' ? 'supplier' : 'customer'
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const canContacts = allows(me, 'contacts.read')
  useEffect(() => {
    if (!canContacts) return
    const controller = new AbortController()
    listContacts({ role: contactRole, limit: 100 }, controller.signal)
      .then((found) => setContacts(found.items.map((item) => ({ id: item.id, name: item.legal_name }))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [canContacts, contactRole])
  const pickedContact = useApi<{ id: string; legal_name: string }>(
    customer && canContacts && !contacts.some((item) => item.id === customer) ? `/v1/contacts/${customer}` : null,
  )

  function update(change: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    change(next)
    next.delete('page')
    setParams(next)
  }

  function setFilter(id: string, value: FilterValue) {
    update((next) => {
      if (id === 'date') {
        const range = value && typeof value === 'object' && !Array.isArray(value) ? value : null
        if (range?.from) next.set('from', range.from)
        else next.delete('from')
        if (range?.to) next.set('to', range.to)
        else next.delete('to')
        return
      }
      const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
      if (raw) next.set(id, raw)
      else if (id === 'entity' && rail !== 'all') next.set('entity', 'all')
      else next.delete(id)
    })
  }

  function clearFilters() {
    update((next) => {
      for (const key of LIST_KEYS) next.delete(key)
      if (rail !== 'all') next.set('entity', 'all')
    })
    setQ('')
    setDebounced('')
  }

  function goPage(target: number) {
    const next = new URLSearchParams(params)
    if (target > 1) next.set('page', String(target))
    else next.delete('page')
    setParams(next)
  }

  function setSort(id: string, nextDir: SortDir) {
    update((next) => {
      if (id === 'date' && nextDir === 'desc') {
        next.delete('sort')
        next.delete('dir')
      } else {
        next.set('sort', id)
        next.set('dir', nextDir)
      }
    })
  }

  function toggleColumn(id: ColumnId) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(columnKey(book), JSON.stringify([...next]))
      return next
    })
  }

  const facets = data?.facets
  const filters = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      {
        id: 'status',
        label: copy.salesDocs.status,
        kind: 'multi',
        options: (facets?.status ?? [])
          .filter((facet) => facet.count > 0 || statuses.includes(facet.value))
          .map((facet) => ({ value: facet.value, label: facet.label, count: facet.count, tone: statusTone(facet.value) })),
      },
      {
        id: 'entity',
        label: copy.salesDocs.entity,
        kind: 'single',
        options: (facets?.entity ?? [{ value: 'PO', label: copy.entity.po, count: 0 }, { value: 'CVPO', label: copy.entity.cvpo, count: 0 }]).map((facet) => ({
          value: facet.value,
          label: facet.label,
          count: facets ? facet.count : undefined,
          tone: entityTone(facet.value),
        })),
      },
      { id: 'date', label: copy.salesDocs.date, kind: 'date' },
    ]
    if ((data?.origins.length ?? 2) > 1) {
      defs.push({
        id: 'origin',
        label: copy.lists.origin.label,
        kind: 'single',
        options: (['holded', 'winecore'] as const).map((value) => ({
          value,
          label: copy.lists.origin[value],
          count: facets?.origin.find((facet) => facet.value === value)?.count,
          tone: originTone(value),
        })),
      })
    }
    if (canContacts) {
      const named = pickedContact.data ? [{ id: pickedContact.data.id, name: pickedContact.data.legal_name }] : []
      defs.push({
        id: 'customer',
        label: book === 'purchase' ? copy.salesDocs.supplier : copy.salesDocs.customer,
        kind: 'single',
        optional: true,
        options: [...named, ...contacts].map((item) => ({ value: item.id, label: item.name })),
      })
    }
    if (tracked) {
      defs.push(
        {
          id: 'verifactu',
          label: copy.salesDocs.verifactu,
          kind: 'single',
          optional: true,
          options: VERIFACTU_STATES.map((value) => ({ value, label: copy.salesDocs.verifactuStates[value], tone: VERIFACTU_TONE[value] })),
        },
        {
          id: 'delivery',
          label: copy.salesDocs.delivery,
          kind: 'single',
          optional: true,
          options: DELIVERY_STATES.map((value) => ({ value, label: copy.salesDocs.deliveryStates[value], tone: DELIVERY_TONE[value] })),
        },
      )
    }
    return defs
  }, [book, canContacts, contacts, data?.origins.length, facets, pickedContact.data, statuses, tracked])

  const values = {
    status: statuses,
    entity,
    origin,
    date: from || to ? { from: from || to, to: to || from } : null,
    customer,
    verifactu,
    delivery,
  }

  const columns = useMemo<GridColumn<SalesDocumentItem>[]>(() => {
    const all: (GridColumn<SalesDocumentItem> & { id: ColumnId })[] = [
      {
        id: 'number',
        header: copy.salesDocs.number,
        sortable: true,
        filterValue: (row) => row.number ?? copy.salesDocs.draft,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate', !row.number && 'text-text-tertiary')}>{row.number ?? copy.salesDocs.draft}</span>
            {row.origin === 'holded' ? (
              <Badge size="sm" tone="neutral" className="shrink-0" title={copy.salesDocs.holdedTip}>
                {copy.salesDocs.holded}
              </Badge>
            ) : null}
          </span>
        ),
      },
      { id: 'date', header: copy.salesDocs.date, sortable: true, cell: (row) => day(row.issue_date) },
      {
        id: 'customer',
        header: book === 'purchase' ? copy.salesDocs.supplier : copy.salesDocs.customer,
        sortable: true,
        cell: (row) => row.customer.name || '—',
      },
      {
        id: 'entity',
        header: copy.salesDocs.entity,
        filterValue: (row) => entityName(row.entity_code),
        cell: (row) => <StatusPill tone={entityTone(row.entity_code)}>{entityName(row.entity_code)}</StatusPill>,
      },
      { id: 'total', header: copy.salesDocs.total, align: 'right', sortable: true, aggregations: ['sum'], cell: (row) => money(row.total) },
      ...(kind === 'invoice'
        ? [{ id: 'pending' as const, header: copy.salesDocs.pending, align: 'right' as const, sortable: true, aggregations: ['sum' as const], cell: (row: SalesDocumentItem) => money(row.pending) }]
        : []),
      ...(kind === 'delivery_note'
        ? []
        : [{ id: 'due' as const, header: kind === 'quote' ? copy.salesDocs.validUntil : copy.salesDocs.due, cell: (row: SalesDocumentItem) => day(row.due_date) }]),
      {
        id: 'status',
        header: copy.salesDocs.status,
        filterValue: (row) => row.status_label,
        cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status_label}</StatusPill>,
      },
      ...(tracked
        ? [
            {
              id: 'verifactu' as const,
              header: copy.salesDocs.verifactu,
              filterValue: (row: SalesDocumentItem) => (row.verifactu ? copy.salesDocs.verifactuStates[row.verifactu] : ''),
              cell: (row: SalesDocumentItem) =>
                row.verifactu ? <StatusPill tone={VERIFACTU_TONE[row.verifactu]}>{copy.salesDocs.verifactuStates[row.verifactu]}</StatusPill> : '—',
            },
            {
              id: 'delivery' as const,
              header: copy.salesDocs.delivery,
              filterValue: (row: SalesDocumentItem) => (row.delivery ? copy.salesDocs.deliveryStates[row.delivery] : ''),
              cell: (row: SalesDocumentItem) =>
                row.delivery ? <StatusPill tone={DELIVERY_TONE[row.delivery]}>{copy.salesDocs.deliveryStates[row.delivery]}</StatusPill> : '—',
            },
          ]
        : []),
    ]
    const shown = new Set(hidden)
    if (verifactu) shown.delete('verifactu')
    if (delivery) shown.delete('delivery')
    return all.filter((column) => column.id === 'number' || !shown.has(column.id))
  }, [book, delivery, hidden, kind, tracked, verifactu])

  const choosable = useMemo(() => {
    const ids: ColumnId[] = ['date', 'customer', 'entity', 'total']
    if (kind === 'invoice') ids.push('pending')
    if (kind !== 'delivery_note') ids.push('due')
    ids.push('status')
    if (tracked) ids.push('verifactu', 'delivery')
    return ids
  }, [kind, tracked])

  const columnLabel: Record<ColumnId, string> = {
    number: copy.salesDocs.number,
    date: copy.salesDocs.date,
    customer: book === 'purchase' ? copy.salesDocs.supplier : copy.salesDocs.customer,
    entity: copy.salesDocs.entity,
    total: copy.salesDocs.total,
    pending: copy.salesDocs.pending,
    due: kind === 'quote' ? copy.salesDocs.validUntil : copy.salesDocs.due,
    status: copy.salesDocs.status,
    verifactu: copy.salesDocs.verifactu,
    delivery: copy.salesDocs.delivery,
  }

  const keyOf = (row: SalesDocumentItem): string | null => {
    const source = modalSourceOf(row, direction)
    return source ? docKey({ source, id: row.id }) : null
  }
  const pageOf = (row: SalesDocumentItem) => (book === 'purchase' ? `/gastos/${row.id}` : `${docPath(salesDoc)}/${row.id}`)

  function openRow(row: SalesDocumentItem) {
    const key = keyOf(row)
    if (key) opened.open(key)
    else navigate(pageOf(row))
  }

  /** Links shared before the key carried its source still open, as long as the row is on screen. */
  const current: RecordDoc | null = useMemo(() => {
    const parsed = parseDocKey(opened.id)
    if (parsed || !opened.id) return parsed
    const row = items.find((item) => item.id === opened.id)
    const source = row ? modalSourceOf(row, direction) : null
    return row && source ? { source, id: row.id } : null
  }, [direction, items, opened.id])
  const [shown, setShown] = useState<RecordDoc | null>(current)
  if (current && (current.id !== shown?.id || current.source !== shown?.source)) setShown(current)

  const viewable = useMemo(() => items.filter((row) => modalSourceOf(row, direction) != null), [direction, items])
  const viewableIds = useMemo(() => viewable.map((row) => row.id), [viewable])

  function step(id: string) {
    const row = viewable.find((item) => item.id === id)
    const key = row ? keyOf(row) : null
    if (key) opened.move(key)
  }

  const chosen = items.filter((row) => picked.has(row.id))

  function exportSelection() {
    const header = [
      copy.salesDocs.number,
      copy.salesDocs.date,
      columnLabel.customer,
      copy.salesDocs.entity,
      copy.salesDocs.total,
      ...(kind === 'invoice' ? [copy.salesDocs.pending] : []),
      ...(kind === 'delivery_note' ? [] : [columnLabel.due]),
      copy.salesDocs.status,
      copy.lists.origin.label,
      ...(tracked ? [copy.salesDocs.verifactu, copy.salesDocs.delivery] : []),
    ]
    downloadCsv(
      `${copy.salesDocs.files[book]}-seleccion.csv`,
      header,
      chosen.map((row) => [
        row.number ?? copy.salesDocs.draft,
        row.issue_date ?? '',
        row.customer.name,
        entityName(row.entity_code),
        row.total ?? '',
        ...(kind === 'invoice' ? [row.pending ?? ''] : []),
        ...(kind === 'delivery_note' ? [] : [row.due_date ?? '']),
        row.status_label,
        copy.lists.origin[row.origin],
        ...(tracked
          ? [row.verifactu ? copy.salesDocs.verifactuStates[row.verifactu] : '', row.delivery ? copy.salesDocs.deliveryStates[row.delivery] : '']
          : []),
      ]),
    )
    toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
  }

  const drafts = chosen.filter((row) => row.origin === 'winecore' && row.status === 'draft')
  const issuable = tracked && allows(me, 'billing.write') && drafts.length === chosen.length && new Set(drafts.map((row) => row.entity_code)).size === 1

  async function issueDrafts() {
    if (!issuable) {
      toast(copy.salesDocs.issueNeedsDrafts)
      return
    }
    try {
      await requestBatch(drafts.map((row) => row.id))
      toast(copy.facturas.batchPending)
      setPicked(new Set())
      setAttempt((value) => value + 1)
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.api.generic)
    }
  }

  const actions: SelectionAction[] = [{ id: 'export', label: copy.lists.bulk.exportCsv, icon: DownloadSimple, onRun: exportSelection }]
  if (tracked && allows(me, 'billing.write')) {
    actions.push({ id: 'issue', label: copy.salesDocs.issueDrafts, icon: Send, disabled: !issuable, onRun: issueDrafts })
  }

  async function exportPeriod() {
    if (!entity) {
      toast(copy.salesDocs.bookNeedsEntity)
      return
    }
    setExporting(true)
    try {
      if (book === 'purchase') {
        await downloadBook(entity, from ? quarterOf(from.slice(0, 7)) ?? currentQuarter() : currentQuarter())
      } else {
        const range = from && to ? { from, to } : monthRange()
        saveText(`libro-emitidas-${entity}.csv`, await exportBook(entity, range.from, range.to))
      }
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setExporting(false)
    }
  }

  if (!canRead(me, book)) return <NoPermission />

  const filtersActive = Boolean(debounced || statuses.length || entity || origin || from || to || customer || verifactu || delivery)
  const loadingFirst = loading && !data
  const screen = screenOf(book, loadingFirst ? 'loading' : items.length === 0 && !filtersActive ? 'empty' : 'list')

  const createPath = book === 'invoice'
    ? allows(me, 'billing.write') ? '/facturas/nueva' : null
    : book === 'purchase'
      ? allows(me, 'purchasing.write') ? '/gastos/capturar' : null
      : allows(me, 'sales.write') ? `${docPath(salesDoc)}/nuevo` : null
  const createLabel = book === 'invoice' ? copy.facturas.new : book === 'purchase' ? copy.gastos.add : kind === 'quote' ? copy.sales.newQuote : copy.sales.newDelivery
  const createButton = createPath ? (
    <Button type="button" variant="primary" size="sm" onClick={() => navigate(createPath)}>
      {createLabel}
    </Button>
  ) : null
  const bookButton = book === 'invoice' || book === 'purchase' ? (
    <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportPeriod()}>
      {book === 'invoice' ? copy.facturas.export : copy.gastos.book}
    </Button>
  ) : null

  const empty = (
    <EmptyState
      size="sm"
      icon={desktop ? undefined : <FileText strokeWidth={iconStroke} />}
      title={filtersActive ? copy.salesDocs.noMatch : copy.salesDocs.empty[book]}
      action={!filtersActive && createButton ? createButton : undefined}
    />
  )

  const Icon = book === 'invoice' ? FileText : Receipt

  return (
    <div data-screen={screen} data-book={book} className="flex min-h-0 flex-1 flex-col">
      {book === 'quote' || book === 'delivery_note' ? (
        <SalesHeader current={salesDoc} actions={createButton} />
      ) : (
        <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
          <Icon className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
          <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{title}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {bookButton}
            {createButton}
          </div>
        </header>
      )}

      <FilterBar
        leading={book === 'quote' || book === 'delivery_note' ? <SalesSwitch current={salesDoc} /> : undefined}
        search={{
          id: `buscar-${copy.salesDocs.files[book]}`,
          value: q,
          onChange: setQ,
          placeholder: book === 'purchase' ? copy.salesDocs.searchSupplier : copy.salesDocs.search,
        }}
        filters={filters}
        values={values}
        onChange={setFilter}
        onClear={clearFilters}
        grid={desktop ? gridFilters : undefined}
        selection={{
          count: picked.size,
          pageCount: items.length,
          onSelectAll: () => setPicked(new Set(items.map((row) => row.id))),
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
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.salesDocs.columns}>
                  {copy.salesDocs.columns}
                </MenuChip>
              }
            >
              {choosable.map((id) => (
                <MenuItem key={id} checked={!hidden.has(id)} onClick={() => toggleColumn(id)}>
                  {columnLabel[id]}
                </MenuItem>
              ))}
            </GlassMenu>
            {createButton ? <span className="md:hidden">{createButton}</span> : null}
          </>
        }
      />

      {error && !data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : desktop ? (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          sortBy={sort}
          sortDir={dir}
          onSort={setSort}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={openRow}
          rowHref={(row) => {
            const key = keyOf(row)
            return key ? opened.hrefFor(key) : pageOf(row)
          }}
          openRowKey={current?.id ?? null}
          aggregation={aggregation}
          onAggregationChange={(id, value) => setAggregation((now) => ({ ...now, [id]: value ?? undefined }))}
          aggregationValues={{ total: data ? money(data.totals.amount) : null, pending: data ? money(data.totals.pending) : null }}
          total={total ?? undefined}
          loading={loading}
          filterLink={gridFilters}
          scrollKey={query}
          empty={empty}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingFirst ? (
            <div className="px-3 py-2">
              <SkeletonRows rows={6} />
            </div>
          ) : items.length === 0 ? (
            empty
          ) : (
            <ul className="flex flex-col gap-2 p-3">
              {items.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className="flex w-full items-start gap-3 rounded-2xl border border-border-subtle bg-surface p-3 text-left shadow-(--shadow-card)"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label font-medium text-ink-900">{row.customer.name || '—'}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-text-tertiary">
                        <span className="truncate">
                          {[row.number ?? copy.salesDocs.draft, day(row.issue_date), entityName(row.entity_code)].join(' · ')}
                        </span>
                        {row.origin === 'holded' ? (
                          <Badge size="sm" tone="neutral" className="shrink-0">
                            {copy.salesDocs.holded}
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-label font-medium tabular-nums text-ink-900">{money(row.total)}</span>
                      <StatusPill tone={statusTone(row.status)}>{row.status_label}</StatusPill>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        shown={items.length}
        total={total}
        hasPrev={page > 1}
        hasNext={total != null && page * pageSize < total}
        onPrev={() => goPage(page - 1)}
        onNext={() => goPage(page + 1)}
        sizes={SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size)
          goPage(1)
        }}
        loading={loading}
      />

      {shown ? (
        <DocumentModal
          me={me}
          source={shown.source}
          id={current?.id ?? null}
          ids={viewableIds}
          onNavigate={step}
          onClose={opened.close}
          onChanged={() => setAttempt((value) => value + 1)}
        />
      ) : null}
    </div>
  )
}

function screenOf(book: Book, state: 'loading' | 'empty' | 'list'): string {
  const base = book === 'invoice' ? 'facturas' : book === 'purchase' ? 'gastos' : 'ventas'
  if (state === 'loading') return `${base}-cargando`
  if (state === 'empty') return `${base}-vacio`
  return book === 'quote' || book === 'delivery_note' ? 'ventas-lista' : base
}

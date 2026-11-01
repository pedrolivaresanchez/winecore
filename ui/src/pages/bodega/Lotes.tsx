import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { api, ApiError } from '@/lib/api'
import { listLots, type LotListItem } from '@/lib/cellar'
import { downloadCsv } from '@/lib/csv'
import { formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { statusTone, type StatusTone } from '@/lib/status-tones'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER } from '@/ui/frame'
import { DownloadSimple, Layers } from '@/ui/icons'
import {
  DataGrid,
  EmptyState,
  FilterBar,
  Pagination,
  StatusPill,
  useCursorPages,
  useGridFilterLink,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'
import { GRID_LABELS, lotKindLabel, lotStatusLabel } from '@/pages/bodega/labels'

type Wine = { id: string; name: string }

const KINDS = ['grape', 'must', 'wine', 'bottled'] as const
const STATUSES = ['active', 'depleted', 'closed'] as const

/** Same hue per stage as the states in Existencias: uva morada, mosto ámbar, vino azul, envasado verde. */
const KIND_TONE: Record<string, StatusTone> = {
  grape: 'purple',
  must: 'warning',
  wine: 'info',
  bottled: 'success',
}

function kindTone(kind: string): StatusTone {
  return KIND_TONE[kind] ?? 'neutral'
}

const FILTERS: FilterDef[] = [
  {
    id: 'kind',
    label: copy.lists.lots.kind,
    kind: 'single',
    display: 'chips',
    options: KINDS.map((kind) => ({ value: kind, label: lotKindLabel(kind), tone: kindTone(kind) })),
  },
  {
    id: 'status',
    label: copy.lists.lots.status,
    kind: 'single',
    display: 'menu',
    options: STATUSES.map((status) => ({ value: status, label: lotStatusLabel(status), tone: statusTone(status) })),
  },
  { id: 'organic', label: copy.cellar.organic, kind: 'toggle' },
]

const COLUMN_LABELS = {
  code: 'Código',
  kind: 'Tipo',
  wine: 'Vino',
  vintage: 'Añada',
  status: 'Estado',
  volume: 'Volumen',
  place: 'Ubicación',
}

function volumeText(row: LotListItem): string {
  return row.qty_units > 0 && row.volume_ml === 0 ? `${row.qty_units} ud` : formatLitres(row.volume_ml / 1000)
}

export function LotesPage({ me }: { me: Me }) {
  useChromeTitle(copy.cellar.lots)
  const navigate = useNavigate()
  const toast = useToast()
  const gridFilters = useGridFilterLink()
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') ?? ''
  const status = params.get('status') ?? ''
  const organic = params.get('organic') === '1'
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [wines, setWines] = useState<Map<string, string>>(new Map())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    code: 176,
    kind: 108,
    wine: 188,
    vintage: 84,
    status: 112,
    volume: 136,
    place: 120,
  })
  const canRead = allows(me, 'cellar.read')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!canRead) return
    const controller = new AbortController()
    api<{ items?: Wine[] }>('/v1/wines?limit=100', { signal: controller.signal })
      .then((body) => {
        setWines(new Map((body.items ?? []).map((wine) => [wine.id, wine.name])))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [canRead])

  const query = useMemo(() => ({ q: debounced, kind, status, organic }), [debounced, kind, organic, status])
  const pages = useCursorPages<LotListItem>({
    queryKey: JSON.stringify(query),
    storageKey: 'cellar-lots',
    enabled: canRead,
    fetchPage: ({ cursor, limit, signal }) => listLots({ ...query, cursor: cursor ?? undefined, limit }, signal),
  })
  const rows = pages.items
  const error = pages.error
    ? pages.error instanceof ApiError
      ? pages.error
      : new ApiError(0, 'WC_ERROR', copy.error.load)
    : null

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const columns = useMemo<GridColumn<LotListItem>[]>(
    () => [
      { id: 'code', header: COLUMN_LABELS.code, cell: (row) => row.code },
      {
        id: 'kind',
        header: COLUMN_LABELS.kind,
        filterValue: (row) => lotKindLabel(row.kind),
        cell: (row) => <StatusPill tone={kindTone(row.kind)}>{lotKindLabel(row.kind)}</StatusPill>,
      },
      { id: 'wine', header: COLUMN_LABELS.wine, cell: (row) => (row.wine_id ? wines.get(row.wine_id) : null) || '—' },
      { id: 'vintage', header: COLUMN_LABELS.vintage, cell: (row) => (row.vintage ? String(row.vintage) : '—') },
      {
        id: 'status',
        header: COLUMN_LABELS.status,
        filterValue: (row) => lotStatusLabel(row.status),
        cell: (row) => <StatusPill tone={statusTone(row.status)}>{lotStatusLabel(row.status)}</StatusPill>,
      },
      { id: 'volume', header: COLUMN_LABELS.volume, align: 'right', cell: volumeText },
      { id: 'place', header: COLUMN_LABELS.place, cell: (row) => row.vessel_code || row.location_code || '—' },
    ],
    [wines],
  )

  if (!canRead) return <NoPermission />

  const filtersActive = Boolean(debounced || kind || status || organic)
  const loading = pages.loading && rows.length === 0
  const screen = loading ? 'bodega-lotes-cargando' : rows.length === 0 && !filtersActive ? 'bodega-lotes-vacio' : 'bodega-lotes'

  function setFilter(id: string, value: FilterValue) {
    const next = new URLSearchParams(params)
    const text = id === 'organic' ? (value === true ? '1' : '') : typeof value === 'string' ? value : ''
    if (text) next.set(id, text)
    else next.delete(id)
    setParams(next, { replace: true })
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const id of ['kind', 'status', 'organic']) next.delete(id)
    setParams(next, { replace: true })
    setQ('')
  }

  const chosen = rows.filter((row) => picked.has(row.id))
  const actions: SelectionAction[] = [
    {
      id: 'export',
      label: copy.lists.bulk.exportCsv,
      icon: DownloadSimple,
      onRun: () => {
        downloadCsv(
          'lotes-seleccion.csv',
          Object.values(COLUMN_LABELS),
          chosen.map((row) => [
            row.code,
            lotKindLabel(row.kind),
            (row.wine_id ? wines.get(row.wine_id) : null) ?? '',
            row.vintage,
            lotStatusLabel(row.status),
            volumeText(row),
            row.vessel_code || row.location_code || '',
          ]),
        )
        toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
      },
    },
  ]

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Layers className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.cellar.lots}</h1>
      </header>
      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: copy.cellar.searchLots, id: 'buscar-lotes' }}
        filters={FILTERS}
        values={{ kind, status, organic }}
        onChange={setFilter}
        onClear={clearFilters}
        grid={gridFilters}
        selection={{
          count: picked.size,
          pageCount: rows.length,
          onSelectAll: () => setPicked(new Set(rows.map((row) => row.id))),
          onClear: () => setPicked(new Set()),
          actions,
        }}
      />
      {error && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={{ ...GRID_LABELS, openRecord: 'Abrir lote' }}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/lotes/${encodeURIComponent(row.code)}`)}
          rowHref={(row) => `/bodega/lotes/${encodeURIComponent(row.code)}`}
          total={pages.total ?? undefined}
          loading={pages.loading}
          filterLink={gridFilters}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cellar.noMatch : copy.cellar.emptyLots}
              description={filtersActive ? undefined : copy.cellar.emptyLotsHint}
            />
          }
        />
      )}
      <Pagination {...pages.pagination} />
    </div>
  )
}

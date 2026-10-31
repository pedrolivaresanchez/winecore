import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { api, ApiError, isAbortError } from '@/lib/api'
import { listLots, type LotListItem } from '@/lib/cellar'
import { formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Layers, Search } from '@/ui/icons'
import { Badge, Button, Chip, DataGrid, EmptyState, Input, type GridColumn } from '@/ui'
import { GRID_LABELS, lotKindLabel, lotStatusLabel } from '@/pages/bodega/labels'

type Wine = { id: string; name: string }

const KINDS = [
  { id: '', label: 'Todos' },
  { id: 'grape', label: 'Uva' },
  { id: 'must', label: 'Mosto' },
  { id: 'wine', label: 'Vino' },
  { id: 'bottled', label: 'Envasado' },
] as const

export function LotesPage({ me }: { me: Me }) {
  useChromeTitle(copy.cellar.lots)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kind, setKind] = useState('')
  const [organic, setOrganic] = useState(false)
  const [items, setItems] = useState<LotListItem[]>([])
  const [wines, setWines] = useState<Map<string, string>>(new Map())
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    code: 176,
    kind: 96,
    wine: 188,
    vintage: 84,
    status: 112,
    volume: 136,
    place: 120,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    api<{ items?: Wine[] }>('/v1/wines?limit=100', { signal: controller.signal })
      .then((body) => {
        setWines(new Map((body.items ?? []).map((wine) => [wine.id, wine.name])))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [me])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    listLots({ q: debounced, kind, limit: 50 }, controller.signal)
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
  }, [debounced, kind, me, attempt])

  const rows = useMemo(() => (organic ? items.filter((item) => item.is_organic) : items), [items, organic])
  const filtersActive = Boolean(debounced || kind || organic)

  const columns = useMemo<GridColumn<LotListItem>[]>(
    () => [
      { id: 'code', header: 'Código', cell: (row) => row.code },
      { id: 'kind', header: 'Tipo', cell: (row) => lotKindLabel(row.kind) },
      { id: 'wine', header: 'Vino', cell: (row) => (row.wine_id ? wines.get(row.wine_id) : null) || '—' },
      { id: 'vintage', header: 'Añada', cell: (row) => (row.vintage ? String(row.vintage) : '—') },
      {
        id: 'status',
        header: 'Estado',
        cell: (row) => (
          <Badge tone={row.status === 'active' ? 'success' : row.status === 'depleted' ? 'warning' : 'neutral'} size="sm">
            {lotStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        id: 'volume',
        header: 'Volumen',
        align: 'right',
        cell: (row) => (row.qty_units > 0 && row.volume_ml === 0 ? `${row.qty_units} ud` : formatLitres(row.volume_ml / 1000)),
      },
      { id: 'place', header: 'Ubicación', cell: (row) => row.vessel_code || row.location_code || '—' },
    ],
    [wines],
  )

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const screen = loading ? 'bodega-lotes-cargando' : rows.length === 0 && !filtersActive ? 'bodega-lotes-vacio' : 'bodega-lotes'

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listLots({ q: debounced, kind, cursor, limit: 50 })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Layers className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.cellar.lots}</h1>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-lotes"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.cellar.searchLots}
            aria-label={copy.cellar.searchLots}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {KINDS.map((pill) => (
            <Chip key={pill.id || 'todos'} pressed={kind === pill.id} active={kind === pill.id} onClick={() => setKind(pill.id)}>
              {pill.label}
            </Chip>
          ))}
          <Chip pressed={organic} active={organic} onClick={() => setOrganic((value) => !value)}>
            {copy.cellar.organic}
          </Chip>
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
          total={organic ? rows.length : total}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cellar.noMatch : copy.cellar.emptyLots}
              description={filtersActive ? undefined : copy.cellar.emptyLotsHint}
            />
          }
        />
      )}
      {cursor && !organic ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

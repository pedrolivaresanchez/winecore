import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { contentLabel, fillPercent, holding, kindLabel, type Vessel } from '@/lib/cellar'
import { formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Layers, ScanSearch, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  useMenuOpen,
  type GridColumn,
} from '@/ui'
import { GRID_LABELS, vesselTone } from '@/pages/bodega/labels'

type List = { items: Vessel[]; next_cursor: string | null; total: number }

const COLUMN_IDS = ['code', 'zone', 'kind', 'lot', 'litres', 'capacity', 'state'] as const
type ColumnId = (typeof COLUMN_IDS)[number]

const COLUMN_LABELS: Record<ColumnId, string> = {
  code: 'Código',
  zone: 'Zona',
  kind: 'Tipo',
  lot: 'Lote',
  litres: 'Litros',
  capacity: 'Capacidad',
  state: 'Estado',
}

function vesselTargetFromScan(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const qr = text.match(/\/q\/([^/?#]+)/)
  if (qr?.[1]) return `/q/${decodeURIComponent(qr[1])}`
  const deposit = text.match(/\/bodega\/depositos\/([^/?#]+)/)
  if (deposit?.[1]) return `/bodega/depositos/${decodeURIComponent(deposit[1])}`
  const bodega = text.match(/\/bodega\/([^/?#]+)/)
  if (bodega?.[1]) return `/bodega/${decodeURIComponent(bodega[1])}`
  if (/^[A-Za-z0-9_-]{16,64}$/.test(text) && text.startsWith('wcqr_')) return `/q/${text}`
  if (/^[A-Z0-9-]{2,20}$/.test(text)) return `/bodega/depositos/${text}`
  return null
}

export function MapaPage({ me }: { me: Me }) {
  useChromeTitle(copy.cellar.vessels)
  const navigate = useNavigate()
  const columnsMenu = useMenuOpen()
  const data = useApi<List>(allows(me, 'cellar.read') ? '/v1/vessels?limit=100' : null)
  const [zone, setZone] = useState('')
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [onlyFull, setOnlyFull] = useState(false)
  const [table, setTable] = useState(true)
  const [scan, setScan] = useState(false)
  const [code, setCode] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    code: 132,
    zone: 128,
    kind: 128,
    lot: 168,
    litres: 128,
    capacity: 136,
    state: 148,
  })

  const zones = useMemo(() => {
    const names = new Set((data.data?.items ?? []).map((item) => item.zone || 'Sin zona'))
    return [...names]
  }, [data.data])

  const items = (data.data?.items ?? []).filter((item) => {
    if (zone && (item.zone || 'Sin zona') !== zone) return false
    if (kind && item.kind !== kind) return false
    if (onlyFull && item.volume_ml <= 0) return false
    if (query.trim()) {
      const haystack = `${item.code} ${item.name} ${item.lot_code ?? ''} ${item.wine_name ?? ''}`.toLowerCase()
      if (!haystack.includes(query.trim().toLowerCase())) return false
    }
    return true
  })

  const grouped = useMemo(() => {
    const map = new Map<string, Vessel[]>()
    for (const item of items) {
      const key = item.zone || 'Sin zona'
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()]
  }, [items])

  const columns = useMemo<GridColumn<Vessel>[]>(() => {
    const all: GridColumn<Vessel>[] = [
      { id: 'code', header: 'Código', cell: (row) => row.code },
      { id: 'zone', header: 'Zona', cell: (row) => row.zone || '—' },
      { id: 'kind', header: 'Tipo', cell: (row) => kindLabel(row.kind) },
      { id: 'lot', header: 'Lote', cell: (row) => row.lot_code || '—' },
      {
        id: 'litres',
        header: 'Litros',
        align: 'right',
        cell: (row) => formatLitres(row.volume_ml / 1000),
      },
      {
        id: 'capacity',
        header: 'Capacidad',
        align: 'right',
        cell: (row) => formatLitres(row.capacity_ml / 1000),
      },
      { id: 'state', header: 'Estado', cell: (row) => contentLabel(row) },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const source = data.data?.items ?? []
  const empty = !data.loading && source.length === 0
  const filtersActive = Boolean(query.trim() || zone || kind || onlyFull)
  const screen = scan
    ? 'bodega-qr'
    : data.loading
      ? 'bodega-cargando'
      : empty
        ? 'bodega-vacio'
        : table
          ? 'bodega-depositos'
          : 'bodega-mapa'

  function openScanTarget(raw: string) {
    const next = vesselTargetFromScan(raw)
    if (!next) return
    setScan(false)
    setCode('')
    navigate(next)
  }

  return (
    <div data-screen={screen} data-view={table ? 'tabla' : 'tarjetas'} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Layers className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.cellar.vessels}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setScan(true)}>
            {copy.cellar.scan}
          </Button>
          {allows(me, 'cellar.operate') ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/operaciones/nueva')}>
              {copy.cellar.operation}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="bodega-buscar"
            size="sm"
            type="search"
            value={query}
            placeholder={copy.cellar.searchVessels}
            aria-label={copy.cellar.searchVessels}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Chip pressed={table} active={table} onClick={() => setTable(true)}>
            {copy.cellar.table}
          </Chip>
          <Chip pressed={!table} active={!table} onClick={() => setTable(false)}>
            {copy.cellar.cards}
          </Chip>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => navigate('/bodega/calculadoras')}>
            {copy.nav.calculators}
          </Button>
          {table ? (
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-start"
              panelClassName="min-w-[200px]"
              trigger={
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.cellar.columns}>
                  {copy.cellar.columns}
                </MenuChip>
              }
            >
              {COLUMN_IDS.map((id) => (
                <MenuItem
                  key={id}
                  checked={!hidden.has(id)}
                  disabled={id === 'code'}
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                >
                  {COLUMN_LABELS[id]}
                </MenuItem>
              ))}
            </GlassMenu>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.cellar.scan} onClick={() => setScan(true)}>
            <ScanSearch strokeWidth={iconStroke} />
          </Button>
          {allows(me, 'cellar.operate') ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/operaciones/nueva')}>
              {copy.cellar.operation}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <Chip
            pressed={zone === '' && !onlyFull && kind === ''}
            active={zone === '' && !onlyFull && kind === ''}
            onClick={() => {
              setZone('')
              setKind('')
              setOnlyFull(false)
            }}
          >
            {copy.cellar.all}
          </Chip>
          {zones.map((name) => (
            <Chip key={name} pressed={zone === name} active={zone === name} onClick={() => setZone(zone === name ? '' : name)}>
              {name}
            </Chip>
          ))}
          <Chip pressed={onlyFull} active={onlyFull} onClick={() => setOnlyFull((value) => !value)}>
            {copy.cellar.occupied}
          </Chip>
          <span className="hidden md:contents">
            <Chip pressed={kind === 'barrel'} active={kind === 'barrel'} onClick={() => setKind(kind === 'barrel' ? '' : 'barrel')}>
              {copy.cellar.barrels}
            </Chip>
            <Chip
              pressed={kind === 'tank_fermenter'}
              active={kind === 'tank_fermenter'}
              onClick={() => setKind(kind === 'tank_fermenter' ? '' : 'tank_fermenter')}
            >
              {copy.cellar.fermenters}
            </Chip>
          </span>
          <Button type="button" variant="ghost" size="sm" className="md:hidden" onClick={() => setFiltersOpen(true)}>
            {copy.cellar.filters}
          </Button>
        </div>
      </div>

      {data.error && source.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
        </div>
      ) : table ? (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/depositos/${encodeURIComponent(row.code)}`)}
          rowHref={(row) => `/bodega/depositos/${encodeURIComponent(row.code)}`}
          total={items.length}
          loading={data.loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cellar.noMatch : copy.cellar.emptyVessels}
              description={filtersActive ? undefined : copy.cellar.emptyVesselsHint}
            />
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {data.loading ? (
            <div className="p-4 text-label text-text-tertiary" aria-busy="true">
              {copy.loading}
            </div>
          ) : items.length === 0 ? (
            <div className="flex justify-center p-6">
              <EmptyState
                size="sm"
                title={filtersActive ? copy.cellar.noMatch : copy.cellar.emptyVessels}
                description={filtersActive ? undefined : copy.cellar.emptyVesselsHint}
              />
            </div>
          ) : (
            <div className="grid gap-6 p-4">
              {grouped.map(([name, group]) => (
                <section key={name} className="grid gap-3">
                  <h2 className="text-label font-medium text-ink-900">
                    {name}
                    <span className="ml-2 font-normal text-text-tertiary">· {group.length}</span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((vessel) => (
                      <VesselCard key={vessel.id} vessel={vessel} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} labelledBy="bodega-filtros-titulo" size="sm">
        <DialogHeader titleId="bodega-filtros-titulo" title={copy.cellar.filters} onClose={() => setFiltersOpen(false)} />
        <DialogBody>
          <div className="flex flex-wrap gap-1.5 pb-2" data-screen="bodega-filtros">
            <Chip pressed={kind === 'barrel'} active={kind === 'barrel'} onClick={() => setKind(kind === 'barrel' ? '' : 'barrel')}>
              {copy.cellar.barrels}
            </Chip>
            <Chip
              pressed={kind === 'tank_fermenter'}
              active={kind === 'tank_fermenter'}
              onClick={() => setKind(kind === 'tank_fermenter' ? '' : 'tank_fermenter')}
            >
              {copy.cellar.fermenters}
            </Chip>
            <Chip pressed={kind === ''} active={kind === ''} onClick={() => setKind('')}>
              {copy.cellar.all}
            </Chip>
          </div>
        </DialogBody>
      </Dialog>

      <Dialog open={scan} onClose={() => setScan(false)} labelledBy="bodega-qr-titulo" size="sm">
        <DialogHeader titleId="bodega-qr-titulo" title={copy.cellar.scan} description={copy.cellar.scanHint} onClose={() => setScan(false)} />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            openScanTarget(code)
          }}
        >
          <DialogBody>
            <Input
              id="qr-url"
              autoFocus
              value={code}
              placeholder="INOX-003"
              aria-label={copy.cellar.scan}
              onChange={(event) => setCode(event.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setScan(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm">
              {copy.cellar.openVessel}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}

function VesselCard({ vessel }: { vessel: Vessel }) {
  const pct = fillPercent(vessel)
  const inside = holding(vessel)
  return (
    <Link
      to={`/bodega/depositos/${encodeURIComponent(vessel.code)}`}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-2xl border border-border-subtle bg-surface p-4 shadow-(--shadow-card)',
        vessel.alert && 'border-warning-500',
        vessel.status !== 'in_service' && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-label font-medium text-ink-900">{vessel.code}</p>
          <p className="truncate text-caption text-text-tertiary">{vessel.name}</p>
        </div>
        <Badge tone={vesselTone(vessel)} size="sm">
          {kindLabel(vessel.kind)}
        </Badge>
      </div>
      <p className="truncate text-label text-text-secondary">
        {inside ? `${inside.lot_code}${inside.wine_name ? ` · ${inside.wine_name}` : ''}` : contentLabel(vessel)}
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-ink-100"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${copy.cellar.fill} ${pct} %`}
      >
        <div className="h-full bg-ink-900" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-caption tabular-nums text-text-tertiary">
        <span>
          {formatLitres(vessel.volume_ml / 1000)}
          <span> / {formatLitres(vessel.capacity_ml / 1000)}</span>
        </span>
        <span>
          {contentLabel(vessel)} · {pct} %
        </span>
      </div>
      {vessel.alert ? <p className="text-caption text-warning-700">{vessel.alert}</p> : null}
    </Link>
  )
}

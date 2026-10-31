import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatInteger } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { EntityChoice, Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Box, Search } from '@/ui/icons'
import { Badge, Chip, DataGrid, EmptyState, Input, type GridColumn } from '@/ui'
import { GRID_LABELS } from '@/pages/bodega/labels'
import { holderKindLabel, packagedLabel } from '@/pages/bodega-plano/text'
import type { CellarLocation, HolderKind, HolderView, Page } from '@/pages/bodega-plano/types'

type Cut = '' | HolderKind

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function cellarIds(items: CellarLocation[], entities: Me['entities'], filter: EntityChoice): Set<string> | null {
  const cellars = items.filter((item) => item.kind === 'cellar' && item.is_active !== false)
  if (filter === 'all') return new Set(cellars.map((item) => item.id.toLowerCase()))
  const entity = entities.find((entry) => entry.code === filter)
  if (!entity) return new Set(cellars.map((item) => item.id.toLowerCase()))
  return new Set(cellars.filter((item) => sameId(item.controlling_entity_id, entity.id)).map((item) => item.id.toLowerCase()))
}

function stateTone(state: string): 'success' | 'neutral' | 'info' | 'warning' {
  if (state === 'packaged_labeled') return 'success'
  if (state === 'packaged_unlabeled') return 'info'
  if (state === 'mixed') return 'warning'
  return 'neutral'
}

export function HoldersPage({ me }: { me: Me }) {
  useChromeTitle(copy.plano.holders)
  const navigate = useNavigate()
  const { filter, entities } = useEntity()
  const locations = useApi<Page<CellarLocation>>(allows(me, 'cellar.read') ? '/v1/locations?limit=100' : null)
  const data = useApi<Page<HolderView>>(allows(me, 'cellar.read') ? '/v1/holders?limit=100' : null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Cut>('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    code: 140,
    kind: 110,
    capacity: 120,
    bottles: 110,
    format: 110,
    lot: 220,
    state: 140,
  })
  const allowedLocations = useMemo(
    () => cellarIds(locations.data?.items ?? [], entities, filter),
    [locations.data, entities, filter],
  )

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data.data?.items ?? []).filter((holder) => {
      if (allowedLocations && !allowedLocations.has(holder.location_id.toLowerCase())) return false
      if (kind && holder.kind !== kind) return false
      if (!needle) return true
      const haystack = `${holder.code} ${holder.name} ${holder.lot_code ?? ''} ${holder.format ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [allowedLocations, data.data, kind, query])

  const columns = useMemo<GridColumn<HolderView>[]>(
    () => [
      { id: 'code', header: copy.plano.code, cell: (row) => row.code },
      { id: 'kind', header: copy.plano.kind, cell: (row) => holderKindLabel(row.kind) },
      {
        id: 'capacity',
        header: copy.plano.capacity,
        align: 'right',
        cell: (row) => (row.capacity_bottles == null ? '—' : formatInteger(row.capacity_bottles)),
      },
      { id: 'bottles', header: copy.plano.bottles, align: 'right', cell: (row) => formatInteger(row.count) },
      { id: 'format', header: copy.plano.format, cell: (row) => row.format || '—' },
      { id: 'lot', header: copy.plano.lot, cell: (row) => row.lot_code || '—' },
      {
        id: 'state',
        header: copy.plano.state,
        cell: (row) => (
          <Badge tone={stateTone(row.state)} size="sm">
            {packagedLabel(row.state)}
          </Badge>
        ),
      },
    ],
    [],
  )

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || kind)
  const empty = !data.loading && (data.data?.items.length ?? 0) === 0
  const screen = data.loading ? 'bodega-contenedores-cargando' : empty && !filtersActive ? 'bodega-contenedores-vacio' : 'bodega-contenedores'

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Box className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.plano.holders}</h1>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="contenedores-buscar"
            size="sm"
            type="search"
            value={query}
            placeholder={copy.plano.searchHolders}
            aria-label={copy.plano.searchHolders}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <Chip pressed={kind === ''} active={kind === ''} onClick={() => setKind('')}>
            {copy.plano.all}
          </Chip>
          <Chip pressed={kind === 'jaulon'} active={kind === 'jaulon'} onClick={() => setKind(kind === 'jaulon' ? '' : 'jaulon')}>
            {copy.plano.jaulones}
          </Chip>
          <Chip pressed={kind === 'nicho'} active={kind === 'nicho'} onClick={() => setKind(kind === 'nicho' ? '' : 'nicho')}>
            {copy.plano.nichos}
          </Chip>
        </div>
      </div>
      {data.error && !data.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/contenedores/${encodeURIComponent(row.code)}`)}
          rowHref={(row) => `/bodega/contenedores/${encodeURIComponent(row.code)}`}
          total={rows.length}
          loading={data.loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.plano.noMatch : copy.plano.emptyHolders}
              description={filtersActive ? undefined : copy.plano.emptyHoldersHint}
            />
          }
        />
      )}
    </div>
  )
}

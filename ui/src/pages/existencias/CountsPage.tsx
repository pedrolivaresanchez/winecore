import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { toCount } from '@/pages/existencias/adapt'
import { countsPath, ownerEntityId, type InventoryCount } from '@/pages/existencias/api'
import { useCatalog } from '@/pages/existencias/catalog'
import { ColumnMenu } from '@/pages/existencias/components/ColumnMenu'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { readCountCache } from '@/pages/existencias/count-cache'
import { filterCounts } from '@/pages/existencias/filters'
import { GRID_LABELS } from '@/pages/existencias/grid'
import { COUNT_KINDS, countKindLabel, countStatusLabel, countStatusTone, ownerLabel } from '@/pages/existencias/labels'
import { assignParams } from '@/pages/existencias/query'
import { useHiddenColumns } from '@/pages/existencias/use-hidden'
import { useList } from '@/pages/existencias/use-list'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { FileText, MoreVertical, Search } from '@/ui/icons'
import { Badge, Button, Chip, DataGrid, EmptyState, GlassMenu, Input, MenuItem, useMenuOpen, type GridColumn } from '@/ui'

const COLUMN_IDS = ['number', 'kind', 'when', 'status', 'locations', 'entity', 'differences'] as const
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  number: 'Número',
  kind: 'Tipo',
  when: 'Fecha',
  status: 'Estado',
  locations: 'Ubicaciones',
  entity: 'Entidad',
  differences: 'Diferencias',
}

export function CountsPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const more = useMenuOpen()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const ownerId = ownerEntityId(filter, entities)
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') ?? ''
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ number: 170, kind: 120, when: 160, status: 150, locations: 120, entity: 90, differences: 120 })
  const { hidden, toggle } = useHiddenColumns('winecore.columns.stock-counts', COLUMN_IDS)
  const list = useList<unknown>(countsPath(ownerId))
  const missingList = list.error?.status === 404
  const source = useMemo(() => {
    const remote = list.error ? [] : list.items.map((row) => toCount(row, catalog))
    const seen = new Set(remote.map((row) => row.id))
    return [...remote, ...readCountCache().filter((row) => !seen.has(row.id)).map((row) => toCount(row, catalog))]
  }, [catalog, list.error, list.items])
  const rows = useMemo(() => filterCounts(source, { legalEntityId: ownerId, kind, q }), [kind, ownerId, q, source])
  const canCount = allows(me, 'inventory.count')
  const filtersOn = Boolean(q || kind || ownerId)
  const screen = list.loading ? 'aforos-cargando' : rows.length === 0 && !filtersOn ? 'aforos-vacio' : 'aforos'

  function assign(next: Record<string, string | null>) {
    setParams(assignParams(params, next))
  }

  const columns = useMemo<GridColumn<InventoryCount>[]>(() => {
    const all: GridColumn<InventoryCount>[] = [
      { id: 'number', header: COLUMN_LABELS.number, cell: (row) => row.number ?? 'Sin número' },
      { id: 'kind', header: COLUMN_LABELS.kind, cell: (row) => countKindLabel(row.kind) },
      { id: 'when', header: COLUMN_LABELS.when, cell: (row) => formatDateTime(row.counted_at) },
      {
        id: 'status',
        header: COLUMN_LABELS.status,
        cell: (row) => {
          const pending = Boolean(row.approval_request_id && row.status !== 'posted' && row.status !== 'approved')
          return (
            <Badge tone={pending ? 'warning' : countStatusTone(row.status)} size="sm">
              {pending ? copy.stock.pendingApproval : countStatusLabel(row.status)}
            </Badge>
          )
        },
      },
      { id: 'locations', header: COLUMN_LABELS.locations, cell: (row) => row.location_codes.join(', ') || '—' },
      { id: 'entity', header: COLUMN_LABELS.entity, cell: (row) => ownerLabel(row.legal_entity_code) },
      { id: 'differences', header: COLUMN_LABELS.differences, align: 'right', cell: (row) => String(row.difference_count) },
    ]
    return all.filter((column) => !hidden.has(column.id))
  }, [hidden])

  if (!allows(me, 'inventory.read')) return <NoPermission />

  return (
    <ListFrame
      screen={screen}
      title={copy.stock.counts}
      section="counts"
      icon={<FileText className="size-4" strokeWidth={iconStroke} />}
      actions={
        canCount ? (
          <>
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/stock/aforos/nuevo')}>
              {copy.stock.newCount}
            </Button>
            <GlassMenu
              open={more.open}
              onOpenChange={more.setOpen}
              placement="bottom-end"
              trigger={
                <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.stock.more} onClick={more.toggle}>
                  <MoreVertical strokeWidth={iconStroke} />
                </Button>
              }
            >
              <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=opening')}>{copy.stock.opening}</MenuItem>
              <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=periodic')}>{copy.stock.periodic}</MenuItem>
              <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=inspection')}>{copy.stock.inspectionKind}</MenuItem>
              <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=spot')}>{copy.stock.spot}</MenuItem>
            </GlassMenu>
          </>
        ) : null
      }
      toolbar={
        <>
          <div className={FRAME_STRIP_SCROLL}>
            <Input
              size="sm"
              type="search"
              value={q}
              placeholder={copy.stock.searchCounts}
              aria-label={copy.stock.searchCounts}
              className="w-56 shrink-0"
              prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
              onChange={(event) => setQ(event.target.value)}
            />
            <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="number" onToggle={toggle} />
          </div>
          {canCount ? (
            <Button type="button" variant="primary" size="sm" className="md:hidden" onClick={() => navigate('/stock/aforos/nuevo')}>
              {copy.stock.newCount}
            </Button>
          ) : null}
        </>
      }
      filters={
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <Chip pressed={!kind} active={!kind} onClick={() => assign({ kind: null })}>
            {copy.stock.all}
          </Chip>
          {COUNT_KINDS.map((item) => (
            <Chip key={item.id} pressed={kind === item.id} active={kind === item.id} onClick={() => assign({ kind: kind === item.id ? null : item.id })}>
              {item.label}
            </Chip>
          ))}
        </div>
      }
    >
      {list.error && !missingList && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${list.error.code})`} detail={list.error.message} onRetry={list.reload} />
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
          onOpenRow={(row) => navigate(`/stock/aforos/${row.id}`)}
          rowHref={(row) => `/stock/aforos/${row.id}`}
          loading={list.loading}
          total={missingList ? rows.length : list.total}
          empty={
            <EmptyState
              size="sm"
              icon={<FileText strokeWidth={iconStroke} />}
              title={filtersOn ? copy.stock.noMatch : copy.stock.emptyCounts}
              description={filtersOn ? undefined : copy.stock.emptyCountsHint}
              action={
                canCount && !filtersOn ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/stock/aforos/nuevo')}>
                    {copy.stock.newCount}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {list.cursor && !missingList ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={list.loadingMore} onClick={() => void list.loadMore()}>
            {copy.stock.loadMore}
          </Button>
        </div>
      ) : null}
    </ListFrame>
  )
}

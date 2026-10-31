import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import { Search } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
import { Button, Chip, DataGrid, EmptyState, GlassMenu, Input, MenuChip, MenuItem, useMenuOpen, type GridColumn } from '@/ui'
import { submissionOf, submissionsPath, type Submission } from '@/pages/regulatorio/api'
import { CreateDialog } from '@/pages/regulatorio/CreateDialog'
import { ListFrame, StatusBadge } from '@/pages/regulatorio/frame'
import {
  canPrepare,
  entityLabel,
  filterLabel,
  matchesStatus,
  periodRange,
  STATUS_FILTERS,
  warehouseLabel,
} from '@/pages/regulatorio/model'
import { useWarehouses } from '@/pages/regulatorio/warehouses'

const COLUMN_KEY = 'winecore.columns.regulatorio'
const COLUMN_IDS = ['period', 'status', 'entity', 'warehouse', 'entries'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_HIDDEN = new Set<ColumnId>(['entries'])

const GRID_LABELS = {
  addCalculation: copy.regulatorio.grid.addCalculation,
  aggregation: () => copy.regulatorio.grid.aggregation,
  aggregations: copy.regulatorio.grid.aggregations,
  count: (n: number) => String(n),
  clearCalculation: copy.regulatorio.grid.clearCalculation,
  selectAll: copy.regulatorio.grid.selectAll,
  selectRow: copy.regulatorio.grid.selectRow,
  openRecord: copy.regulatorio.grid.openRecord,
  sortAscending: copy.regulatorio.grid.sortAscending,
  sortDescending: copy.regulatorio.grid.sortDescending,
  columnOptions: copy.regulatorio.grid.columnOptions,
}

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

export function PresentacionesPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const columnsMenu = useMenuOpen()
  const { filter, entities } = useEntity()
  const entityId = filter === 'all' ? undefined : entities.find((entity) => entity.code === filter)?.id
  const [params, setParams] = useSearchParams()
  const status = params.get('estado') ?? ''
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ period: 280, status: 180, entity: 110, warehouse: 220, entries: 110 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const query = useApi<{ items: Submission[] }>(allows(me, 'regulatory.read') ? submissionsPath(entityId) : null)
  const places = useWarehouses()
  const prepare = canPrepare(me)

  const items = useMemo(() => (query.data?.items ?? []).map(submissionOf), [query.data])
  const needle = search.trim().toLocaleLowerCase('es')
  const visible = useMemo(() => {
    return items.filter((item) => {
      if (entityId && item.legal_entity_id !== entityId) return false
      if (!matchesStatus(item, status)) return false
      if (!needle) return true
      const warehouse = warehouseLabel(places.warehouses, item.tax_warehouse_id, item.files)
      const hay = `${periodRange(item.period_start, item.period_end)} ${entityLabel(entities, item.legal_entity_id)} ${warehouse} ${item.external_ref ?? ''} ${item.flow}`.toLocaleLowerCase('es')
      return hay.includes(needle)
    })
  }, [entities, entityId, items, needle, places.warehouses, status])

  function setStatus(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('estado', value)
    else next.delete('estado')
    setParams(next)
  }

  function toggleColumn(id: ColumnId) {
    if (id === 'period') return
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const columns = useMemo<GridColumn<Submission>[]>(() => {
    const all: GridColumn<Submission>[] = [
      { id: 'period', header: copy.regulatorio.columns.period, cell: (row) => periodRange(row.period_start, row.period_end) },
      {
        id: 'status',
        header: copy.regulatorio.columns.status,
        cell: (row) => <StatusBadge status={row.status} phase={row.phase} size="sm" />,
      },
      { id: 'entity', header: copy.regulatorio.columns.entity, cell: (row) => entityLabel(entities, row.legal_entity_id) },
      {
        id: 'warehouse',
        header: copy.regulatorio.columns.warehouse,
        cell: (row) => warehouseLabel(places.warehouses, row.tax_warehouse_id, row.files),
      },
      { id: 'entries', header: copy.regulatorio.columns.entries, align: 'right', cell: (row) => String(row.summary?.entry_count ?? 0) },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [entities, hidden, places.warehouses])

  if (!allows(me, 'regulatory.read')) return <NoPermission />

  const filtered = Boolean(status || needle)
  const loading = query.loading && !query.data
  const empty = !loading && visible.length === 0
  const screen = loading ? 'regulatorio-cargando' : empty && !filtered ? 'regulatorio-vacio' : 'regulatorio'

  const createButton = prepare ? (
    <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
      {copy.regulatorio.new}
    </Button>
  ) : null

  return (
    <>
      <ListFrame
        screen={screen}
        view="presentaciones"
        actions={createButton}
        mobileActions={createButton}
        toolbar={
          <>
            <Input
              id="buscar-presentaciones"
              size="sm"
              type="search"
              value={search}
              placeholder={copy.regulatorio.search}
              aria-label={copy.regulatorio.search}
              className="w-56 shrink-0"
              prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
              onChange={(event) => setSearch(event.target.value)}
            />
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-start"
              panelClassName="min-w-[200px]"
              trigger={
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.regulatorio.columnsLabel}>
                  {copy.regulatorio.columnsLabel}
                </MenuChip>
              }
            >
              {COLUMN_IDS.map((id) => (
                <MenuItem key={id} checked={!hidden.has(id)} disabled={id === 'period'} onClick={() => toggleColumn(id)}>
                  {copy.regulatorio.columns[id]}
                </MenuItem>
              ))}
            </GlassMenu>
          </>
        }
        filters={
          <>
            {STATUS_FILTERS.map((id) => (
              <Chip key={id || 'all'} pressed={status === id} active={status === id} onClick={() => setStatus(id)}>
                {filterLabel(id)}
              </Chip>
            ))}
          </>
        }
      >
        {query.error && items.length === 0 ? (
          <div className="p-4">
            <ErrorState title={`${copy.error.load} (${query.error.code})`} detail={query.error.message} onRetry={query.reload} />
          </div>
        ) : (
          <DataGrid
            columns={columns}
            rows={loading ? [] : visible}
            rowKey={(row) => row.id}
            labels={GRID_LABELS}
            widths={widths}
            onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
            selected={picked}
            onSelectedChange={setPicked}
            onOpenRow={(row) => navigate(`/regulatorio/envios/${row.id}`)}
            rowHref={(row) => `/regulatorio/envios/${row.id}`}
            total={visible.length}
            loading={loading}
            empty={
              <EmptyState
                size="sm"
                title={filtered ? copy.regulatorio.emptyFiltered : copy.regulatorio.empty}
                description={filtered ? copy.regulatorio.emptyFilteredHint : copy.regulatorio.emptyHint}
                action={!filtered ? createButton : undefined}
              />
            }
          />
        )}
      </ListFrame>
      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        me={me}
        warehouses={places.warehouses}
        initial={{ entityId }}
      />
    </>
  )
}

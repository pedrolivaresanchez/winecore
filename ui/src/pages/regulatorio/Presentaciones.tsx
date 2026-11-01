import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { downloadCsv } from '@/lib/csv'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { entityTone } from '@/lib/status-tones'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import { DownloadSimple, Plus } from '@/ui/icons'
import {
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  StatusPill,
  useGridFilterLink,
  useMenuOpen,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'
import { submissionOf, submissionsPath, type Submission } from '@/pages/regulatorio/api'
import { asApiError, usePagedList } from '@/pages/existencias/use-list'
import { CreateDialog } from '@/pages/regulatorio/CreateDialog'
import { ListFrame, MobileViewSwitch, StatusBadge } from '@/pages/regulatorio/frame'
import {
  canPrepare,
  entityLabel,
  filterLabel,
  periodRange,
  STATUS_FILTERS,
  statusMeta,
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

const FILTERS: FilterDef[] = [
  {
    id: 'estado',
    label: copy.regulatorio.columns.status,
    kind: 'single',
    display: 'menu',
    options: STATUS_FILTERS.filter((id) => id !== '').map((id) => ({
      value: id,
      label: filterLabel(id),
      tone: statusMeta(id, id === 'corrected' ? 'corrected' : '').tone,
    })),
  },
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

export function PresentacionesPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
  const { filter, entities } = useEntity()
  const entityId = filter === 'all' ? undefined : entities.find((entity) => entity.code === filter)?.id
  const [params, setParams] = useSearchParams()
  const status = params.get('estado') ?? ''
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ period: 220, status: 150, entity: 90, warehouse: 420, entries: 110 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const page = usePagedList<Submission>(allows(me, 'regulatory.read') ? submissionsPath(entityId, status) : null, 'regulatory-submissions')
  const error = asApiError(page.error)
  const places = useWarehouses()
  const prepare = canPrepare(me)

  useEffect(() => {
    setPicked(new Set())
  }, [page.pageKey])

  const items = useMemo(() => page.items.map(submissionOf), [page.items])
  const needle = search.trim().toLocaleLowerCase('es')
  const visible = useMemo(() => {
    if (!needle) return items
    return items.filter((item) => {
      const warehouse = warehouseLabel(places.warehouses, item.tax_warehouse_id, item.files)
      const hay = `${periodRange(item.period_start, item.period_end)} ${entityLabel(entities, item.legal_entity_id)} ${warehouse} ${item.external_ref ?? ''} ${item.flow}`.toLocaleLowerCase('es')
      return hay.includes(needle)
    })
  }, [entities, items, needle, places.warehouses])

  function setStatus(value: FilterValue) {
    const next = new URLSearchParams(params)
    if (typeof value === 'string' && value) next.set('estado', value)
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
        filterValue: (row) => statusMeta(row.status, row.phase).label,
        cell: (row) => <StatusBadge status={row.status} phase={row.phase} size="sm" />,
      },
      {
        id: 'entity',
        header: copy.regulatorio.columns.entity,
        filterValue: (row) => entityLabel(entities, row.legal_entity_id),
        cell: (row) => (
          <StatusPill tone={entityTone(entities.find((entity) => entity.id === row.legal_entity_id)?.code)}>
            {entityLabel(entities, row.legal_entity_id)}
          </StatusPill>
        ),
      },
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
  const loading = page.loading && page.items.length === 0
  const empty = !loading && visible.length === 0
  const screen = loading ? 'regulatorio-cargando' : empty && !filtered ? 'regulatorio-vacio' : 'regulatorio'

  const createButton = prepare ? (
    <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
      {copy.regulatorio.new}
    </Button>
  ) : null

  const chosen = visible.filter((row) => picked.has(row.id))
  const actions: SelectionAction[] = [
    {
      id: 'export',
      label: copy.lists.bulk.exportCsv,
      icon: DownloadSimple,
      onRun: () => {
        downloadCsv(
          'presentaciones-seleccion.csv',
          COLUMN_IDS.map((id) => copy.regulatorio.columns[id]),
          chosen.map((row) => [
            periodRange(row.period_start, row.period_end),
            statusMeta(row.status, row.phase).label,
            entityLabel(entities, row.legal_entity_id),
            warehouseLabel(places.warehouses, row.tax_warehouse_id, row.files),
            row.summary?.entry_count ?? 0,
          ]),
        )
        toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
      },
    },
  ]

  return (
    <>
      <ListFrame
        screen={screen}
        view="presentaciones"
        actions={createButton}
        bar={
          <FilterBar
            leading={<MobileViewSwitch current="presentaciones" />}
            search={{ value: search, onChange: setSearch, placeholder: copy.regulatorio.search, id: 'buscar-presentaciones' }}
            filters={FILTERS}
            values={{ estado: status }}
            onChange={(_id: string, value: FilterValue) => setStatus(value)}
            onClear={() => {
              setStatus(null)
              setSearch('')
            }}
            grid={gridFilters}
            selection={{
              count: picked.size,
              pageCount: visible.length,
              onSelectAll: () => setPicked(new Set(visible.map((row) => row.id))),
              onClear: () => setPicked(new Set()),
              actions,
            }}
            trailing={
              <>
                <span className="max-md:hidden">
                  <GlassMenu
                    open={columnsMenu.open}
                    onOpenChange={columnsMenu.setOpen}
                    placement="bottom-end"
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
                </span>
                {prepare ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    iconOnly
                    className="md:hidden"
                    aria-label={copy.regulatorio.new}
                    title={copy.regulatorio.new}
                    onClick={() => setCreating(true)}
                  >
                    <Plus strokeWidth={iconStroke} />
                  </Button>
                ) : null}
              </>
            }
          />
        }
      >
        {error && items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="p-4">
              <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={page.reload} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <DataGrid
              className="min-h-0 flex-1"
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
              total={needle ? visible.length : (page.total ?? undefined)}
              loading={loading}
              filterLink={gridFilters}
              empty={
                <EmptyState
                  size="sm"
                  title={filtered ? copy.regulatorio.emptyFiltered : copy.regulatorio.empty}
                  description={filtered ? copy.regulatorio.emptyFilteredHint : copy.regulatorio.emptyHint}
                  action={!filtered ? createButton : undefined}
                />
              }
            />
            <Pagination {...page.pagination} />
          </div>
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

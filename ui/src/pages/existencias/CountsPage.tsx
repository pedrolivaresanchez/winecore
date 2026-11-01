import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { downloadCsv } from '@/lib/csv'
import { iconStroke } from '@/lib/motion'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { entityTone, statusTone } from '@/lib/status-tones'
import type { Me } from '@/lib/types'
import { toCount } from '@/pages/existencias/adapt'
import { countsPath, ownerEntityId, type InventoryCount } from '@/pages/existencias/api'
import { useCatalog } from '@/pages/existencias/catalog'
import { ColumnMenu } from '@/pages/existencias/components/ColumnMenu'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { readCountCache } from '@/pages/existencias/count-cache'
import { filterCounts } from '@/pages/existencias/filters'
import { GRID_LABELS } from '@/pages/existencias/grid'
import { COUNT_KINDS, countKindLabel, countStatusLabel, ownerLabel } from '@/pages/existencias/labels'
import { assignParams } from '@/pages/existencias/query'
import { useHiddenColumns } from '@/pages/existencias/use-hidden'
import { asApiError, usePagedList } from '@/pages/existencias/use-list'
import { DownloadSimple, FileText, MoreVertical } from '@/ui/icons'
import {
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
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

const FILTERS: FilterDef[] = [
  {
    id: 'kind',
    label: copy.lists.stock.kind,
    kind: 'single',
    display: 'chips',
    options: COUNT_KINDS.map((item) => ({ value: item.id, label: item.label })),
  },
]

function pendingApproval(row: InventoryCount): boolean {
  return Boolean(row.approval_request_id && row.status !== 'posted' && row.status !== 'approved')
}

function statusText(row: InventoryCount): string {
  return pendingApproval(row) ? copy.stock.pendingApproval : countStatusLabel(row.status)
}

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
  const toast = useToast()
  const more = useMenuOpen()
  const gridFilters = useGridFilterLink()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const ownerId = ownerEntityId(filter, entities)
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') ?? ''
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ number: 170, kind: 120, when: 160, status: 150, locations: 120, entity: 90, differences: 120 })
  const { hidden, toggle } = useHiddenColumns('winecore.columns.stock-counts', COLUMN_IDS)
  const list = usePagedList<unknown>(countsPath(ownerId), 'stock-counts')
  const error = asApiError(list.error)
  const missingList = error?.status === 404
  const firstPage = list.page === 1
  const source = useMemo(() => {
    const remote = error ? [] : list.items.map((row) => toCount(row, catalog))
    if (!firstPage) return remote
    const seen = new Set(remote.map((row) => row.id))
    return [...remote, ...readCountCache().filter((row) => !seen.has(row.id)).map((row) => toCount(row, catalog))]
  }, [catalog, error, firstPage, list.items])
  const rows = useMemo(() => filterCounts(source, { legalEntityId: ownerId, kind, q }), [kind, ownerId, q, source])
  const canCount = allows(me, 'inventory.count')
  const filtersOn = Boolean(q || kind || ownerId)
  const loading = list.loading && list.items.length === 0
  const screen = loading ? 'aforos-cargando' : rows.length === 0 && !filtersOn ? 'aforos-vacio' : 'aforos'

  useEffect(() => {
    setPicked(new Set())
  }, [list.pageKey])

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
        filterValue: statusText,
        cell: (row) => <StatusPill tone={pendingApproval(row) ? 'warning' : statusTone(row.status)}>{statusText(row)}</StatusPill>,
      },
      { id: 'locations', header: COLUMN_LABELS.locations, cell: (row) => row.location_codes.join(', ') || '—' },
      {
        id: 'entity',
        header: COLUMN_LABELS.entity,
        filterValue: (row) => ownerLabel(row.legal_entity_code),
        cell: (row) => <StatusPill tone={entityTone(row.legal_entity_code)}>{ownerLabel(row.legal_entity_code)}</StatusPill>,
      },
      { id: 'differences', header: COLUMN_LABELS.differences, align: 'right', cell: (row) => String(row.difference_count) },
    ]
    return all.filter((column) => !hidden.has(column.id))
  }, [hidden])

  if (!allows(me, 'inventory.read')) return <NoPermission />

  const chosen = rows.filter((row) => picked.has(row.id))
  const actions: SelectionAction[] = [
    {
      id: 'export',
      label: copy.lists.bulk.exportCsv,
      icon: DownloadSimple,
      onRun: () => {
        downloadCsv(
          'aforos-seleccion.csv',
          COLUMN_IDS.map((id) => COLUMN_LABELS[id]),
          chosen.map((row) => [
            row.number,
            countKindLabel(row.kind),
            formatDateTime(row.counted_at),
            statusText(row),
            row.location_codes.join(', '),
            ownerLabel(row.legal_entity_code),
            row.difference_count,
          ]),
        )
        toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
      },
    },
  ]

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
      bar={
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: copy.stock.searchCounts }}
          filters={FILTERS}
          values={{ kind }}
          onChange={(id: string, value: FilterValue) => assign({ [id]: typeof value === 'string' && value ? value : null })}
          onClear={() => {
            assign({ kind: null })
            setQ('')
          }}
          grid={gridFilters}
          selection={{
            count: picked.size,
            pageCount: rows.length,
            onSelectAll: () => setPicked(new Set(rows.map((row) => row.id))),
            onClear: () => setPicked(new Set()),
            actions,
          }}
          trailing={
            <>
              <span className="max-md:hidden">
                <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="number" onToggle={toggle} />
              </span>
              {canCount ? (
                <Button type="button" variant="primary" size="sm" className="md:hidden" onClick={() => navigate('/stock/aforos/nuevo')}>
                  {copy.stock.newCount}
                </Button>
              ) : null}
            </>
          }
        />
      }
    >
      {error && !missingList && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={list.reload} />
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
          total={missingList ? rows.length : (list.total ?? undefined)}
          filterLink={gridFilters}
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
      {missingList ? null : <Pagination {...list.pagination} />}
    </ListFrame>
  )
}

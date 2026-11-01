import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { downloadCsv, type CsvValue } from '@/lib/csv'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { toFiscalMove, toPhysicalMove } from '@/pages/existencias/adapt'
import { movesPath, ownerEntityId } from '@/pages/existencias/api'
import { BookControl } from '@/pages/existencias/components/BookControl'
import { ColumnMenu } from '@/pages/existencias/components/ColumnMenu'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { useCatalog } from '@/pages/existencias/catalog'
import { periodClosedText } from '@/pages/existencias/explain'
import { filterFiscalMoves, filterPhysicalMoves } from '@/pages/existencias/filters'
import { GRID_LABELS } from '@/pages/existencias/grid'
import { FISCAL_MOVE_TYPES, PHYSICAL_MOVE_TYPES, moveTypeTone } from '@/pages/existencias/labels'
import { MovePreview } from '@/pages/existencias/MovePreview'
import { fiscalView, physicalView, type MoveView } from '@/pages/existencias/move-view'
import { assignParams } from '@/pages/existencias/query'
import { useHiddenColumns } from '@/pages/existencias/use-hidden'
import { asApiError, usePagedList } from '@/pages/existencias/use-list'
import { formatMl, formatUnits } from '@/pages/existencias/volume'
import { DownloadSimple, List, Lock } from '@/ui/icons'
import {
  Badge,
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  InfoTip,
  Pagination,
  StatusPill,
  useGridFilterLink,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'

const COLUMN_IDS = ['when', 'type', 'place', 'lot', 'product', 'volume', 'units', 'document', 'justification', 'silicie', 'user'] as const
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  when: 'Fecha',
  type: 'Tipo',
  place: 'Dónde',
  lot: 'Lote',
  product: 'Producto',
  volume: 'Litros',
  units: 'Unidades',
  document: 'Documento',
  justification: 'Justificante',
  silicie: 'Asiento SILICIE',
  user: 'Usuario',
}

function csvRow(row: MoveView): CsvValue[] {
  return [
    row.when,
    row.moveType,
    row.place,
    row.lot,
    row.product,
    formatMl(row.volumeMl),
    row.units ? formatUnits(row.units) : '',
    row.document,
    row.justification,
    row.silicie,
    row.user,
  ]
}

export function MovesPage({ me }: { me: Me }) {
  const toast = useToast()
  const gridFilters = useGridFilterLink()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const ownerId = ownerEntityId(filter, entities)
  const [params, setParams] = useSearchParams()
  const book = params.get('book') === 'fiscal' ? 'fiscal' : 'physical'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const moveType = params.get('move_type') ?? ''
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ when: 180, type: 200, place: 200, document: 160 })
  const { hidden, toggle } = useHiddenColumns('winecore.columns.stock-moves', COLUMN_IDS, ['user', 'justification'])

  const path = movesPath({
    book,
    from,
    to,
    moveType,
    ownerEntityId: book === 'physical' ? ownerId : undefined,
    legalEntityId: book === 'fiscal' ? ownerId : undefined,
  })
  const physical = usePagedList<unknown>(book === 'physical' ? path : null, 'stock-moves')
  const fiscal = usePagedList<unknown>(book === 'fiscal' ? path : null, 'stock-moves')
  const pages = book === 'physical' ? physical : fiscal
  const loading = pages.loading && pages.items.length === 0
  const error = asApiError(pages.error)

  const views = useMemo<MoveView[]>(() => {
    if (book === 'physical') {
      const rows = physical.items.map((row) => toPhysicalMove(row, catalog))
      return filterPhysicalMoves(rows, { ownerEntityId: ownerId, from, to, moveType, q }).map(physicalView)
    }
    const rows = fiscal.items.map((row) => toFiscalMove(row, catalog))
    return filterFiscalMoves(rows, { legalEntityId: ownerId, from, to, moveType, q }).map(fiscalView)
  }, [book, catalog, fiscal.items, from, moveType, ownerId, physical.items, q, to])

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const lockedUntil = views.find((row) => row.locked)?.lockedUntil ?? null
  const filtersOn = Boolean(q || from || to || moveType || ownerId)
  const screen = loading ? 'movimientos-cargando' : views.length === 0 && !filtersOn ? 'movimientos-vacio' : book === 'fiscal' ? 'movimientos-fiscal' : 'movimientos-physical'
  const types = book === 'fiscal' ? FISCAL_MOVE_TYPES : PHYSICAL_MOVE_TYPES

  function assign(next: Record<string, string | null>) {
    setParams(assignParams(params, next))
    setSelected(null)
  }

  const filters = useMemo<FilterDef[]>(
    () => [
      { id: 'date', label: copy.lists.stock.date, kind: 'date' },
      {
        id: 'move_type',
        label: copy.lists.stock.type,
        kind: 'single',
        options: types.map((item) => ({ value: item.id, label: item.label, tone: moveTypeTone(item.id) })),
      },
    ],
    [types],
  )

  function setFilter(id: string, value: FilterValue) {
    if (id === 'date') {
      const range = value && typeof value === 'object' && !Array.isArray(value) ? value : null
      assign({ from: range?.from ?? null, to: range?.to ?? null })
    } else assign({ [id]: typeof value === 'string' && value ? value : null })
  }

  const columns = useMemo<GridColumn<MoveView>[]>(() => {
    const all: GridColumn<MoveView>[] = [
      {
        id: 'when',
        header: COLUMN_LABELS.when,
        cell: (row) => (
          <span className="inline-flex items-center gap-1.5">
            {row.locked ? <Lock aria-label={copy.stock.closed} className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={iconStroke} /> : null}
            <span>
              {row.when}
              {row.whenDetail ? <span className="mt-0.5 block text-caption font-normal text-text-tertiary">{row.whenDetail}</span> : null}
            </span>
          </span>
        ),
      },
      {
        id: 'type',
        header: COLUMN_LABELS.type,
        filterValue: (row) => row.moveType,
        cell: (row) => <StatusPill tone={moveTypeTone(row.moveTypeId)}>{row.moveType}</StatusPill>,
      },
      { id: 'place', header: book === 'fiscal' ? 'Mayor' : COLUMN_LABELS.place, cell: (row) => row.place },
      { id: 'lot', header: COLUMN_LABELS.lot, cell: (row) => row.lot },
      { id: 'product', header: COLUMN_LABELS.product, cell: (row) => row.product },
      { id: 'volume', header: COLUMN_LABELS.volume, align: 'right', cell: (row) => formatMl(row.volumeMl) },
      { id: 'units', header: COLUMN_LABELS.units, align: 'right', cell: (row) => (row.units ? formatUnits(row.units) : '—') },
      { id: 'document', header: COLUMN_LABELS.document, cell: (row) => row.document },
      { id: 'justification', header: COLUMN_LABELS.justification, cell: (row) => row.justification },
      { id: 'silicie', header: COLUMN_LABELS.silicie, cell: (row) => row.silicie },
      { id: 'user', header: COLUMN_LABELS.user, cell: (row) => row.user },
    ]
    return all.filter((column) => !hidden.has(column.id))
  }, [book, hidden])

  const index = views.findIndex((row) => row.id === selected)
  const chosen = views.filter((row) => picked.has(row.id))

  if (!allows(me, 'inventory.read')) return <NoPermission />

  function exportCsv() {
    downloadCsv(`movimientos-${book}.csv`, COLUMN_IDS.map((id) => COLUMN_LABELS[id]), views.map(csvRow))
    toast(copy.stock.csvDone)
  }

  const actions: SelectionAction[] = [
    {
      id: 'export',
      label: copy.lists.bulk.exportCsv,
      icon: DownloadSimple,
      onRun: () => {
        downloadCsv(`movimientos-${book}-seleccion.csv`, COLUMN_IDS.map((id) => COLUMN_LABELS[id]), chosen.map(csvRow))
        toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
      },
    },
  ]

  return (
    <ListFrame
      screen={screen}
      title={copy.stock.moves}
      section="moves"
      icon={<List className="size-4" strokeWidth={iconStroke} />}
      actions={
        <Button type="button" variant="secondary" size="sm" disabled={views.length === 0} onClick={exportCsv}>
          {copy.stock.exportCsv}
        </Button>
      }
      bar={
        <FilterBar
          leading={<BookControl value={book} onChange={(value) => assign({ book: value === 'physical' ? null : value, move_type: null })} />}
          search={{ value: q, onChange: setQ, placeholder: copy.stock.searchMoves }}
          filters={filters}
          values={{ date: from || to ? { from: from || to, to: to || from } : null, move_type: moveType }}
          onChange={setFilter}
          onClear={() => {
            assign({ from: null, to: null, move_type: null })
            setQ('')
          }}
          grid={gridFilters}
          selection={{
            count: picked.size,
            pageCount: views.length,
            onSelectAll: () => setPicked(new Set(views.map((row) => row.id))),
            onClear: () => setPicked(new Set()),
            actions,
          }}
          trailing={
            <>
              {views.some((row) => row.locked) ? (
                <span className="inline-flex items-center gap-1 max-md:hidden">
                  <Badge tone="warning" size="sm" icon={<Lock strokeWidth={iconStroke} />}>
                    {copy.stock.closed}
                  </Badge>
                  <InfoTip label={copy.stock.closed}>{periodClosedText(lockedUntil)}</InfoTip>
                </span>
              ) : null}
              <span className="max-md:hidden">
                <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="when" onToggle={toggle} />
              </span>
              <Button type="button" variant="secondary" size="sm" className="md:hidden" disabled={views.length === 0} onClick={exportCsv}>
                CSV
              </Button>
            </>
          }
        />
      }
    >
      {error && views.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={views}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setSelected(row.id)}
          openRowKey={selected}
          loading={pages.loading}
          total={pages.total ?? undefined}
          filterLink={gridFilters}
          empty={
            <EmptyState
              size="sm"
              icon={<List strokeWidth={iconStroke} />}
              title={filtersOn ? copy.stock.noMatch : copy.stock.emptyMoves}
              description={filtersOn ? undefined : copy.stock.emptyMovesHint}
            />
          }
        />
      )}
      <Pagination {...pages.pagination} />
      <MovePreview
        row={views.find((row) => row.id === selected) ?? null}
        index={index}
        total={views.length}
        onClose={() => setSelected(null)}
        onPrev={index > 0 ? () => setSelected(views[index - 1]?.id ?? null) : undefined}
        onNext={index >= 0 && index < views.length - 1 ? () => setSelected(views[index + 1]?.id ?? null) : undefined}
      />
    </ListFrame>
  )
}

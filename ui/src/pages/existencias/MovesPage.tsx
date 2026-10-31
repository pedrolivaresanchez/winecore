import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
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
import { FISCAL_MOVE_TYPES, PHYSICAL_MOVE_TYPES } from '@/pages/existencias/labels'
import { MovePreview } from '@/pages/existencias/MovePreview'
import { fiscalView, physicalView, type MoveView } from '@/pages/existencias/move-view'
import { assignParams } from '@/pages/existencias/query'
import { useHiddenColumns } from '@/pages/existencias/use-hidden'
import { useList } from '@/pages/existencias/use-list'
import { formatMl, formatUnits } from '@/pages/existencias/volume'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { List, Lock, Search } from '@/ui/icons'
import { Badge, Button, DataGrid, DatePicker, EmptyState, InfoTip, Input, Select, useToast, type GridColumn } from '@/ui'

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
const DATE_LABELS = { clear: copy.stock.dateClear, today: copy.stock.dateToday }

function csvCell(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function MovesPage({ me }: { me: Me }) {
  const toast = useToast()
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
  const [widths, setWidths] = useState<Record<string, number>>({ when: 180, type: 180, place: 200, document: 160 })
  const { hidden, toggle } = useHiddenColumns('winecore.columns.stock-moves', COLUMN_IDS, ['user', 'justification'])

  const path = movesPath({
    book,
    from,
    to,
    moveType,
    ownerEntityId: book === 'physical' ? ownerId : undefined,
    legalEntityId: book === 'fiscal' ? ownerId : undefined,
  })
  const physical = useList<unknown>(book === 'physical' ? path : null)
  const fiscal = useList<unknown>(book === 'fiscal' ? path : null)
  const loading = book === 'physical' ? physical.loading : fiscal.loading
  const error = book === 'physical' ? physical.error : fiscal.error
  const reload = book === 'physical' ? physical.reload : fiscal.reload
  const cursor = book === 'physical' ? physical.cursor : fiscal.cursor

  const views = useMemo<MoveView[]>(() => {
    if (book === 'physical') {
      const rows = physical.items.map((row) => toPhysicalMove(row, catalog))
      return filterPhysicalMoves(rows, { ownerEntityId: ownerId, from, to, moveType, q }).map(physicalView)
    }
    const rows = fiscal.items.map((row) => toFiscalMove(row, catalog))
    return filterFiscalMoves(rows, { legalEntityId: ownerId, from, to, moveType, q }).map(fiscalView)
  }, [book, catalog, fiscal.items, from, moveType, ownerId, physical.items, q, to])

  const lockedUntil = views.find((row) => row.locked)?.lockedUntil ?? null
  const filtersOn = Boolean(q || from || to || moveType || ownerId)
  const screen = loading ? 'movimientos-cargando' : views.length === 0 && !filtersOn ? 'movimientos-vacio' : book === 'fiscal' ? 'movimientos-fiscal' : 'movimientos-physical'

  function assign(next: Record<string, string | null>) {
    setParams(assignParams(params, next))
    setSelected(null)
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
      { id: 'type', header: COLUMN_LABELS.type, cell: (row) => row.moveType },
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
  const types = book === 'fiscal' ? FISCAL_MOVE_TYPES : PHYSICAL_MOVE_TYPES

  if (!allows(me, 'inventory.read')) return <NoPermission />

  function exportCsv() {
    const header = COLUMN_IDS.map((id) => COLUMN_LABELS[id])
    const lines = views.map((row) =>
      [row.when, row.moveType, row.place, row.lot, row.product, formatMl(row.volumeMl), row.units ? formatUnits(row.units) : '', row.document, row.justification, row.silicie, row.user]
        .map(csvCell)
        .join(';'),
    )
    const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `movimientos-${book}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast(copy.stock.csvDone)
  }

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
      toolbar={
        <>
          <div className={FRAME_STRIP_SCROLL}>
            <BookControl value={book} onChange={(value) => assign({ book: value === 'physical' ? null : value, move_type: null })} />
            <Input
              size="sm"
              type="search"
              value={q}
              placeholder={copy.stock.searchMoves}
              aria-label={copy.stock.searchMoves}
              className="w-44 shrink-0 sm:w-56"
              prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
              onChange={(event) => setQ(event.target.value)}
            />
            <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="when" onToggle={toggle} />
          </div>
          <Button type="button" variant="secondary" size="sm" className="md:hidden" disabled={views.length === 0} onClick={exportCsv}>
            CSV
          </Button>
        </>
      }
      filters={
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <DatePicker size="sm" locale="es" timeZone="Europe/Madrid" labels={DATE_LABELS} value={from || null} placeholder={copy.stock.from} className="w-40 shrink-0" onChange={(next) => assign({ from: next })} />
          <DatePicker size="sm" locale="es" timeZone="Europe/Madrid" labels={DATE_LABELS} value={to || null} placeholder={copy.stock.to} className="w-40 shrink-0" onChange={(next) => assign({ to: next })} />
          <Select size="sm" aria-label={copy.stock.type} value={moveType} onChange={(event) => assign({ move_type: event.target.value || null })}>
            <option value="">{copy.stock.type}</option>
            {types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          {views.some((row) => row.locked) ? (
            <span className="inline-flex items-center gap-1">
              <Badge tone="warning" size="sm" icon={<Lock strokeWidth={iconStroke} />}>
                {copy.stock.closed}
              </Badge>
              <InfoTip label={copy.stock.closed}>{periodClosedText(lockedUntil)}</InfoTip>
            </span>
          ) : null}
        </div>
      }
    >
      {error && views.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={reload} />
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
          loading={loading}
          total={book === 'physical' ? physical.total : fiscal.total}
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
      {cursor ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={book === 'physical' ? physical.loadingMore : fiscal.loadingMore} onClick={() => void (book === 'physical' ? physical.loadMore() : fiscal.loadMore())}>
            {copy.stock.loadMore}
          </Button>
        </div>
      ) : null}
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

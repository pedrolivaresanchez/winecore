import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, api, isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { toBalance, toFiscal, toMaterial, type MaterialRow } from '@/pages/existencias/adapt'
import { balanceKey, balancesPath, fiscalBalancesPath, materialsStockPath, ownerEntityId, type FiscalBalance, type StockBalance } from '@/pages/existencias/api'
import { BookControl } from '@/pages/existencias/components/BookControl'
import { ColumnMenu } from '@/pages/existencias/components/ColumnMenu'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { StockPreview } from '@/pages/existencias/components/StockPreview'
import { useCatalog } from '@/pages/existencias/catalog'
import { filterBalances, filterFiscal } from '@/pages/existencias/filters'
import { GRID_LABELS } from '@/pages/existencias/grid'
import { PRODUCT_STATES, classLabel, productLabel, stateLabel } from '@/pages/existencias/labels'
import { assignParams } from '@/pages/existencias/query'
import { summarizeFiscal, summarizePhysical } from '@/pages/existencias/summarize'
import { STOCK_EPOCH_ISO, isBeforeStockEpoch, madridInputToIso } from '@/pages/existencias/time'
import { useHiddenColumns } from '@/pages/existencias/use-hidden'
import { useList } from '@/pages/existencias/use-list'
import { formatMl, formatUnits } from '@/pages/existencias/volume'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Box, MoreVertical, Search } from '@/ui/icons'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  DatePicker,
  EmptyState,
  GlassMenu,
  Input,
  MenuItem,
  Select,
  useMenuOpen,
  type GridColumn,
} from '@/ui'

const STATE_PILLS = PRODUCT_STATES.filter((item) => item.id !== 'grape' && item.id !== 'goods')
const COLUMN_IDS = ['name', 'location', 'lot', 'product', 'state', 'owner', 'litres', 'units'] as const
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  name: 'Recipiente',
  location: 'Ubicación',
  lot: 'Lote',
  product: 'Producto o vino',
  state: 'Estado',
  owner: 'Propietario',
  litres: 'Litros',
  units: 'Unidades',
}
const FISCAL_IDS = ['place', 'klass', 'ref', 'lot', 'product', 'litres', 'units'] as const
const FISCAL_LABELS: Record<(typeof FISCAL_IDS)[number], string> = {
  place: 'Establecimiento',
  klass: 'Mayor',
  ref: 'Referencia',
  lot: 'Lote',
  product: 'Producto o vino',
  litres: 'Litros',
  units: 'Unidades',
}
const MATERIAL_LABELS: Record<'sku' | 'name' | 'location' | 'units', string> = {
  sku: 'Referencia',
  name: 'Material',
  location: 'Ubicación',
  units: 'Unidades',
}

const DATE_LABELS = { clear: copy.stock.dateClear, today: copy.stock.dateToday, time: copy.stock.dateTime }

function stateTone(state: string): 'info' | 'warning' | 'success' | 'neutral' {
  if (state === 'wine') return 'info'
  if (state === 'must') return 'warning'
  if (state === 'packaged_labeled') return 'success'
  return 'neutral'
}

function shownProduct(row: { product_name?: string | null; wine_name?: string | null; vintage?: number | null }): string {
  if (!row.product_name && !row.wine_name) return '—'
  return productLabel(row)
}

export function StockPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const more = useMenuOpen()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const ownerId = ownerEntityId(filter, entities)
  const [params, setParams] = useSearchParams()
  const at = params.get('at') || new Date().toISOString()
  const book = params.get('book') === 'fiscal' ? 'fiscal' : 'physical'
  const locationId = params.get('location') ?? ''
  const state = params.get('state') ?? ''
  const materials = params.get('cat') === 'materials'
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    name: 130,
    location: 160,
    lot: 150,
    product: 220,
    state: 110,
    litres: 130,
    units: 110,
    place: 180,
    klass: 150,
    ref: 140,
  })
  const [materialsOn, setMaterialsOn] = useState(false)
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([])
  const [materialLoading, setMaterialLoading] = useState(false)
  const hiddenPhysical = useHiddenColumns('winecore.columns.stock', COLUMN_IDS, ['owner'])
  const hiddenFiscal = useHiddenColumns('winecore.columns.stock-fiscal', FISCAL_IDS)
  const before = isBeforeStockEpoch(at)
  const canCount = allows(me, 'inventory.count')

  const physicalPath = before || book !== 'physical' || materials ? null : balancesPath({ at, locationId, ownerEntityId: ownerId, state })
  const fiscalPath = before || book !== 'fiscal' ? null : fiscalBalancesPath({ at, legalEntityId: ownerId })
  const physical = useList<unknown>(physicalPath)
  const fiscal = useList<unknown>(fiscalPath)

  useEffect(() => {
    if (before) return
    const controller = new AbortController()
    api(materialsStockPath(at, ownerId), { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setMaterialsOn(true)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        setMaterialsOn(false)
      })
    return () => controller.abort()
  }, [at, before, ownerId])

  useEffect(() => {
    if (!materials || !materialsOn || before) return
    const controller = new AbortController()
    setMaterialLoading(true)
    api<{ items?: unknown[] }>(materialsStockPath(at, ownerId), { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        setMaterialRows((page.items ?? []).map((row) => toMaterial(row, catalog)))
        setMaterialLoading(false)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        setMaterialRows([])
        setMaterialLoading(false)
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) setMaterialsOn(false)
      })
    return () => controller.abort()
  }, [at, before, catalog, materials, materialsOn, ownerId])

  function assign(next: Record<string, string | null>) {
    setParams(assignParams(params, next))
    setSelected(null)
  }

  const physicalRows = useMemo(() => {
    const rows = physical.items.map((row) => toBalance(row, catalog))
    return filterBalances(rows, { ownerEntityId: ownerId, locationId, state, q }).sort((a, b) =>
      a.location_code.localeCompare(b.location_code, 'es') || (a.vessel_code ?? '').localeCompare(b.vessel_code ?? '', 'es'),
    )
  }, [catalog, locationId, ownerId, physical.items, q, state])
  const fiscalRows = useMemo(
    () => filterFiscal(fiscal.items.map((row) => toFiscal(row, catalog)), { legalEntityId: ownerId, q }),
    [catalog, fiscal.items, ownerId, q],
  )
  const stats = useMemo(() => summarizePhysical(physicalRows), [physicalRows])
  const fiscalStats = useMemo(() => summarizeFiscal(fiscalRows), [fiscalRows])
  const locations = useMemo(
    () => [...catalog.locations.values()].map((place) => [place.id, `${place.code} · ${place.name}`] as const),
    [catalog],
  )

  const filtersOn = Boolean(q || locationId || state || ownerId || materials)
  const visibleCount = materials ? materialRows.length : book === 'physical' ? physicalRows.length : fiscalRows.length
  const loading = materials ? materialLoading : book === 'physical' ? physical.loading : fiscal.loading
  const error = materials ? null : book === 'physical' ? physical.error : fiscal.error
  const reload = book === 'physical' ? physical.reload : fiscal.reload
  const screen = loading
    ? 'existencias-cargando'
    : before
      ? 'existencias-antes'
      : book === 'fiscal'
        ? 'existencias-fiscal'
        : materials
          ? 'existencias-materiales'
          : visibleCount === 0 && !filtersOn
            ? 'existencias-vacio'
            : 'existencias-physical'

  const selectedRow = physicalRows.find((row) => balanceKey(row) === selected) ?? null
  const selectedIndex = physicalRows.findIndex((row) => balanceKey(row) === selected)
  const informeTo = `/stock/informe?at=${encodeURIComponent(at)}`

  const columns = useMemo<GridColumn<StockBalance>[]>(() => {
    const all: GridColumn<StockBalance>[] = [
      { id: 'name', header: COLUMN_LABELS.name, cell: (row) => row.vessel_code ?? shownProduct(row) },
      { id: 'location', header: COLUMN_LABELS.location, cell: (row) => row.location_name },
      { id: 'product', header: COLUMN_LABELS.product, cell: (row) => shownProduct(row) },
      {
        id: 'lot',
        header: COLUMN_LABELS.lot,
        cell: (row) =>
          row.lot_code ? (
            <Link to={`/bodega/lotes/${encodeURIComponent(row.lot_code)}`} className="underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>
              {row.lot_code}
            </Link>
          ) : (
            '—'
          ),
      },
      {
        id: 'state',
        header: COLUMN_LABELS.state,
        cell: (row) => (
          <Badge tone={stateTone(row.product_state)} size="sm">
            {stateLabel(row.product_state)}
          </Badge>
        ),
      },
      { id: 'owner', header: COLUMN_LABELS.owner, cell: (row) => row.owner_code },
      { id: 'litres', header: COLUMN_LABELS.litres, align: 'right', cell: (row) => formatMl(row.volume_ml) },
      { id: 'units', header: COLUMN_LABELS.units, align: 'right', cell: (row) => (row.qty_units ? formatUnits(row.qty_units) : '—') },
    ]
    return all.filter((column) => !hiddenPhysical.hidden.has(column.id))
  }, [hiddenPhysical.hidden])

  const fiscalColumns = useMemo<GridColumn<FiscalBalance>[]>(() => {
    const all: GridColumn<FiscalBalance>[] = [
      { id: 'place', header: FISCAL_LABELS.place, cell: (row) => row.tax_warehouse_name },
      { id: 'klass', header: FISCAL_LABELS.klass, cell: (row) => classLabel(row.product_class) },
      { id: 'ref', header: FISCAL_LABELS.ref, cell: (row) => row.excise_product_key ?? '—' },
      { id: 'lot', header: FISCAL_LABELS.lot, cell: (row) => row.lot_code ?? '—' },
      { id: 'product', header: FISCAL_LABELS.product, cell: (row) => shownProduct(row) },
      { id: 'litres', header: FISCAL_LABELS.litres, align: 'right', cell: (row) => formatMl(row.volume_ml) },
      { id: 'units', header: FISCAL_LABELS.units, align: 'right', cell: (row) => (row.units ? formatUnits(row.units) : '—') },
    ]
    return all.filter((column) => !hiddenFiscal.hidden.has(column.id))
  }, [hiddenFiscal.hidden])

  const materialColumns = useMemo<GridColumn<MaterialRow>[]>(
    () => [
      { id: 'sku', header: MATERIAL_LABELS.sku, cell: (row) => row.sku },
      { id: 'name', header: MATERIAL_LABELS.name, cell: (row) => row.name },
      { id: 'location', header: MATERIAL_LABELS.location, cell: (row) => row.location },
      { id: 'units', header: MATERIAL_LABELS.units, align: 'right', cell: (row) => formatUnits(row.units) },
    ],
    [],
  )

  if (!allows(me, 'inventory.read')) return <NoPermission />

  const summary = materials
    ? null
    : book === 'physical'
      ? [copy.stock.bulk, formatMl(stats.bulkMl), ...stats.formats.map((item) => `${item.label} ${formatUnits(item.units)} ${copy.stock.units}`)].join(' · ')
      : [
          `${copy.stock.bulk} ${formatMl(fiscalStats.bulk.volumeMl)}`,
          `${copy.stock.bulkWood} ${formatMl(fiscalStats.bulk_wood.volumeMl)}`,
          `${copy.stock.packaged} ${formatUnits(fiscalStats.packaged.units)} ${copy.stock.units}`,
        ].join(' · ')

  const kinds = (
    <>
      <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=opening')}>{copy.stock.opening}</MenuItem>
      <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=inspection')}>{copy.stock.inspectionKind}</MenuItem>
      <MenuItem onClick={() => navigate('/stock/aforos/nuevo?kind=spot')}>{copy.stock.spot}</MenuItem>
      <MenuItem onClick={() => navigate(informeTo)}>{copy.stock.inspection}</MenuItem>
    </>
  )

  return (
    <ListFrame
      screen={screen}
      title={copy.stock.title}
      section="stock"
      icon={<Box className="size-4" strokeWidth={iconStroke} />}
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate(informeTo)}>
            {copy.stock.report}
          </Button>
          {canCount ? (
            <>
              <Button type="button" variant="primary" size="sm" onClick={() => navigate('/stock/aforos/nuevo')}>
                {copy.stock.startCount}
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
                {kinds}
              </GlassMenu>
            </>
          ) : null}
        </>
      }
      toolbar={
        <>
          <div className={FRAME_STRIP_SCROLL}>
            <BookControl value={book} onChange={(value) => assign({ book: value === 'physical' ? null : value, cat: null })} />
            <Input
              size="sm"
              type="search"
              value={q}
              placeholder={copy.stock.searchBalances}
              aria-label={copy.stock.searchBalances}
              className="w-44 shrink-0 sm:w-56"
              prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
              onChange={(event) => setQ(event.target.value)}
            />
            <DatePicker
              size="sm"
              withTime
              timeZone="Europe/Madrid"
              locale="es"
              labels={DATE_LABELS}
              value={at}
              className="w-48 shrink-0"
              onChange={(next) => {
                if (!next) {
                  assign({ at: new Date().toISOString() })
                  return
                }
                assign({ at: next.includes('T') ? madridInputToIso(next) : madridInputToIso(`${next}T12:00`) })
              }}
            />
            {book === 'physical' && !materials ? (
              <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hiddenPhysical.hidden} locked="name" onToggle={hiddenPhysical.toggle} />
            ) : null}
            {book === 'fiscal' ? (
              <ColumnMenu ids={FISCAL_IDS} labels={FISCAL_LABELS} hidden={hiddenFiscal.hidden} locked="place" onToggle={hiddenFiscal.toggle} />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 md:hidden">
            {canCount ? (
              <Button type="button" variant="primary" size="sm" onClick={() => navigate('/stock/aforos/nuevo')}>
                {copy.stock.startCount}
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate(informeTo)}>
                {copy.stock.report}
              </Button>
            )}
          </div>
        </>
      }
      filters={
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {book === 'physical' ? (
            <>
              <Chip pressed={!state && !materials} active={!state && !materials} onClick={() => assign({ state: null, cat: null })}>
                {copy.stock.all}
              </Chip>
              {STATE_PILLS.map((item) => (
                <Chip
                  key={item.id}
                  pressed={state === item.id && !materials}
                  active={state === item.id && !materials}
                  onClick={() => assign({ state: state === item.id ? null : item.id, cat: null })}
                >
                  {item.label}
                </Chip>
              ))}
              {materialsOn ? (
                <Chip pressed={materials} active={materials} onClick={() => assign({ cat: materials ? null : 'materials', state: null })}>
                  {copy.stock.materials}
                </Chip>
              ) : null}
              <Select size="sm" aria-label={copy.stock.location} value={locationId} onChange={(event) => assign({ location: event.target.value || null })}>
                <option value="">{copy.stock.location}</option>
                {locations.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <span className="hidden whitespace-nowrap text-caption text-text-tertiary md:inline">{copy.stock.booksLine}</span>
          {summary && visibleCount > 0 ? <span className="ml-auto hidden shrink-0 text-caption text-text-tertiary tabular-nums xl:inline">{summary}</span> : null}
        </div>
      }
    >
      {before ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<Box strokeWidth={iconStroke} />}
            title={copy.stock.beforeTitle}
            description={copy.stock.beforeHint}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" variant="primary" size="sm" onClick={() => assign({ at: STOCK_EPOCH_ISO })}>
                  {copy.stock.seeEpoch}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/stock/aforos?kind=opening')}>
                  {copy.stock.opening}
                </Button>
              </div>
            }
          />
        </div>
      ) : error && visibleCount === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={reload} />
        </div>
      ) : materials ? (
        <DataGrid
          columns={materialColumns}
          rows={materialRows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={() => undefined}
          loading={materialLoading}
          total={materialRows.length}
          empty={<EmptyState size="sm" title={filtersOn ? copy.stock.noMatch : copy.stock.emptyBalances} />}
        />
      ) : book === 'physical' ? (
        <>
          <DataGrid
            columns={columns}
            rows={physicalRows}
            rowKey={(row) => balanceKey(row)}
            labels={GRID_LABELS}
            widths={widths}
            onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
            selected={picked}
            onSelectedChange={setPicked}
            onOpenRow={(row) => setSelected(balanceKey(row))}
            openRowKey={selected}
            loading={physical.loading}
            total={physical.total || physicalRows.length}
            empty={
              <EmptyState
                size="sm"
                icon={<Box strokeWidth={iconStroke} />}
                title={filtersOn ? copy.stock.noMatch : copy.stock.emptyBalances}
                description={filtersOn ? undefined : copy.stock.emptyBalancesHint}
              />
            }
          />
          {physical.cursor ? (
            <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
              <Button type="button" variant="ghost" size="sm" loading={physical.loadingMore} onClick={() => void physical.loadMore()}>
                {copy.stock.loadMore}
              </Button>
            </div>
          ) : null}
          <StockPreview
            row={selectedRow}
            index={selectedIndex}
            total={physicalRows.length}
            onClose={() => setSelected(null)}
            onPrev={selectedIndex > 0 ? () => setSelected(balanceKey(physicalRows[selectedIndex - 1]!)) : undefined}
            onNext={selectedIndex >= 0 && selectedIndex < physicalRows.length - 1 ? () => setSelected(balanceKey(physicalRows[selectedIndex + 1]!)) : undefined}
          />
        </>
      ) : (
        <>
          <DataGrid
            columns={fiscalColumns}
            rows={fiscalRows}
            rowKey={(row) => `${row.tax_warehouse_id}:${row.product_class}:${row.excise_product_key ?? ''}:${row.lot_id ?? ''}`}
            labels={GRID_LABELS}
            widths={widths}
            onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
            selected={picked}
            onSelectedChange={setPicked}
            onOpenRow={() => undefined}
            loading={fiscal.loading}
            total={fiscal.total || fiscalRows.length}
            empty={
              <EmptyState
                size="sm"
                title={filter === 'CVPO' ? copy.stock.emptyFiscalCvpo : filtersOn ? copy.stock.noMatch : copy.stock.emptyFiscal}
                description={filter === 'CVPO' ? copy.stock.emptyFiscalCvpoHint : undefined}
              />
            }
          />
          {fiscal.cursor ? (
            <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
              <Button type="button" variant="ghost" size="sm" loading={fiscal.loadingMore} onClick={() => void fiscal.loadMore()}>
                {copy.stock.loadMore}
              </Button>
            </div>
          ) : null}
        </>
      )}
      </ListFrame>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { listLegacyProducts, type LegacyProduct } from '@/lib/legacy'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import { originTone, statusTone } from '@/lib/status-tones'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import { useApi } from '@/hooks/use-api'
import {
  Badge,
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  StatusPill,
  useCursorPages,
  useGridFilterLink,
  useMenuOpen,
  useToast,
  type CursorPage,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'
import { Ban, DownloadSimple, Undo2 } from '@/ui/icons'
import { exportProducts, listProducts, setProductActive } from '@/pages/catalogo/api'
import { GtinScanButton } from '@/pages/catalogo/components/GtinScan'
import { ListFrame, MobileObjectSwitch } from '@/pages/catalogo/frame'
import { GRID_LABELS } from '@/pages/catalogo/labels'
import { formatAlcohol, formatQty } from '@/pages/catalogo/money'
import {
  KIND_OPTIONS,
  formatCode,
  productWarnings,
  taxLabel,
  wineName,
  type Format,
  type ListPage,
  type MissingData,
  type Product,
  type ProductKind,
  type ProductQuery,
  type Wine,
} from '@/pages/catalogo/model'
import { ProductPreview } from '@/pages/catalogo/ProductPreview'

type Listed = Product & { imported?: boolean; importedStock?: string | null }

function fromHolded(row: LegacyProduct): Listed {
  return {
    id: `holded:${row.id}`,
    sku: row.sku ?? '—',
    name: row.name,
    name_en: null,
    kind: 'merchandise',
    wine_id: null,
    vintage: null,
    format_id: null,
    unit: 'ud',
    gtin: null,
    gtin_case: null,
    nc_code: null,
    excise_product_key: null,
    alcohol_pct: null,
    default_tax_code: row.tax_label,
    sales_account: null,
    is_stock_tracked: false,
    requires_lot: false,
    is_active: true,
    legacy_refs: {},
    created_at: '',
    updated_at: '',
    imported: true,
    importedStock: row.stock,
  }
}

const COLUMN_KEY = 'winecore.columns.products'
const COLUMN_IDS = ['name', 'origin', 'sku', 'wine', 'vintage', 'format', 'gtin', 'nc', 'tax', 'alcohol', 'stock', 'active', 'warnings'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Nombre',
  origin: copy.lists.origin.label,
  sku: 'SKU',
  wine: 'Vino',
  vintage: 'Añada',
  format: 'Formato',
  gtin: 'GTIN',
  nc: 'NC',
  tax: 'IVA',
  alcohol: 'Grado',
  stock: 'Existencias',
  active: 'Activo',
  warnings: 'Avisos',
}
const DEFAULT_HIDDEN = new Set<ColumnId>(['nc', 'tax', 'alcohol'])

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

const text = copy.lists.catalog

const VINTAGES = (() => {
  const year = new Date().getFullYear()
  return Array.from({ length: 30 }, (_, index) => String(year - index))
})()

const NO_PAGE: ListPage<Product> = { items: [], next_cursor: null, total: 0 }

function holdedOrNothing(err: unknown): null {
  if (isAbortError(err)) throw err
  return null
}

/**
 * The catalog's own products, then the ones still only in Holded, as one paged list.
 *
 * Each source pages by its own keyset cursor; the combined cursor says which source the next
 * page comes from (`n:` ours, `h:` Holded) and, once in Holded, how many of ours came before,
 * so the total stays whole without asking our endpoint again.
 */
async function productPage(
  query: ProductQuery,
  holded: { entity: ReturnType<typeof entityFilter>; q: string } | null,
  ownRows: boolean,
  cursor: string | null,
  limit: number,
  signal: AbortSignal,
): Promise<CursorPage<Listed>> {
  const tail = cursor?.match(/^h:(\d+):(.*)$/)
  if (holded && tail) {
    const before = Number(tail[1])
    const page = await listLegacyProducts({ ...holded, cursor: tail[2] || null, limit }, signal)
    return { items: page.items.map(fromHolded), next_cursor: page.next_cursor ? `h:${before}:${page.next_cursor}` : null, total: before + page.total }
  }
  const own = ownRows ? await listProducts({ ...query, cursor: cursor?.replace(/^n:/, '') || undefined, limit }, signal) : NO_PAGE
  if (!holded) return { items: own.items, next_cursor: own.next_cursor ? `n:${own.next_cursor}` : null, total: own.total }
  const room = limit - own.items.length
  const legacy = await listLegacyProducts({ ...holded, limit: own.next_cursor ? 1 : Math.max(1, room) }, signal).catch(holdedOrNothing)
  const legacyTotal = legacy?.total ?? 0
  if (own.next_cursor) return { items: own.items, next_cursor: `n:${own.next_cursor}`, total: own.total + legacyTotal }
  if (room <= 0) return { items: own.items, next_cursor: legacyTotal > 0 ? `h:${own.total}:` : null, total: own.total + legacyTotal }
  return {
    items: [...own.items, ...(legacy?.items ?? []).map(fromHolded)],
    next_cursor: legacy?.next_cursor ? `h:${own.total}:${legacy.next_cursor}` : null,
    total: own.total + legacyTotal,
  }
}

export function ProductList({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
  const [params, setParams] = useSearchParams()
  const canWrite = allows(me, 'catalog.write')
  const kind = (params.get('kind') ?? '') as '' | ProductKind
  const wineId = params.get('wine_id') ?? ''
  const formatId = params.get('format_id') ?? ''
  const vintage = params.get('vintage') ?? ''
  const active = (params.get('active') ?? '') as '' | 'true' | 'false'
  const organic = params.get('organic') === 'true'
  const missing = (params.get('missing') ?? '') as MissingData
  const origin = (params.get('origin') ?? '') as '' | 'winecore' | 'holded'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ name: 280, origin: 120, sku: 168, warnings: 200, wine: 180, vintage: 88, format: 96, stock: 120, active: 110 })
  const wines = useApi<ListPage<Wine>>('/v1/wines?limit=100')
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  const wineRows = useMemo(() => wines.data?.items ?? [], [wines.data])
  const formatRows = useMemo(() => formats.data?.items ?? [], [formats.data])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const query = useMemo<ProductQuery>(
    () => ({ q: debounced, kind, wine_id: wineId, format_id: formatId, vintage, active, organic, missing }),
    [active, debounced, formatId, kind, missing, organic, vintage, wineId],
  )

  const catalogOnly = Boolean(kind || wineId || formatId || vintage || active || organic || missing)
  const withHolded = !catalogOnly && origin !== 'winecore'
  const ownRows = origin !== 'holded'

  const pages = useCursorPages<Listed>({
    queryKey: JSON.stringify({ query, entity, origin, withHolded }),
    storageKey: 'products',
    fetchPage: ({ cursor, limit, signal }) =>
      productPage(query, withHolded ? { entity, q: debounced } : null, ownRows, cursor, limit, signal),
  })
  const items = pages.items
  const loading = pages.loading && items.length === 0
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const filters = useMemo<FilterDef[]>(
    () => [
      { id: 'kind', label: text.kind, kind: 'single', options: KIND_OPTIONS.map((option) => ({ value: option.id, label: option.label })) },
      { id: 'wine_id', label: text.wine, kind: 'single', options: wineRows.map((wine) => ({ value: wine.id, label: wine.name })) },
      { id: 'format_id', label: text.format, kind: 'single', options: formatRows.map((format) => ({ value: format.id, label: format.code })) },
      { id: 'vintage', label: text.vintage, kind: 'single', optional: true, options: VINTAGES.map((year) => ({ value: year, label: year })) },
      {
        id: 'active',
        label: text.state,
        kind: 'single',
        display: 'chips',
        options: [
          { value: 'true', label: text.active, tone: statusTone('active') },
          { value: 'false', label: text.inactive, tone: statusTone('inactive') },
        ],
      },
      { id: 'organic', label: copy.catalog.organic, kind: 'toggle' },
      {
        id: 'missing',
        label: text.warnings,
        kind: 'single',
        options: [
          { value: 'gtin', label: copy.catalog.missingGtin, tone: 'warning' },
          { value: 'nc_code', label: copy.catalog.missingNc, tone: 'warning' },
          { value: 'silicie', label: copy.catalog.missingSilicie, tone: 'warning' },
        ],
      },
      {
        id: 'origin',
        label: copy.lists.origin.label,
        kind: 'single',
        optional: true,
        options: [
          { value: 'winecore', label: copy.lists.origin.winecore, tone: originTone('winecore') },
          { value: 'holded', label: copy.lists.origin.holded, tone: originTone('holded') },
        ],
      },
    ],
    [formatRows, wineRows],
  )

  function setFilter(key: string, value: FilterValue) {
    const next = new URLSearchParams(params)
    if (value === true) next.set(key, 'true')
    else if (typeof value === 'string' && value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const key of ['kind', 'wine_id', 'format_id', 'vintage', 'active', 'organic', 'missing', 'origin', 'q']) next.delete(key)
    setParams(next)
    setQ('')
  }

  function toggleColumn(id: ColumnId) {
    if (id === 'name') return
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const columns = useMemo<GridColumn<Listed>[]>(() => {
    const all: GridColumn<Listed>[] = [
      { id: 'name', header: 'Nombre', cell: (row) => row.name },
      {
        id: 'origin',
        header: copy.lists.origin.label,
        filterValue: (row) => (row.imported ? copy.lists.origin.holded : copy.lists.origin.winecore),
        cell: (row) => (
          <StatusPill tone={originTone(row.imported ? 'holded' : 'winecore')} title={row.imported ? copy.catalog.imported : undefined}>
            {row.imported ? copy.lists.origin.holded : copy.lists.origin.winecore}
          </StatusPill>
        ),
      },
      { id: 'sku', header: 'SKU', cell: (row) => <span className="font-mono text-caption">{row.sku}</span> },
      { id: 'wine', header: 'Vino', cell: (row) => wineName(row, wineRows) },
      { id: 'vintage', header: 'Añada', cell: (row) => (row.vintage == null ? '—' : String(row.vintage)) },
      { id: 'format', header: 'Formato', cell: (row) => formatCode(row, formatRows) },
      { id: 'gtin', header: 'GTIN', cell: (row) => <span className="font-mono text-caption">{row.gtin || '—'}</span> },
      { id: 'nc', header: 'NC', cell: (row) => row.nc_code || '—' },
      { id: 'tax', header: 'IVA', cell: (row) => taxLabel(row.default_tax_code) },
      { id: 'alcohol', header: 'Grado', align: 'right', cell: (row) => formatAlcohol(row.alcohol_pct) },
      {
        id: 'stock',
        header: 'Existencias',
        align: 'right',
        cell: (row) => {
          if (row.imported) return row.importedStock || '—'
          if (!row.is_stock_tracked) return '—'
          return (
            <Link to={`/stock?product_id=${row.id}`} className="underline" onClick={(event) => event.stopPropagation()}>
              {row.on_hand_qty ? formatQty(row.on_hand_qty) : 'Ver'}
            </Link>
          )
        },
      },
      {
        id: 'active',
        header: 'Activo',
        filterValue: (row) => (row.is_active ? text.activeOne : text.inactiveOne),
        cell: (row) => (
          <StatusPill tone={statusTone(row.is_active ? 'active' : 'inactive')}>{row.is_active ? text.activeOne : text.inactiveOne}</StatusPill>
        ),
      },
      {
        id: 'warnings',
        header: 'Avisos',
        cell: (row) => {
          const warnings = productWarnings(row)
          if (warnings.length === 0) return '—'
          return (
            <span className="flex gap-1">
              {warnings.map((warning) => (
                <Badge key={warning} tone="warning" size="sm" variant="dot">
                  {warning}
                </Badge>
              ))}
            </span>
          )
        },
      },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [formatRows, hidden, wineRows])

  const chosen = items.filter((item) => picked.has(item.id))
  const ownChosen = chosen.filter((item) => !item.imported)
  const toDeactivate = ownChosen.filter((item) => item.is_active)
  const toReactivate = ownChosen.filter((item) => !item.is_active)

  async function setActive(rows: Listed[], next: boolean) {
    const results = await Promise.allSettled(rows.map((row) => setProductActive(row.id, next, row.updated_at)))
    const done = results.filter((result) => result.status === 'fulfilled').length
    if (done === rows.length) toast(fill(next ? text.reactivatedDone : text.deactivatedDone, { n: String(done) }))
    else toast(fill(copy.lists.bulk.partial, { done: String(done), n: String(rows.length) }))
    setPicked(new Set())
    pages.reload()
  }

  function exportSelection() {
    downloadCsv(
      'productos-seleccion.csv',
      COLUMN_IDS.map((id) => COLUMN_LABELS[id]),
      chosen.map((row) => [
        row.name,
        row.imported ? copy.lists.origin.holded : copy.lists.origin.winecore,
        row.sku,
        row.imported ? null : wineName(row, wineRows),
        row.vintage,
        row.imported ? null : formatCode(row, formatRows),
        row.gtin,
        row.nc_code,
        taxLabel(row.default_tax_code),
        row.alcohol_pct,
        row.imported ? row.importedStock : row.on_hand_qty,
        row.is_active ? text.activeOne : text.inactiveOne,
        productWarnings(row).join(' · '),
      ]),
    )
    toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
  }

  const actions: SelectionAction[] = [
    ...(canWrite && toDeactivate.length > 0
      ? [
          {
            id: 'deactivate',
            label: text.deactivate,
            icon: Ban,
            confirm: {
              title: fill(text.deactivateTitle, { n: String(toDeactivate.length) }),
              body: text.deactivateBody,
              confirmLabel: text.deactivate,
            },
            onRun: () => setActive(toDeactivate, false),
          },
        ]
      : []),
    ...(canWrite && toReactivate.length > 0
      ? [{ id: 'reactivate', label: text.reactivate, icon: Undo2, onRun: () => setActive(toReactivate, true) }]
      : []),
    { id: 'export', label: copy.lists.bulk.exportCsv, icon: DownloadSimple, onRun: exportSelection },
  ]

  const filtersActive = Boolean(debounced || catalogOnly || origin)
  const selectedIndex = items.findIndex((item) => item.id === selected)
  if (!allows(me, 'catalog.read')) return <NoPermission />

  const screen = loading ? 'catalogo-cargando' : items.length === 0 && !filtersActive ? 'catalogo-vacio' : 'catalogo'
  const create = (
    <Button type="button" variant="primary" size="sm" onClick={() => navigate('/catalogo/nuevo')}>
      <span className="sm:hidden">Nuevo</span>
      <span className="hidden sm:inline">{copy.catalog.newProduct}</span>
    </Button>
  )

  return (
    <ListFrame
      screen={screen}
      object="productos"
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void exportProducts(query).catch(() => toast('No se ha podido exportar.'))
            }}
          >
            {copy.catalog.export}
          </Button>
          {canWrite ? create : null}
        </>
      }
      bar={
        <FilterBar
          leading={<MobileObjectSwitch current="productos" />}
          search={{ id: 'buscar-productos', value: q, onChange: setQ, placeholder: copy.catalog.searchProducts }}
          filters={filters}
          values={{ kind, wine_id: wineId, format_id: formatId, vintage, active, organic, missing, origin }}
          onChange={setFilter}
          onClear={clearFilters}
          grid={gridFilters}
          selection={{
            count: picked.size,
            pageCount: items.length,
            onSelectAll: () => setPicked(new Set(items.map((item) => item.id))),
            onClear: () => setPicked(new Set()),
            actions,
          }}
          trailing={
            <>
              <GtinScanButton onCode={setQ} />
              <GlassMenu
                open={columnsMenu.open}
                onOpenChange={columnsMenu.setOpen}
                placement="bottom-end"
                panelClassName="min-w-[200px]"
                className="max-md:hidden"
                trigger={
                  <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.catalog.columns}>
                    {copy.catalog.columns}
                  </MenuChip>
                }
              >
                {COLUMN_IDS.map((id) => (
                  <MenuItem key={id} checked={!hidden.has(id)} disabled={id === 'name'} onClick={() => toggleColumn(id)}>
                    {COLUMN_LABELS[id]}
                  </MenuItem>
                ))}
              </GlassMenu>
              {canWrite ? <span className="md:hidden">{create}</span> : null}
            </>
          }
        />
      }
    >
      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => {
            if (row.imported) return
            setSelected(row.id)
          }}
          rowHref={(row) => (row.imported ? undefined : `/catalogo/${row.id}`)}
          openRowKey={selected}
          total={pages.total ?? undefined}
          loading={pages.loading}
          filterLink={gridFilters}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.catalog.noMatch : copy.catalog.emptyProducts}
              description={filtersActive ? undefined : copy.catalog.emptyProductsHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/catalogo/nuevo')}>
                    {copy.catalog.newProduct}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <Pagination {...pages.pagination} />
      <ProductPreview
        id={selected}
        ids={items.map((item) => item.id)}
        index={selectedIndex}
        wines={wineRows}
        formats={formatRows}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onSelect={setSelected}
      />
    </ListFrame>
  )
}

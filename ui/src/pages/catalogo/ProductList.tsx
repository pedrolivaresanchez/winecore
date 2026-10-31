import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { listLegacyProducts, type LegacyProduct } from '@/lib/legacy'
import { allows } from '@/lib/permissions'
import { entityFilter } from '@/lib/reports'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import { useApi } from '@/hooks/use-api'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  Select,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'
import { Search } from '@/ui/icons'
import { exportProducts, listProducts } from '@/pages/catalogo/api'
import { GtinScanButton } from '@/pages/catalogo/components/GtinScan'
import { ListFrame } from '@/pages/catalogo/frame'
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
const COLUMN_IDS = ['name', 'sku', 'wine', 'vintage', 'format', 'gtin', 'nc', 'tax', 'alcohol', 'stock', 'active', 'warnings'] as const
type ColumnId = (typeof COLUMN_IDS)[number]
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Nombre',
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

export function ProductList({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const [params, setParams] = useSearchParams()
  const canWrite = allows(me, 'catalog.write')
  const kind = (params.get('kind') ?? '') as '' | ProductKind
  const wineId = params.get('wine_id') ?? ''
  const formatId = params.get('format_id') ?? ''
  const vintage = params.get('vintage') ?? ''
  const active = (params.get('active') ?? '') as '' | 'true' | 'false'
  const organic = params.get('organic') === 'true'
  const missing = (params.get('missing') ?? '') as MissingData
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q.trim())
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const [items, setItems] = useState<Listed[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ name: 280, origin: 200, sku: 168, warnings: 200, wine: 180, vintage: 88, format: 96, stock: 120, active: 110 })
  const wines = useApi<ListPage<Wine>>('/v1/wines?limit=100')
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  const wineRows = useMemo(() => wines.data?.items ?? [], [wines.data])
  const formatRows = useMemo(() => formats.data?.items ?? [], [formats.data])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const query = useMemo<ProductQuery>(
    () => ({ q: debounced, kind, wine_id: wineId, format_id: formatId, vintage, active, organic, missing, limit: 50 }),
    [active, debounced, formatId, kind, missing, organic, vintage, wineId],
  )

  const catalogOnly = Boolean(kind || wineId || formatId || vintage || active || organic || missing)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    const holded = catalogOnly
      ? Promise.resolve({ items: [] as LegacyProduct[], total: 0 })
      : listLegacyProducts({ entity, q: debounced, limit: 100 }, controller.signal).catch((err: unknown) => {
          if (isAbortError(err)) throw err
          return { items: [] as LegacyProduct[], total: 0 }
        })
    Promise.all([listProducts(query, controller.signal), holded])
      .then(([page, imported]) => {
        if (!live) return
        setItems([...page.items, ...imported.items.map(fromHolded)])
        setCursor(page.next_cursor)
        setTotal(page.total + imported.total)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [attempt, catalogOnly, debounced, entity, query])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
    setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listProducts({ ...query, cursor })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
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
        header: 'Origen',
        cell: (row) =>
          row.imported ? (
            <Badge tone="neutral" size="sm">
              {copy.catalog.imported}
            </Badge>
          ) : null,
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
        cell: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Activo' : 'Inactivo'}</Badge>,
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

  const filtersActive = Boolean(debounced || kind || wineId || formatId || vintage || active || organic || missing)
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
      mobileActions={canWrite ? create : null}
      toolbar={
        <>
          <Input
            id="buscar-productos"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.catalog.searchProducts}
            aria-label={copy.catalog.searchProducts}
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <GtinScanButton onCode={setQ} />
          <GlassMenu
            open={columnsMenu.open}
            onOpenChange={columnsMenu.setOpen}
            placement="bottom-start"
            panelClassName="min-w-[200px]"
            className="hidden md:inline-flex"
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
        </>
      }
      filters={
        <>
          <Select id="filtro-tipo" size="sm" aria-label="Tipo" value={kind} onChange={(event) => setFilter('kind', event.target.value)}>
            <option value="">Tipo</option>
            {KIND_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select id="filtro-vino" size="sm" aria-label="Vino" value={wineId} onChange={(event) => setFilter('wine_id', event.target.value)}>
            <option value="">Vino</option>
            {wineRows.map((wine) => (
              <option key={wine.id} value={wine.id}>
                {wine.name}
              </option>
            ))}
          </Select>
          <Select
            id="filtro-formato"
            size="sm"
            aria-label="Formato"
            value={formatId}
            onChange={(event) => setFilter('format_id', event.target.value)}
          >
            <option value="">Formato</option>
            {formatRows.map((format) => (
              <option key={format.id} value={format.id}>
                {format.code}
              </option>
            ))}
          </Select>
          <Input
            id="filtro-anada"
            size="sm"
            inputMode="numeric"
            value={vintage}
            placeholder="Añada"
            aria-label="Añada"
            className="w-24 shrink-0"
            onChange={(event) => setFilter('vintage', event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <Chip pressed={active === 'true'} active={active === 'true'} onClick={() => setFilter('active', active === 'true' ? '' : 'true')}>
            {copy.catalog.activeOnly}
          </Chip>
          <Chip pressed={organic} active={organic} onClick={() => setFilter('organic', organic ? '' : 'true')}>
            {copy.catalog.organic}
          </Chip>
          <Chip pressed={missing === 'gtin'} active={missing === 'gtin'} onClick={() => setFilter('missing', missing === 'gtin' ? '' : 'gtin')}>
            {copy.catalog.missingGtin}
          </Chip>
          <Chip
            pressed={missing === 'nc_code'}
            active={missing === 'nc_code'}
            onClick={() => setFilter('missing', missing === 'nc_code' ? '' : 'nc_code')}
          >
            {copy.catalog.missingNc}
          </Chip>
          <Chip
            pressed={missing === 'silicie'}
            active={missing === 'silicie'}
            onClick={() => setFilter('missing', missing === 'silicie' ? '' : 'silicie')}
          >
            {copy.catalog.missingSilicie}
          </Chip>
        </>
      }
    >
      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState
            title={`${copy.error.load} (${error.code})`}
            detail={error.message}
            onRetry={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          />
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
          total={total}
          loading={loading}
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
      {cursor ? (
        <div className="flex h-10 shrink-0 items-center border-t border-border-subtle px-3 sm:px-4">
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}
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

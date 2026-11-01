import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { MoreVertical } from '@/ui/icons'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { Alert, Badge, Button, GlassMenu, MenuItem, Skeleton, useMenuOpen, useToast } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { duplicateProduct, isStale, markGtinCurrent, moduleDisabled, setProductActive, updateProduct } from '@/pages/catalogo/api'
import { CatalogAudit } from '@/pages/catalogo/components/CatalogAudit'
import { StockPanel } from '@/pages/catalogo/components/StockPanel'
import { Fact, FactCard, RecordBar, RecordTabs } from '@/pages/catalogo/frame'
import { formatAlcohol, formatPrice, formatQty } from '@/pages/catalogo/money'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import {
  formatName,
  inputFromProduct,
  kindLabel,
  productOrganic,
  productWarnings,
  stockHeadline,
  taxLabel,
  unitLabel,
  wineName,
  type AuditEvent,
  type Format,
  type ListPage,
  type Product,
  type ProductInput,
  type ProductPrice,
  type StockBalance,
  type Wine,
} from '@/pages/catalogo/model'
import { ProductForm } from '@/pages/catalogo/ProductForm'
import { validateProduct } from '@/pages/catalogo/validate'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'precios', label: 'Precios' },
  { id: 'fiscal', label: 'Fiscal y aduanas' },
  { id: 'edi', label: 'EDI' },
  { id: 'existencias', label: 'Existencias' },
  { id: 'historial', label: 'Historial' },
] as const

type TabId = (typeof TABS)[number]['id']

const FISCAL_FIELDS = new Set(['nc_code', 'excise_product_key', 'alcohol_pct', 'sales_account', 'default_tax_code'])
const EDI_FIELDS = new Set(['gtin', 'gtin_case'])

function gtinCurrent(product: Product & { is_gtin_current?: boolean }): boolean {
  return Boolean(product.gtin_is_current || product.is_gtin_current)
}

export function ProductPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const product = useApi<Product & { is_gtin_current?: boolean }>(id ? `/v1/products/${id}` : null)
  const wines = useApi<ListPage<Wine>>('/v1/wines?limit=100')
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  useChromeTitle(product.data?.name || 'Producto')

  if (!allows(me, 'catalog.read')) return <NoPermission />
  if (product.loading && !product.data) {
    return <RecordSkeleton screen="producto-cargando" />
  }
  if (product.error || !product.data) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${product.error?.code ?? 'WC_ERROR'})`}
          detail={product.error?.message}
          onRetry={product.reload}
        />
      </div>
    )
  }

  return (
    <Loaded
      me={me}
      product={{ ...product.data, gtin_is_current: gtinCurrent(product.data) }}
      wines={wines.data?.items ?? []}
      formats={formats.data?.items ?? []}
      onReload={product.reload}
    />
  )
}

function Loaded({
  me,
  product,
  wines,
  formats,
  onReload,
}: {
  me: Me
  product: Product
  wines: Wine[]
  formats: Format[]
  onReload: () => void
}) {
  const desktop = useMinWidth(768)
  const toast = useToast()
  const more = useMenuOpen()
  const canWrite = allows(me, 'catalog.write')
  const [tab, setTab] = useState<TabId>('general')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<ProductInput>(() => inputFromProduct(product))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [confirmGtin, setConfirmGtin] = useState(false)
  const stock = useApi<ListPage<StockBalance>>(product.is_stock_tracked ? `/v1/stock/balances?product_id=${product.id}` : null)
  const prices = useApi<ListPage<ProductPrice & { code?: string; name?: string }>>(`/v1/products/${product.id}/prices`)
  const history = useApi<{ items: AuditEvent[]; next_cursor: string | null }>(
    tab === 'historial' ? `/v1/audit?table=catalog.product&row_id=${product.id}` : null,
  )
  const stockOff = moduleDisabled(stock.error)
  const warnings = productWarnings(product)
  const priceRows = (prices.data?.items ?? []).map((item) => ({
    ...item,
    price_list_name: item.price_list_name || item.name || 'Tarifa',
    price_list_code: item.price_list_code ?? item.code,
  }))

  useEffect(() => {
    if (!editing) setValue(inputFromProduct(product))
  }, [editing, product])

  async function save() {
    const found = validateProduct(value)
    setErrors(found)
    setDuplicate(null)
    const keys = Object.keys(found)
    if (keys.length > 0) {
      if (keys.some((key) => FISCAL_FIELDS.has(key))) setTab('fiscal')
      else if (keys.some((key) => EDI_FIELDS.has(key))) setTab('edi')
      else setTab('general')
      return
    }
    setSaving(true)
    setStale(false)
    try {
      await updateProduct(product.id, value, product.updated_at)
      toast('Cambios guardados')
      setEditing(false)
      onReload()
    } catch (error: unknown) {
      if (isStale(error)) setStale(true)
      else {
        const existing = duplicateProduct(error)
        if (existing) {
          setDuplicate(existing)
          setTab('general')
        } else if (error instanceof ApiError && error.fields) setErrors(error.fields)
        else toast(error instanceof ApiError ? error.message : 'No se ha podido guardar.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    setSaving(true)
    try {
      await setProductActive(product.id, !product.is_active, product.updated_at)
      setConfirmOff(false)
      onReload()
    } catch (error: unknown) {
      if (isStale(error)) setStale(true)
      else toast(error instanceof ApiError ? error.message : 'No se ha podido cambiar el estado.')
    } finally {
      setSaving(false)
    }
  }

  async function makeCurrent() {
    setSaving(true)
    try {
      await markGtinCurrent(product.id)
      setConfirmGtin(false)
      toast('Este GTIN queda como el vigente')
      onReload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : 'No se ha podido marcar el GTIN.')
    } finally {
      setSaving(false)
    }
  }

  const stockValue = !product.is_stock_tracked ? '—' : stock.loading ? '…' : stockOff || !stock.data ? '—' : stockHeadline(stock.data.items)
  const hasStock = stock.data ? stockHeadline(stock.data.items) !== '0 ud' && stockHeadline(stock.data.items) !== '—' : false

  return (
    <div data-screen="producto" data-tab={tab} data-stock={stockOff ? 'off' : stock.data ? 'ready' : 'loading'} className="flex min-h-0 flex-1 flex-col">
      <RecordBar
        backTo="/catalogo"
        backLabel={copy.catalog.backProducts}
        actions={
          canWrite ? (
            <>
              {editing ? (
                <>
                  <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
                    {saving ? 'Guardando…' : copy.catalog.save}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setEditing(false)
                      setErrors({})
                      setDuplicate(null)
                      setValue(inputFromProduct(product))
                    }}
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" size="sm" onClick={() => setEditing(true)}>
                  {copy.catalog.edit}
                </Button>
              )}
              <GlassMenu
                open={more.open}
                onOpenChange={more.setOpen}
                placement="bottom-end"
                trigger={
                  <Button type="button" variant="secondary" size="sm" iconOnly aria-label="Más acciones" onClick={more.toggle}>
                    <MoreVertical strokeWidth={iconStroke} />
                  </Button>
                }
              >
                <MenuItem
                  tone={product.is_active ? 'danger' : 'default'}
                  onClick={() => {
                    more.close()
                    setConfirmOff(true)
                  }}
                >
                  {product.is_active ? copy.catalog.deactivate : copy.catalog.reactivate}
                </MenuItem>
              </GlassMenu>
            </>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{product.name}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {kindLabel(product.kind)} · <span className="font-mono text-caption">{product.sku}</span>
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={product.is_active ? 'success' : 'neutral'}>{product.is_active ? 'Activo' : 'Inactivo'}</Badge>
            <Badge tone="neutral">{kindLabel(product.kind)}</Badge>
            {productOrganic(product, wines) ? <Badge tone="success">Ecológico</Badge> : null}
            {product.gtin_is_current ? <Badge tone="info">GTIN vigente</Badge> : null}
            {warnings.map((warning) => (
              <Badge key={warning} tone="warning">
                {warning}
              </Badge>
            ))}
          </div>
          {stale ? (
            <Alert tone="danger">
              <span className="text-label">
                Otra persona ha cambiado este producto.{' '}
                <button type="button" className="underline" onClick={onReload}>
                  Recargar
                </button>
              </span>
            </Alert>
          ) : null}
          <RecordTabs label="Secciones" tabs={[...TABS]} value={tab} onChange={setTab} />
          {tab === 'general' ? (
            <div className="grid gap-4">
              {editing ? (
                <ProductForm
                  section="general"
                  value={value}
                  onChange={setValue}
                  errors={errors}
                  wines={wines}
                  formats={formats}
                  locked={Boolean(product.has_movements)}
                  disabled={saving}
                  duplicate={duplicate}
                />
              ) : (
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <FactCard title="Identidad">
                    <Fact label="SKU" value={product.sku} />
                    <Fact label="Vino" value={wineName(product, wines)} />
                    <Fact label="Añada" value={product.vintage == null ? '—' : String(product.vintage)} />
                    <Fact label="Formato" value={formatName(product, formats)} />
                    <Fact label="Unidad" value={unitLabel(product.unit)} />
                    <Fact label="Lote" value={product.requires_lot ? 'Obligatorio' : 'No'} />
                    <Fact label="Inglés" value={product.name_en || '—'} />
                    <Fact label="IVA" value={taxLabel(product.default_tax_code)} />
                  </FactCard>
                  <FactCard title="Existencias y precios">
                    <Fact label="Existencias" value={stockValue} />
                    <Fact label="GTIN" value={product.gtin || 'Sin GTIN'} />
                    <Fact label="Grado" value={formatAlcohol(product.alcohol_pct)} />
                  </FactCard>
                </div>
              )}
              <section className="grid gap-3">
                <h2 className="text-label font-medium text-ink-900">Existencias por almacén</h2>
                <StockPanel
                  productId={product.id}
                  tracked={product.is_stock_tracked}
                  rows={stock.data?.items ?? []}
                  loading={stock.loading}
                  error={stock.error}
                  disabled={stockOff}
                  onRetry={stock.reload}
                />
              </section>
              <PricePanel prices={priceRows} loading={prices.loading} error={prices.error} onRetry={prices.reload} />
            </div>
          ) : null}
          {tab === 'precios' ? <PricePanel prices={priceRows} loading={prices.loading} error={prices.error} onRetry={prices.reload} /> : null}
          {tab === 'fiscal' ? (
            editing ? (
              <ProductForm section="fiscal" value={value} onChange={setValue} errors={errors} wines={wines} formats={formats} disabled={saving} />
            ) : (
              <FactCard title="Fiscal y aduanas">
                <Fact label="IVA por defecto" value={taxLabel(product.default_tax_code)} />
                <Fact label="Código NC" value={product.nc_code || '—'} />
                <Fact label="Mayor SILICIE" value={product.excise_product_key || '—'} />
                <Fact label="Grado declarado" value={formatAlcohol(product.alcohol_pct)} />
                <Fact label="Cuenta de ventas" value={product.sales_account || '—'} />
              </FactCard>
            )
          ) : null}
          {tab === 'edi' ? (
            <div className="grid gap-4">
              {editing ? (
                <ProductForm section="edi" value={value} onChange={setValue} errors={errors} wines={wines} formats={formats} disabled={saving} />
              ) : (
                <FactCard title="Códigos">
                  <Fact label="GTIN unidad" value={product.gtin || '—'} />
                  <Fact label="GTIN-14 caja" value={product.gtin_case || '—'} />
                  <Fact label="GTIN vigente" value={product.gtin_is_current ? 'Este producto' : 'No'} />
                </FactCard>
              )}
              {canWrite && desktop ? (
                <div>
                  <Button type="button" variant="secondary" size="sm" disabled={!product.gtin || saving} onClick={() => setConfirmGtin(true)}>
                    Marcar GTIN vigente
                  </Button>
                  {!product.gtin ? <p className="mt-2 text-caption text-text-tertiary">Primero indica el GTIN de la unidad.</p> : null}
                </div>
              ) : null}
              <CustomerCodes codes={product.customer_item_codes ?? []} />
            </div>
          ) : null}
          {tab === 'existencias' ? (
            <StockPanel
              productId={product.id}
              tracked={product.is_stock_tracked}
              rows={stock.data?.items ?? []}
              loading={stock.loading}
              error={stock.error}
              disabled={stockOff}
              onRetry={stock.reload}
            />
          ) : null}
          {tab === 'historial' ? (
            <CatalogAudit
              items={history.data?.items ?? []}
              loading={history.loading}
              error={history.error ? `${copy.error.load} (${history.error.code})` : undefined}
              onRetry={history.reload}
            />
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOff}
        title={product.is_active ? 'Desactivar producto' : 'Reactivar producto'}
        body={
          product.is_active
            ? hasStock
              ? `${product.name} tiene existencias. Dejará de ofrecerse en pedidos, pero no se borra.`
              : `${product.name} dejará de ofrecerse en pedidos. No se borra.`
            : `${product.name} volverá a ofrecerse en pedidos.`
        }
        confirmLabel={product.is_active ? copy.catalog.deactivate : copy.catalog.reactivate}
        danger={product.is_active}
        busy={saving}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => void toggleActive()}
      />
      <ConfirmDialog
        open={confirmGtin}
        title="Marcar GTIN vigente"
        body="Los pedidos de El Corte Inglés con este GTIN irán a esta añada."
        confirmLabel="Marcar vigente"
        busy={saving}
        onClose={() => setConfirmGtin(false)}
        onConfirm={() => void makeCurrent()}
      />
    </div>
  )
}

function PricePanel({
  prices,
  loading,
  error,
  onRetry,
}: {
  prices: ProductPrice[]
  loading: boolean
  error: ApiError | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }
  if (error) return <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={onRetry} />
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
        <h2 className="text-caption text-text-tertiary">Precios vigentes</h2>
        <Link to="/catalogo/tarifas" className="text-caption text-text-tertiary underline max-sm:-mx-2 max-sm:-my-3.5 max-sm:px-2 max-sm:py-3.5">
          Tarifas
        </Link>
      </div>
      {prices.length === 0 ? (
        <p className="px-4 py-4 text-label text-text-tertiary">Sin precio en las tarifas activas.</p>
      ) : (
        <ul>
          {prices.map((price) => (
            <li key={`${price.price_list_id}-${price.min_qty}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0 max-sm:py-0 max-sm:pb-3">
              <div className="min-w-0">
                <Link to={`/catalogo/tarifas/${price.price_list_id}`} className="text-label font-medium text-ink-900 max-sm:block max-sm:pt-3.5 max-sm:pb-2.5">
                  {price.price_list_name}
                </Link>
                <p className="text-caption text-text-tertiary">
                  {price.tax_included ? 'IVA incluido' : 'IVA aparte'}
                  {price.min_qty && price.min_qty !== '1' && price.min_qty !== '1.000' ? ` · desde ${formatQty(price.min_qty)}` : ''}
                  {price.version ? ` · v${price.version}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-label font-medium text-ink-900 tabular-nums">{formatPrice(price.unit_price)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CustomerCodes({ codes }: { codes: Product['customer_item_codes'] }) {
  const rows = codes ?? []
  return (
    <section>
      <h3 className="text-label font-medium text-ink-900">Códigos del cliente</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-label text-text-tertiary">Sin códigos de artículo de cliente.</p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-border-subtle">
          {rows.map((row) => (
            <li key={`${row.contact_id}-${row.code}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0">
              <span className="min-w-0 truncate text-label text-ink-900">{row.contact_name || row.contact_id}</span>
              <span className="font-mono text-caption text-ink-900">{row.code}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

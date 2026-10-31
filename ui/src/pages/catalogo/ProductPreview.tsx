import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import { Badge, Button, Drawer, DrawerBody, DrawerHeader, Skeleton } from '@/ui'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { formatAlcohol, formatQty } from '@/pages/catalogo/money'
import {
  formatCode,
  kindLabel,
  productWarnings,
  taxLabel,
  wineName,
  type Format,
  type Product,
  type Wine,
} from '@/pages/catalogo/model'

export function ProductPreview({
  id,
  ids,
  index,
  wines,
  formats,
  onOpenChange,
  onSelect,
}: {
  id: string | null
  ids: string[]
  index: number
  wines: Wine[]
  formats: Format[]
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
}) {
  const product = useApi<Product>(id ? `/v1/products/${id}` : null)
  const ready = Boolean(id && product.data && product.data.id === id)
  const title = ready && product.data ? product.data.name : 'Producto'

  return (
    <Drawer open={Boolean(id)} onClose={() => onOpenChange(false)} labelledBy="preview-producto" size="md">
      <DrawerHeader
        titleId="preview-producto"
        title={title}
        description={ready && product.data ? product.data.sku : undefined}
        onClose={() => onOpenChange(false)}
      />
      <div className="flex items-center gap-1 px-4 pb-2 sm:px-6">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Anterior" disabled={index <= 0} onClick={() => onSelect(ids[index - 1] ?? '')}>
          <ChevronLeft strokeWidth={iconStroke} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Siguiente"
          disabled={index < 0 || index >= ids.length - 1}
          onClick={() => onSelect(ids[index + 1] ?? '')}
        >
          <ChevronRight strokeWidth={iconStroke} />
        </Button>
      </div>
      <DrawerBody>
        <div data-screen="producto-preview">
          {!id ? null : product.loading || product.data?.id !== id ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : product.error || !product.data ? (
            <ErrorState
              title={`${copy.error.load} (${product.error?.code ?? 'WC_ERROR'})`}
              detail={product.error?.message}
              onRetry={product.reload}
            />
          ) : (
            <PreviewBody product={product.data} wines={wines} formats={formats} />
          )}
        </div>
      </DrawerBody>
    </Drawer>
  )
}

function PreviewBody({ product, wines, formats }: { product: Product; wines: Wine[]; formats: Format[] }) {
  const navigate = useNavigate()
  const warnings = productWarnings(product)
  return (
    <div className="grid gap-5">
      <Button type="button" variant="primary" size="sm" className="w-full" onClick={() => navigate(`/catalogo/${product.id}`)}>
        {copy.catalog.open}
      </Button>
      <dl className="overflow-hidden rounded-2xl border border-border-subtle">
        <Row label="SKU" value={product.sku} />
        <Row label="Tipo" value={kindLabel(product.kind)} />
        <Row label="Vino" value={wineName(product, wines)} />
        <Row label="Añada" value={product.vintage == null ? '—' : String(product.vintage)} />
        <Row label="Formato" value={formatCode(product, formats)} />
        <Row label="GTIN" value={product.gtin || '—'} />
        <Row label="NC" value={product.nc_code || '—'} />
        <Row label="Grado" value={formatAlcohol(product.alcohol_pct)} />
        <Row label="IVA" value={taxLabel(product.default_tax_code)} />
        <Row label="Existencias" value={product.on_hand_qty ? `${formatQty(product.on_hand_qty)} ud` : '—'} />
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={product.is_active ? 'success' : 'neutral'}>{product.is_active ? 'Activo' : 'Inactivo'}</Badge>
        {product.gtin_is_current ? <Badge tone="info">GTIN vigente</Badge> : null}
        {warnings.map((warning) => (
          <Badge key={warning} tone="warning">
            {warning}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-right text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}

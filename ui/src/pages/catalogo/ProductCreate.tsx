import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Button, Drawer, DrawerBody, DrawerHeader, useToast } from '@/ui'
import { createProduct, duplicateProduct } from '@/pages/catalogo/api'
import { emptyProductInput, type Format, type ListPage, type ProductInput, type ProductKind, type Wine } from '@/pages/catalogo/model'
import { ProductForm } from '@/pages/catalogo/ProductForm'
import { validateProduct } from '@/pages/catalogo/validate'

const KINDS = new Set<ProductKind>(['wine', 'bulk_wine', 'packaging_material', 'oenological_product', 'merchandise', 'service', 'gift_card', 'other'])

export function ProductCreate({ me }: { me: Me }) {
  const navigate = useNavigate()
  const desktop = useMinWidth(768)
  const toast = useToast()
  const [params] = useSearchParams()
  useChromeTitle(copy.catalog.newProduct)
  const wines = useApi<ListPage<Wine>>('/v1/wines?limit=100')
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  const [value, setValue] = useState<ProductInput>(() => {
    const next = emptyProductInput()
    const kind = params.get('tipo')
    if (kind && KINDS.has(kind as ProductKind)) {
      next.kind = kind as ProductKind
      if (kind === 'service' || kind === 'gift_card') next.is_stock_tracked = false
      if (kind !== 'wine') next.requires_lot = false
    }
    return next
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const idempotency = useRef(crypto.randomUUID())

  useEffect(() => {
    const field = Object.keys(errors)[0]
    if (field) document.getElementById(field)?.scrollIntoView({ block: 'center' })
  }, [errors])

  if (!allows(me, 'catalog.read')) return <NoPermission />

  async function onSubmit() {
    const found = validateProduct(value)
    setErrors(found)
    setDuplicate(null)
    if (Object.keys(found).length > 0 || !allows(me, 'catalog.write')) return
    setSaving(true)
    try {
      const created = await createProduct(value, idempotency.current)
      toast('Producto creado')
      navigate(`/catalogo/${created.id}`)
    } catch (error: unknown) {
      const existing = duplicateProduct(error)
      if (existing) {
        setDuplicate(existing)
        return
      }
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : 'No se ha podido crear el producto.')
    } finally {
      setSaving(false)
    }
  }

  const form = (
    <form
      className="grid gap-4"
      data-screen="producto-alta"
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <ProductForm
        section="create"
        value={value}
        onChange={setValue}
        errors={errors}
        wines={wines.data?.items ?? []}
        formats={formats.data?.items ?? []}
        duplicate={duplicate}
        disabled={saving || !allows(me, 'catalog.write')}
      />
      {allows(me, 'catalog.write') ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {saving ? 'Creando…' : copy.catalog.createProduct}
          </Button>
        </div>
      ) : null}
    </form>
  )

  if (!desktop) {
    return (
      <Drawer open onClose={() => navigate('/catalogo')} labelledBy="nuevo-producto" size="lg">
        <DrawerHeader titleId="nuevo-producto" title={copy.catalog.newProduct} onClose={() => navigate('/catalogo')} />
        <DrawerBody>{form}</DrawerBody>
      </Drawer>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 md:px-8">
        <header>
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.catalog.newProduct}</h1>
          <p className="mt-1 text-label text-text-secondary">Vino, material o servicio.</p>
        </header>
        {form}
      </div>
    </div>
  )
}

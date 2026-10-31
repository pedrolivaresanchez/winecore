import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreVertical } from '@/ui/icons'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  InfoTip,
  Input,
  MenuItem,
  SegmentedControl,
  Select,
  Skeleton,
  useMenuOpen,
  useToast,
} from '@/ui'
import {
  createFormatMaterial,
  deleteFormatMaterial,
  listFormatMaterials,
  listProducts,
  updateFormatMaterial,
} from '@/pages/catalogo/api'
import { normalizeDecimal, showDecimal } from '@/pages/catalogo/money'
import { perLabel, type FormatMaterial, type MaterialPer, type Product } from '@/pages/catalogo/model'

const GROUPS: { id: MaterialPer; title: string }[] = [
  { id: 'unit', title: copy.catalog.perUnit },
  { id: 'case', title: copy.catalog.perCase },
  { id: 'pallet', title: copy.catalog.perPallet },
]

export function FormatMaterials({ formatId, canWrite }: { formatId: string; canWrite: boolean }) {
  const toast = useToast()
  const [items, setItems] = useState<FormatMaterial[]>([])
  const [materials, setMaterials] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<FormatMaterial | null | 'new'>(null)
  const [removing, setRemoving] = useState<FormatMaterial | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [page, products] = await Promise.all([
        listFormatMaterials(formatId),
        listProducts({ kind: 'packaging_material', active: 'true', limit: 100 }),
      ])
      setItems(page.items)
      setMaterials(products.items.filter((item) => item.is_active && item.is_stock_tracked))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // formatId is the only input; load closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatId])

  async function remove(material: FormatMaterial) {
    setBusy(true)
    try {
      await deleteFormatMaterial(formatId, material.id)
      setRemoving(null)
      toast('Material quitado')
      await load()
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : 'No se ha podido quitar el material.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (error && items.length === 0) return <ErrorState title={error} onRetry={() => void load()} />

  return (
    <section data-screen="formato-materiales" className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1 text-label font-medium text-ink-900">
          {copy.catalog.materialsTitle}
          <InfoTip label={copy.catalog.materialsTitle}>{copy.catalog.materialsHelp}</InfoTip>
        </h2>
        {canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setEditing('new')}>
            {copy.catalog.addMaterial}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <EmptyState
          size="sm"
          title={copy.catalog.materialsEmpty}
          description={copy.catalog.materialsHint}
          action={
            canWrite ? (
              <Button type="button" variant="primary" size="sm" onClick={() => setEditing('new')}>
                {copy.catalog.addMaterial}
              </Button>
            ) : undefined
          }
        />
      ) : (
        GROUPS.map((group) => {
          const rows = items.filter((item) => item.per === group.id)
          return (
            <div key={group.id}>
              <h3 className="mb-1 text-caption text-text-tertiary">{group.title}</h3>
              {rows.length === 0 ? (
                <p className="text-label text-text-tertiary">Ninguno</p>
              ) : (
                <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-label font-medium text-ink-900">{row.name}</p>
                        <p className="font-mono text-caption text-text-tertiary">{row.sku}</p>
                      </div>
                      <p className="shrink-0 text-label tabular-nums text-ink-900">{showDecimal(row.quantity)}</p>
                      {canWrite ? <RowMenu row={row} onEdit={() => setEditing(row)} onRemove={() => setRemoving(row)} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })
      )}
      <MaterialDialog
        open={editing !== null}
        formatId={formatId}
        current={editing && editing !== 'new' ? editing : null}
        materials={materials}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          toast('Material guardado')
          await load()
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Quitar material"
        body={removing ? `${removing.name} dejará de contarse en este formato.` : ''}
        confirmLabel="Quitar"
        danger
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
      />
    </section>
  )
}

function RowMenu({ row, onEdit, onRemove }: { row: FormatMaterial; onEdit: () => void; onRemove: () => void }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={`Acciones de ${row.name}`} onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
      <MenuItem
        onClick={() => {
          menu.close()
          onEdit()
        }}
      >
        Editar
      </MenuItem>
      <MenuItem
        tone="danger"
        onClick={() => {
          menu.close()
          onRemove()
        }}
      >
        Quitar
      </MenuItem>
    </GlassMenu>
  )
}

function MaterialDialog({
  open,
  formatId,
  current,
  materials,
  onClose,
  onSaved,
}: {
  open: boolean
  formatId: string
  current: FormatMaterial | null
  materials: Product[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [productId, setProductId] = useState('')
  const [per, setPer] = useState<MaterialPer>('unit')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const idempotency = useRef(crypto.randomUUID())
  const options = useMemo(() => {
    const rows = materials.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}` }))
    if (current && !rows.some((row) => row.id === current.material_product_id)) {
      rows.unshift({ id: current.material_product_id, label: `${current.sku} · ${current.name}` })
    }
    return rows
  }, [current, materials])

  useEffect(() => {
    if (!open) return
    setProductId(current?.material_product_id ?? options[0]?.id ?? '')
    setPer(current?.per ?? 'unit')
    setQuantity(current ? showDecimal(current.quantity) : '1')
    setError(null)
    idempotency.current = crypto.randomUUID()
  }, [current, open, options])

  async function onSubmit() {
    const parsed = normalizeDecimal(quantity, 3)
    if (!productId) {
      setError('Elige un material de envasado.')
      return
    }
    if (!parsed.value || parsed.error) {
      setError(parsed.error ?? 'Indica la cantidad.')
      return
    }
    setSaving(true)
    setError(null)
    const body = { material_product_id: productId, per, quantity: parsed.value }
    try {
      if (current) await updateFormatMaterial(formatId, current.id, body)
      else await createFormatMaterial(formatId, body, idempotency.current)
      await onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? (err.fields?.material_product_id ?? err.fields?.quantity ?? err.message) : 'No se ha podido guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="material-formato" size="md">
      <DialogHeader
        titleId="material-formato"
        title={current ? 'Editar material' : copy.catalog.addMaterial}
        onClose={onClose}
      />
      <DialogBody>
        <form
          id="material-formato-form"
          data-screen="material-alta"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          {materials.length === 0 && !current ? (
            <p className="text-label text-text-secondary">
              No hay materiales activos.{' '}
              <Link className="underline" to="/catalogo/nuevo?tipo=packaging_material">
                Crear material
              </Link>
            </p>
          ) : (
            <>
              <Field id="material_product_id" label="Material">
                <Select
                  id="material_product_id"
                  className="w-full"
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <fieldset className="grid gap-2">
                <legend className="text-label text-text-secondary">Base</legend>
                <SegmentedControl
                  aria-label="Base"
                  value={per}
                  onChange={(next) => setPer(next as MaterialPer)}
                  options={[
                    { value: 'unit', content: perLabel('unit') },
                    { value: 'case', content: perLabel('case') },
                    { value: 'pallet', content: perLabel('pallet') },
                  ]}
                />
              </fieldset>
              <Field id="material_quantity" label="Cantidad" error={error ?? undefined}>
                <Input
                  id="material_quantity"
                  inputMode="decimal"
                  value={quantity}
                  invalid={Boolean(error)}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
            </>
          )}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" form="material-formato-form" variant="primary" size="sm" loading={saving} disabled={materials.length === 0 && !current}>
          {saving ? 'Guardando…' : copy.catalog.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

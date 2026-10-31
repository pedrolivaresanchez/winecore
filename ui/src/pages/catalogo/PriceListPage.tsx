import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MoreVertical } from '@/ui/icons'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  EmptyState,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  GlassMenu,
  Input,
  MenuItem,
  Reveal,
  Select,
  Skeleton,
  Textarea,
  useMenuOpen,
  useToast,
  type BadgeTone,
} from '@/ui'
import { createVersion, requestActivation, saveVersionItems } from '@/pages/catalogo/api'
import { RecordBar, RecordTabs } from '@/pages/catalogo/frame'
import { cmpDecimal, formatPrice, normalizeDecimal, showDecimal } from '@/pages/catalogo/money'
import {
  VERSION_LABELS,
  pickVersion,
  versionEditable,
  versionStatus,
  type ListPage,
  type PriceItem,
  type PriceList,
  type PriceListVersion,
  type Product,
  type VersionStatus,
} from '@/pages/catalogo/model'
import { validateMinQty, validatePrice } from '@/pages/catalogo/validate'

type Row = { key: string; product_id: string; min_qty: string; unit_price: string }

const TONE: Record<VersionStatus, BadgeTone> = {
  draft: 'neutral',
  pending: 'warning',
  active: 'success',
  retired: 'neutral',
}

const DATE_LABELS = { clear: 'Quitar', today: 'Hoy' }

export function PriceListPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const lists = useApi<ListPage<PriceList>>('/v1/price-lists?limit=100')
  const versions = useApi<ListPage<PriceListVersion>>(id ? `/v1/price-lists/${id}/versions` : null)
  const products = useApi<ListPage<Product>>('/v1/products?limit=100')
  const list = lists.data?.items.find((item) => item.id === id) ?? null
  useChromeTitle(list?.name || 'Tarifa')

  if (!allows(me, 'catalog.read')) return <NoPermission />
  if ((lists.loading && !lists.data) || (versions.loading && !versions.data)) {
    return (
      <div data-screen="tarifa-cargando" aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (lists.error || versions.error || !lists.data || !versions.data) {
    const error = lists.error ?? versions.error
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${error?.code ?? 'WC_ERROR'})`}
          detail={error?.message}
          onRetry={() => {
            lists.reload()
            versions.reload()
          }}
        />
      </div>
    )
  }
  if (!list) {
    return (
      <div className="p-6">
        <ErrorState title="No encuentro esa tarifa" />
      </div>
    )
  }

  return (
    <Editor me={me} list={list} versions={versions.data.items} products={products.data?.items ?? []} onReload={versions.reload} />
  )
}

function Editor({
  me,
  list,
  versions,
  products,
  onReload,
}: {
  me: Me
  list: PriceList
  versions: PriceListVersion[]
  products: Product[]
  onReload: () => void
}) {
  const desktop = useMinWidth(768)
  const toast = useToast()
  const canWrite = allows(me, 'catalog.write') && desktop
  const ordered = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const chosen = ordered.find((version) => version.id === selectedId) ?? pickVersion(ordered)
  const [rows, setRows] = useState<Row[]>([])
  const [baseline, setBaseline] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importNotes, setImportNotes] = useState<string[]>([])
  const [find, setFind] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!chosen) return
    const next = (chosen.items ?? []).map((item) => ({
      key: item.id ?? `${item.product_id}-${item.min_qty}`,
      product_id: item.product_id,
      min_qty: showDecimal(item.min_qty),
      unit_price: showDecimal(item.unit_price),
    }))
    setRows(next)
    setBaseline(JSON.stringify(next))
    setRowErrors({})
    setBanner(null)
    setImportNotes([])
  }, [chosen])

  const editable = Boolean(chosen && versionEditable(chosen) && canWrite)
  const status = chosen ? versionStatus(chosen) : null
  const dirty = JSON.stringify(rows) !== baseline
  const previous = chosen ? ordered.find((version) => version.version < chosen.version) : undefined
  const missing = missingPrices(rows, products)
  const visible = rows.filter((row) => matches(row, find, products, chosen?.items ?? []))

  function productLabel(productId: string): string {
    const product = products.find((item) => item.id === productId)
    if (product) return `${product.sku} · ${product.name}`
    const item = chosen?.items?.find((entry) => entry.product_id === productId)
    return item?.product_name || item?.product_sku || productId || 'Elige un producto'
  }

  async function save() {
    if (!chosen) return
    const errors: Record<string, string> = {}
    const items: PriceItem[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row.product_id) {
        errors[row.key] = 'Elige un producto.'
        continue
      }
      const priceError = validatePrice(row.unit_price)
      const minError = validateMinQty(row.min_qty)
      if (priceError || minError) {
        errors[row.key] = priceError ?? minError ?? 'Revisa el precio.'
        continue
      }
      const price = normalizeDecimal(row.unit_price, 4).value
      const min = normalizeDecimal(row.min_qty, 3).value
      const key = `${row.product_id}|${min}`
      if (seen.has(key)) {
        errors[row.key] = 'Ese mínimo ya está en el producto.'
        continue
      }
      seen.add(key)
      items.push({ product_id: row.product_id, min_qty: min, unit_price: price })
    }
    setRowErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setBanner(null)
    try {
      await saveVersionItems(list.id, chosen.version, items)
      toast('Precios guardados')
      onReload()
    } catch (error: unknown) {
      setBanner(error instanceof ApiError ? error.message : 'No se han podido guardar los precios.')
    } finally {
      setSaving(false)
    }
  }

  async function activate() {
    if (!chosen) return
    setSaving(true)
    setBanner(null)
    try {
      await requestActivation(list.id, chosen.version)
      setConfirm(false)
      toast('Activación solicitada')
      onReload()
    } catch (error: unknown) {
      setConfirm(false)
      const message = error instanceof ApiError ? error.message : 'No se ha podido solicitar la activación.'
      setBanner(error instanceof ApiError && error.code === 'WC050' ? `${message} Crea una versión nueva.` : message)
    } finally {
      setSaving(false)
    }
  }

  function readCsv(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''), products)
      setImportNotes(parsed.notes)
      if (parsed.rows.length > 0) {
        setRows((current) => mergeRows(current, parsed.rows))
        toast(parsed.rows.length === 1 ? '1 precio leído' : `${parsed.rows.length} precios leídos`)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div data-screen="tarifa" data-version={status ?? 'none'} className="flex min-h-0 flex-1 flex-col">
      <RecordBar
        backTo="/catalogo/tarifas"
        backLabel={copy.catalog.backTariffs}
        actions={
          canWrite ? (
            <Button type="button" variant={editable ? 'secondary' : 'primary'} size="sm" onClick={() => setCreating(true)}>
              {copy.catalog.newVersion}
            </Button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{list.name}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              <span className="font-mono text-caption">{list.code}</span>
              {` · ${list.currency} · ${list.tax_included ? 'IVA incluido' : 'IVA aparte'}`}
            </p>
          </header>
          {ordered.length === 0 ? (
            <EmptyState size="sm" title="Sin versiones" description="Esta tarifa todavía no tiene versiones." />
          ) : chosen && status ? (
            <>
              <RecordTabs
                label="Versiones"
                tabs={ordered.map((version) => ({ id: version.id, label: `v${version.version}` }))}
                value={chosen.id}
                onChange={setSelectedId}
              />
              <div className="flex flex-wrap items-center gap-2">
                {status === 'pending' && chosen.approval_request_id ? (
                  <Link to={`/aprobaciones/${chosen.approval_request_id}`}>
                    <Badge tone="warning">Pendiente</Badge>
                  </Link>
                ) : (
                  <Badge tone={TONE[status]}>{VERSION_LABELS[status]}</Badge>
                )}
                <p className="text-label text-text-tertiary">
                  {formatDate(chosen.valid_from)} → {chosen.valid_to ? formatDate(chosen.valid_to) : 'abierta'}
                </p>
              </div>
              {chosen.notes ? <p className="text-label text-text-secondary">{chosen.notes}</p> : null}
              {status === 'active' || status === 'retired' ? (
                <p className="text-label text-text-tertiary">Versión cerrada. Crea una versión nueva para cambiar precios.</p>
              ) : null}
              {status === 'pending' ? <p className="text-label text-text-tertiary">Sigue en borrador hasta que se apruebe.</p> : null}
              {banner ? <Alert tone="danger">{banner}</Alert> : null}
              {editable && missing.length > 0 ? (
                <Alert tone="warning">
                  {missing.length === 1
                    ? `${missing[0]?.name ?? 'Un producto'} no tiene precio en esta versión.`
                    : `${missing.length} productos activos sin precio en esta versión.`}
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  id="buscar-precio"
                  size="sm"
                  type="search"
                  value={find}
                  placeholder="Buscar producto"
                  aria-label="Buscar producto"
                  className="w-44"
                  onChange={(event) => setFind(event.target.value)}
                />
                {editable ? (
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                      {copy.catalog.importCsv}
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) readCsv(file)
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), product_id: '', min_qty: '1', unit_price: '' }])}
                    >
                      {copy.catalog.addPrice}
                    </Button>
                    <Button type="button" variant={dirty ? 'primary' : 'secondary'} size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
                      {saving ? 'Guardando…' : copy.catalog.savePrices}
                    </Button>
                    <Button
                      type="button"
                      variant={dirty ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={saving || dirty || rows.length === 0}
                      onClick={() => setConfirm(true)}
                    >
                      {copy.catalog.requestActivation}
                    </Button>
                  </>
                ) : null}
              </div>
              {importNotes.length > 0 ? (
                <ul className="grid gap-1 text-label text-danger-600">
                  {importNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <div className="hidden overflow-hidden rounded-2xl border border-border-subtle md:block">
                <table className="w-full text-label">
                  <caption className="sr-only">Precios de la versión {chosen.version}</caption>
                  <thead className="bg-surface-subtle text-caption text-text-tertiary">
                    <tr>
                      <th className="h-9 px-3 text-left font-medium">Producto</th>
                      <th className="h-9 px-3 text-right font-medium">Precio</th>
                      <th className="h-9 px-3 text-right font-medium">Mínimo</th>
                      {editable ? <th className="h-9 w-12 px-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={editable ? 4 : 3} className="px-3 py-6 text-center text-text-tertiary">
                          {rows.length === 0 ? 'Sin precios en esta versión.' : 'Ningún producto coincide.'}
                        </td>
                      </tr>
                    ) : (
                      visible.map((row) => (
                        <tr key={row.key} className="border-t border-border-subtle">
                          <td className="px-3 py-1.5">
                            {editable ? (
                              <Select
                                size="sm"
                                aria-label="Producto"
                                className="w-full max-w-md"
                                value={row.product_id}
                                onChange={(event) => updateRow(setRows, row.key, { product_id: event.target.value })}
                              >
                                <option value="">Elige un producto</option>
                                {optionsFor(row, products, chosen.items ?? []).map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="text-ink-900">{productLabel(row.product_id)}</span>
                            )}
                            {rowErrors[row.key] ? <p className="mt-1 text-caption text-danger-600">{rowErrors[row.key]}</p> : null}
                          </td>
                          <td className="w-36 px-3 py-1.5">
                            <Input
                              aria-label="Precio"
                              size="sm"
                              inputMode="decimal"
                              className="w-full text-right tabular-nums"
                              value={row.unit_price}
                              disabled={!editable}
                              onChange={(event) => updateRow(setRows, row.key, { unit_price: event.target.value })}
                            />
                          </td>
                          <td className="w-28 px-3 py-1.5">
                            <Input
                              aria-label="Mínimo"
                              size="sm"
                              inputMode="decimal"
                              className="w-full text-right tabular-nums"
                              value={row.min_qty}
                              disabled={!editable}
                              onChange={(event) => updateRow(setRows, row.key, { min_qty: event.target.value })}
                            />
                          </td>
                          {editable ? (
                            <td className="px-2 py-1.5 text-right">
                              <RowMenu onRemove={() => setRows((current) => current.filter((item) => item.key !== row.key))} />
                            </td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-2 md:hidden">
                {visible.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-label text-text-tertiary">
                    {rows.length === 0 ? 'Sin precios en esta versión.' : 'Ningún producto coincide.'}
                  </li>
                ) : (
                  visible.map((row) => (
                    <li key={row.key} className="rounded-2xl border border-border-subtle bg-surface px-3 py-2">
                      <p className="text-label font-medium text-ink-900">{productLabel(row.product_id)}</p>
                      <p className="mt-1 text-label tabular-nums text-ink-900">{priceText(row.unit_price)}</p>
                      <p className="text-caption text-text-tertiary">Mínimo {row.min_qty}</p>
                    </li>
                  ))
                )}
              </ul>
              {previous ? (
                <Reveal summary={`Cambios respecto a v${previous.version}`}>
                  <div className="pt-2">
                    <Diff rows={rows} previous={previous.items ?? []} products={products} />
                  </div>
                </Reveal>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <VersionDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (body) => {
          const created = await createVersion(list.id, body, crypto.randomUUID())
          if (created.id) setSelectedId(created.id)
          toast('Versión creada')
          onReload()
        }}
      />
      <ConfirmDialog
        open={confirm}
        title="Pedir activación"
        body={
          chosen
            ? `Se pedirá aprobación para activar la versión ${chosen.version} desde el ${formatDate(chosen.valid_from)}. La versión sigue en borrador hasta que se apruebe.`
            : ''
        }
        confirmLabel={copy.catalog.requestActivation}
        busy={saving}
        onClose={() => setConfirm(false)}
        onConfirm={() => void activate()}
      />
    </div>
  )
}

function RowMenu({ onRemove }: { onRemove: () => void }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Acciones del precio" onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
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

function VersionDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (body: { valid_from: string; valid_to: string | null; notes: string | null }) => Promise<void>
}) {
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFrom(null)
    setTo(null)
    setNotes('')
    setError(null)
  }, [open])

  async function onSubmit() {
    if (!from) {
      setError('Indica desde cuándo vale la versión.')
      return
    }
    if (to && to <= from) {
      setError('El fin tiene que ser posterior al inicio.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onCreate({ valid_from: from, valid_to: to || null, notes: notes.trim() || null })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'No se ha podido crear la versión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="nueva-version" size="md">
      <DialogHeader titleId="nueva-version" title={copy.catalog.newVersion} description="Se copia la versión vigente como borrador." onClose={onClose} />
      <DialogBody>
        <form
          id="nueva-version-form"
          data-screen="tarifa-version"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          <Field id="valid_from" label="Vigente desde" error={!from ? (error ?? undefined) : undefined}>
            <DatePicker value={from} onChange={setFrom} labels={DATE_LABELS} className="w-full" />
          </Field>
          <Field id="valid_to" label="Hasta" hint="No incluida. Vacío si sigue abierta.">
            <DatePicker value={to} onChange={setTo} labels={DATE_LABELS} className="w-full" />
          </Field>
          <Field id="version_notes" label="Notas">
            <Textarea id="version_notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {error && from ? <p className="text-caption text-danger-600">{error}</p> : null}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" form="nueva-version-form" variant="primary" size="sm" loading={saving}>
          {saving ? 'Creando…' : 'Crear borrador'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Diff({ rows, previous, products }: { rows: Row[]; previous: PriceItem[]; products: Product[] }) {
  const lines = useMemo(() => diffRows(rows, previous, products), [products, previous, rows])
  if (lines.length === 0) return <p className="text-label text-text-tertiary">Sin cambios de precio respecto a la versión anterior.</p>
  return (
    <div className="overflow-x-auto rounded-2xl border border-border-subtle">
      <table className="w-full text-label">
        <thead className="bg-surface-subtle text-caption text-text-tertiary">
          <tr>
            <th className="h-9 px-3 text-left font-medium">Producto</th>
            <th className="h-9 px-3 text-right font-medium">Antes</th>
            <th className="h-9 px-3 text-right font-medium">Ahora</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-t border-border-subtle">
              <td className="px-3 py-2">{line.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{line.before}</td>
              <td className="px-3 py-2 text-right tabular-nums">{line.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function diffRows(rows: Row[], previous: PriceItem[], products: Product[]) {
  const before = new Map(previous.map((item) => [`${item.product_id}|${item.min_qty}`, item]))
  const seen = new Set<string>()
  const lines: { key: string; name: string; before: string; after: string }[] = []
  for (const row of rows) {
    const min = normalizeDecimal(row.min_qty, 3).value
    const price = normalizeDecimal(row.unit_price, 4).value
    if (!row.product_id || !min || !price) continue
    const key = `${row.product_id}|${min}`
    seen.add(key)
    const prev = before.get(key)
    const name = labelOf(row.product_id, products, previous)
    if (!prev) lines.push({ key, name, before: '—', after: formatPrice(price) })
    else if (cmpDecimal(prev.unit_price, price) !== 0) lines.push({ key, name, before: formatPrice(prev.unit_price), after: formatPrice(price) })
  }
  for (const item of previous) {
    const key = `${item.product_id}|${item.min_qty}`
    if (seen.has(key)) continue
    lines.push({
      key,
      name: item.product_name || labelOf(item.product_id, products, previous),
      before: formatPrice(item.unit_price),
      after: '—',
    })
  }
  return lines
}

function labelOf(productId: string, products: Product[], items: PriceItem[]): string {
  const product = products.find((item) => item.id === productId)
  if (product) return product.name
  return items.find((item) => item.product_id === productId)?.product_name || productId
}

function optionsFor(row: Row, products: Product[], items: PriceItem[]) {
  const options = products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))
  if (row.product_id && !options.some((option) => option.id === row.product_id)) {
    const item = items.find((entry) => entry.product_id === row.product_id)
    options.unshift({ id: row.product_id, label: item?.product_name || item?.product_sku || row.product_id })
  }
  return options
}

function updateRow(setRows: (value: (current: Row[]) => Row[]) => void, key: string, patch: Partial<Row>) {
  setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
}

function matches(row: Row, find: string, products: Product[], items: PriceItem[]): boolean {
  const needle = find.trim().toLowerCase()
  if (!needle) return true
  const product = products.find((item) => item.id === row.product_id)
  const item = items.find((entry) => entry.product_id === row.product_id)
  const haystack = [product?.name, product?.sku, item?.product_name, item?.product_sku].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(needle)
}

function missingPrices(rows: Row[], products: Product[]) {
  const priced = new Set(rows.map((row) => row.product_id))
  return products
    .filter((product) => product.is_active && (product.kind === 'wine' || product.kind === 'bulk_wine') && !priced.has(product.id))
    .map((product) => ({ id: product.id, name: product.name }))
}

function priceText(value: string): string {
  const parsed = normalizeDecimal(value, 4)
  return parsed.value ? formatPrice(parsed.value) : value || '—'
}

function parseCsv(text: string, products: Product[]): { rows: Row[]; notes: string[] } {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return { rows: [], notes: ['El archivo está vacío.'] }
  const delimiter = (lines[0] ?? '').includes(';') ? ';' : ','
  let start = 0
  const header = (lines[0] ?? '').toLowerCase()
  if (header.includes('sku') || header.includes('precio') || header.includes('producto')) start = 1
  const rows: Row[] = []
  const notes: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const cells = (lines[index] ?? '').split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''))
    const sku = cells[0] ?? ''
    const price = cells[1] ?? ''
    const min = cells[2] || '1'
    const product = products.find((item) => item.sku.toLowerCase() === sku.toLowerCase() || item.id === sku)
    if (!product) {
      notes.push(`Fila ${index + 1}: no encuentro el SKU ${sku}.`)
      continue
    }
    const parsedPrice = normalizeDecimal(price, 4)
    const parsedMin = normalizeDecimal(min, 3)
    if (!parsedPrice.value || parsedPrice.error) {
      notes.push(`Fila ${index + 1}: ${parsedPrice.error ?? 'precio vacío'}.`)
      continue
    }
    if (!parsedMin.value || parsedMin.error || cmpDecimal(parsedMin.value, '0') !== 1) {
      notes.push(`Fila ${index + 1}: el mínimo no es válido.`)
      continue
    }
    rows.push({
      key: crypto.randomUUID(),
      product_id: product.id,
      min_qty: showDecimal(parsedMin.value),
      unit_price: showDecimal(parsedPrice.value),
    })
  }
  if (rows.length === 0 && notes.length === 0) notes.push('No hay filas de precio.')
  return { rows, notes }
}

function mergeRows(current: Row[], incoming: Row[]): Row[] {
  const next = [...current]
  for (const row of incoming) {
    const min = normalizeDecimal(row.min_qty, 3).value
    const index = next.findIndex((item) => item.product_id === row.product_id && normalizeDecimal(item.min_qty, 3).value === min)
    if (index >= 0) next[index] = { ...next[index], unit_price: row.unit_price, key: next[index]?.key ?? row.key }
    else next.push(row)
  }
  return next
}

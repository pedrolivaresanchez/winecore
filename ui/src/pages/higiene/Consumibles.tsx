import { useEffect, useMemo, useState } from 'react'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatInteger } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import {
  CONSUMABLE_KINDS,
  createReceipt,
  errorFields,
  errorText,
  listConsumables,
  listStock,
  pastInstant,
  registerConsumable,
  todayMadrid,
  wholeNumber,
  type Consumable,
  type ConsumableKind,
} from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, consumableKindLabel, isConsumableKind, matches } from '@/pages/higiene/labels'
import { dateLabels } from '@/pages/higiene/labels'
import { useLookups } from '@/pages/higiene/use-lookups'
import { Search } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Chip,
  DataGrid,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  Select,
  useToast,
  type GridColumn,
} from '@/ui'

type Row = Consumable & { balance: number | null }

const COLUMN_IDS = ['name', 'sku', 'kind', 'balance'] as const

export function Consumibles({ me }: { me: Me }) {
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [registering, setRegistering] = useState(false)
  const [receiving, setReceiving] = useState<string | null>(null)
  const [widths, setWidths] = useState<Record<string, number>>({ name: 260, sku: 140, kind: 180, balance: 120 })
  const columnsState = useColumns('winecore.columns.hygiene.consumibles', COLUMN_IDS, [])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([listConsumables(controller.signal), listStock(todayMadrid(), controller.signal).catch(() => ({ items: [] }))])
      .then(([consumables, stock]) => {
        if (!active) return
        const totals = new Map<string, number>()
        for (const hit of stock.items ?? []) {
          if (!hit.product_id || hit.product_state !== 'goods') continue
          totals.set(hit.product_id, (totals.get(hit.product_id) ?? 0) + hit.qty_units)
        }
        setRows(consumables.items.map((item) => ({ ...item, balance: totals.has(item.product_id) ? totals.get(item.product_id) ?? 0 : null })))
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, me])

  const visible = useMemo(
    () => rows.filter((row) => (kind ? row.consumable_kind === kind : true) && matches(query, [row.name, row.sku, consumableKindLabel(row.consumable_kind)])),
    [kind, query, rows],
  )

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const all: GridColumn<Row>[] = [
      { id: 'name', header: copy.higiene.name, cell: (row) => row.name },
      { id: 'sku', header: copy.higiene.sku, cell: (row) => row.sku },
      {
        id: 'kind',
        header: copy.higiene.kind,
        cell: (row) => (
          <Badge tone="neutral" size="sm">
            {consumableKindLabel(row.consumable_kind)}
          </Badge>
        ),
      },
      { id: 'balance', header: copy.higiene.balance, align: 'right', cell: (row) => (row.balance === null ? '—' : formatInteger(row.balance)) },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || kind)
  const screen = loading ? 'higiene-consumibles-cargando' : visible.length === 0 && !filtersActive ? 'higiene-consumibles-vacio' : 'higiene-consumibles'

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setRegistering(true)}>
            {copy.higiene.register}
          </Button>
        ) : null
      }
      toolbar={
        <>
          {canOperate ? (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => setReceiving(rows[0]?.product_id ?? '')}>
              {copy.higiene.receipt}
            </Button>
          ) : null}
          <Input
            size="sm"
            type="search"
            value={query}
            placeholder={copy.higiene.search}
            aria-label={copy.higiene.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ColumnPicker
            columns={[
              { id: 'name', header: copy.higiene.name },
              { id: 'sku', header: copy.higiene.sku },
              { id: 'kind', header: copy.higiene.kind },
              { id: 'balance', header: copy.higiene.balance },
            ]}
            hidden={columnsState.hidden}
            locked="name"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={kind === ''} active={kind === ''} onClick={() => setKind('')}>
            {copy.higiene.all}
          </Chip>
          {CONSUMABLE_KINDS.map((item) => (
            <Chip key={item} pressed={kind === item} active={kind === item} onClick={() => setKind(kind === item ? '' : item)}>
              {consumableKindLabel(item)}
            </Chip>
          ))}
        </>
      }
    >
      {error && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.product_id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => {
            if (canOperate) setReceiving(row.product_id)
          }}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyConsumables}
              description={filtersActive ? undefined : copy.higiene.emptyConsumablesHint}
              action={
                canOperate && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setRegistering(true)}>
                    {copy.higiene.register}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {registering ? (
        <RegisterDialog
          taken={new Set(rows.map((row) => row.product_id))}
          onClose={() => setRegistering(false)}
          onSaved={() => {
            setRegistering(false)
            toast(copy.higiene.saved)
            setAttempt((value) => value + 1)
          }}
        />
      ) : null}
      {receiving !== null ? (
        <ReceiptDialog
          productId={receiving}
          options={rows}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null)
            toast(copy.higiene.saved)
            setAttempt((value) => value + 1)
          }}
        />
      ) : null}
    </HygieneFrame>
  )
}

function RegisterDialog({ taken, onClose, onSaved }: { taken: Set<string>; onClose: () => void; onSaved: () => void }) {
  const lookups = useLookups(true)
  const products = lookups.data.products.filter((item) => item.unit === 'ud' && item.is_stock_tracked !== false && item.requires_lot !== true && !taken.has(item.id))
  const [productId, setProductId] = useState('')
  const [kind, setKind] = useState<ConsumableKind>('filter_plate')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!productId || !isConsumableKind(kind)) {
      setError(copy.higiene.product)
      return
    }
    setSaving(true)
    setError('')
    try {
      await registerConsumable({ product_id: productId, consumable_kind: kind })
      onSaved()
    } catch (err: unknown) {
      setError(errorText(err, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="consumible-nuevo" size="md">
      <DialogHeader titleId="consumible-nuevo" title={copy.higiene.register} onClose={onClose} />
      <DialogBody>
        <form
          id="consumible-nuevo-form"
          data-screen="higiene-dialogo-consumible"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="consumible-producto" label={copy.higiene.product}>
            <Select id="consumible-producto" className="w-full" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">{copy.higiene.none}</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="consumible-tipo" label={copy.higiene.kind}>
            <Select id="consumible-tipo" className="w-full" value={kind} onChange={(event) => { if (isConsumableKind(event.target.value)) setKind(event.target.value) }}>
              {CONSUMABLE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {consumableKindLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="consumible-nuevo-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ReceiptDialog({
  productId,
  options,
  onClose,
  onSaved,
}: {
  productId: string
  options: Consumable[]
  onClose: () => void
  onSaved: () => void
}) {
  const { entities } = useEntity()
  const lookups = useLookups(true)
  const [product, setProduct] = useState(productId)
  const [locationId, setLocationId] = useState('')
  const [entityId, setEntityId] = useState(entities.find((item) => item.code === 'PO')?.id ?? entities[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [day, setDay] = useState<string | null>(todayMadrid())
  const [supplier, setSupplier] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!locationId && lookups.data.places[0]) setLocationId(lookups.data.places[0].id)
  }, [locationId, lookups.data.places])

  async function submit() {
    const qty = wholeNumber(quantity)
    const next: Record<string, string> = {}
    if (!product) next.product_id = copy.higiene.product
    if (!locationId) next.location_id = copy.higiene.location
    if (!entityId) next.owner_entity_id = copy.higiene.entity
    if (qty === null || qty <= 0) next.quantity = copy.higiene.quantity
    if (!day || day > todayMadrid()) next.occurred_at = copy.higiene.future
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length > 0 || !day || qty === null) return
    setSaving(true)
    try {
      await createReceipt({
        product_id: product,
        location_id: locationId,
        owner_entity_id: entityId,
        quantity: qty,
        occurred_at: pastInstant(day),
        supplier_name: supplier.trim() || null,
      })
      onSaved()
    } catch (error: unknown) {
      setErrors(errorFields(error))
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="entrada-consumible" size="md">
      <DialogHeader titleId="entrada-consumible" title={copy.higiene.receipt} onClose={onClose} />
      <DialogBody>
        <form
          id="entrada-consumible-form"
          data-screen="higiene-dialogo-entrada"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="entrada-producto" label={copy.higiene.product} error={errors.product_id}>
            <Select id="entrada-producto" className="w-full" value={product} onChange={(event) => setProduct(event.target.value)}>
              {options.map((item) => (
                <option key={item.product_id} value={item.product_id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="entrada-cantidad" label={copy.higiene.quantity} error={errors.quantity}>
              <Input id="entrada-cantidad" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <Field id="entrada-fecha" label={copy.higiene.date} error={errors.occurred_at}>
              <DatePicker value={day} onChange={setDay} locale="es" labels={dateLabels()} className="w-full" />
            </Field>
          </div>
          <Field id="entrada-ubicacion" label={copy.higiene.location} error={errors.location_id}>
            <Select id="entrada-ubicacion" className="w-full" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {lookups.data.places.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="entrada-entidad" label={copy.higiene.entity}>
            <Select id="entrada-entidad" className="w-full" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="entrada-proveedor" label={copy.higiene.supplierName}>
            <Input id="entrada-proveedor" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="entrada-consumible-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

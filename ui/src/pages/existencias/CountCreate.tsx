import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { entityName } from '@/lib/labels'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { formatDateTime } from '@/lib/format'
import type { Me } from '@/lib/types'
import { toCount } from '@/pages/existencias/adapt'
import { createCount, ownerEntityId, type CountKind, type StockLocation } from '@/pages/existencias/api'
import { useCatalog } from '@/pages/existencias/catalog'
import { rememberCount } from '@/pages/existencias/count-cache'
import { explainStockError } from '@/pages/existencias/explain'
import { COUNT_KINDS } from '@/pages/existencias/labels'
import { OPENING_COUNT_ISO, madridInputToIso } from '@/pages/existencias/time'
import { useList } from '@/pages/existencias/use-list'
import { ArrowLeft } from '@/ui/icons'
import { Button, Checkbox, Chip, DatePicker, Drawer, DrawerBody, DrawerHeader, Input, Select, Textarea, useToast } from '@/ui'

const DATE_LABELS = { clear: copy.stock.dateClear, today: copy.stock.dateToday, time: copy.stock.dateTime }

function isKind(value: string | null): value is CountKind {
  return COUNT_KINDS.some((item) => item.id === value)
}

export function CountCreate({ me }: { me: Me }) {
  const navigate = useNavigate()
  const desktop = useMinWidth(768)
  const toast = useToast()
  const [params] = useSearchParams()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const preset = ownerEntityId(filter, entities)
  const fallback = entities.find((entity) => entity.code === 'PO')?.id ?? entities[0]?.id ?? ''
  const kindParam = params.get('kind')
  const initialKind: CountKind = isKind(kindParam) ? kindParam : 'periodic'
  const [kind, setKind] = useState<CountKind>(initialKind)
  const [countedAt, setCountedAt] = useState(initialKind === 'opening' ? OPENING_COUNT_ISO : new Date().toISOString())
  const [entityId, setEntityId] = useState(preset ?? fallback)
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locations = useList<StockLocation>(allows(me, 'inventory.count') ? '/v1/locations?limit=100' : null)
  useChromeTitle(copy.stock.newCount)

  if (!allows(me, 'inventory.read') || !allows(me, 'inventory.count')) return <NoPermission />

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function submit() {
    if (!entityId) {
      setError(copy.stock.needEntity)
      return
    }
    if (selected.length === 0) {
      setError(copy.stock.needLocation)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createCount(
        {
          kind,
          counted_at: kind === 'opening' ? OPENING_COUNT_ISO : countedAt,
          location_ids: selected,
          legal_entity_id: entityId,
          notes: notes.trim() || undefined,
        },
        crypto.randomUUID(),
      )
      rememberCount(toCount(created, catalog))
      toast(copy.stock.created)
      navigate(`/stock/aforos/${created.id}`)
    } catch (err: unknown) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load)
      setError(explainStockError(apiError))
      setBusy(false)
    }
  }

  const form = (
    <form
      id="aforo-nuevo"
      data-screen="aforo-nuevo"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-label text-text-secondary">{copy.stock.kind}</legend>
        <div className="flex flex-wrap gap-1.5">
          {COUNT_KINDS.map((item) => (
            <Chip
              key={item.id}
              pressed={kind === item.id}
              active={kind === item.id}
              onClick={() => {
                setKind(item.id)
                if (item.id === 'opening') setCountedAt(OPENING_COUNT_ISO)
              }}
            >
              {item.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      {kind === 'opening' ? (
        <label className="grid gap-1">
          <span className="text-label text-text-secondary">{copy.stock.cutoff}</span>
          <Input value={formatDateTime(OPENING_COUNT_ISO)} disabled />
          <span className="text-caption text-text-tertiary">{copy.stock.cutoffHint}</span>
        </label>
      ) : (
        <label className="grid max-w-xs gap-1">
          <span className="text-label text-text-secondary">{copy.stock.countedAt}</span>
          <DatePicker
            withTime
            timeZone="Europe/Madrid"
            locale="es"
            labels={DATE_LABELS}
            value={countedAt}
            onChange={(next) => {
              if (!next) return
              setCountedAt(next.includes('T') ? madridInputToIso(next) : madridInputToIso(`${next}T12:00`))
            }}
          />
        </label>
      )}
      <label className="grid max-w-xs gap-1">
        <span className="text-label text-text-secondary">{copy.stock.entity}</span>
        <Select id="legal_entity_id" value={entityId} disabled={Boolean(preset)} onChange={(event) => setEntityId(event.target.value)}>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entityName(entity.code)}
            </option>
          ))}
        </Select>
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-label text-text-secondary">{copy.stock.locations}</legend>
        {locations.loading ? <p className="text-label text-text-tertiary">{copy.loading}</p> : null}
        {locations.error ? <ErrorState title={`${copy.error.load} (${locations.error.code})`} detail={locations.error.message} onRetry={locations.reload} /> : null}
        {!locations.loading && locations.items.filter((item) => item.is_active).length === 0 ? <p className="text-label text-text-tertiary">{copy.stock.noLocations}</p> : null}
        <div className="overflow-hidden rounded-2xl border border-border-subtle">
          {locations.items
            .filter((item) => item.is_active)
            .map((item) => (
              <div key={item.id} className="border-b border-border-subtle px-3 py-2 last:border-b-0">
                <Checkbox
                  checked={selected.includes(item.id)}
                  label={item.name}
                  description={item.code}
                  onChange={() => toggle(item.id)}
                />
              </div>
            ))}
        </div>
      </fieldset>
      <label className="grid gap-1">
        <span className="text-label text-text-secondary">{copy.stock.notes}</span>
        <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {error ? <ErrorState title={error} framed={false} /> : null}
    </form>
  )

  const actions = (
    <div className={desktop ? 'flex justify-end gap-2' : 'flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3'}>
      <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/stock/aforos')}>
        {copy.stock.cancel}
      </Button>
      <Button type="submit" form="aforo-nuevo" variant="primary" size="sm" loading={busy}>
        {busy ? copy.stock.creating : copy.stock.create}
      </Button>
    </div>
  )

  if (!desktop) {
    return (
      <Drawer open onClose={() => navigate('/stock/aforos')} labelledBy="nuevo-aforo" size="lg">
        <DrawerHeader titleId="nuevo-aforo" title={copy.stock.newCount} onClose={() => navigate('/stock/aforos')} />
        <DrawerBody>{form}</DrawerBody>
        {actions}
      </Drawer>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 md:px-8">
        <button type="button" className="inline-flex items-center gap-1 text-label text-text-tertiary" onClick={() => navigate('/stock/aforos')}>
          <ArrowLeft className="size-3.5" strokeWidth={iconStroke} />
          {copy.stock.counts}
        </button>
        <header>
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.stock.newCount}</h1>
          <p className="mt-1 text-label text-text-secondary">El libro se compara al cerrar el recuento.</p>
        </header>
        {form}
        {actions}
      </div>
    </div>
  )
}

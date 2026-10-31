import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { Badge, Button, GlassMenu, Input, MenuItem, Select, Textarea, useMenuOpen, useToast } from '@/ui'
import { MoreVertical } from '@/ui/icons'
import { createFieldTask, updateParcel, type FieldTask, type Harvest, type MaturityCheck, type Parcel } from '@/pages/vinedo/api'
import { Fact, FactCard, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { civil, ha, kilos, organicLabel, ownershipLabel, seedLabel, taskLabel } from '@/pages/vinedo/labels'

type Tab = 'datos' | 'variedades' | 'labores' | 'maduracion' | 'vendimias'

export function ParcelaPage({ me }: { me: Me }) {
  const { code = '' } = useParams()
  const parcel = useApi<Parcel>(code ? `/v1/parcels/${encodeURIComponent(code)}` : null)
  useChromeTitle(parcel.data?.code || copy.nav.vineyard)
  const [tab, setTab] = useState<Tab>('datos')

  if (!allows(me, 'vineyard.read')) return <NoPermission />
  if (parcel.loading && !parcel.data) {
    return <div aria-busy="true" className="p-4 text-label text-text-tertiary">{copy.loading}</div>
  }
  if (parcel.error || !parcel.data) {
    return (
      <div className="p-4">
        <ErrorState title={`${copy.error.load} (${parcel.error?.code ?? 'WC_ERROR'})`} detail={parcel.error?.message} onRetry={parcel.reload} />
      </div>
    )
  }

  return <Loaded me={me} parcel={parcel.data} tab={tab} onTab={setTab} onReload={parcel.reload} />
}

function Loaded({
  me,
  parcel,
  tab,
  onTab,
  onReload,
}: {
  me: Me
  parcel: Parcel
  tab: Tab
  onTab: (tab: Tab) => void
  onReload: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const canWrite = allows(me, 'vineyard.write')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const tasks = useApi<{ items: FieldTask[] }>(tab === 'labores' ? `/v1/field-tasks?parcel_code=${encodeURIComponent(parcel.code)}` : null)
  const checks = useApi<{ items: MaturityCheck[] }>(tab === 'maduracion' ? `/v1/maturity-checks?parcel_code=${encodeURIComponent(parcel.code)}` : null)
  const harvests = useApi<{ items: Harvest[] }>(tab === 'vendimias' ? '/v1/harvests' : null)
  const mine = useMemo(
    () => (harvests.data?.items ?? []).filter((item) => item.parcel_code === parcel.code),
    [harvests.data, parcel.code],
  )

  async function deactivate() {
    setBusy(true)
    try {
      await updateParcel(parcel.code, { is_active: false })
      setConfirm(false)
      onReload()
      toast(copy.vinedo.deactivated)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.error.load)
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    { id: 'datos' as const, label: copy.vinedo.tabData },
    { id: 'variedades' as const, label: copy.vinedo.varieties },
    { id: 'labores' as const, label: copy.vinedo.tabTasks },
    { id: 'maduracion' as const, label: copy.vinedo.sections.maduracion },
    { id: 'vendimias' as const, label: copy.vinedo.sections.vendimias },
  ]

  return (
    <div data-screen="vinedo-parcela" data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <RecordBar backTo="/vinedo" backLabel={copy.nav.vineyard}>
        {canWrite ? (
          <GlassMenu
            open={more.open}
            onOpenChange={more.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.vinedo.more} onClick={more.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              tone="danger"
              onClick={() => {
                more.close()
                setConfirm(true)
              }}
            >
              {copy.vinedo.deactivate}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </RecordBar>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <h1 className="text-body font-medium text-ink-900">{parcel.code}</h1>
        <span className="text-label text-text-secondary">{parcel.name}</span>
        <Badge tone={parcel.is_organic ? 'success' : 'neutral'} size="sm">
          {organicLabel(parcel.organic_status)}
        </Badge>
        {!parcel.is_active ? (
          <Badge tone="neutral" size="sm">
            {copy.vinedo.inactive}
          </Badge>
        ) : null}
      </div>
      <div className="px-4">
        <SectionTabs label={parcel.code} tabs={tabs} value={tab} onChange={onTab} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'datos' ? <Datos parcel={parcel} /> : null}
        {tab === 'variedades' ? <Variedades parcel={parcel} /> : null}
        {tab === 'labores' ? (
          <Labores me={me} parcel={parcel} items={tasks.data?.items ?? []} error={tasks.error} onReload={tasks.reload} />
        ) : null}
        {tab === 'maduracion' ? (
          <Checks items={checks.data?.items ?? []} onOpen={() => navigate(`/vinedo?seccion=maduracion&parcela=${encodeURIComponent(parcel.code)}`)} />
        ) : null}
        {tab === 'vendimias' ? <HarvestList items={mine} /> : null}
      </div>
      <ConfirmDialog
        open={confirm}
        danger
        title={copy.vinedo.deactivate}
        body={copy.vinedo.deactivateBody}
        confirmLabel={copy.vinedo.deactivate}
        busy={busy}
        onConfirm={() => void deactivate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

function Datos({ parcel }: { parcel: Parcel }) {
  return (
    <div className="grid gap-3 p-4">
      <FactCard title={copy.vinedo.tabData}>
        <Fact label={copy.vinedo.sigpac} value={parcel.sigpac} />
        <Fact label={copy.vinedo.area} value={ha(parcel.area_ha)} />
        <Fact label={copy.vinedo.ownership} value={ownershipLabel(parcel.ownership)} />
        <Fact label={copy.vinedo.organicSince} value={civil(parcel.organic_since)} />
        <Fact label={copy.vinedo.appellation} value={parcel.appellation || '—'} />
        <Fact label={copy.vinedo.soil} value={parcel.soil || '—'} />
        <Fact label={copy.vinedo.notes} value={parcel.notes || '—'} />
      </FactCard>
    </div>
  )
}

function Variedades({ parcel }: { parcel: Parcel }) {
  return (
    <div className="grid gap-2 p-4">
      {parcel.varieties.map((item) => (
        <FactCard key={item.id} title={item.variety}>
          <Fact label={copy.vinedo.area} value={ha(item.area_ha)} />
          <Fact label={copy.vinedo.color} value={item.color === 'white' ? copy.vinedo.white : copy.vinedo.red} />
          <Fact label={copy.vinedo.planted} value={item.planting_year ? String(item.planting_year) : '—'} />
        </FactCard>
      ))}
    </div>
  )
}

function Labores({
  me,
  parcel,
  items,
  error,
  onReload,
}: {
  me: Me
  parcel: Parcel
  items: FieldTask[]
  error: ApiError | null
  onReload: () => void
}) {
  const canWrite = allows(me, 'vineyard.write')
  const [open, setOpen] = useState(false)
  const [doneOn, setDoneOn] = useState('')
  const [kind, setKind] = useState('pruning')
  const [operator, setOperator] = useState('')
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit() {
    setSaving(true)
    setFormError('')
    try {
      await createFieldTask({
        parcel_code: parcel.code,
        done_on: doneOn,
        kind,
        operator_name: operator.trim() || null,
        hours: hours.trim() ? hours.trim().replace(',', '.') : null,
        notes: notes.trim() || null,
      })
      setOpen(false)
      onReload()
    } catch (err: unknown) {
      setFormError(err instanceof ApiError ? err.message : copy.error.load)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-3 p-4">
      {canWrite ? (
        <Button type="button" variant="primary" size="sm" className="justify-self-start" onClick={() => setOpen((value) => !value)}>
          {copy.vinedo.newTask}
        </Button>
      ) : null}
      {open ? (
        <div className="grid gap-3 rounded-2xl border border-border-subtle p-3">
          <Field id="labor-fecha" label={copy.vinedo.date}>
            <Input id="labor-fecha" type="date" className="w-full" value={doneOn} onChange={(event) => setDoneOn(event.target.value)} />
          </Field>
          <Field id="labor-tipo" label={copy.vinedo.taskKind}>
            <Select id="labor-tipo" className="w-full" value={kind} onChange={(event) => setKind(event.target.value)}>
              {Object.entries(copy.vinedo.tasks).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="labor-quien" label={copy.vinedo.operator}>
            <Input id="labor-quien" className="w-full" value={operator} onChange={(event) => setOperator(event.target.value)} />
          </Field>
          <Field id="labor-horas" label={copy.vinedo.hours}>
            <Input id="labor-horas" inputMode="decimal" className="w-full" value={hours} onChange={(event) => setHours(event.target.value)} />
          </Field>
          <Field id="labor-notas" label={copy.vinedo.notes}>
            <Textarea id="labor-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {formError ? <p className="text-caption text-danger-600">{formError}</p> : null}
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
            {copy.vinedo.save}
          </Button>
        </div>
      ) : null}
      {error ? <ErrorState title={error.message} onRetry={onReload} /> : null}
      {items.length === 0 && !error ? <p className="text-label text-text-tertiary">{copy.vinedo.emptyTasks}</p> : null}
      {items.map((item) => (
        <FactCard key={item.id} title={`${civil(item.done_on)} · ${taskLabel(item.kind)}`}>
          <Fact label={copy.vinedo.operator} value={item.operator_name || '—'} />
          <Fact label={copy.vinedo.hours} value={item.hours || '—'} />
          <Fact label={copy.vinedo.notes} value={item.notes || '—'} />
        </FactCard>
      ))}
    </div>
  )
}

function Checks({ items, onOpen }: { items: MaturityCheck[]; onOpen: () => void }) {
  return (
    <div className="grid gap-3 p-4">
      <Button type="button" variant="primary" size="sm" className="justify-self-start" onClick={onOpen}>
        {copy.vinedo.newCheck}
      </Button>
      {items.length === 0 ? <p className="text-label text-text-tertiary">{copy.vinedo.emptyMaturity}</p> : null}
      {items.map((item) => (
        <FactCard key={item.id} title={civil(item.checked_at)}>
          <Fact label={copy.vinedo.days} value={item.estimated_days_to_harvest == null ? '—' : String(item.estimated_days_to_harvest)} />
          <Fact label={copy.vinedo.seed} value={seedLabel(item.seed_color)} />
          <Fact label={copy.vinedo.phenolic} value={item.phenolic_maturity == null ? '—' : String(item.phenolic_maturity)} />
          <Fact label={copy.vinedo.author} value={item.author} />
        </FactCard>
      ))}
    </div>
  )
}

function HarvestList({ items }: { items: Harvest[] }) {
  if (items.length === 0) return <p className="p-4 text-label text-text-tertiary">{copy.vinedo.emptyHarvests}</p>
  return (
    <div className="grid gap-2 p-4">
      {items.map((item) => (
        <FactCard key={item.id} title={`${item.vintage} · ${item.variety}`}>
          <Fact label={copy.vinedo.date} value={civil(item.harvested_on)} />
          <Fact label={copy.vinedo.estimatedKg} value={kilos(item.estimated_kg)} />
          <Fact label={copy.vinedo.closed} value={item.closed ? copy.vinedo.yes : copy.vinedo.no} />
        </FactCard>
      ))}
    </div>
  )
}

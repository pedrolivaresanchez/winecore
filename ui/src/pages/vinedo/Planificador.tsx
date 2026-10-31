import { useMemo, useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { Badge, Button, Dialog, DialogBody, DialogFooter, DialogHeader, GlassMenu, Input, MenuItem, Select, Textarea, useMenuOpen, useToast } from '@/ui'
import { ChevronLeft, ChevronRight, MoreVertical } from '@/ui/icons'
import {
  cancelPlan,
  confirmPlan,
  createPlan,
  deleteCrew,
  putCrew,
  suggestPlan,
  type CrewDay,
  type HarvestPlan,
  type Parcel,
} from '@/pages/vinedo/api'
import { VineyardShell } from '@/pages/vinedo/chrome'
import { civil, planStatusLabel, todayMadrid, weatherLabel } from '@/pages/vinedo/labels'

const WEEK = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function monthStart(anchor: string): Date {
  const [year, month] = anchor.split('-').map(Number)
  return new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1))
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addMonths(anchor: string, delta: number): string {
  const start = monthStart(anchor)
  start.setUTCMonth(start.getUTCMonth() + delta)
  return iso(start)
}

export function Planificador({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const canWrite = allows(me, 'vineyard.write')
  const [anchor, setAnchor] = useState(() => `${todayMadrid().slice(0, 7)}-01`)
  const [year, setYear] = useState(todayMadrid().slice(0, 4))
  const from = iso(monthStart(anchor))
  const end = iso(new Date(Date.UTC(monthStart(anchor).getUTCFullYear(), monthStart(anchor).getUTCMonth() + 1, 0)))
  const crew = useApi<{ items: CrewDay[] }>(`/v1/crew-availability?from=${from}&to=${end}`)
  const plans = useApi<{ items: HarvestPlan[] }>(`/v1/harvest-plans?campaign=${year}`)
  const parcels = useApi<{ items: Parcel[] }>('/v1/parcels')
  const [day, setDay] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const byDay = useMemo(() => {
    const map = new Map<string, CrewDay>()
    for (const item of crew.data?.items ?? []) {
      if (item.day) map.set(item.day, item)
    }
    return map
  }, [crew.data])

  const cells = useMemo(() => buildMonth(anchor), [anchor])
  const rawTitle = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthStart(anchor))
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1)

  return (
    <VineyardShell
      section="planificador"
      screen="vinedo-planificador"
      actions={
        canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
            {copy.vinedo.newPlan}
          </Button>
        ) : null
      }
    >
      <div className="grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
        <section className="border-b border-border-subtle md:border-r md:border-b-0">
          <div className="flex h-11 items-center gap-1 px-3">
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.vinedo.prev} onClick={() => setAnchor((value) => addMonths(value, -1))}>
              <ChevronLeft strokeWidth={iconStroke} />
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-center text-label font-medium text-ink-900">{title}</h2>
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.vinedo.next} onClick={() => setAnchor((value) => addMonths(value, 1))}>
              <ChevronRight strokeWidth={iconStroke} />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 px-3 pb-1">
            {WEEK.map((label) => (
              <span key={label} className="text-center text-caption text-text-tertiary">
                {label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 px-3 pb-3">
            {cells.map((cell, index) => {
              const people = cell ? byDay.get(cell)?.people : undefined
              return cell ? (
                <button
                  key={cell}
                  type="button"
                  className={cn(
                    'flex h-9 flex-col items-center justify-center rounded-[7px] text-caption leading-none',
                    day === cell ? 'bg-ink-900 text-ink-0' : 'text-ink-900 hover:bg-fill-hover',
                  )}
                  onClick={() => setDay(cell)}
                >
                  <span>{Number(cell.slice(8))}</span>
                  {people != null ? <span className={day === cell ? 'text-ink-0' : 'text-text-tertiary'}>{people}</span> : null}
                </button>
              ) : (
                <span key={`empty-${index}`} />
              )
            })}
          </div>
          {crew.error ? <div className="px-3 pb-3"><ErrorState title={crew.error.message} onRetry={crew.reload} /></div> : null}
        </section>
        <section className="min-h-0 overflow-auto">
          <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-4">
            <h2 className="text-label font-medium text-ink-900">{copy.vinedo.plans}</h2>
            <Select aria-label={copy.vinedo.campaign} size="sm" value={year} onChange={(event) => setYear(event.target.value)}>
              {['2025', '2026', '2027'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          {plans.error ? <div className="p-4"><ErrorState title={plans.error.message} onRetry={plans.reload} /></div> : null}
          {(plans.data?.items.length ?? 0) === 0 && !plans.loading ? (
            <p className="p-4 text-label text-text-tertiary">{copy.vinedo.emptyPlans}</p>
          ) : null}
          <div className="grid gap-3 p-4">
            {(plans.data?.items ?? []).map((plan) => (
              <PlanCard key={plan.id} me={me} plan={plan} canWrite={canWrite} onChange={plans.reload} />
            ))}
          </div>
        </section>
      </div>
      {day ? (
        <CrewDialog
          day={day}
          current={byDay.get(day) ?? null}
          canWrite={canWrite}
          onClose={() => setDay(null)}
          onSaved={() => {
            setDay(null)
            crew.reload()
          }}
        />
      ) : null}
      {creating ? (
        <PlanDialog
          parcels={parcels.data?.items.filter((item) => item.is_active) ?? []}
          year={year}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            plans.reload()
          }}
        />
      ) : null}
    </VineyardShell>
  )
}

function buildMonth(anchor: string): (string | null)[] {
  const start = monthStart(anchor)
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const firstWeekday = (start.getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= count; day += 1) {
    cells.push(iso(new Date(Date.UTC(year, month, day))))
  }
  return cells
}

function PlanCard({
  me,
  plan,
  canWrite,
  onChange,
}: {
  me: Me
  plan: HarvestPlan
  canWrite: boolean
  onChange: () => void
}) {
  const toast = useToast()
  const more = useMenuOpen()
  const [busy, setBusy] = useState<'suggest' | 'confirm' | null>(null)
  const draft = plan.status === 'draft'

  async function run(action: 'suggest' | 'confirm') {
    setBusy(action)
    try {
      const next = action === 'suggest' ? await suggestPlan(plan.id) : await confirmPlan(plan.id)
      toast(action === 'confirm' ? `${copy.vinedo.confirmedBy} ${me.display_name}` : civil(next.suggested_on))
      onChange()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.error.load)
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="grid gap-2 rounded-2xl border border-border-subtle p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-label font-medium text-ink-900">
          {plan.parcel_code} · {plan.vintage}
        </h3>
        <Badge tone={plan.status === 'confirmed' ? 'success' : plan.status === 'cancelled' ? 'danger' : 'neutral'} size="sm">
          {planStatusLabel(plan.status)}
        </Badge>
        {canWrite && draft ? (
          <GlassMenu
            open={more.open}
            onOpenChange={more.setOpen}
            placement="bottom-end"
            className="ml-auto"
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
                void cancelPlan(plan.id).then(onChange).catch((error: unknown) => {
                  toast(error instanceof ApiError ? error.message : copy.error.load)
                })
              }}
            >
              {copy.vinedo.cancelPlan}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </div>
      <p className="text-caption text-text-tertiary">
        {copy.vinedo.ready} {civil(plan.ripeness_ready_on)} · {weatherLabel(plan.weather_risk)} · {plan.crew_needed ?? '—'}
      </p>
      {plan.suggested_on ? (
        <p className="text-body font-medium text-ink-900">
          {civil(plan.suggested_on)}
        </p>
      ) : null}
      {plan.earliest_on && plan.latest_on ? (
        <p className="text-caption text-text-tertiary">
          {civil(plan.earliest_on)} – {civil(plan.latest_on)}
        </p>
      ) : null}
      {plan.rationale ? <p className="text-label text-text-secondary">{plan.rationale}</p> : null}
      {canWrite && draft ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" loading={busy === 'suggest'} onClick={() => void run('suggest')}>
            {copy.vinedo.suggest}
          </Button>
          {plan.suggested_on ? (
            <Button type="button" variant="primary" size="sm" loading={busy === 'confirm'} onClick={() => void run('confirm')}>
              {copy.vinedo.confirm}
            </Button>
          ) : null}
          <span className="text-caption text-text-tertiary">{me.display_name}</span>
        </div>
      ) : null}
    </article>
  )
}

function CrewDialog({
  day,
  current,
  canWrite,
  onClose,
  onSaved,
}: {
  day: string
  current: CrewDay | null
  canWrite: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const more = useMenuOpen()
  const [people, setPeople] = useState(current ? String(current.people) : '')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    const count = Number(people)
    if (!Number.isInteger(count) || count < 0) {
      toast(copy.vinedo.peopleInvalid)
      return
    }
    setSaving(true)
    try {
      await putCrew(day, { people: count, notes: notes.trim() || null })
      onSaved()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.error.load)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="cuadrilla-dia" size="sm">
      <DialogHeader
        titleId="cuadrilla-dia"
        title={civil(day)}
        onClose={onClose}
        actions={
          canWrite && current ? (
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
                  void deleteCrew(day).then(onSaved).catch((error: unknown) => {
                    toast(error instanceof ApiError ? error.message : copy.error.load)
                  })
                }}
              >
                {copy.vinedo.removeDay}
              </MenuItem>
            </GlassMenu>
          ) : null
        }
      />
      <DialogBody>
        <div className="grid gap-3">
          <Field id="cuadrilla-personas" label={copy.vinedo.people}>
            <Input id="cuadrilla-personas" inputMode="numeric" className="w-full" value={people} onChange={(event) => setPeople(event.target.value)} />
          </Field>
          <Field id="cuadrilla-notas" label={copy.vinedo.notes}>
            <Textarea id="cuadrilla-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        {canWrite ? (
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {copy.vinedo.save}
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}

function PlanDialog({
  parcels,
  year,
  onClose,
  onCreated,
}: {
  parcels: Parcel[]
  year: string
  onClose: () => void
  onCreated: () => void
}) {
  const [parcel, setParcel] = useState(parcels[0]?.code ?? '')
  const [weather, setWeather] = useState('none')
  const [note, setNote] = useState('')
  const [crew, setCrew] = useState('4')
  const [ready, setReady] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await createPlan({
        parcel_code: parcel,
        vintage: Number(year),
        weather_risk: weather,
        weather_note: note.trim() || null,
        crew_needed: Number(crew),
        ripeness_ready_on: ready || null,
      })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="plan-alta" size="md">
      <DialogHeader titleId="plan-alta" title={copy.vinedo.newPlan} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          <Field id="plan-parcela" label={copy.vinedo.parcel}>
            <Select id="plan-parcela" className="w-full" value={parcel} onChange={(event) => setParcel(event.target.value)}>
              {parcels.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="plan-meteo" label={copy.vinedo.weatherLabel}>
            <Select id="plan-meteo" className="w-full" value={weather} onChange={(event) => setWeather(event.target.value)}>
              {Object.entries(copy.vinedo.weather).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="plan-gente" label={copy.vinedo.crewNeeded}>
            <Input id="plan-gente" inputMode="numeric" className="w-full" value={crew} onChange={(event) => setCrew(event.target.value)} />
          </Field>
          <Field id="plan-lista" label={copy.vinedo.ready}>
            <Input id="plan-lista" type="date" className="w-full" value={ready} onChange={(event) => setReady(event.target.value)} />
          </Field>
          <Field id="plan-nota" label={copy.vinedo.notes}>
            <Input id="plan-nota" className="w-full" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.vinedo.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

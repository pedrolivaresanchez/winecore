import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import { Alert, Badge, Button, EmptyState, InfoTip, Select, Skeleton, useToast, type BadgeTone } from '@/ui'
import { obligationOf, obligationWarehouse, obligationsPath, syncObligations, type Obligation } from '@/pages/regulatorio/api'
import { CreateDialog } from '@/pages/regulatorio/CreateDialog'
import { ListFrame } from '@/pages/regulatorio/frame'
import {
  bandLabel,
  canPrepare,
  deadlineBand,
  flowLabel,
  madridMonth,
  madridToday,
  monthTitle,
  dayMonth,
  isoWeek,
  shiftMonth,
  daysUntil,
  type DeadlineBand,
} from '@/pages/regulatorio/model'
import { useWarehouses } from '@/pages/regulatorio/warehouses'

const BANDS: DeadlineBand[] = ['overdue', 'd1', 'd7', 'd30']

function obligationMeta(item: Obligation): { label: string; tone: BadgeTone } {
  if (item.display === 'presentado' || item.status === 'done') {
    return { label: copy.regulatorio.statuses.presentado, tone: 'success' }
  }
  if (item.display === 'vencido') return { label: copy.regulatorio.statuses.vencido, tone: 'danger' }
  if (item.display === 'preparado' || item.status === 'in_progress') {
    return { label: copy.regulatorio.statuses.preparado, tone: 'info' }
  }
  return { label: copy.regulatorio.statuses.pendiente, tone: 'warning' }
}

function closed(item: Obligation): boolean {
  return item.status === 'done' || item.display === 'presentado'
}

export function CalendarioPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const wide = useMinWidth(768)
  const { filter, entities } = useEntity()
  const entityId = filter === 'all' ? undefined : entities.find((entity) => entity.code === filter)?.id
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? (params.get('mes') as string) : madridMonth()
  const flow = params.get('flujo') ?? ''
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Obligation | null>(null)
  const places = useWarehouses()
  const prepare = canPrepare(me)
  const year = Number(month.slice(0, 4))
  const path = allows(me, 'regulatory.read')
    ? obligationsPath({ entityId, flow: flow || undefined, from: `${year - 1}-01-01`, to: `${year + 1}-12-31` })
    : null
  const query = useApi<{ items: Obligation[] }>(path)
  const today = madridToday()
  const items = useMemo(() => (query.data?.items ?? []).map(obligationOf), [query.data])

  const flows = useMemo(() => {
    const values = new Set(items.map((item) => item.flow))
    values.add('silicie')
    return [...values]
  }, [items])

  const openItems = items.filter((item) => !closed(item))
  const counts = Object.fromEntries(BANDS.map((band) => [band, openItems.filter((item) => deadlineBand(today, item.due_date) === band).length])) as Record<DeadlineBand, number>

  const monthRows = items.filter((item) => item.due_date.slice(0, 7) === month)
  const lateRows = wide
    ? items.filter((item) => !closed(item) && deadlineBand(today, item.due_date) === 'overdue' && item.due_date.slice(0, 7) !== month)
    : []
  const rows = wide ? monthRows : items.filter((item) => daysUntil(today, item.due_date) <= 30)

  const groups = useMemo(() => {
    const grouped: { week: number; items: Obligation[] }[] = []
    for (const item of rows) {
      const week = isoWeek(item.due_date)
      const last = grouped[grouped.length - 1]
      if (!last || last.week !== week) grouped.push({ week, items: [item] })
      else last.items.push(item)
    }
    return grouped
  }, [rows])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  async function sync() {
    setBusy(true)
    try {
      const targets = entityId ? [{ id: entityId }] : me.entities
      if (targets.length === 0) await syncObligations()
      else {
        for (const entity of targets) await syncObligations({ legalEntityId: entity.id, year })
      }
      toast(copy.regulatorio.synced, { tone: 'success' })
      query.reload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  if (!allows(me, 'regulatory.read')) return <NoPermission />

  const loading = query.loading && !query.data
  const anyBand = BANDS.some((band) => counts[band] > 0)
  const screen = loading
    ? 'regulatorio-calendario-cargando'
    : rows.length === 0 && !anyBand
      ? 'regulatorio-calendario-vacio'
      : 'regulatorio-calendario'

  const syncButton = prepare ? (
    <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void sync()}>
      {copy.regulatorio.sync}
    </Button>
  ) : null

  return (
    <>
      <ListFrame
        screen={screen}
        view="calendario"
        actions={syncButton}
        mobileActions={syncButton}
        toolbar={
          wide ? (
            <>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.regulatorio.monthPrev} onClick={() => setParam('mes', shiftMonth(month, -1))}>
                <ChevronLeft strokeWidth={iconStroke} />
              </Button>
              <span className="shrink-0 text-label text-ink-900">{monthTitle(month)}</span>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.regulatorio.monthNext} onClick={() => setParam('mes', shiftMonth(month, 1))}>
                <ChevronRight strokeWidth={iconStroke} />
              </Button>
            </>
          ) : (
            <span className="shrink-0 text-label text-ink-900">{copy.regulatorio.next30}</span>
          )
        }
        filters={
          <Select id="flujo" size="sm" aria-label={copy.regulatorio.flow} value={flow} onChange={(event) => setParam('flujo', event.target.value)}>
            <option value="">{copy.regulatorio.allFlows}</option>
            {flows.map((item) => (
              <option key={item} value={item}>
                {flowLabel(item)}
              </option>
            ))}
          </Select>
        }
      >
        {query.error && items.length === 0 ? (
          <div className="p-4">
            <ErrorState title={`${copy.error.load} (${query.error.code})`} detail={query.error.message} onRetry={query.reload} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {anyBand ? (
              <div className="grid gap-2 px-3 py-3 sm:px-4">
                {BANDS.filter((band) => counts[band] > 0).map((band) => (
                  <Alert key={band} tone={band === 'overdue' || band === 'd1' ? 'danger' : band === 'd7' ? 'warning' : 'info'}>
                    {bandLabel(band, counts[band])}
                  </Alert>
                ))}
              </div>
            ) : null}
            {loading ? (
              <div aria-busy="true" className="grid gap-2 p-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : lateRows.length === 0 && rows.length === 0 ? (
              <EmptyState
                size="sm"
                title={items.length === 0 ? copy.regulatorio.noObligations : copy.regulatorio.noObligationsMonth}
                description={items.length === 0 ? copy.regulatorio.noObligationsHint : undefined}
                action={items.length === 0 ? syncButton : undefined}
              />
            ) : (
              <>
                {lateRows.length > 0 ? (
                  <ul>
                    {lateRows.map((item) => (
                      <ObligationRow key={item.id} item={item} today={today} prepare={prepare} onPrepare={setDraft} onOpen={(target) => navigate(`/regulatorio/envios/${target}`)} />
                    ))}
                  </ul>
                ) : null}
                {groups.map((group) => (
                  <section key={`${month}-${group.week}`}>
                    <h2 className="bg-surface-subtle px-3 py-1.5 text-caption text-text-tertiary sm:px-4">
                      {fill(copy.regulatorio.week, { n: String(group.week) })}
                    </h2>
                    <ul>
                      {group.items.map((item) => (
                        <ObligationRow key={item.id} item={item} today={today} prepare={prepare} onPrepare={setDraft} onOpen={(target) => navigate(`/regulatorio/envios/${target}`)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </div>
        )}
      </ListFrame>
      <CreateDialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        me={me}
        warehouses={places.warehouses}
        initial={{
          entityId: draft?.legal_entity_id,
          warehouseId: draft?.tax_warehouse_id ?? undefined,
          periodStart: draft?.period_start ?? undefined,
          periodEnd: draft?.period_end ?? undefined,
        }}
      />
    </>
  )
}

function ObligationRow({
  item,
  today,
  prepare,
  onPrepare,
  onOpen,
}: {
  item: Obligation
  today: string
  prepare: boolean
  onPrepare: (item: Obligation) => void
  onOpen: (id: string) => void
}) {
  const band = deadlineBand(today, item.due_date)
  const late = !closed(item) && band === 'overdue'
  const soon = !closed(item) && item.display !== 'preparado' && item.status !== 'in_progress' && (band === 'd7' || band === 'd1')
  const meta = obligationMeta(item)
  const canMake = prepare && item.flow === 'silicie' && item.period_start && item.period_end && !item.submission_id
  const warehouse = obligationWarehouse(item)
  return (
    <li
      className={cn(
        'flex min-h-9 items-center gap-2 border-b border-border-subtle px-3 py-1.5 sm:px-4',
        late && 'bg-danger-50',
        soon && 'bg-warning-50',
      )}
    >
      <span className="w-14 shrink-0 text-caption text-text-tertiary">{dayMonth(item.due_date)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          {item.submission_id ? (
            <Link to={`/regulatorio/envios/${item.submission_id}`} className="truncate text-label text-ink-900 hover:underline">
              {item.title}
            </Link>
          ) : (
            <span className="truncate text-label text-ink-900">{item.title}</span>
          )}
          <InfoTip label={copy.regulatorio.legalBasis}>{item.legal_basis}</InfoTip>
        </div>
        {warehouse ? <p className="truncate text-caption text-text-tertiary">{warehouse}</p> : null}
      </div>
      <Badge tone={meta.tone} dot size="sm">
        {meta.label}
      </Badge>
      {item.submission_id ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(item.submission_id ?? '')}>
          {copy.regulatorio.seeFiling}
        </Button>
      ) : canMake ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => onPrepare(item)}>
          {copy.regulatorio.prepare}
        </Button>
      ) : null}
    </li>
  )
}

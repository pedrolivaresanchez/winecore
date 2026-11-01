import { useMemo, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { receivablesPath, type AgingBucket, type ReceivableGroup, type ReceivableItem, type Receivables } from '@/lib/finance'
import { formatDate, formatInteger, formatPercent } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { entityTone, originTone } from '@/lib/status-tones'
import type { EntityChoice, Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { BUCKETS, centsOf, moneyOf, sumItems } from '@/pages/cobros/money'
import { RegistrarDialog } from '@/pages/cobros/RegistrarDialog'
import { vistaOf } from '@/pages/cobros/vista'
import { DocumentModal } from '@/pages/documents/DocumentModal'
import { docKey, parseDocKey, type RecordDoc } from '@/pages/documents/doc-key'
import { useDocParam } from '@/pages/documents/use-doc-param'
import { StatTile } from '@/ui/charts'
import { FRAME_GUTTER } from '@/ui/frame'
import {
  Badge,
  Button,
  EmptyState,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  SkeletonRows,
  StatusPill,
  useLocalPages,
  useMenuOpen,
  useToast,
  type FilterDef,
  type FilterValue,
} from '@/ui'

type Due = '' | 'vencido' | 'por_vencer'
type Sort = 'vencido' | 'importe' | 'cliente'
type Origin = '' | 'holded' | 'winecore'

const SIZES = [25, 50, 100, 200] as const
const PREVIEW = 6
const FILTER_KEYS = ['entity', 'aging', 'vencimiento', 'origen']
const SORTS: { id: Sort; label: string }[] = [
  { id: 'vencido', label: copy.cobros.sortOverdue },
  { id: 'importe', label: copy.cobros.sortTotal },
  { id: 'cliente', label: copy.cobros.sortName },
]
const AGING_LABEL: Record<AgingBucket, string> = {
  '0-30': copy.cobros.bucket030,
  '31-60': copy.cobros.bucket3160,
  '61-90': copy.cobros.bucket6190,
  '>90': copy.cobros.bucket90,
}

/** The rail picks the entity; `?entity=all` overrides it for this view only. */
function entityOf(raw: string | null, rail: EntityChoice): string {
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

function entityName(code: string | null): string {
  if (code === 'PO') return copy.entity.po
  if (code === 'CVPO') return copy.entity.cvpo
  return code || '—'
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es')
}

function sourceOf(item: ReceivableItem): RecordDoc['source'] {
  return item.origin === 'holded' ? 'holded-invoice' : 'invoice'
}

function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Overdue in red with its days; what is still to come says when. */
function dueText(item: ReceivableItem, today: string): { text: string; late: boolean } {
  if (item.is_overdue) {
    return { text: item.days === 1 ? copy.cobros.overdueDay : fill(copy.cobros.overdueDays, { days: formatInteger(item.days) }), late: true }
  }
  if (!item.due_date) return { text: copy.cobros.noDueDate, late: false }
  const days = daysUntil(item.due_date, today)
  if (days <= 0) return { text: copy.cobros.dueToday, late: false }
  if (days === 1) return { text: copy.cobros.dueTomorrow, late: false }
  return { text: fill(copy.cobros.dueInDays, { days: formatInteger(days) }), late: false }
}

/**
 * What customers owe, one block per customer with its open invoices. The strip on top reads the
 * whole book from `summary`; the filters only cut the list under it. Each invoice opens in the
 * document viewer over the page (`?doc=<origen>:<id>`).
 */
export function Pendiente({ me }: { me: Me }) {
  const toast = useToast()
  const opened = useDocParam()
  const { filter: rail } = useEntity()
  const [params, setParams] = useSearchParams()
  const vista = vistaOf(params.get('vista'))
  const entity = entityOf(params.get('entity'), rail)
  const agingRaw = params.get('aging') as AgingBucket | null
  const aging = agingRaw && BUCKETS.includes(agingRaw) ? agingRaw : ''
  const dueRaw = params.get('vencimiento')
  const due: Due = dueRaw === 'vencido' || dueRaw === 'por_vencer' ? dueRaw : ''
  const originRaw = params.get('origen')
  const origin: Origin = originRaw === 'holded' || originRaw === 'winecore' ? originRaw : ''
  const sortRaw = params.get('orden')
  const sort: Sort = sortRaw === 'importe' || sortRaw === 'cliente' ? sortRaw : 'vencido'
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [register, setRegister] = useState<{ contactId: string | null; entityId: string | null } | null>(null)
  const sortMenu = useMenuOpen()
  const canWrite = allows(me, 'finance.write')
  const data = useApi<Receivables>(receivablesPath(entity || null, aging || null))
  const today = data.data?.as_of ?? ''
  const needle = fold(q.trim())

  const all = useMemo(() => data.data?.groups ?? [], [data.data])
  const groups = useMemo(() => {
    const kept: ReceivableGroup[] = []
    for (const group of all) {
      const nameHit = needle !== '' && fold(group.customer_name).includes(needle)
      const items = group.items.filter((item) => {
        if (due && (due === 'vencido') !== item.is_overdue) return false
        if (origin && item.origin !== origin) return false
        if (!needle || nameHit) return true
        return fold(`${item.document_number} ${item.counterparty_name ?? ''}`).includes(needle)
      })
      if (items.length > 0) kept.push({ ...group, items, amounts: sumItems(items) })
    }
    const byName = (left: ReceivableGroup, right: ReceivableGroup) => left.customer_name.localeCompare(right.customer_name, 'es')
    if (sort === 'cliente') return kept.sort(byName)
    const key = sort === 'importe' ? 'total' : 'overdue'
    return kept.sort((left, right) => centsOf(right.amounts[key]) - centsOf(left.amounts[key]) || centsOf(right.amounts.total) - centsOf(left.amounts.total) || byName(left, right))
  }, [all, due, needle, origin, sort])

  const pages = useLocalPages(groups, {
    queryKey: [entity, aging, due, origin, needle, sort].join('|'),
    storageKey: 'cobros-pendiente',
    sizes: SIZES,
    defaultSize: 25,
  })

  const viewable = useMemo(() => pages.items.flatMap((group) => group.items), [pages.items])
  const viewableIds = useMemo(() => viewable.map((item) => item.document_id), [viewable])
  const current = parseDocKey(opened.id)
  const [shown, setShown] = useState<RecordDoc | null>(current)
  if (current && (current.id !== shown?.id || current.source !== shown?.source)) setShown(current)

  function step(id: string) {
    const item = viewable.find((row) => row.document_id === id)
    if (item) opened.move(docKey({ source: sourceOf(item), id }))
  }

  function update(change: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace: true })
  }

  function setFilter(id: string, value: FilterValue) {
    const raw = typeof value === 'string' ? value : ''
    update((next) => {
      if (raw) next.set(id, raw)
      else if (id === 'entity' && rail !== 'all') next.set('entity', 'all')
      else next.delete(id)
    })
  }

  function clearFilters() {
    update((next) => {
      for (const key of FILTER_KEYS) next.delete(key)
      if (rail !== 'all') next.set('entity', 'all')
    })
    setQ('')
  }

  function toggle(key: string) {
    setExpanded((now) => {
      const next = new Set(now)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const summary = data.data?.summary
  const invoiceTotal = all.reduce((sum, group) => sum + group.items.length, 0)
  const pendingCents = centsOf(summary?.pending_total)
  const overdueCents = centsOf(summary?.overdue_total)
  const entities = summary?.by_entity.filter((row) => centsOf(row.pending) !== 0) ?? []
  const filtersActive = Boolean(needle || aging || due || origin || entity)
  const loadingFirst = data.loading && !data.data
  const screen = loadingFirst ? 'cobros-cargando' : groups.length === 0 ? 'cobros-vacio' : 'cobros-pendiente'

  const filters: FilterDef[] = [
    {
      id: 'entity',
      label: copy.salesDocs.entity,
      kind: 'single',
      options: me.entities.map((item) => ({ value: item.code, label: entityName(item.code), tone: entityTone(item.code) })),
    },
    {
      id: 'vencimiento',
      label: copy.cobros.dueFilter,
      kind: 'single',
      display: 'chips',
      options: [
        { value: 'vencido', label: copy.cobros.dueOverdue, tone: 'danger' },
        { value: 'por_vencer', label: copy.cobros.dueUpcoming, tone: 'warning' },
      ],
    },
    {
      id: 'origen',
      label: copy.lists.origin.label,
      kind: 'single',
      options: (['holded', 'winecore'] as const).map((value) => ({ value, label: copy.lists.origin[value], tone: originTone(value) })),
    },
    {
      id: 'aging',
      label: copy.cobros.agingFilter,
      kind: 'single',
      optional: true,
      options: BUCKETS.map((value) => ({ value, label: AGING_LABEL[value] })),
    },
  ]

  const registerAction = canWrite ? { label: copy.cobros.register, onClick: () => setRegister({ contactId: null, entityId: null }) } : null

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={registerAction}
      bar={{
        search: { id: 'buscar-cobros', value: q, onChange: setQ, placeholder: copy.cobros.searchPending },
        filters,
        values: { entity, vencimiento: due, origen: origin, aging },
        onChange: setFilter,
        onClear: clearFilters,
        trailing: (
          <GlassMenu
            open={sortMenu.open}
            onOpenChange={sortMenu.setOpen}
            placement="bottom-end"
            panelClassName="min-w-[220px]"
            trigger={
              <MenuChip active={sortMenu.open} onClick={sortMenu.toggle} title={copy.cobros.sort}>
                {SORTS.find((item) => item.id === sort)?.label}
              </MenuChip>
            }
          >
            {SORTS.map((item) => (
              <MenuItem
                key={item.id}
                checked={item.id === sort}
                onClick={() => {
                  sortMenu.close()
                  update((next) => {
                    if (item.id === 'vencido') next.delete('orden')
                    else next.set('orden', item.id)
                  })
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </GlassMenu>
        ),
      }}
    >
      {data.error && !data.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('grid grid-cols-2 gap-2 border-b border-border-subtle py-3 lg:grid-cols-4', entities.length > 1 && 'xl:grid-cols-5', FRAME_GUTTER)}>
            <StatTile
              label={copy.cobros.kpiPending}
              value={pendingCents / 100}
              type="currency"
              formatted={summary ? moneyOf(summary.pending_total) : '—'}
              hint={
                summary
                  ? fill(copy.cobros.kpiPendingHint, { invoices: formatInteger(invoiceTotal), customers: formatInteger(all.length) })
                  : undefined
              }
            />
            <StatTile
              label={copy.cobros.kpiOverdue}
              value={overdueCents / 100}
              type="currency"
              formatted={summary ? <span className={cn(overdueCents > 0 && 'text-danger-600')}>{moneyOf(summary.overdue_total)}</span> : '—'}
              hint={
                summary
                  ? overdueCents > 0 && pendingCents > 0
                    ? fill(copy.cobros.kpiOverdueHint, { percent: formatPercent(Math.round((overdueCents / pendingCents) * 1000) / 10) })
                    : copy.cobros.kpiOverdueNone
                  : undefined
              }
              onClick={() => setFilter('vencimiento', due === 'vencido' ? '' : 'vencido')}
            />
            <StatTile
              label={copy.cobros.kpiNext30}
              value={centsOf(summary?.due_next_30) / 100}
              type="currency"
              formatted={summary ? moneyOf(summary.due_next_30) : '—'}
              hint={copy.cobros.kpiNext30Hint}
              onClick={() => setFilter('vencimiento', due === 'por_vencer' ? '' : 'por_vencer')}
            />
            <StatTile
              label={copy.cobros.kpiCollected}
              value={centsOf(summary?.collected_this_month) / 100}
              type="currency"
              formatted={summary ? moneyOf(summary.collected_this_month) : '—'}
              hint={copy.cobros.kpiCollectedHint}
              href="/cobros?vista=pagos"
            />
            {entities.length > 1 ? (
              <div className="col-span-2 flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-border-subtle bg-surface-subtle px-3 py-2.5 lg:col-span-4 xl:col-span-1">
                <span className="truncate text-caption text-text-tertiary">{copy.cobros.kpiEntities}</span>
                {entities.map((row) => (
                  <button
                    key={row.entity_code}
                    type="button"
                    onClick={() => setFilter('entity', entity === row.entity_code ? '' : row.entity_code)}
                    className="-mx-1 flex min-w-0 items-center gap-2 rounded-[6px] px-1 py-0.5 text-left outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
                  >
                    <StatusPill tone={entityTone(row.entity_code)}>{entityName(row.entity_code)}</StatusPill>
                    <span className="ml-auto shrink-0 text-label font-medium tabular-nums text-ink-900">{moneyOf(row.pending)}</span>
                    {centsOf(row.overdue) > 0 ? (
                      <span className="shrink-0 text-caption tabular-nums text-danger-600">{fill(copy.cobros.kpiEntityOverdue, { amount: moneyOf(row.overdue) })}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {loadingFirst ? (
            <div className={cn('py-3', FRAME_GUTTER)}>
              <SkeletonRows rows={6} />
            </div>
          ) : groups.length === 0 ? (
            <div className="py-10">
              <EmptyState
                size="sm"
                title={filtersActive ? copy.cobros.noMatch : data.data?.status === 'clear' ? copy.cobros.clear : copy.cobros.empty}
                description={filtersActive ? undefined : copy.cobros.emptyHint}
                action={
                  registerAction && !filtersActive ? (
                    <Button type="button" variant="primary" size="sm" onClick={registerAction.onClick}>
                      {registerAction.label}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className={cn('flex flex-col gap-3 py-3', FRAME_GUTTER)}>
              {pages.items.map((group) => (
                <CustomerBlock
                  key={group.key}
                  group={group}
                  today={today}
                  open={expanded.has(group.key)}
                  openKey={current ? docKey(current) : null}
                  canWrite={canWrite}
                  hrefFor={(item) => opened.hrefFor(docKey({ source: sourceOf(item), id: item.document_id }))}
                  onOpen={(item) => opened.open(docKey({ source: sourceOf(item), id: item.document_id }))}
                  onToggle={() => toggle(group.key)}
                  onCollect={() => {
                    const ids = new Set(group.items.map((item) => item.legal_entity_id))
                    setRegister({ contactId: group.contact_id, entityId: ids.size === 1 ? [...ids][0] : null })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Pagination {...pages.pagination} loading={data.loading} />

      {shown ? (
        <DocumentModal
          me={me}
          source={shown.source}
          id={current?.id ?? null}
          ids={viewableIds}
          onNavigate={step}
          onClose={opened.close}
          onChanged={data.reload}
        />
      ) : null}
      <RegistrarDialog
        me={me}
        open={register !== null}
        direction="in"
        contactId={register?.contactId ?? null}
        entityId={register?.entityId ?? null}
        onClose={() => setRegister(null)}
        onSaved={(warnings) => {
          setRegister(null)
          const warning = warnings[0]
          toast(copy.cobros.saved, warning ? { tone: 'warning', description: warning } : { tone: 'success' })
          data.reload()
        }}
      />
    </CobrosFrame>
  )
}

function CustomerBlock({
  group,
  today,
  open,
  openKey,
  canWrite,
  hrefFor,
  onOpen,
  onToggle,
  onCollect,
}: {
  group: ReceivableGroup
  today: string
  open: boolean
  openKey: string | null
  canWrite: boolean
  hrefFor: (item: ReceivableItem) => string
  onOpen: (item: ReceivableItem) => void
  onToggle: () => void
  onCollect: () => void
}) {
  const items = open ? group.items : group.items.slice(0, PREVIEW)
  const rest = group.items.length - PREVIEW
  const overdue = centsOf(group.amounts.overdue)
  const entities = [...new Set(group.items.map((item) => item.entity_code).filter((code): code is string => Boolean(code)))]
  const count = group.items.length === 1 ? copy.cobros.invoiceOne : fill(copy.cobros.invoiceCount, { count: formatInteger(group.items.length) })

  return (
    <section aria-label={group.customer_name} data-group={group.key} className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-subtle bg-surface-subtle px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {group.contact_id ? (
            <Link
              to={`/contactos/${group.contact_id}`}
              title={fill(copy.cobros.openContact, { name: group.customer_name })}
              className="min-w-0 truncate rounded-[4px] text-label font-medium text-ink-900 outline-none hover:underline focus-visible:shadow-(--shadow-focus)"
            >
              {group.customer_name}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-label font-medium text-ink-900">{group.customer_name}</span>
          )}
          {group.contact_id ? null : (
            <Badge size="sm" tone="neutral" className="shrink-0" title={copy.cobros.noContactTip}>
              {copy.cobros.noContact}
            </Badge>
          )}
          <span className="shrink-0 text-caption text-text-tertiary">{count}</span>
          {entities.map((code) => (
            <StatusPill key={code} tone={entityTone(code)} className="shrink-0">
              {entityName(code)}
            </StatusPill>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {overdue > 0 ? (
            <span className="text-caption tabular-nums text-danger-600">{fill(copy.cobros.overdueAmount, { amount: moneyOf(group.amounts.overdue) })}</span>
          ) : null}
          <span className="text-label font-medium tabular-nums text-ink-900">{moneyOf(group.amounts.total)}</span>
          {canWrite && group.contact_id ? (
            <Button type="button" variant="secondary" size="sm" title={fill(copy.cobros.collectTitle, { name: group.customer_name })} onClick={onCollect}>
              {copy.cobros.collect}
            </Button>
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-border-subtle">
        {items.map((item) => (
          <InvoiceLine
            key={`${item.target_table}:${item.target_id}`}
            item={item}
            today={today}
            active={openKey === docKey({ source: sourceOf(item), id: item.document_id })}
            href={hrefFor(item)}
            onOpen={() => onOpen(item)}
          />
        ))}
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 w-full items-center border-t border-border-subtle px-3 text-caption text-text-secondary outline-none hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
        >
          {open ? copy.cobros.showLess : fill(copy.cobros.showMore, { count: formatInteger(rest) })}
        </button>
      ) : null}
    </section>
  )
}

function InvoiceLine({
  item,
  today,
  active,
  href,
  onOpen,
}: {
  item: ReceivableItem
  today: string
  active: boolean
  href: string
  onOpen: () => void
}) {
  const state = dueText(item, today)
  const dates = [
    fill(copy.cobros.issuedOn, { date: formatDate(item.issue_date) }),
    item.due_date ? fill(copy.cobros.dueOn, { date: formatDate(item.due_date) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onOpen()
  }

  return (
    <li>
      <Link
        to={href}
        onClick={click}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 outline-none transition-colors duration-(--duration-quick) hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)',
          active && 'bg-fill-hover',
        )}
      >
        <span className="flex min-w-0 flex-1 basis-48 items-center gap-1.5">
          <span className="truncate text-label font-medium text-ink-900">{item.document_number}</span>
          {item.origin === 'holded' ? (
            <Badge size="sm" tone="neutral" className="shrink-0" title={copy.cobros.holdedTip}>
              {copy.cobros.holded}
            </Badge>
          ) : null}
        </span>
        <span className="hidden w-56 shrink-0 truncate text-caption text-text-tertiary md:block">{dates}</span>
        <span className={cn('w-40 shrink-0 truncate text-caption', state.late ? 'font-medium text-danger-600' : 'text-text-secondary')}>{state.text}</span>
        <span className={cn('w-28 shrink-0 text-right text-label tabular-nums', state.late ? 'text-danger-600' : 'text-ink-900')}>{moneyOf(item.outstanding)}</span>
      </Link>
    </li>
  )
}

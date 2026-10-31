import { Link } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { ArrowDown, ArrowUp } from '@/ui/icons'
import { Skeleton } from '@/ui'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatInteger, formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import {
  attentionHref,
  useDashboard,
  verifactuClock,
  type AttentionBlock,
  type AttentionItem,
  type ReceivablesBlock,
} from '@/lib/dashboard'
import {
  entityFilter,
  formatDelta,
  formatMeasure,
  metricNumber,
  useReport,
  yearToDate,
  type Measure,
} from '@/lib/reports'
import type { Me } from '@/lib/types'

const dateLabel = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
})

export function Panel({ me }: { me: Me }) {
  useChromeTitle(copy.panel.title)
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const canReports = allows(me, 'reports.read')
  const range = yearToDate()
  const yearQuery = {
    from: range.from,
    to: range.to,
    groupBy: 'month' as const,
    entity,
    compare: true,
  }
  const dashboard = useDashboard(entity)
  const sales = useReport(canReports ? 'sales' : null, canReports ? yearQuery : null, true)
  const expenses = useReport(canReports ? 'expenses' : null, canReports ? yearQuery : null, true)
  const stock = useReport(canReports ? 'stock' : null, canReports ? yearQuery : null, true)
  const pending = dashboard.initial || (canReports && (sales.initial || expenses.initial || stock.initial))

  return (
    <div data-screen={pending ? 'panel-cargando' : 'panel'} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-5 sm:px-4 sm:py-8">
        <header>
          <p className="text-caption text-text-tertiary first-letter:uppercase">{dateLabel.format(new Date())}</p>
          <h1 className="mt-1 text-heading font-medium tracking-[-0.02em] text-ink-900">{copy.panel.title}</h1>
        </header>

        {dashboard.initial ? (
          <PanelSkeleton />
        ) : dashboard.data ? (
          <>
            {dashboard.data.verifactu && dashboard.data.verifactu.count > 0 ? (
              <Link
                to={attentionHref.verifactu}
                className="rounded-2xl outline-none focus-visible:shadow-(--shadow-focus)"
              >
                <div className="flex items-center gap-3 rounded-2xl border border-ink-900/10 bg-warning-50 px-4 py-2.5 text-label text-warning-700">
                  {dashboard.data.verifactu.count === 1
                    ? fill(copy.panel.verifactuOne, { time: verifactuClock(dashboard.data.verifactu.since ?? '') })
                    : fill(copy.panel.verifactu, {
                        count: formatInteger(dashboard.data.verifactu.count),
                        time: verifactuClock(dashboard.data.verifactu.since ?? ''),
                      })}
                </div>
              </Link>
            ) : null}

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {dashboard.data.approvals ? (
                <CountTile label={copy.panel.approvals} value={dashboard.data.approvals.count} href={attentionHref.approvals} />
              ) : null}
              {dashboard.data.deadlines ? (
                <CountTile label={copy.panel.deadlines} value={dashboard.data.deadlines.count} href={attentionHref.deadlines} />
              ) : null}
              {dashboard.data.receivables ? (
                <CountTile
                  label={copy.panel.overdue}
                  value={moneyText(dashboard.data.receivables.amount)}
                  quiet={dashboard.data.receivables.count === 0}
                  href={attentionHref.receivables}
                />
              ) : null}
              {dashboard.data.alerts ? (
                <CountTile label={copy.panel.alerts} value={dashboard.data.alerts.count} href={firstHref(dashboard.data.alerts)} />
              ) : null}
            </div>
          </>
        ) : dashboard.error ? (
          <ErrorState
            title={`${copy.error.load} (${dashboard.error.code})`}
            detail={dashboard.error.message}
            onRetry={dashboard.reload}
          />
        ) : null}

        {canReports ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-label font-medium text-ink-900">{copy.panel.year}</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              <YearTile label={copy.panel.sales} href="/informes?tab=ventas" report={sales} measure="amount" polarity="up" />
              <YearTile label={copy.panel.expenses} href="/informes?tab=gastos" report={expenses} measure="amount" polarity="down" />
              <YearTile label={copy.panel.stock} href="/informes?tab=existencias" report={stock} measure="volume" polarity="neutral" />
            </div>
          </section>
        ) : null}

        {dashboard.data && !dashboard.error ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {dashboard.data.approvals ? (
              <AttentionCard title={copy.panel.approvals} href={attentionHref.approvals} block={dashboard.data.approvals} />
            ) : null}
            {dashboard.data.deadlines ? (
              <AttentionCard title={copy.panel.deadlines} href={attentionHref.deadlines} block={dashboard.data.deadlines} days />
            ) : null}
            {dashboard.data.receivables ? (
              <ReceivablesCard block={dashboard.data.receivables} />
            ) : null}
            {dashboard.data.alerts ? (
              <AttentionCard title={copy.panel.alerts} href={firstHref(dashboard.data.alerts)} block={dashboard.data.alerts} />
            ) : null}
            {dashboard.data.submissions ? (
              <AttentionCard title={copy.panel.shipments} href={attentionHref.submissions} block={dashboard.data.submissions} className="max-md:hidden" />
            ) : null}
            {dashboard.data.cellar ? (
              <AttentionCard title={copy.panel.cellar} href={attentionHref.cellar} block={dashboard.data.cellar} />
            ) : null}
            {dashboard.data.stock ? (
              <AttentionCard title={copy.panel.gaps} href={attentionHref.stock} block={dashboard.data.stock} className="max-md:hidden" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
    </div>
  )
}

function firstHref(block: AttentionBlock): string | null {
  return block.items.find((item) => item.href)?.href ?? null
}

function CountTile({
  label,
  value,
  href,
  quiet,
}: {
  label: string
  value: number | string
  href: string | null
  quiet?: boolean
}) {
  const empty = quiet ?? value === 0
  const className =
    'flex min-w-0 flex-col gap-1 rounded-[10px] border border-border-subtle bg-surface-subtle px-3 py-2.5 outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:border-border hover:bg-surface focus-visible:shadow-(--shadow-focus)'
  const body = (
    <>
      <span className="truncate text-caption text-text-tertiary">{label}</span>
      <span className={cn('truncate text-heading font-medium leading-none tabular-nums', empty ? 'text-text-tertiary' : 'text-ink-900')}>
        {typeof value === 'number' ? formatInteger(value) : value}
      </span>
    </>
  )
  if (!href) return <div className={className}>{body}</div>
  return (
    <Link to={href} className={className}>
      {body}
    </Link>
  )
}

function YearTile({
  label,
  href,
  report,
  measure,
  polarity,
}: {
  label: string
  href: string
  report: ReturnType<typeof useReport>
  measure: Measure
  polarity: 'up' | 'down' | 'neutral'
}) {
  if (report.initial) return <Skeleton className="h-16 rounded-[10px]" />
  if (!report.data) {
    return (
      <button
        type="button"
        onClick={report.reload}
        className="flex min-w-0 flex-col items-start gap-1 rounded-[10px] border border-border-subtle bg-surface-subtle px-3 py-2.5 text-left outline-none focus-visible:shadow-(--shadow-focus)"
      >
        <span className="text-caption text-text-tertiary">{label}</span>
        <span className="text-caption text-ink-900">{copy.error.retry}</span>
      </button>
    )
  }
  const value = metricNumber(report.data.totals, measure)
  const previous = metricNumber(report.data.previous_totals, measure)
  const delta = formatDelta(value, previous)
  const good = !delta || delta.direction === 0 || polarity === 'neutral' ? null : (polarity === 'up') === (delta.direction === 1)
  const spark = report.data.series.map((point) => metricNumber(point, measure))
  return (
    <Link
      to={href}
      className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-border-subtle bg-surface-subtle px-3 py-2.5 outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:border-border hover:bg-surface focus-visible:shadow-(--shadow-focus)"
    >
      <span className="truncate text-caption text-text-tertiary">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-heading font-medium leading-none tabular-nums text-ink-900" title={formatMeasure(value, measure)}>
          {formatMeasure(value, measure)}
        </span>
        {delta ? (
          <span
            className={cn(
              'flex shrink-0 items-center gap-0.5 text-caption font-medium tabular-nums',
              good == null ? 'text-text-tertiary' : good ? 'text-success-700' : 'text-danger-700',
            )}
          >
            {delta.direction === 1 ? <ArrowUp className="size-3" strokeWidth={iconStroke} /> : null}
            {delta.direction === -1 ? <ArrowDown className="size-3" strokeWidth={iconStroke} /> : null}
            {delta.text}
          </span>
        ) : null}
      </span>
      {spark.length >= 3 && spark.some((item) => item !== spark[0]) ? <Sparkline values={spark} /> : null}
    </Link>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const width = 120
  const height = 24
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * (width - 2) + 1
      const y = height - 2 - ((value - min) / span) * (height - 4)
      return `${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-6 w-full" aria-hidden>
      <polyline fill="none" stroke="var(--color-chart-ink)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  )
}

function AttentionCard({
  title,
  href,
  block,
  days = false,
  className,
}: {
  title: string
  href: string | null
  block: AttentionBlock
  days?: boolean
  className?: string
}) {
  const titleClass = 'min-w-0 truncate text-label font-medium text-ink-900 outline-none focus-visible:shadow-(--shadow-focus)'
  return (
    <section className={cn('rounded-xl bg-surface shadow-(--shadow-surface)', className)}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        {href ? (
          <Link to={href} className={titleClass}>
            {title}
          </Link>
        ) : (
          <span className={titleClass}>{title}</span>
        )}
        {block.count > 0 ? <span className="text-caption tabular-nums text-text-tertiary">{formatInteger(block.count)}</span> : null}
      </div>
      {block.items.length === 0 ? (
        <p className="border-t border-border-subtle px-4 py-3 text-label text-text-tertiary">{copy.panel.clear}</p>
      ) : (
        <ul>
          {block.items.map((item) => (
            <li key={item.id} className="border-t border-border-subtle">
              <ItemLink item={item} href={item.href ?? href} days={days} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReceivablesCard({ block }: { block: ReceivablesBlock }) {
  const buckets =
    block.buckets.length > 0
      ? block.buckets
      : [
          { key: '0-30', label: copy.panel.buckets.d30, amount: '0.00', count: 0 },
          { key: '31-60', label: copy.panel.buckets.d60, amount: '0.00', count: 0 },
          { key: '60+', label: copy.panel.buckets.d61, amount: '0.00', count: 0 },
        ]
  return (
    <section className="rounded-xl bg-surface shadow-(--shadow-surface)">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Link
          to={attentionHref.receivables}
          className="min-w-0 truncate text-label font-medium text-ink-900 outline-none focus-visible:shadow-(--shadow-focus)"
        >
          {copy.panel.overdue}
        </Link>
        {block.count > 0 ? <span className="text-caption tabular-nums text-text-tertiary">{moneyText(block.amount)}</span> : null}
      </div>
      {block.count === 0 ? (
        <p className="border-t border-border-subtle px-4 py-3 text-label text-text-tertiary">{copy.panel.clear}</p>
      ) : (
        <ul>
          {buckets.map((bucket) => (
            <li key={bucket.key} className="flex items-baseline justify-between gap-3 border-t border-border-subtle px-4 py-2.5">
              <span className="text-label text-ink-900">{bucket.label}</span>
              <span className="text-label tabular-nums text-text-secondary">
                {moneyText(bucket.amount)} · {formatInteger(bucket.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ItemLink({ item, href, days }: { item: AttentionItem; href: string | null; days: boolean }) {
  const meta = [item.detail, days && item.daysLeft != null ? fill(copy.panel.days, { days: String(item.daysLeft) }) : null]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const body = (
    <>
      <p className="truncate text-label text-ink-900">{item.title}</p>
      {meta ? <p className="truncate text-caption text-text-tertiary">{meta}</p> : null}
    </>
  )
  if (!href) return <div className="px-4 py-2.5">{body}</div>
  return (
    <Link to={href} className="block px-4 py-2.5 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)">
      {body}
    </Link>
  )
}

function moneyText(value: string): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatMoney(parsed) : value
}

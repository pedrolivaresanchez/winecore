import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, CreditCard, History, Receipt, TrendUp, Users, type IconComponent } from '@/ui/icons'
import { tagToneClass, type TagTone } from '@/ui/tag-palette'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { FitAmount, Skeleton } from '@/ui'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { formatInteger, formatMoney } from '@/lib/format'
import { useLegacyOverview, type LegacyInvoice, type LegacyOverview } from '@/lib/legacy'
import { allows } from '@/lib/permissions'
import { attentionHref, useDashboard, verifactuClock, type AttentionBlock } from '@/lib/dashboard'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'
import { ColumnChart } from '@/pages/informes/charts/column-chart'
import { SetupCard } from '@/pages/ajustes/puesta-en-marcha/SetupPanel'

const dateLabel = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
})

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function Panel({ me }: { me: Me }) {
  useChromeTitle(copy.panel.title)
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const canLegacy = allows(me, 'reports.read') || allows(me, 'finance.read') || allows(me, 'sales.read') || allows(me, 'billing.read')
  const legacy = useLegacyOverview(entity, canLegacy)
  const dashboard = useDashboard(entity)
  const pending = legacy.initial

  return (
    <div data-screen={pending ? 'panel-cargando' : 'panel'} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-3 py-5 sm:px-4 sm:py-8">
        <header>
          <p className="text-caption text-text-tertiary first-letter:uppercase">{dateLabel.format(new Date())}</p>
          <h1 className="mt-1 text-heading font-medium tracking-tight text-ink-900">{copy.panel.title}</h1>
        </header>

        <SetupCard me={me} />

        {legacy.initial ? <PanelSkeleton /> : null}
        {legacy.error ? (
          <ErrorState
            title={`${copy.error.load} (${legacy.error.code})`}
            detail={legacy.error.message}
            onRetry={legacy.reload}
          />
        ) : null}
        {legacy.data ? <HoldedHome data={legacy.data} /> : null}

        {dashboard.data?.verifactu && dashboard.data.verifactu.count > 0 ? (
          <Link to={attentionHref.verifactu} className="rounded-2xl outline-none focus-visible:shadow-(--shadow-focus)">
            <div className="rounded-2xl border border-ink-900/10 bg-warning-50 px-4 py-2.5 text-label text-warning-700">
              {dashboard.data.verifactu.count === 1
                ? fill(copy.panel.verifactuOne, { time: verifactuClock(dashboard.data.verifactu.since ?? '') })
                : fill(copy.panel.verifactu, {
                    count: formatInteger(dashboard.data.verifactu.count),
                    time: verifactuClock(dashboard.data.verifactu.since ?? ''),
                  })}
            </div>
          </Link>
        ) : null}

        <div className="flex flex-col gap-2">
          <OpsLine
            label={copy.panel.approvals}
            href={attentionHref.approvals}
            count={dashboard.data?.approvals?.count ?? 0}
            empty={copy.panel.pendingApprovals}
          />
          {dashboard.data?.deadlines && dashboard.data.deadlines.count > 0 ? (
            <OpsLine label={copy.panel.deadlines} href={attentionHref.deadlines} count={dashboard.data.deadlines.count} />
          ) : null}
          {dashboard.data?.alerts && dashboard.data.alerts.count > 0 ? (
            <OpsLine label={copy.panel.alerts} href={firstHref(dashboard.data.alerts)} count={dashboard.data.alerts.count} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HoldedHome({ data }: { data: LegacyOverview }) {
  const sales = Number(data.kpis.sales_this_year)
  const chartEmpty = data.months.every((point) => Number(point.total) === 0)
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MoneyTile
          label={copy.panel.salesYear}
          icon={TrendUp}
          tone="emerald"
          value={data.kpis.sales_this_year}
          href="/facturas"
          empty={copy.panel.noneYear}
        />
        <MoneyTile
          label={copy.panel.salesLast}
          icon={History}
          tone="sky"
          value={data.kpis.sales_last_year}
          href="/facturas"
          empty={copy.panel.noneYear}
        />
        <MoneyTile
          label={copy.panel.receivables}
          icon={CreditCard}
          tone="blue"
          value={data.kpis.pending_receivables}
          href="/cobros"
          count={data.kpis.pending_receivables_count}
          empty={copy.panel.noneReceivables}
        />
        <CountTile
          label={copy.panel.contacts}
          icon={Users}
          tone="violet"
          value={data.kpis.contacts}
          href="/contactos"
          empty={copy.panel.noneContacts}
        />
        <MoneyTile
          label={copy.panel.payables}
          icon={Briefcase}
          tone="amber"
          value={data.kpis.open_payables}
          href="/gastos"
          count={data.kpis.open_payables_count}
          empty={copy.panel.nonePayables}
        />
      </div>

      <section className="rounded-xl bg-surface px-4 py-3 shadow-(--shadow-surface)">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-label font-medium text-ink-900">{copy.panel.chart}</h2>
          <Link to="/informes?tab=ventas" className="text-caption text-text-tertiary outline-none hover:text-ink-900 focus-visible:shadow-(--shadow-focus)">
            {copy.nav.reports}
          </Link>
        </div>
        {chartEmpty ? (
          <p className="py-3 text-label text-text-tertiary">{data.has_imported ? copy.panel.noneYear : copy.panel.noneImported}</p>
        ) : (
          <ColumnChart
            height={180}
            color="var(--color-ink-900)"
            label={copy.panel.chart}
            currentLabel={String(data.year)}
            previousLabel={copy.informes.previous}
            formatValue={(value) => formatMoney(value)}
            points={data.months.map((point) => ({
              key: String(point.month),
              label: MONTHS[point.month - 1] ?? String(point.month),
              axis: (MONTHS[point.month - 1] ?? '').slice(0, 1),
              value: Number(point.total),
              previous: null,
            }))}
          />
        )}
        {sales === 0 ? null : <p className="sr-only">{copy.panel.holdedHint}</p>}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <RecordCard title={copy.panel.recentInvoices} icon={Receipt} tone="emerald" href="/facturas" empty={data.recent_invoices.length === 0 ? copy.panel.noneInvoices : null}>
          {data.recent_invoices.map((invoice) => (
            <li key={invoice.id} className="border-t border-border-subtle">
              <Link to={`/facturas?q=${encodeURIComponent(invoice.number)}`} className="block px-4 py-2.5 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)">
                <InvoiceLine invoice={invoice} />
              </Link>
            </li>
          ))}
        </RecordCard>
        <RecordCard title={copy.panel.topCustomers} icon={Users} tone="violet" href="/contactos" empty={data.top_customers.length === 0 ? copy.panel.noneCustomers : null}>
          {data.top_customers.map((customer) => (
            <li key={customer.name} className="border-t border-border-subtle">
              <Link
                to={`/contactos?q=${encodeURIComponent(customer.name)}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
              >
                <span className="min-w-0 truncate text-label text-ink-900">{customer.name}</span>
                <span className="shrink-0 text-label tabular-nums text-text-secondary">{formatMoney(Number(customer.total))}</span>
              </Link>
            </li>
          ))}
        </RecordCard>
      </div>
    </>
  )
}

function InvoiceLine({ invoice }: { invoice: LegacyInvoice }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-label text-ink-900">
          {invoice.number} · {invoice.counterparty_name}
        </p>
        <p className="truncate text-caption text-text-tertiary">
          {formatDate(invoice.issue_date)} · {invoice.status_holded}
        </p>
      </div>
      <span className="shrink-0 text-label tabular-nums text-ink-900">{formatMoney(Number(invoice.total))}</span>
    </div>
  )
}

type Accent = { icon: IconComponent; tone: TagTone }

function TileHead({ label, icon: Icon, tone }: { label: string } & Accent) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn(tagToneClass(tone), 'tag inline-flex size-6 shrink-0 items-center justify-center rounded-lg')}>
        <Icon className="size-3.5" strokeWidth={iconStroke} />
      </span>
      <span className="truncate text-caption text-text-tertiary">{label}</span>
    </span>
  )
}

function MoneyTile({
  label,
  icon,
  tone,
  value,
  href,
  count,
  empty,
}: {
  label: string
  value: string
  href: string
  count?: number
  empty: string
} & Accent) {
  const amount = Number(value)
  const quiet = !Number.isFinite(amount) || amount === 0
  return (
    <Link to={href} className={cn(tagToneClass(tone), tileClass)}>
      <TileHead label={label} icon={icon} tone={tone} />
      <FitAmount
        full={formatMoney(Number.isFinite(amount) ? amount : 0)}
        short={formatMoney(Number.isFinite(amount) ? amount : 0)}
        className={cn('w-full text-heading font-medium leading-none tabular-nums', quiet ? 'text-text-tertiary' : 'text-ink-900')}
      />
      {quiet || (count != null && count > 0) ? (
        <span className="truncate text-caption text-text-tertiary">{quiet ? empty : formatInteger(count ?? 0)}</span>
      ) : null}
    </Link>
  )
}

function CountTile({
  label,
  icon,
  tone,
  value,
  href,
  empty,
}: { label: string; value: number; href: string; empty: string } & Accent) {
  const quiet = value === 0
  return (
    <Link to={href} className={cn(tagToneClass(tone), tileClass)}>
      <TileHead label={label} icon={icon} tone={tone} />
      <span className={cn('text-heading font-medium leading-none tabular-nums', quiet ? 'text-text-tertiary' : 'text-ink-900')}>
        {formatInteger(value)}
      </span>
      {quiet ? <span className="truncate text-caption text-text-tertiary">{empty}</span> : null}
    </Link>
  )
}

function RecordCard({
  title,
  icon: Icon,
  tone,
  href,
  empty,
  children,
}: {
  title: string
  href: string
  empty: string | null
  children: ReactNode
} & Accent) {
  return (
    <section className="rounded-xl bg-surface shadow-(--shadow-surface)">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Link
          to={href}
          className="flex min-w-0 items-center gap-2 text-label font-medium text-ink-900 outline-none focus-visible:shadow-(--shadow-focus)"
        >
          <Icon aria-hidden className={cn(tagToneClass(tone), 'size-4 shrink-0 text-(--tag-dot-0)')} strokeWidth={iconStroke} />
          <span className="truncate">{title}</span>
        </Link>
      </div>
      {empty ? <p className="border-t border-border-subtle px-4 py-3 text-label text-text-tertiary">{empty}</p> : <ul>{children}</ul>}
    </section>
  )
}

function OpsLine({ label, href, count, empty }: { label: string; href: string | null; count: number; empty?: string }) {
  const body = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-text-tertiary">{count > 0 ? formatInteger(count) : empty}</span>
    </>
  )
  const className = 'flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-2.5 text-label text-ink-900 shadow-(--shadow-surface) outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)'
  if (!href) return <div className={className}>{body}</div>
  return (
    <Link to={href} className={className}>
      {body}
    </Link>
  )
}

function firstHref(block: AttentionBlock): string | null {
  return block.items.find((item) => item.href)?.href ?? null
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

/** A faint wash of the tile's tone from the top-left, so five figures are five subjects at a glance. */
const tileClass =
  'flex min-w-0 flex-col gap-2 rounded-2xl border border-border-subtle bg-surface bg-linear-to-br from-(--tag-bg-0)/45 via-surface to-surface px-3 py-2.5 outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:border-(--tag-dot-0)/40 focus-visible:shadow-(--shadow-focus)'

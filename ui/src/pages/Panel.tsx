import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Check, FileText, Users, type IconComponent } from '@/ui/icons'
import { ObjectGlyph, type GlyphTint } from '@/ui/object-glyph'
import { CHART_INK, ChartEmpty, ColumnChart, StatTile, chartModel, seriesColor } from '@/ui/charts'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { FitAmount, Skeleton } from '@/ui'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatCompact, formatInteger, formatMoney } from '@/lib/format'
import { useLegacyOverview, type LegacyOverview } from '@/lib/legacy'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import { attentionHref, useDashboard, verifactuClock, type AttentionBlock, type Dashboard } from '@/lib/dashboard'
import { entityFilter } from '@/lib/reports'
import type { Me } from '@/lib/types'

const dateLabel = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
})

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const LIST_LIMIT = 5

const ROW = 'flex items-center justify-between gap-3 px-4 py-2.5'
const ROW_LINK = cn(ROW, 'outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)')

export function Panel({ me }: { me: Me }) {
  useChromeTitle(copy.panel.title)
  const { filter } = useEntity()
  const entity = entityFilter(filter)
  const canLegacy = allows(me, 'reports.read') || allows(me, 'finance.read') || allows(me, 'sales.read') || allows(me, 'billing.read')
  const legacy = useLegacyOverview('both', canLegacy)
  const dashboard = useDashboard(entity)
  const pending = legacy.initial
  const context = legacy.data ? fill(copy.panel.exercise, { year: String(legacy.data.year) }) : copy.panel.title

  return (
    <div data-screen={pending ? 'panel-cargando' : 'panel'} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-5 sm:px-6 sm:py-7">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-2">
          <div className="min-w-0">
            <p className="text-caption text-text-tertiary first-letter:uppercase">{dateLabel.format(new Date())}</p>
            <h1 className="mt-1 text-heading font-medium tracking-tight text-ink-900">{copy.panel.title}</h1>
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-label text-text-secondary">
            <Calendar className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
            <span className="truncate">{context}</span>
          </p>
        </header>

        {legacy.initial ? <PanelSkeleton /> : null}
        {legacy.error ? (
          <ErrorState
            title={`${copy.error.load} (${legacy.error.code})`}
            detail={legacy.error.message}
            onRetry={legacy.reload}
          />
        ) : null}
        {legacy.data ? (
          <HoldedHome data={legacy.data} attention={<AttentionCard data={dashboard.data} failed={dashboard.error != null} className="md:col-span-2 lg:col-span-3" />} />
        ) : legacy.initial ? null : (
          <div className="grid gap-4 lg:grid-cols-12">
            <AttentionCard data={dashboard.data} failed={dashboard.error != null} className="lg:col-span-5" />
          </div>
        )}
      </div>
    </div>
  )
}

type CompanyCode = 'PO' | 'CVPO'

function companiesOf(entity: LegacyOverview['entity']): CompanyCode[] {
  if (entity === 'PO') return ['PO']
  if (entity === 'CVPO') return ['CVPO']
  return ['PO', 'CVPO']
}

function companyLabel(code: CompanyCode): string {
  return code === 'PO' ? copy.panel.companyPo : copy.panel.companyCvpo
}

function HoldedHome({ data, attention }: { data: LegacyOverview; attention: ReactNode }) {
  const companies = companiesOf(data.entity)
  const lastYear = data.year - 1
  const chartEmpty = data.months.every((point) => companies.every((code) => Number(point[code]) === 0))
  const invoices = data.recent_invoices.slice(0, LIST_LIMIT)
  const customers = data.top_customers.slice(0, LIST_LIMIT)
  const series = companies.map((code, index) => ({
    key: code,
    label: companyLabel(code),
    color: index === 0 ? CHART_INK : seriesColor(1),
    type: 'currency' as const,
  }))
  const model = chartModel({
    categoryLabel: copy.panel.chart,
    measureType: 'currency',
    temporal: true,
    format: (value) => formatMoney(value),
    series,
    categories: data.months.map((point) => {
      const values = companies.map((code) => Number(point[code]) || 0)
      return {
        key: String(point.month),
        label: MONTHS[point.month - 1] ?? String(point.month),
        values,
        total: values.reduce((sum, value) => sum + value, 0),
      }
    }),
  })
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {companies.map((code) => (
          <MoneyTile
            key={`year-${code}`}
            label={fill(copy.panel.salesCompany, { year: String(data.year), company: companyLabel(code) })}
            value={data.kpis.sales_this_year[code]}
            href={`/facturas?entity=${code}`}
            empty={copy.panel.noneYear}
            spark={data.months.map((point) => Number(point[code]) || 0)}
          />
        ))}
        {companies.map((code) => (
          <MoneyTile
            key={`last-${code}`}
            label={fill(copy.panel.salesCompany, { year: String(lastYear), company: companyLabel(code) })}
            value={data.kpis.sales_last_year[code]}
            href={`/facturas?entity=${code}`}
            empty={copy.panel.noneYear}
          />
        ))}
        {companies.map((code) => (
          <MoneyTile
            key={`due-${code}`}
            label={fill(copy.panel.receivablesCompany, { company: companyLabel(code) })}
            value={data.kpis.pending_receivables[code]}
            href={`/cobros?entity=${code}`}
            count={data.kpis.pending_receivables_count[code]}
            empty={copy.panel.noneReceivables}
          />
        ))}
        <MoneyTile
          label={copy.panel.payables}
          value={data.kpis.open_payables}
          href="/gastos"
          count={data.kpis.open_payables_count}
          empty={copy.panel.nonePayables}
        />
        <StatTile
          label={copy.panel.contacts}
          value={data.kpis.contacts}
          formatted={formatInteger(data.kpis.contacts)}
          href="/contactos"
          hint={data.kpis.contacts === 0 ? copy.panel.noneContacts : undefined}
        />
      </div>

      <PanelCard title={copy.panel.chart} href="/informes?tab=ventas" more={copy.panel.seeReport}>
        <div className="px-4 pb-4">
          {chartEmpty ? (
            <ChartEmpty height={220} message={copy.panel.noneYear} />
          ) : (
            <ColumnChart model={model} height={220} subtitle={String(data.year)} />
          )}
        </div>
      </PanelCard>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <PanelCard
          className="lg:col-span-5"
          title={copy.panel.recentInvoices}
          icon={FileText}
          tint="info"
          href="/facturas"
          more={copy.panel.seeAll}
        >
          <CardList empty={invoices.length === 0 ? copy.panel.noneInvoices : null}>
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link to={`/facturas?q=${encodeURIComponent(invoice.number)}`} className={ROW_LINK}>
                  <RowBody
                    title={invoice.counterparty_name}
                    detail={`${companyLabel(invoice.entity_code === 'CVPO' ? 'CVPO' : 'PO')} · ${invoice.number} · ${formatDate(invoice.issue_date)} · ${invoice.status_holded}`}
                    value={formatMoney(Number(invoice.total))}
                  />
                </Link>
              </li>
            ))}
          </CardList>
        </PanelCard>
        <PanelCard className="lg:col-span-4" title={copy.panel.topCustomers} icon={Users} tint="flame" href="/contactos" more={copy.panel.seeAll}>
          <CardList empty={customers.length === 0 ? copy.panel.noneCustomers : null}>
            {customers.map((customer) => (
              <li key={customer.name}>
                <Link to={`/contactos?q=${encodeURIComponent(customer.name)}`} className={ROW_LINK}>
                  <RowBody
                    title={customer.name}
                    detail={customer.invoices === 1 ? copy.panel.invoiceOne : fill(copy.panel.invoiceMany, { count: formatInteger(customer.invoices) })}
                    value={formatMoney(Number(customer.total))}
                  />
                </Link>
              </li>
            ))}
          </CardList>
        </PanelCard>
        {attention}
      </div>
    </>
  )
}

type AttentionRow = { id: string; label: string; href: string | null; count: number; hint: string; warn?: boolean }

function attentionRows(data: Dashboard): AttentionRow[] {
  const rows: AttentionRow[] = [
    {
      id: 'approvals',
      label: copy.panel.approvals,
      href: attentionHref.approvals,
      count: data.approvals?.count ?? 0,
      hint: leadOf(data.approvals) ?? copy.panel.pendingApprovals,
    },
  ]
  if (data.deadlines) {
    rows.push({
      id: 'deadlines',
      label: copy.panel.deadlines,
      href: attentionHref.deadlines,
      count: data.deadlines.count,
      hint: leadOf(data.deadlines) ?? copy.panel.noneDeadlines,
    })
  }
  if (data.alerts) {
    rows.push({
      id: 'alerts',
      label: copy.panel.alerts,
      href: firstHref(data.alerts),
      count: data.alerts.count,
      hint: leadOf(data.alerts) ?? copy.panel.noneAlerts,
      warn: true,
    })
  }
  if (data.verifactu) {
    const { count, since } = data.verifactu
    rows.push({
      id: 'verifactu',
      label: copy.panel.verifactuLabel,
      href: attentionHref.verifactu,
      count,
      hint: count === 0 ? copy.panel.verifactuClear : since ? fill(copy.panel.verifactuSince, { time: verifactuClock(since) }) : copy.panel.verifactuWaiting,
      warn: true,
    })
  }
  return rows
}

function leadOf(block: AttentionBlock | null): string | null {
  const first = block?.items[0]
  if (!block || block.count === 0 || !first) return null
  if (first.daysLeft == null) return first.title
  return `${first.title} · ${first.daysLeft < 0 ? copy.panel.overdue : fill(copy.panel.days, { days: String(first.daysLeft) })}`
}

function AttentionCard({ data, failed, className }: { data: Dashboard | null; failed: boolean; className?: string }) {
  return (
    <PanelCard className={className} title={copy.panel.attention} icon={Check} tint="slate">
      {data ? (
        <CardList empty={null}>
          {attentionRows(data).map((row) => {
            const body = (
              <RowBody
                title={row.label}
                detail={row.hint}
                value={formatInteger(row.count)}
                valueClass={cn('font-medium', row.count === 0 ? 'text-text-tertiary' : row.warn ? 'text-warning-700' : 'text-ink-900')}
              />
            )
            return (
              <li key={row.id}>
                {row.href ? (
                  <Link to={row.href} className={ROW_LINK}>
                    {body}
                  </Link>
                ) : (
                  <div className={ROW}>{body}</div>
                )}
              </li>
            )
          })}
        </CardList>
      ) : (
        <CardList empty={failed ? copy.error.load : null}>
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} aria-busy="true" className={ROW}>
              <Skeleton className="h-8 w-full rounded-md" />
            </li>
          ))}
        </CardList>
      )}
    </PanelCard>
  )
}

function PanelCard({
  title,
  icon,
  tint,
  href,
  more,
  className,
  children,
}: {
  title: string
  icon?: IconComponent
  tint?: GlyphTint
  href?: string
  more?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-border-subtle bg-surface', className)}>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 px-4">
        <h2 className="flex min-w-0 items-center gap-2 text-label font-medium text-ink-900">
          {icon ? <ObjectGlyph icon={icon} tint={tint} size="md" /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {href && more ? (
          <Link
            to={href}
            className="shrink-0 rounded-md text-caption text-text-tertiary outline-none max-sm:-my-3 max-sm:py-3 transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
          >
            {more}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function CardList({ empty, children }: { empty: string | null; children: ReactNode }) {
  if (empty) {
    return <p className="flex flex-1 items-center justify-center border-t border-border-subtle px-4 py-8 text-center text-label text-text-tertiary">{empty}</p>
  }
  return <ul className="divide-y divide-border-subtle border-t border-border-subtle">{children}</ul>
}

function RowBody({ title, detail, value, valueClass }: { title: string; detail: string; value: string; valueClass?: string }) {
  return (
    <>
      <span className="min-w-0">
        <span className="block truncate text-label text-ink-900">{title}</span>
        <span className="block truncate text-caption text-text-tertiary">{detail}</span>
      </span>
      <span className={cn('shrink-0 text-label tabular-nums text-ink-900', valueClass)}>{value}</span>
    </>
  )
}

function MoneyTile({
  label,
  value,
  href,
  count,
  empty,
  spark,
  className,
}: {
  label: string
  value: string
  href: string
  count?: number
  empty: string
  spark?: number[]
  className?: string
}) {
  const amount = Number(value)
  const safe = Number.isFinite(amount) ? amount : 0
  const quiet = safe === 0
  return (
    <StatTile
      className={className}
      label={label}
      value={safe}
      type="currency"
      formatted={<FitAmount full={formatMoney(safe)} short={formatCompact(safe, '€')} className="w-full" />}
      href={href}
      spark={quiet ? undefined : spark}
      hint={quiet ? empty : count != null && count > 0 ? dueLabel(count) : undefined}
    />
  )
}

function dueLabel(count: number): string {
  return count === 1 ? copy.panel.dueOne : fill(copy.panel.dueMany, { count: formatInteger(count) })
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
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-[10px]" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-[10px]" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <Skeleton className="h-72 rounded-[10px] lg:col-span-5" />
        <Skeleton className="h-72 rounded-[10px] lg:col-span-4" />
        <Skeleton className="h-72 rounded-[10px] md:col-span-2 lg:col-span-3" />
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, FileText, Receipt, Storefront, type IconComponent } from '@/ui/icons'
import { ObjectGlyph, type GlyphTint } from '@/ui/object-glyph'
import { Badge, Button, EmptyState, FitAmount, InfoTip, Skeleton, SkeletonRows } from '@/ui'
import { CHART_INK, ChartEmpty, ColumnChart, StatTile, chartModel } from '@/ui/charts'
import { AuditTrail } from '@/components/AuditTrail'
import { ErrorState } from '@/components/ErrorState'
import type { ApiError } from '@/lib/api'
import type { AuditEvent } from '@/lib/contacts'
import { copy, fill } from '@/i18n'
import { formatCompact, formatDate, formatInteger, formatMoney } from '@/lib/format'
import { paymentLabel } from '@/lib/contacts'
import { cn } from '@/lib/cn'
import {
  INVOICE_STATE,
  amount,
  invoiceDoc,
  monthLabel,
  paymentHref,
  salesDoc,
  salesHref,
  salesStatusLabel,
  type ContactOverview,
  type OverviewPayment,
  type OverviewReceivable,
  type OverviewSalesDoc,
} from '@/pages/contactos/overview'
import { docKey, type RecordDoc } from '@/pages/documents/doc-key'
import { useDocParam } from '@/pages/documents/use-doc-param'
import { DocRow, InvoiceRow, RowList, Section, SourceMark } from '@/pages/contactos/record-ui'

export type OverviewState = {
  data: ContactOverview | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

type TabId = 'facturas' | 'cobros' | 'ventas'

export function SummaryTab({ overview, onTab }: { overview: OverviewState; onTab: (tab: TabId) => void }) {
  return (
    <Loaded overview={overview} skeleton={<SummarySkeleton />}>
      {(data) => {
        const invoices = data.invoices
        const receivables = data.receivables
        const kpis = invoices?.kpis
        const ytd = amount(kpis?.invoiced_ytd)
        const prior = amount(kpis?.invoiced_prior_ytd)
        const months = invoices?.months ?? []
        const chartEmpty = months.every((point) => amount(point.total) === 0)
        const model = chartModel({
          categoryLabel: copy.contactRecord.chart,
          measureType: 'currency',
          temporal: true,
          format: (value) => formatMoney(value),
          series: [{ key: 'sales', label: copy.contactRecord.chart, color: CHART_INK, type: 'currency' }],
          categories: months.map((point) => ({
            key: point.month,
            label: monthLabel(point.month),
            values: [amount(point.total)],
            total: amount(point.total),
          })),
        })
        return (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @[84rem]:grid-cols-6">
              {kpis ? (
                <StatTile
                  className="col-span-2"
                  label={fill(copy.contactRecord.invoicedYear, { year: String(data.year) })}
                  value={ytd}
                  type="currency"
                  formatted={<Money value={ytd} />}
                  previous={prior > 0 ? prior : null}
                  previousText={fill(copy.contactRecord.vsLastYear, { year: String(data.year - 1) })}
                  polarity="up-good"
                  spark={ytd > 0 ? months.map((point) => amount(point.total)) : undefined}
                  explain={copy.contactRecord.invoicedYearHelp}
                />
              ) : null}
              {receivables ? (
                <StatTile
                  label={copy.contactRecord.pending}
                  value={amount(receivables.total)}
                  type="currency"
                  formatted={<Money value={amount(receivables.total)} />}
                  onClick={() => onTab('cobros')}
                  hint={
                    amount(receivables.overdue) > 0 ? (
                      <span className="text-danger-600">{fill(copy.contactRecord.overdue, { amount: formatMoney(amount(receivables.overdue)) })}</span>
                    ) : receivables.count === 0 ? (
                      copy.contactRecord.noReceivables
                    ) : undefined
                  }
                />
              ) : null}
              {kpis ? (
                <>
                  <StatTile
                    label={copy.contactRecord.invoiceCount}
                    value={kpis.invoice_count}
                    formatted={formatInteger(kpis.invoice_count)}
                    onClick={() => onTab('facturas')}
                    hint={kpis.first_invoice_date ? fill(copy.contactRecord.since, { date: formatDate(kpis.first_invoice_date) }) : undefined}
                  />
                  <StatTile
                    label={copy.contactRecord.averageTicket}
                    value={amount(kpis.average_ticket)}
                    type="currency"
                    formatted={kpis.average_ticket ? <Money value={amount(kpis.average_ticket)} /> : '—'}
                    hint={fill(copy.contactRecord.totalHint, { amount: formatMoney(amount(kpis.invoiced_total)) })}
                  />
                  <StatTile
                    label={copy.contactRecord.lastInvoice}
                    value={0}
                    formatted={kpis.last_invoice_date ? formatDate(kpis.last_invoice_date) : '—'}
                  />
                </>
              ) : null}
            </div>

            {invoices ? (
              <Section title={copy.contactRecord.chart} meta={copy.contactRecord.last12}>
                {chartEmpty ? (
                  <ChartEmpty height={180} message={copy.contactRecord.chartEmpty} />
                ) : (
                  <ColumnChart model={model} height={180} />
                )}
              </Section>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-2">
              {invoices ? (
                <Section
                  title={copy.contactRecord.recentInvoices}
                  action={
                    invoices.items.length > 5 ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onTab('facturas')}>
                        {copy.contactRecord.seeAll}
                      </Button>
                    ) : undefined
                  }
                >
                  {invoices.items.length === 0 ? (
                    <Quiet title={copy.contactRecord.noInvoices} line={copy.contactRecord.noInvoicesHint} />
                  ) : (
                    <RowList>
                      {invoices.items.slice(0, 5).map((invoice) => (
                        <InvoiceRow key={`${invoice.source}-${invoice.id}`} invoice={invoice} />
                      ))}
                    </RowList>
                  )}
                </Section>
              ) : null}
              {receivables ? (
                <Section
                  title={copy.contactRecord.openItems}
                  meta={receivables.count > 0 ? formatMoney(amount(receivables.total)) : undefined}
                  action={
                    receivables.count > 5 ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onTab('cobros')}>
                        {copy.contactRecord.seeAll}
                      </Button>
                    ) : undefined
                  }
                >
                  {receivables.items.length === 0 ? (
                    <Quiet title={copy.contactRecord.noReceivables} line={copy.contactRecord.noReceivablesHint} />
                  ) : (
                    <RowList>
                      {receivables.items.slice(0, 5).map((item) => (
                        <ReceivableRow key={`${item.source}-${item.id}`} item={item} />
                      ))}
                    </RowList>
                  )}
                </Section>
              ) : null}
            </div>
            {!invoices && !receivables ? <NoAccess /> : null}
          </div>
        )
      }}
    </Loaded>
  )
}

export function InvoicesTab({ overview, contactId, newInvoice }: { overview: OverviewState; contactId: string; newInvoice: (() => void) | null }) {
  return (
    <Loaded overview={overview} skeleton={<SkeletonRows rows={6} />}>
      {(data) => {
        const invoices = data.invoices
        if (!invoices) return <NoAccess />
        if (invoices.items.length === 0) {
          return (
            <EmptyState
              size="sm"
              title={copy.contactRecord.noInvoices}
              description={copy.contactRecord.noInvoicesHint}
              action={
                newInvoice ? (
                  <Button type="button" variant="primary" size="sm" onClick={newInvoice}>
                    {copy.contactRecord.newInvoice}
                  </Button>
                ) : undefined
              }
            />
          )
        }
        const byName = invoices.items.some((item) => item.linked_by === 'name')
        return (
          <Section
            title={copy.contactRecord.invoices}
            meta={
              <span className="inline-flex items-center gap-1">
                {formatInteger(invoices.total_count)} · {formatMoney(amount(invoices.kpis.invoiced_total))}
                {byName ? <InfoTip label={copy.contactRecord.byName}>{copy.contactRecord.byNameHelp}</InfoTip> : null}
              </span>
            }
            action={
              <Link
                to={`/facturas?customer=${contactId}`}
                className="rounded-md px-1.5 py-1 text-caption text-text-tertiary outline-none hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
              >
                {copy.contactRecord.inInvoices}
              </Link>
            }
          >
            <RowList>
              {invoices.items.map((invoice) => (
                <InvoiceRow key={`${invoice.source}-${invoice.id}`} invoice={invoice} />
              ))}
            </RowList>
          </Section>
        )
      }}
    </Loaded>
  )
}

export function CollectionsTab({ overview }: { overview: OverviewState }) {
  return (
    <Loaded overview={overview} skeleton={<SkeletonRows rows={6} />}>
      {(data) => {
        const receivables = data.receivables
        const payments = data.payments
        if (!receivables || !payments) return <NoAccess />
        return (
          <div className="flex flex-col gap-5">
            <Section
              title={copy.contactRecord.openItems}
              meta={
                receivables.count > 0
                  ? [
                      formatMoney(amount(receivables.total)),
                      amount(receivables.overdue) > 0 ? fill(copy.contactRecord.overdue, { amount: formatMoney(amount(receivables.overdue)) }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined
              }
            >
              {receivables.items.length === 0 ? (
                <Quiet title={copy.contactRecord.noReceivables} line={copy.contactRecord.noReceivablesHint} />
              ) : (
                <RowList>
                  {receivables.items.map((item) => (
                    <ReceivableRow key={`${item.source}-${item.id}`} item={item} />
                  ))}
                </RowList>
              )}
            </Section>
            <Section title={copy.contactRecord.paid} meta={payments.count > 0 ? formatMoney(amount(payments.total)) : undefined}>
              {payments.items.length === 0 ? (
                <Quiet title={copy.contactRecord.noPayments} line={copy.contactRecord.noPaymentsHint} />
              ) : (
                <RowList>
                  {payments.items.map((item) => (
                    <PaymentRow key={`${item.source}-${item.id}`} item={item} />
                  ))}
                </RowList>
              )}
            </Section>
          </div>
        )
      }}
    </Loaded>
  )
}

export function SalesTab({ overview, newQuote }: { overview: OverviewState; newQuote: (() => void) | null }) {
  return (
    <Loaded overview={overview} skeleton={<SkeletonRows rows={6} />}>
      {(data) => {
        const sales = data.sales
        if (!sales) return <NoAccess />
        const empty = sales.quotes.length === 0 && sales.orders.length === 0 && sales.delivery_notes.length === 0
        if (empty) {
          return (
            <EmptyState
              size="sm"
              title={copy.contactRecord.noSales}
              description={copy.contactRecord.noSalesHint}
              action={
                newQuote ? (
                  <Button type="button" variant="primary" size="sm" onClick={newQuote}>
                    {copy.contactRecord.newQuote}
                  </Button>
                ) : undefined
              }
            />
          )
        }
        return (
          <div className="flex flex-col gap-5">
            <SalesSection title={copy.contactRecord.quotes} kind="quote" items={sales.quotes} />
            <SalesSection title={copy.contactRecord.orders} kind="order" items={sales.orders} />
            <SalesSection title={copy.contactRecord.deliveries} kind="delivery" items={sales.delivery_notes} />
          </div>
        )
      }}
    </Loaded>
  )
}

type TimelineEntry = { key: string; date: string; icon: IconComponent; tint: GlyphTint; title: string; meta: string; href: string | null; doc: RecordDoc | null }

export function ActivityTab({
  overview,
  audit,
}: {
  overview: OverviewState
  audit: { items: AuditEvent[]; loading: boolean; error: ApiError | null; reload: () => void } | null
}) {
  const docs = useDocParam()
  return (
    <Loaded overview={overview} skeleton={<SkeletonRows rows={6} />}>
      {(data) => {
        const entries = timelineOf(data).slice(0, 40)
        return (
          <div className="flex flex-col gap-5">
            <Section title={copy.contactRecord.documents}>
              {entries.length === 0 ? (
                <Quiet title={copy.contactRecord.noActivity} line={copy.contactRecord.noActivityHint} />
              ) : (
                <ol className="relative flex flex-col">
                  {entries.map((entry, index) => (
                    <li key={entry.key} className="relative flex gap-3 pb-3 last:pb-0">
                      {index < entries.length - 1 ? <span aria-hidden className="absolute top-5 bottom-0 left-2 w-px bg-border-subtle" /> : null}
                      <ObjectGlyph icon={entry.icon} tint={entry.tint} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        {entry.doc || entry.href ? (
                          <Link
                            to={entry.doc ? docs.hrefFor(docKey(entry.doc)) : (entry.href ?? '')}
                            state={entry.doc ? { docModal: true } : undefined}
                            className="block truncate rounded-sm text-label text-ink-900 outline-none hover:underline focus-visible:shadow-(--shadow-focus)"
                          >
                            {entry.title}
                          </Link>
                        ) : (
                          <p className="truncate text-label text-ink-900">{entry.title}</p>
                        )}
                        <p className="truncate text-caption text-text-tertiary">{entry.meta}</p>
                      </div>
                      <span className="shrink-0 text-caption tabular-nums text-text-tertiary">{formatDate(entry.date)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            {audit ? (
              <Section title={copy.contactRecord.changes}>
                <AuditTrail
                  items={audit.items}
                  loading={audit.loading}
                  error={audit.error ? `${copy.error.load} (${audit.error.code})` : undefined}
                  onRetry={audit.reload}
                />
              </Section>
            ) : null}
          </div>
        )
      }}
    </Loaded>
  )
}

function timelineOf(data: ContactOverview): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const invoice of data.invoices?.items ?? []) {
    if (!invoice.issue_date) continue
    entries.push({
      key: `invoice-${invoice.source}-${invoice.id}`,
      date: invoice.issue_date,
      icon: Receipt,
      tint: 'info',
      title: `${copy.contactRecord.invoice} ${invoice.number ?? ''}`.trim(),
      meta: [formatMoney(amount(invoice.total)), invoice.source === 'holded' ? copy.contactRecord.holded : null].filter(Boolean).join(' · '),
      href: null,
      doc: invoiceDoc(invoice),
    })
  }
  for (const payment of data.payments?.items ?? []) {
    const date = payment.date ?? payment.document_date
    if (!date) continue
    entries.push({
      key: `payment-${payment.source}-${payment.id}`,
      date,
      icon: CreditCard,
      tint: 'success',
      title: `${copy.contactRecord.paid} ${formatMoney(amount(payment.amount))}`,
      meta: [payment.documents.join(', '), payment.method ? paymentLabel(payment.method) : null].filter(Boolean).join(' · '),
      href: null,
      doc: null,
    })
  }
  const sales = data.sales
  const add = (items: OverviewSalesDoc[], kind: 'quote' | 'order' | 'delivery', label: string, icon: IconComponent, tint: GlyphTint) => {
    for (const doc of items) {
      if (!doc.date) continue
      entries.push({
        key: `${kind}-${doc.source}-${doc.id}`,
        date: doc.date,
        icon,
        tint,
        title: `${label} ${doc.number ?? ''}`.trim(),
        meta: [salesStatusLabel(doc.status), doc.total ? formatMoney(amount(doc.total)) : null].filter(Boolean).join(' · '),
        href: salesHref(kind, doc),
        doc: salesDoc(kind, doc),
      })
    }
  }
  if (sales) {
    add(sales.quotes, 'quote', copy.contactRecord.quote, FileText, 'purple')
    add(sales.orders, 'order', copy.contactRecord.order, Storefront, 'warning')
    add(sales.delivery_notes, 'delivery', copy.contactRecord.delivery, FileText, 'slate')
  }
  return entries.sort((left, right) => right.date.localeCompare(left.date))
}

function SalesSection({ title, kind, items }: { title: string; kind: 'quote' | 'order' | 'delivery'; items: OverviewSalesDoc[] }) {
  if (items.length === 0) return null
  return (
    <Section title={title} meta={formatInteger(items.length)}>
      <RowList>
        {items.map((doc) => (
          <DocRow
            key={`${doc.source}-${doc.id}`}
            href={salesHref(kind, doc)}
            doc={salesDoc(kind, doc)}
            title={
              <>
                <span className="truncate font-medium">{doc.number ?? salesStatusLabel(doc.status)}</span>
                <SourceMark source={doc.source} />
              </>
            }
            meta={doc.date ? formatDate(doc.date) : copy.contactRecord.dateMissing}
            value={doc.total ? formatMoney(amount(doc.total)) : '—'}
            badge={
              <Badge size="sm" variant="dot" tone="neutral">
                {salesStatusLabel(doc.status)}
              </Badge>
            }
          />
        ))}
      </RowList>
    </Section>
  )
}

function ReceivableRow({ item }: { item: OverviewReceivable }) {
  return (
    <DocRow
      doc={invoiceDoc({ source: item.source, id: item.invoice_id })}
      title={
        <>
          <span className="truncate font-medium">{item.number ?? '—'}</span>
          <SourceMark source={item.source} />
        </>
      }
      meta={[
        item.due_date ? fill(copy.contactRecord.dueOn, { date: formatDate(item.due_date) }) : item.issue_date ? formatDate(item.issue_date) : null,
        item.entity_code,
        item.linked_by === 'name' ? copy.contactRecord.byName.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      value={formatMoney(amount(item.outstanding))}
      badge={
        item.is_overdue ? (
          <Badge size="sm" variant="dot" tone="danger">
            {fill(copy.contactRecord.daysOverdue, { days: String(item.days_overdue) })}
          </Badge>
        ) : (
          <Badge size="sm" variant="dot" tone={INVOICE_STATE.pending.tone}>
            {INVOICE_STATE.pending.label}
          </Badge>
        )
      }
    />
  )
}

function PaymentRow({ item }: { item: OverviewPayment }) {
  const number = item.documents[0] ?? null
  return (
    <DocRow
      href={item.source === 'holded' ? paymentHref(number) : null}
      title={
        <>
          <span className="truncate font-medium">{item.documents.join(', ') || paymentLabel(item.method)}</span>
          <SourceMark source={item.source} />
        </>
      }
      meta={[item.date ? formatDate(item.date) : copy.contactRecord.dateMissing, item.method ? paymentLabel(item.method) : null, item.reference, item.entity_code]
        .filter(Boolean)
        .join(' · ')}
      value={formatMoney(amount(item.amount))}
    />
  )
}

function Loaded({
  overview,
  skeleton,
  children,
}: {
  overview: OverviewState
  skeleton: ReactNode
  children: (data: ContactOverview) => ReactNode
}) {
  if (overview.loading && !overview.data) return <div aria-busy="true">{skeleton}</div>
  if (overview.error || !overview.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${overview.error?.code ?? 'WC_ERROR'})`}
        detail={overview.error?.message}
        onRetry={overview.reload}
      />
    )
  }
  return <>{children(overview.data)}</>
}

function Money({ value }: { value: number }) {
  return <FitAmount full={formatMoney(value)} short={formatCompact(value, '€')} className="w-full" />
}

function Quiet({ title, line }: { title: string; line: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-subtle px-4 py-5 text-center">
      <p className="text-label font-medium text-ink-900">{title}</p>
      <p className="text-caption text-text-tertiary">{line}</p>
    </div>
  )
}

function NoAccess() {
  return <EmptyState size="sm" title={copy.contactRecord.noAccess} description={copy.contactRecord.noAccessHint} />
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @[84rem]:grid-cols-6">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className={cn('h-20 rounded-[10px]', index === 0 && 'col-span-2')} />
        ))}
      </div>
      <Skeleton className="h-44 rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <SkeletonRows rows={4} />
        <SkeletonRows rows={4} />
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { formatInteger, formatMoney } from '@/lib/format'
import { DocLink } from '@/pages/ventas/chrome'
import { StatusPill, SegmentedControl } from '@/ui'

export type ConversionBucket = 'all' | 'abierto' | 'aceptado' | 'rechazado' | 'convertido' | 'custom'

export interface ConversionDoc {
  id: string
  number: string | null
  status: string
  total: string | null
}

export interface ConversionLine {
  line_no: number
  description: string
  wine: string | null
  vintage: number | null
  lots: string[]
  bottles_budgeted: string
  bottles_invoiced: string
  amount_budgeted: string
  amount_invoiced: string
  difference_bottles: string
  difference_amount: string
}

export interface ConversionQuote {
  id: string
  origin: 'winecore' | 'holded'
  partial: boolean
  linked: boolean
  bottles_budgeted: string
  bottles_invoiced: string
  total_possible: string
  total_invoiced: string
  delivery_notes: ConversionDoc[]
  invoices: ConversionDoc[]
  lines: ConversionLine[]
}

interface ConversionSummary {
  quotes: number
  bottles_budgeted: string
  base_possible: string
  total_possible: string
  bottles_invoiced: string
  base_invoiced: string
  total_invoiced: string
  conversion_bottles_pct: string | null
  conversion_amount_pct: string | null
}

interface ConversionReference {
  label: string
  bottles_budgeted: string
  bottles_invoiced: string
  amount_budgeted: string
  amount_invoiced: string
  average_price: string | null
  average_price_invoiced: string | null
}

interface ConversionReport {
  summary: ConversionSummary
  by_reference: ConversionReference[]
  quote: ConversionQuote | null
}

const text = copy.salesDocs.conversion

function conversionBucket(statuses: readonly string[]): ConversionBucket {
  const key = [...statuses].sort().join(',')
  if (key === '') return 'all'
  if (key === 'draft,sent') return 'abierto'
  if (key === 'accepted') return 'aceptado'
  if (key === 'rejected') return 'rechazado'
  if (key === 'converted') return 'convertido'
  return 'custom'
}

export function QuoteConversion({
  entity,
  from,
  to,
  origin,
  customer,
  statuses,
  onStatus,
}: {
  entity: string
  from: string
  to: string
  origin: string
  customer: string
  statuses: readonly string[]
  onStatus: (bucket: Exclude<ConversionBucket, 'custom'>) => void
}) {
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (entity) params.set('entity', entity)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (origin) params.set('origin', origin)
    if (customer) params.set('customer_id', customer)
    if (statuses.length > 0) params.set('status', statuses.join(','))
    const search = params.toString()
    return `/v1/quotes/conversion${search ? `?${search}` : ''}`
  }, [customer, entity, from, origin, statuses, to])
  const report = useApi<ConversionReport>(query)
  const bucket = conversionBucket(statuses)
  const summary = report.data?.summary
  const rows = report.data?.by_reference ?? []

  return (
    <section aria-label={text.title} data-conversion="summary" className="shrink-0 border-b border-border-subtle px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-label font-medium text-ink-900">{text.title}</h2>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl<ConversionBucket>
            aria-label={text.state}
            size="sm"
            value={bucket}
            onChange={(value) => {
              if (value !== 'custom') onStatus(value)
            }}
            options={[
              { value: 'all', content: text.all },
              { value: 'abierto', content: text.open },
              { value: 'aceptado', content: text.accepted },
              { value: 'rechazado', content: text.rejected },
              { value: 'convertido', content: text.converted },
            ]}
          />
        </div>
      </div>
      {report.error ? (
        <p className="mt-2 text-caption text-text-secondary">{text.loadError}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
          <Figure label={text.quotes} value={summary ? formatInteger(summary.quotes) : '—'} raw={summary ? String(summary.quotes) : ''} attr="quotes" />
          <Figure label={text.bottles} value={bottles(summary?.bottles_budgeted)} raw={summary?.bottles_budgeted ?? ''} attr="bottles" />
          <Figure label={text.base} value={money(summary?.base_possible)} />
          <Figure label={text.total} value={money(summary?.total_possible)} />
          <Figure label={text.invoicedBottles} value={bottles(summary?.bottles_invoiced)} raw={summary?.bottles_invoiced ?? ''} attr="invoiced" />
          <Figure label={text.invoicedAmount} value={money(summary?.total_invoiced)} />
          <Figure label={text.rate} value={rate(summary?.conversion_bottles_pct, summary?.conversion_amount_pct)} raw={summary?.conversion_bottles_pct ?? ''} attr="rate" />
        </dl>
      )}
      <div className="mt-3 max-h-80 overflow-auto" data-conversion="breakdown">
        {rows.length === 0 ? (
          <p className="text-caption text-text-tertiary">{report.loading ? '—' : text.empty}</p>
        ) : (
          <table className="w-full min-w-[40rem] border-collapse text-left text-label">
            <thead className="text-caption text-text-tertiary">
              <tr>
                <th className="py-1 pr-3 font-medium">{text.reference}</th>
                <th className="py-1 pr-3 text-right font-medium">{text.bottles}</th>
                <th className="py-1 pr-3 text-right font-medium">{text.invoicedBottles}</th>
                <th className="py-1 pr-3 text-right font-medium">{text.budgeted}</th>
                <th className="py-1 pr-3 text-right font-medium">{text.invoiced}</th>
                <th className="py-1 text-right font-medium">{text.average}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-3 text-ink-900">{row.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{bottles(row.bottles_budgeted)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{bottles(row.bottles_invoiced)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.amount_budgeted)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.amount_invoiced)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(row.average_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export function QuoteTrace({ id }: { id: string }) {
  const report = useApi<ConversionReport>(id ? `/v1/quotes/conversion?quote_id=${id}` : null)
  const quote = report.data?.quote
  if (report.error || !quote) return null
  return (
    <section aria-label={text.title} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-label font-medium text-ink-900">{text.title}</h2>
        {quote.partial ? <StatusPill tone="warning" size="sm">{text.partial}</StatusPill> : null}
        {!quote.linked && quote.total_invoiced !== '0.00' ? <StatusPill tone="neutral" size="sm">{text.noLink}</StatusPill> : null}
      </div>
      <p className="text-label text-text-secondary">
        {bottles(quote.bottles_invoiced)} / {bottles(quote.bottles_budgeted)}
        {' · '}
        {money(quote.total_invoiced)} / {money(quote.total_possible)}
      </p>
      <DocList title={text.deliveries} docs={quote.delivery_notes} href={(doc) => `/ventas/albaranes/${doc.id}`} />
      <DocList title={text.invoices} docs={quote.invoices} href={(doc) => `/facturas/${doc.id}`} />
      {quote.lines.length > 0 ? (
        <table className="w-full border-collapse text-left text-label">
          <thead className="text-caption text-text-tertiary">
            <tr>
              <th className="py-1 pr-3 font-medium">{text.reference}</th>
              <th className="py-1 pr-3 text-right font-medium">{text.budgeted}</th>
              <th className="py-1 pr-3 text-right font-medium">{text.invoiced}</th>
              <th className="py-1 text-right font-medium">{text.difference}</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => (
              <tr key={line.line_no} className="border-t border-border-subtle">
                <td className="py-1.5 pr-3 text-ink-900">{line.wine ?? line.description}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{bottles(line.bottles_budgeted)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{bottles(line.bottles_invoiced)}</td>
                <td className="py-1.5 text-right tabular-nums">{bottles(line.difference_bottles)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}

function DocList({ title, docs, href }: { title: string; docs: ConversionDoc[]; href: (doc: ConversionDoc) => string }) {
  if (docs.length === 0) return null
  return (
    <div className="grid gap-1">
      <h3 className="text-caption text-text-tertiary">{title}</h3>
      <ul className="grid gap-1">
        {docs.map((doc) => (
          <li key={doc.id}>
            <DocLink to={href(doc)}>{doc.number ?? title}</DocLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Figure({ label, value, raw = '', attr }: { label: string; value: string; raw?: string; attr?: string }) {
  const data = attr ? { [`data-conversion-${attr}`]: raw } : {}
  return (
    <div className="min-w-0" {...data}>
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="truncate text-label font-medium tabular-nums text-ink-900">{value}</dd>
    </div>
  )
}

function money(value: string | null | undefined): string {
  if (value == null || value === '') return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatMoney(parsed) : value
}

function bottles(value: string | null | undefined): string {
  if (value == null || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return Number.isInteger(parsed) ? formatInteger(parsed) : value.replace('.', ',')
}

function rate(bottlesPct: string | null | undefined, amountPct: string | null | undefined): string {
  if (bottlesPct == null) return '—'
  const bottlesText = percent(bottlesPct)
  const amountText = amountPct == null ? null : percent(amountPct)
  return amountText && amountText !== bottlesText ? `${bottlesText} · ${amountText}` : bottlesText
}

function percent(value: string): string {
  const [whole, frac] = value.split('.')
  if (!frac || frac === '00') return `${whole} %`
  return `${whole},${frac} %`
}

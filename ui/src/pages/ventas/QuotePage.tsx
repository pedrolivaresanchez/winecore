import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { useSalesCatalog } from '@/lib/sales-catalog'
import {
  channelLabel,
  docPath,
  errorText,
  quotePdfPath,
  formatIsoDate,
  quoteStatusLabel,
  quoteToOrder,
  sendQuote,
  type Quote,
  type SalesOrder,
  type SalesPage,
} from '@/lib/sales'
import type { Me } from '@/lib/types'
import { Button, useToast } from '@/ui'
import { DocLink, FactList, LineTable, RecordFrame, SalesHistory, StatusBadge, TotalsBox } from '@/pages/ventas/chrome'
import { RecordSkeleton } from '@/components/RecordSkeleton'

export function QuotePage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const quote = useApi<Quote>(id ? `/v1/quotes/${id}` : null)
  useChromeTitle(quote.data?.number || copy.sales.quotes)
  if (!allows(me, 'sales.read')) return <NoPermission />
  if (quote.loading && !quote.data) return <Loading />
  if (quote.error || !quote.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${quote.error?.code ?? 'WC_ERROR'})`} detail={quote.error?.message} onRetry={quote.reload} />
      </div>
    )
  }
  return <Loaded me={me} quote={quote.data} onReload={quote.reload} />
}

function Loaded({ me, quote, onReload }: { me: Me; quote: Quote; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const catalog = useSalesCatalog()
  const [tab, setTab] = useState('lines')
  const [busy, setBusy] = useState(false)
  const canWrite = allows(me, 'sales.write')
  const orders = useApi<SalesPage<SalesOrder>>(quote.status === 'converted' ? '/v1/sales-orders?limit=100' : null)
  const child = orders.data?.items.find((item) => item.quote_id === quote.id)
  const title = quote.number ?? copy.sales.draft

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <RecordFrame
      backTo={docPath('quote')}
      backLabel={copy.sales.quotes}
      title={title}
      subtitle={catalog.customerName(quote.customer_id)}
      badges={
        <>
          <StatusBadge status={quote.status} label={quoteStatusLabel(quote.status)} />
          {quote.is_proforma ? <StatusBadge status="sent" label={copy.sales.proforma} /> : null}
          {quote.language === 'en' ? <StatusBadge status="draft" label={copy.sales.english} /> : null}
        </>
      }
      actions={
        canWrite ? (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => window.open(quotePdfPath(quote.id), '_blank', 'noopener')}>
              {copy.sales.pdf}
            </Button>
            {quote.status === 'draft' ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() => void run(async () => { await sendQuote(quote.id); toast(copy.sales.toast.sent); onReload() })}
              >
                {copy.sales.send}
              </Button>
            ) : null}
            {quote.status === 'draft' || quote.status === 'sent' ? (
              <Button
                type="button"
                variant={quote.status === 'sent' ? 'primary' : 'secondary'}
                size="sm"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    const order = await quoteToOrder(quote.id)
                    toast(copy.sales.toast.accepted)
                    navigate(`${docPath('order')}/${order.id}`)
                  })
                }
              >
                {copy.sales.accept}
              </Button>
            ) : null}
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => window.open(quotePdfPath(quote.id), '_blank', 'noopener')}>
            {copy.sales.pdf}
          </Button>
        )
      }
      tabs={[
        { id: 'lines', label: copy.sales.lines },
        { id: 'summary', label: copy.sales.summary },
        { id: 'history', label: copy.sales.history },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'lines' ? (
        <div className="grid gap-4">
          <LineTable lines={quote.lines} />
          <TotalsBox subtotal={quote.subtotal} tax={quote.tax_total} total={quote.total} />
        </div>
      ) : null}
      {tab === 'summary' ? (
        <div className="grid gap-4">
          <FactList
            rows={[
              { label: copy.sales.customer, value: catalog.customerName(quote.customer_id) },
              { label: copy.sales.channel, value: channelLabel(quote.channel) },
              { label: copy.sales.language, value: quote.language === 'en' ? copy.sales.english : copy.sales.spanish },
              { label: copy.sales.incoterm, value: quote.incoterm || '—' },
              { label: copy.sales.validUntil, value: formatIsoDate(quote.valid_until) },
              { label: copy.sales.date, value: formatIsoDate(quote.issue_date) },
              { label: copy.sales.notes, value: quote.notes || '—' },
              {
                label: copy.sales.relatedOrder,
                value: child ? <DocLink to={`${docPath('order')}/${child.id}`}>{child.number ?? copy.sales.draft}</DocLink> : '—',
              },
            ]}
          />
        </div>
      ) : null}
      {tab === 'history' ? <SalesHistory table="sales.quote" id={quote.id} /> : null}
    </RecordFrame>
  )
}

function Loading() {
  return <RecordSkeleton />
}

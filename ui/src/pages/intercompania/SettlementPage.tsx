import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { closePeriod, requestInvoice } from '@/pages/intercompania/api'
import { Fact, RecordBar, RecordTabs } from '@/pages/intercompania/frame'
import {
  blockerText,
  costTotal,
  discountLabel,
  formatAmount,
  formatCivil,
  formatQty,
  formatSignedAmount,
  formatUnitPrice,
  GRID_LABELS,
  invoiceStatusLabel,
  invoiceTone,
  isPeriod,
  litersLabel,
  periodTitle,
  settlementStatusLabel,
  sharedDiscount,
  sourceLabel,
  watcherLabel,
  watcherTone,
  withholdingRate,
  type Invoice,
  type Settlement,
  type SettlementLine,
} from '@/pages/intercompania/model'
import {
  Alert,
  Badge,
  Button,
  DataGrid,
  Skeleton,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  MenuChip,
  MenuItem,
  StatusChip,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'

type TabId = 'lineas' | 'factura'
type LineColumn = 'product' | 'date' | 'lot' | 'qty' | 'price' | 'amount' | 'origin' | 'base' | 'discount' | 'cost'

const LINE_COLUMNS: LineColumn[] = ['product', 'date', 'lot', 'qty', 'price', 'amount', 'origin', 'base', 'discount', 'cost']
const HIDDEN_LINES = new Set<LineColumn>(['base', 'discount', 'cost'])

const LINE_LABEL: Record<LineColumn, string> = {
  product: copy.intercompany.product,
  date: copy.intercompany.date,
  lot: copy.intercompany.lot,
  qty: copy.intercompany.qty,
  price: copy.intercompany.price,
  amount: copy.intercompany.amount,
  origin: copy.intercompany.origin,
  base: copy.intercompany.basePrice,
  discount: copy.intercompany.discount,
  cost: copy.intercompany.cost,
}

export function SettlementPage({ me }: { me: Me }) {
  const { period = '' } = useParams()
  const valid = isPeriod(period)
  const query = useApi<Settlement>(valid ? `/v1/intercompany/settlements?period=${encodeURIComponent(period)}` : null)
  const [override, setOverride] = useState<Settlement | null>(null)
  useChromeTitle(valid ? periodTitle(period) : copy.nav.intercompany)

  useEffect(() => {
    setOverride(null)
  }, [period])

  if (!allows(me, 'billing.read')) return <NoPermission />
  if (!valid) {
    return (
      <div className="p-6">
        <ErrorState title={copy.intercompany.invalidPeriod} />
      </div>
    )
  }
  if (query.loading && !query.data && !override) {
    return (
      <div data-screen="intercompania-ficha-cargando" aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  const view = override ?? query.data
  if (query.error || !view) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${query.error?.code ?? 'WC_ERROR'})`}
          detail={query.error?.message}
          onRetry={query.reload}
        />
      </div>
    )
  }
  return <Loaded me={me} view={view} onChange={setOverride} />
}

function Loaded({ me, view, onChange }: { me: Me; view: Settlement; onChange: (next: Settlement) => void }) {
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const canWrite = allows(me, 'billing.write')
  const [tab, setTab] = useState<TabId>('lineas')
  const [busy, setBusy] = useState(false)
  const [belowOpen, setBelowOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<LineColumn>>(new Set(HIDDEN_LINES))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
      ? { product: 240, date: 112, lot: 132, qty: 72, price: 88, amount: 96, origin: 120 }
      : { product: 380, date: 112, lot: 140, qty: 84, price: 96, amount: 108, origin: 124 },
  )
  useChromeTitle(periodTitle(view.period))

  const hard = view.blockers.filter((blocker) => blocker.code !== 'WC_IC_BELOW_COST')
  const below = view.blockers.filter((blocker) => blocker.code === 'WC_IC_BELOW_COST')
  const discount = sharedDiscount(view.lines)
  const cost = costTotal(view.lines)
  const margin = cost == null ? null : Number(view.totals.amount) - cost
  const urgent = view.watcher_status === 'overdue' || view.watcher_status === 'pending_issue'

  const columns = useMemo<GridColumn<SettlementLine>[]>(() => {
    const all: GridColumn<SettlementLine>[] = [
      {
        id: 'product',
        header: LINE_LABEL.product,
        cell: (row) => row.product_name,
      },
      { id: 'date', header: LINE_LABEL.date, cell: (row) => formatCivil(row.occurred_on) },
      { id: 'lot', header: LINE_LABEL.lot, cell: (row) => row.lot_code ?? '—' },
      { id: 'qty', header: LINE_LABEL.qty, align: 'right', cell: (row) => formatQty(row.quantity) },
      { id: 'price', header: LINE_LABEL.price, align: 'right', cell: (row) => formatUnitPrice(row.unit_price) },
      { id: 'amount', header: LINE_LABEL.amount, align: 'right', cell: (row) => formatAmount(row.amount) },
      { id: 'origin', header: LINE_LABEL.origin, cell: (row) => sourceLabel(row) },
      { id: 'base', header: LINE_LABEL.base, align: 'right', cell: (row) => formatUnitPrice(row.base_unit_price) },
      { id: 'discount', header: LINE_LABEL.discount, align: 'right', cell: (row) => discountLabel(row.discount_pct) },
      {
        id: 'cost',
        header: LINE_LABEL.cost,
        align: 'right',
        cell: (row) => (row.unit_cost ? formatUnitPrice(row.unit_cost) : '—'),
      },
    ]
    return all.filter((column) => !hidden.has(column.id as LineColumn))
  }, [hidden])

  async function close(acknowledged: boolean) {
    setBusy(true)
    try {
      const next = await closePeriod(view.period, acknowledged)
      onChange(next)
      setBelowOpen(false)
      toast(copy.intercompany.closedToast)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_IC_BELOW_COST' && !acknowledged) {
        setBelowOpen(true)
        return
      }
      toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function ask() {
    if (!view.id) return
    setBusy(true)
    try {
      const next = await requestInvoice(view.id)
      onChange(next)
      setAskOpen(false)
      toast(copy.intercompany.requestedToast)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const showClose = canWrite && view.status === 'open' && hard.length === 0
  const showAsk = canWrite && view.invoice?.status === 'draft' && view.id != null

  return (
    <div data-screen="intercompania-ficha" data-tab={tab} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <RecordBar
        backTo="/intercompania"
        backLabel={copy.intercompany.backSettlements}
        actions={
          <>
            {showClose ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() => {
                  if (below.length > 0) setBelowOpen(true)
                  else void close(false)
                }}
              >
                {copy.intercompany.closeMonth}
              </Button>
            ) : null}
            {showAsk ? (
              <Button type="button" variant="primary" size="sm" onClick={() => setAskOpen(true)}>
                {copy.intercompany.requestInvoice}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex shrink-0 flex-col gap-3 px-3 py-4 sm:px-4">
        <header>
          <h1 className="text-body font-medium text-ink-900">{periodTitle(view.period)}</h1>
          <p className="mt-0.5 text-label text-text-secondary">
            {copy.intercompany.pair} · {fill(copy.intercompany.issueBy, { date: formatCivil(view.issue_deadline) })}
          </p>
        </header>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={watcherTone(view.watcher_status)}>{watcherLabel(view.watcher_status)}</Badge>
          {view.status !== 'open' ? <Badge tone="info">{settlementStatusLabel(view.status)}</Badge> : null}
          {view.invoice && view.invoice.status !== 'draft' ? (
            <Badge tone={invoiceTone(view.invoice.status)}>{invoiceStatusLabel(view.invoice.status)}</Badge>
          ) : null}
          {discount ? (
            <StatusChip
              tone="neutral"
              detail={fill(copy.intercompany.formula, { discount: discountLabel(discount) })}
            >{`−${discountLabel(discount)}`}</StatusChip>
          ) : null}
          {view.lines.some((line) => line.below_cost) ? <Badge tone="warning">{copy.intercompany.belowCost}</Badge> : null}
        </div>
        {urgent ? (
          <Alert tone={view.watcher_status === 'overdue' ? 'danger' : 'warning'}>
            <p className="text-label">{view.watcher_message}</p>
          </Alert>
        ) : null}
        {view.watcher_status === 'draft' ? (
          <Alert tone="info">
            <p className="text-label">{view.watcher_message}</p>
          </Alert>
        ) : null}
        {hard.length > 0 ? (
          <Alert tone="danger">
            <ul className="grid gap-0.5 text-label">
              {[...new Set(hard.map(blockerText))].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {view.status === 'open' && below.length > 0 ? (
          <Alert tone="warning">
            <p className="text-label">{copy.intercompany.closeBelowBody}</p>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-4">
          <Stat label={copy.intercompany.units} value={formatQty(view.totals.units)} />
          <Stat label={copy.intercompany.liters} value={litersLabel(view.totals.liters)} />
          <Stat label={copy.intercompany.amount} value={formatAmount(view.totals.amount)} />
          <Stat label={copy.intercompany.cost} value={cost == null ? '—' : formatAmount(cost)} />
          {margin != null ? <Stat label={copy.intercompany.margin} value={formatAmount(margin)} /> : null}
        </div>
      </div>
      <RecordTabs
        label={periodTitle(view.period)}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'lineas', label: copy.intercompany.lines },
          { id: 'factura', label: copy.intercompany.invoice },
        ]}
        end={
          tab === 'lineas' ? (
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-end"
              panelClassName="min-w-[200px]"
              trigger={
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.intercompany.columns}>
                  {copy.intercompany.columns}
                </MenuChip>
              }
            >
              {LINE_COLUMNS.map((id) => (
                <MenuItem
                  key={id}
                  checked={!hidden.has(id)}
                  disabled={id === 'product'}
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                >
                  {LINE_LABEL[id]}
                </MenuItem>
              ))}
            </GlassMenu>
          ) : null
        }
      />
      {tab === 'lineas' ? (
        <DataGrid
          columns={columns}
          rows={view.lines}
          rowKey={(row) => `${row.source_table}:${row.id}:${row.occurred_on}`}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={() => undefined}
          loading={false}
          empty={
            <EmptyState
              size="sm"
              title={fill(copy.intercompany.noMoves, { month: periodTitle(view.period) })}
              description={view.status === 'open' ? undefined : copy.intercompany.noMovesHint}
            />
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-8">
            <InvoicePanel view={view} />
          </div>
        </div>
      )}

      <Dialog open={belowOpen} onClose={() => setBelowOpen(false)} labelledBy="bajo-coste" size="sm">
        <DialogHeader titleId="bajo-coste" title={copy.intercompany.closeBelowTitle} onClose={() => setBelowOpen(false)} />
        <DialogBody>
          <div className="grid gap-2">
            <p className="text-label text-text-secondary">{copy.intercompany.closeBelowBody}</p>
            <ul className="grid gap-1 text-label text-ink-900">
              {below.map((blocker) => (
                <li key={`${blocker.product_id}-${blocker.occurred_on ?? ''}`}>{blockerText(blocker)}</li>
              ))}
            </ul>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setBelowOpen(false)} disabled={busy}>
            {copy.intercompany.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void close(true)}>
            {copy.intercompany.ackBelow}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={askOpen} onClose={() => setAskOpen(false)} labelledBy="pedir-aprobacion" size="sm">
        <DialogHeader titleId="pedir-aprobacion" title={copy.intercompany.requestTitle} onClose={() => setAskOpen(false)} />
        <DialogBody>
          <div data-screen="intercompania-aprobacion" className="grid gap-3">
            <p className="text-label text-text-secondary">{copy.intercompany.requestBody}</p>
            {view.invoice ? <PayFacts invoice={view.invoice} framed={false} /> : null}
            <p className="text-caption text-text-tertiary">{copy.intercompany.approvalKind}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAskOpen(false)} disabled={busy}>
            {copy.intercompany.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void ask()}>
            {copy.intercompany.requestInvoice}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2 sm:px-4">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="truncate text-label font-medium tabular-nums text-ink-900">{value}</p>
    </div>
  )
}

function InvoicePanel({ view }: { view: Settlement }) {
  if (view.lines.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={fill(copy.intercompany.noMoves, { month: periodTitle(view.period) })}
        description={copy.intercompany.noMovesHint}
      />
    )
  }
  if (!view.invoice) {
    const groups = rollup(view.lines)
    return (
      <>
        <p className="text-label text-text-secondary">{copy.intercompany.noInvoiceHint}</p>
        <section className="overflow-hidden rounded-2xl border border-border-subtle">
          <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.intercompany.byProduct}</h2>
          <ul>
            {groups.map((group) => (
              <li key={group.id} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
                <span className="min-w-0">
                  <span className="block truncate text-label text-ink-900">{group.name}</span>
                  <span className="block text-caption text-text-tertiary tabular-nums">
                    {formatQty(group.qty)} × {group.prices.size === 1 ? formatUnitPrice([...group.prices][0] ?? '') : copy.intercompany.severalPrices}
                  </span>
                </span>
                <span className="shrink-0 text-label tabular-nums text-ink-900">{formatAmount(group.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      </>
    )
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={invoiceTone(view.invoice.status)}>{invoiceStatusLabel(view.invoice.status)}</Badge>
        <Badge tone="neutral">{`${copy.intercompany.regime} ${view.invoice.issuer_income_tax}`}</Badge>
      </div>
      <PayFacts invoice={view.invoice} />
      <section className="overflow-hidden rounded-2xl border border-border-subtle">
        <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.intercompany.byProduct}</h2>
        <ul>
          {view.invoice.lines.map((line) => (
            <li key={line.line_no} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
              <span className="min-w-0">
                <span className="block truncate text-label text-ink-900">{line.description}</span>
                <span className="block text-caption text-text-tertiary tabular-nums">
                  {formatQty(line.quantity)} × {formatUnitPrice(line.unit_price)}
                </span>
              </span>
              <span className="shrink-0 text-label tabular-nums text-ink-900">{formatAmount(line.line_base)}</span>
            </li>
          ))}
        </ul>
      </section>
      {view.invoice.status === 'pending_approval' ? (
        <p className="text-caption text-text-tertiary">{copy.intercompany.approvalNote}</p>
      ) : null}
    </>
  )
}

function PayFacts({ invoice, framed = true }: { invoice: Invoice; framed?: boolean }) {
  const rate = withholdingRate(invoice)
  const applies = invoice.issuer_income_tax === 'IRPF' && Number(invoice.withholding_total) > 0
  const due = invoice.dues_preview[0]
  return (
    <section className={framed ? 'overflow-hidden rounded-2xl border border-border-subtle bg-surface' : undefined}>
      <Fact label={copy.intercompany.operationDate} value={formatCivil(invoice.operation_date)} />
      <Fact label={copy.intercompany.subtotal} value={formatAmount(invoice.subtotal)} />
      <Fact label={copy.intercompany.tax} value={formatAmount(invoice.tax_total)} />
      <Fact label={copy.intercompany.invoiceTotal} value={formatAmount(invoice.importe_total)} />
      {invoice.issuer_income_tax === 'IRPF' ? (
        <Fact
          label={rate ? `${copy.intercompany.withholding} ${formatPercent(Number(rate))}` : copy.intercompany.withholding}
          value={applies ? formatSignedAmount(invoice.withholding_total) : copy.intercompany.withholdingNone}
          hint={copy.intercompany.irpfHint}
        />
      ) : null}
      <Fact label={copy.intercompany.totalToPay} value={formatAmount(invoice.total_to_pay)} />
      {due ? <Fact label={copy.intercompany.due} value={`${formatCivil(due.due_date)} · ${formatAmount(due.amount)}`} /> : null}
    </section>
  )
}

function rollup(lines: readonly SettlementLine[]): { id: string; name: string; qty: number; amount: number; prices: Set<string> }[] {
  const map = new Map<string, { id: string; name: string; qty: number; amount: number; prices: Set<string> }>()
  for (const line of lines) {
    const current = map.get(line.product_id) ?? {
      id: line.product_id,
      name: line.product_name,
      qty: 0,
      amount: 0,
      prices: new Set<string>(),
    }
    current.qty += Number(line.quantity)
    current.amount += Number(line.amount)
    current.prices.add(line.unit_price)
    map.set(line.product_id, current)
  }
  return [...map.values()]
}

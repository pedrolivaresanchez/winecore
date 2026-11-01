import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MoreVertical } from '@/ui/icons'
import { Badge, Button, GlassMenu, InfoTip, useMenuOpen, type BadgeTone } from '@/ui'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { deliveryLabel, deliveryTone, entityLabel, hasAmount, money, qty, statusLabel, statusTone, verifactuLabel } from '@/pages/facturas/format'
import type { DeliveryStatus, Invoice, InvoiceLine } from '@/pages/facturas/types'

export function RecordFrame({
  title,
  subtitle,
  badges,
  actions,
  tabs,
  tab,
  onTab,
  children,
  screen = 'facturas-ficha',
}: {
  title: string
  subtitle?: string
  badges?: ReactNode
  actions?: ReactNode
  tabs: { id: string; label: string }[]
  tab: string
  onTab: (id: string) => void
  children: ReactNode
  screen?: string
}) {
  return (
    <div data-screen={screen} data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <BackLink />
        <span className="min-w-0 truncate text-label text-text-tertiary">{copy.facturas.title}</span>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-label text-text-secondary">{subtitle}</p> : null}
          </header>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
          <div role="tablist" aria-label={copy.facturas.lines} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
                  tab === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                onClick={() => onTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export function BackLink() {
  return (
    <Link
      to="/facturas"
      aria-label={copy.facturas.title}
      className="flex size-7 max-sm:size-11 shrink-0 items-center justify-center rounded-md text-ink-900 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
    >
      <ArrowLeft className="size-4" strokeWidth={iconStroke} />
    </Link>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status) as BadgeTone}>{statusLabel(status)}</Badge>
}

export function DeliveryBadge({ status }: { status: DeliveryStatus | null }) {
  if (!status) return null
  return <Badge tone={deliveryTone(status)}>{deliveryLabel(status)}</Badge>
}

export function InvoiceBadges({ invoice, delivery }: { invoice: Invoice; delivery: DeliveryStatus | null }) {
  return (
    <>
      <StatusBadge status={invoice.status} />
      <Badge tone="neutral">{entityLabel(invoice.entity_code)}</Badge>
      {invoice.invoice_type.startsWith('R') ? <Badge tone="info">{invoice.invoice_type}</Badge> : null}
      <DeliveryBadge status={delivery} />
      {invoice.status === 'issued' || invoice.status === 'voided' ? (
        <Badge tone={invoice.verifactu_record_id ? 'success' : 'neutral'}>{verifactuLabel(invoice.verifactu_record_id)}</Badge>
      ) : null}
    </>
  )
}

export function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.facturas.more} onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
      {children(menu.close)}
    </GlassMenu>
  )
}

export function Totals({ invoice }: { invoice: Invoice }) {
  const withholding = hasAmount(invoice.withholding_total)
  return (
    <section className="ml-auto w-full max-w-xs overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-4 py-2">
        <h2 className="text-caption text-text-tertiary">{copy.facturas.importe}</h2>
        <InfoTip label={copy.facturas.stockLabel}>{copy.facturas.stockTip}</InfoTip>
      </div>
      <TotalRow label={copy.facturas.base} value={money(invoice.subtotal)} />
      <TotalRow label={copy.facturas.tax} value={money(invoice.tax_total)} />
      {hasAmount(invoice.surcharge_total) ? <TotalRow label={copy.facturas.surcharge} value={money(invoice.surcharge_total)} /> : null}
      {withholding ? <TotalRow label={copy.facturas.withholding} value={money(invoice.withholding_total)} /> : null}
      <TotalRow label={copy.facturas.importe} value={money(invoice.importe_total ?? invoice.total)} strong={!withholding} />
      {withholding ? <TotalRow label={copy.facturas.payable} value={money(invoice.total)} strong /> : null}
    </section>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-label text-text-tertiary">{label}</dt>
      <dd className={cn('text-label tabular-nums text-ink-900', strong && 'font-medium')}>{value}</dd>
    </div>
  )
}

export function FactList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <dt className="text-caption text-text-tertiary">{row.label}</dt>
          <dd className="text-label break-words text-ink-900">{row.value}</dd>
        </div>
      ))}
    </section>
  )
}

export function LineTable({ lines }: { lines: InvoiceLine[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border-subtle sm:block">
        <table className="w-full border-collapse text-label">
          <thead>
            <tr className="border-b border-border-subtle text-left text-text-tertiary">
              <th className="px-3 py-2 font-normal">{copy.facturas.product}</th>
              <th className="px-3 py-2 font-normal">{copy.facturas.lot}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.facturas.quantity}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.facturas.price}</th>
              <th className="px-3 py-2 font-normal">{copy.facturas.taxCode}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.facturas.base}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-border-subtle last:border-b-0">
                <td className="px-3 py-2 text-ink-900">
                  <span className="block">{line.description}</span>
                  {line.sku ? <span className="text-caption text-text-tertiary">{line.sku}</span> : null}
                </td>
                <td className="px-3 py-2 text-text-secondary">{line.lot_code || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.unit_price)}</td>
                <td className="px-3 py-2">{line.tax_code}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.line_base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 sm:hidden">
        {lines.map((line) => (
          <li key={line.id} className="rounded-2xl border border-border-subtle px-3 py-2">
            <p className="text-label text-ink-900">{line.description}</p>
            {line.lot_code ? <p className="text-caption text-text-tertiary">{line.lot_code}</p> : null}
            <p className="mt-1 text-caption text-text-secondary tabular-nums">
              {qty(line.quantity)} × {money(line.unit_price)} · {line.tax_code}
            </p>
            <p className="text-label font-medium tabular-nums text-ink-900">{money(line.line_base)}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

export function TaxBreakdown({ invoice }: { invoice: Invoice }) {
  if (invoice.taxes.length === 0) return null
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.facturas.tax}</h2>
      {invoice.taxes.map((tax) => (
        <div key={tax.tax_code} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <dt className="text-caption text-text-tertiary">{tax.tax_code}</dt>
          <dd className="text-label tabular-nums text-ink-900">
            {money(tax.base)} · {money(tax.quota)}
            {hasAmount(tax.surcharge_quota) ? ` · ${copy.facturas.surcharge} ${money(tax.surcharge_quota)}` : ''}
            {hasAmount(tax.withholding) ? ` · ${copy.facturas.withholding} ${money(tax.withholding)}` : ''}
          </dd>
        </div>
      ))}
    </section>
  )
}

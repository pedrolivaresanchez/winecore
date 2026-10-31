import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MoreVertical } from '@/ui/icons'
import { Badge, Button, GlassMenu, InfoTip, StatusChip, useMenuOpen, type BadgeTone } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { formatAmount, formatQty, lineBase, statusTone, taxLabel, type SalesLine } from '@/lib/sales'

export function RecordFrame({
  backTo,
  backLabel,
  title,
  subtitle,
  badges,
  actions,
  tabs,
  tab,
  onTab,
  children,
}: {
  backTo: string
  backLabel: string
  title: string
  subtitle?: string
  badges?: ReactNode
  actions?: ReactNode
  tabs: { id: string; label: string }[]
  tab: string
  onTab: (id: string) => void
  children: ReactNode
}) {
  return (
    <div data-screen="ventas-ficha" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <BackLink to={backTo} label={backLabel} />
        <span className="min-w-0 truncate text-label text-text-tertiary">{backLabel}</span>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-label text-text-secondary">{subtitle}</p> : null}
          </header>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
          <div role="tablist" aria-label={copy.sales.lines} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label',
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

/** Back control is a real link. Button's iconOnly doesn't forward `to`, so the header uses a link styled as the ghost control. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-900 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
    >
      <ArrowLeft className="size-4" strokeWidth={iconStroke} />
    </Link>
  )
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={statusTone(status) as BadgeTone}>{label}</Badge>
}

export function MoreMenu({ label, children }: { label?: string; children: (close: () => void) => ReactNode }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="secondary" size="sm" iconOnly aria-label={label ?? copy.sales.moreActions} onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
      {children(menu.close)}
    </GlassMenu>
  )
}

export function TotalsBox({ subtotal, tax, total }: { subtotal: string; tax: string; total: string }) {
  return (
    <section className="ml-auto w-full max-w-xs overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <TotalRow label={copy.sales.subtotal} value={formatAmount(subtotal)} />
      <TotalRow label={copy.sales.taxTotal} value={formatAmount(tax)} />
      <TotalRow label={copy.sales.total} value={formatAmount(total)} strong />
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
      {rows.map((row) => (
        <div key={row.label} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <dt className="text-caption text-text-tertiary">{row.label}</dt>
          <dd className="text-label break-words text-ink-900">{row.value}</dd>
        </div>
      ))}
    </section>
  )
}

export function LineTable({
  lines,
  lotName,
}: {
  lines: SalesLine[]
  lotName?: (id: string) => string
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border-subtle sm:block">
        <table className="w-full border-collapse text-label">
          <thead>
            <tr className="border-b border-border-subtle text-left text-text-tertiary">
              <th className="px-3 py-2 font-normal">{copy.sales.product}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.sales.quantity}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.sales.price}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.sales.discount}</th>
              <th className="px-3 py-2 font-normal">{copy.sales.tax}</th>
              <th className="px-3 py-2 text-right font-normal">{copy.sales.amount}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const base = lineBase(line.quantity, line.unit_price, line.discount_pct)
              return (
                <tr key={line.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-3 py-2 text-ink-900">
                    <span className="block">{line.description}</span>
                    {line.lot_id ? (
                      <span className="text-caption text-text-tertiary">{lotName ? lotName(line.lot_id) : line.lot_id.slice(0, 8)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQty(line.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(line.unit_price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(line.discount_pct) > 0 ? formatQty(line.discount_pct) : '—'}</td>
                  <td className="px-3 py-2">{taxLabel(line.tax_code)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{base == null ? '—' : formatAmount(base)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 sm:hidden">
        {lines.map((line) => {
          const base = lineBase(line.quantity, line.unit_price, line.discount_pct)
          return (
            <li key={line.id} className="rounded-2xl border border-border-subtle px-3 py-2">
              <p className="text-label text-ink-900">{line.description}</p>
              {line.lot_id ? <p className="text-caption text-text-tertiary">{lotName ? lotName(line.lot_id) : line.lot_id.slice(0, 8)}</p> : null}
              <p className="mt-1 text-caption text-text-secondary tabular-nums">
                {formatQty(line.quantity)} × {formatAmount(line.unit_price)} · {taxLabel(line.tax_code)}
              </p>
              <p className="text-label font-medium tabular-nums text-ink-900">{base == null ? '—' : formatAmount(base)}</p>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function RuleLine({ code, label }: { code: string | null; label: string | null }) {
  if (!code && !label) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-label text-text-secondary">
      {code ? <span className="font-medium text-ink-900">{copy.sales.invoiceAs.replace('{entity}', code)}</span> : null}
      {label ? <span>{label}</span> : <span>{copy.sales.ruleMissing}</span>}
    </p>
  )
}

export function PhysicalChip() {
  return (
    <StatusChip tone="info" detail={copy.sales.physicalDetail}>
      {copy.sales.physical}
    </StatusChip>
  )
}

export function EadChip() {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="warning">{copy.sales.needsEad}</Badge>
      <InfoTip label={copy.sales.needsEad}>{copy.sales.needsEadDetail}</InfoTip>
    </span>
  )
}

type AuditItem = {
  id: string | number
  occurred_at: string
  actor: { display_name: string }
  action: string
  changes: { field: string; before: unknown; after: unknown }[]
}

const AUDIT_ACTION: Record<string, string> = {
  INSERT: 'Alta',
  UPDATE: 'Cambio',
  DELETE: 'Baja',
}

export function SalesHistory({ table, id }: { table: string; id: string }) {
  const history = useApi<{ items: AuditItem[] }>(`/v1/audit?table=${encodeURIComponent(table)}&row_id=${id}&limit=30`)
  if (history.loading && !history.data) return <p className="text-label text-text-tertiary">{copy.loading}</p>
  if (history.error) return <p className="text-label text-danger-700">{history.error.message}</p>
  const items = history.data?.items ?? []
  if (items.length === 0) {
    return (
      <div>
        <p className="text-label font-medium text-ink-900">{copy.sales.historyEmpty}</p>
        <p className="text-label text-text-secondary">{copy.sales.historyHint}</p>
      </div>
    )
  }
  return (
    <ol className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      {items.map((event) => (
        <li key={String(event.id)} className="border-b border-border-subtle px-4 py-3 last:border-b-0">
          <p className="text-label font-medium text-ink-900">
            {AUDIT_ACTION[event.action] ?? event.action}
            <span className="font-normal text-text-tertiary"> · {event.actor.display_name}</span>
          </p>
          <p className="text-caption text-text-tertiary">{formatDateTime(event.occurred_at)}</p>
        </li>
      ))}
    </ol>
  )
}

export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-label text-ink-900 underline-offset-2 hover:underline">
      {children}
    </Link>
  )
}

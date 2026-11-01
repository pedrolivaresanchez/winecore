import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { DATE_LABELS } from '@/pages/facturas/format'
import { FRAME_GUTTER } from '@/ui/frame'
import { DatePicker, Select } from '@/ui'

export function HoldedFilters({
  id,
  statusLabel,
  allLabel,
  status,
  statuses,
  onStatus,
  from,
  to,
  onFrom,
  onTo,
}: {
  id: string
  statusLabel: string
  allLabel: string
  status: string
  statuses: string[]
  onStatus: (value: string) => void
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
}) {
  return (
    <>
      <Select
        id={id}
        size="sm"
        aria-label={statusLabel}
        value={status}
        className="shrink-0"
        onChange={(event) => onStatus(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {statuses.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      <DatePicker
        size="sm"
        value={from || null}
        placeholder={copy.facturas.from}
        labels={DATE_LABELS}
        className="shrink-0"
        onChange={(value) => onFrom(value ?? '')}
      />
      <DatePicker
        size="sm"
        value={to || null}
        placeholder={copy.facturas.to}
        labels={DATE_LABELS}
        className="shrink-0"
        onChange={(value) => onTo(value ?? '')}
      />
    </>
  )
}

export function HoldedTotals({ count, total, pending }: { count: number; total: string; pending?: string }) {
  return (
    <div className={cn('flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border-subtle bg-surface py-2 text-caption', FRAME_GUTTER)}>
      <span className="font-medium text-ink-900">{fill(copy.facturas.onScreen, { n: String(count) })}</span>
      <span className="text-text-tertiary">
        {copy.facturas.total} <span className="tabular-nums text-ink-900">{total}</span>
      </span>
      {pending !== undefined ? (
        <span className="text-text-tertiary">
          {copy.facturas.pendingAmount} <span className="tabular-nums text-ink-900">{pending}</span>
        </span>
      ) : null}
    </div>
  )
}

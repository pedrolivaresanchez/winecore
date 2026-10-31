import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { DATE_LABELS, money, qty } from '@/pages/facturas/format'
import type { HoldedDetailState, HoldedLine } from '@/pages/facturas/holded-detail'
import { FRAME_GUTTER } from '@/ui/frame'
import { Button, DatePicker, DrawerBody, Select } from '@/ui'

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

export function HoldedDrawerBody({
  hint,
  fields,
  showPdf,
  pdfBusy,
  pdfError,
  onPdf,
  detailState,
  lines,
}: {
  hint: string
  fields: { label: string; value: string }[]
  showPdf: boolean
  pdfBusy: boolean
  pdfError: boolean
  onPdf: () => void
  detailState: HoldedDetailState
  lines: HoldedLine[] | null
}) {
  return (
    <DrawerBody>
      <div className="flex items-start justify-between gap-3">
        <p className="text-caption text-text-tertiary">{hint}</p>
        {showPdf ? (
          <Button type="button" variant="secondary" size="sm" className="shrink-0" loading={pdfBusy} onClick={onPdf}>
            {copy.facturas.pdf}
          </Button>
        ) : null}
      </div>
      {pdfError ? (
        <p role="alert" className="mt-2 text-caption text-danger-600">
          {copy.error.load}
        </p>
      ) : null}
      <dl className="mt-4 grid gap-3">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="text-caption text-text-tertiary">{field.label}</dt>
            <dd className="text-label text-ink-900">{field.value}</dd>
          </div>
        ))}
      </dl>
      <HoldedLines state={detailState} lines={lines} />
    </DrawerBody>
  )
}

function HoldedLines({ state, lines }: { state: HoldedDetailState; lines: HoldedLine[] | null }) {
  if (state === 'missing') return null
  if (state === 'loading') return <p className="mt-6 text-caption text-text-tertiary">{copy.table.loading}</p>
  if (state === 'error') return <p className="mt-6 text-caption text-danger-600">{copy.error.load}</p>
  return (
    <section className="mt-6 border-t border-border-subtle pt-4">
      <h3 className="text-label font-medium text-ink-900">{copy.sales.lines}</h3>
      {lines && lines.length > 0 ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border-subtle bg-surface">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle text-caption text-text-tertiary">
                <th scope="col" className="px-2 py-1.5 font-medium">{copy.facturas.number}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{copy.higiene.sku}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{copy.facturas.description}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{copy.facturas.quantity}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{copy.facturas.price}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{copy.facturas.base}</th>
                <th scope="col" className="px-2 py-1.5 font-medium">{copy.facturas.taxCode}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.line_no}-${index}`} className="border-b border-border-subtle text-label text-ink-900 last:border-b-0">
                  <td className="px-2 py-1.5 tabular-nums">{line.line_no}</td>
                  <td className="px-2 py-1.5">{line.sku || '—'}</td>
                  <td className="px-2 py-1.5">{line.description || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{qty(line.quantity)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(line.unit_price)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(line.line_base)}</td>
                  <td className="px-2 py-1.5">{line.tax_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-caption text-text-tertiary">{copy.facturas.noLines}</p>
      )}
    </section>
  )
}

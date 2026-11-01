import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, type IconComponent } from '@/ui/icons'
import { Badge, Tooltip, textureSecondary } from '@/ui'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney } from '@/lib/format'
import { useDocParam } from '@/pages/documents/use-doc-param'
import { INVOICE_STATE, amount, docKey, invoiceDoc, type DocSource, type OverviewInvoice, type RecordDoc } from '@/pages/contactos/overview'

export const RECORD_CARD = 'rounded-xl bg-surface shadow-(--shadow-surface)'

const BAR_BUTTON = cn(
  'flex size-7 shrink-0 items-center justify-center rounded-md text-control outline-none',
  'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
  'hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)',
  'disabled:pointer-events-none disabled:opacity-40',
)

export function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={BAR_BUTTON}>
        {children}
      </button>
    </Tooltip>
  )
}

export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-1', className)}>{children}</dl>
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-28 shrink-0 truncate text-label leading-5 text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-label leading-5 break-words text-ink-900">{children}</dd>
    </div>
  )
}

/** SDR's related-record card: a chevron header that folds the body, with the count beside the title. */
export function FoldCard({
  title,
  count,
  defaultOpen = true,
  action,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  action?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <section className={cn(RECORD_CARD, 'px-2.5 py-2')}>
      <div className="flex min-h-7 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
        >
          <ChevronDown className={cn('size-3 shrink-0 text-icon transition-transform', !open && '-rotate-90')} strokeWidth={2} />
          <span className="min-w-0 truncate text-label font-medium text-ink-900">{title}</span>
          {count != null ? <span className="shrink-0 text-caption tabular-nums text-text-tertiary">{count}</span> : null}
        </button>
        {action}
      </div>
      {open ? (
        <div id={bodyId} className="pt-1.5 pb-1">
          {children}
        </div>
      ) : null}
    </section>
  )
}

export type RecordTab<T extends string> = { id: T; label: string; icon: IconComponent; count?: number | null }

export function TabStrip<T extends string>({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
}: {
  tabs: RecordTab<T>[]
  active: T
  onChange: (id: T) => void
  label: string
  idPrefix: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === active)
    const last = tabs.length - 1
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight' ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1
    const tab = tabs[next]
    if (!tab) return
    onChange(tab.id)
    refs.current[tab.id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className="scrollbar-none relative flex h-10 min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[tab.id] = node
            }}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] pr-2 pl-1.5 text-label whitespace-nowrap outline-none',
              'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) focus-visible:shadow-(--shadow-focus)',
              selected ? cn(textureSecondary, 'font-medium text-ink-900') : 'border border-transparent bg-transparent text-control hover:bg-fill-hover hover:text-ink-700',
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={2} />
            {tab.label}
            {tab.count ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-fill-muted px-1 text-caption font-medium tabular-nums text-text-secondary">
                {tab.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="min-w-0 truncate text-label font-medium text-ink-900">{title}</h3>
        {meta ? <span className="min-w-0 truncate text-caption tabular-nums text-text-tertiary">{meta}</span> : null}
        {action ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function RowList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">{children}</ul>
}

/** A document line: the number and its dates on the left, the amount and the state on the right. */
export function DocRow({
  href,
  doc,
  title,
  meta,
  value,
  badge,
}: {
  href?: string | null
  /** Opens over the record in the document modal; wins over `href`. */
  doc?: RecordDoc | null
  title: ReactNode
  meta: ReactNode
  value: ReactNode
  badge?: ReactNode
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-label text-ink-900">{title}</p>
        <p className="truncate text-caption text-text-tertiary">{meta}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-label tabular-nums text-ink-900">{value}</span>
        {badge}
      </div>
    </>
  )
  const row = 'flex items-center gap-3 px-3 py-2'
  const docs = useDocParam()
  const to = doc ? docs.hrefFor(docKey(doc)) : href
  return (
    <li>
      {to ? (
        <Link
          to={to}
          state={doc ? { docModal: true } : undefined}
          className={cn(row, 'outline-none transition-colors hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)')}
        >
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  )
}

export function SourceMark({ source }: { source: DocSource }) {
  if (source !== 'holded') return null
  return (
    <Badge size="sm" tone="neutral" className="shrink-0">
      {copy.contactRecord.holded}
    </Badge>
  )
}

export function InvoiceRow({ invoice }: { invoice: OverviewInvoice }) {
  const state = INVOICE_STATE[invoice.state]
  const pending = amount(invoice.pending)
  const open = invoice.state === 'pending' || invoice.state === 'overdue'
  const meta = [
    invoice.issue_date ? formatDate(invoice.issue_date) : copy.contactRecord.dateMissing,
    open && invoice.due_date ? fill(copy.contactRecord.dueOn, { date: formatDate(invoice.due_date) }) : null,
    open && pending !== amount(invoice.total) ? formatMoney(pending) : null,
    invoice.entity_code,
    invoice.linked_by === 'name' ? copy.contactRecord.byName.toLowerCase() : null,
  ]
  return (
    <DocRow
      doc={invoiceDoc(invoice)}
      title={
        <>
          <span className="truncate font-medium">{invoice.number ?? state.label}</span>
          <SourceMark source={invoice.source} />
        </>
      }
      meta={meta.filter(Boolean).join(' · ')}
      value={formatMoney(amount(invoice.total))}
      badge={
        <Badge size="sm" variant="dot" tone={state.tone}>
          {state.label}
        </Badge>
      }
    />
  )
}

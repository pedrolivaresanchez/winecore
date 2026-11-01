import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { ArrowLeft, Calendar, ChevronDown } from '@/ui/icons'
import { Button, GlassMenu, InfoTip, MenuItem, StatusPill, useMenuOpen } from '@/ui'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { REGULATORY_VIEWS, resultStepLabel, statusMeta, stepIndex, type RegulatoryView } from '@/pages/regulatorio/model'

function ObjectSwitch({ current }: { current: RegulatoryView }) {
  const navigate = useNavigate()
  const menu = useMenuOpen()
  const label = REGULATORY_VIEWS.find((item) => item.id === current)?.label ?? copy.regulatorio.title
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      panelClassName="min-w-[200px]"
      trigger={
        <button
          type="button"
          onClick={menu.toggle}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          title={copy.regulatorio.switch}
          className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium text-ink-900 hover:bg-fill-hover"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
        </button>
      }
    >
      {REGULATORY_VIEWS.map((item) => (
        <MenuItem
          key={item.id}
          active={item.id === current}
          onClick={() => {
            menu.close()
            navigate(item.path)
          }}
        >
          {item.label}
        </MenuItem>
      ))}
    </GlassMenu>
  )
}

/** The view switch for a `FilterBar`'s leading slot: on a phone the header that holds it is gone. */
export function MobileViewSwitch({ current }: { current: RegulatoryView }) {
  return (
    <div className="shrink-0 md:hidden">
      <ObjectSwitch current={current} />
    </div>
  )
}

export function ListFrame({
  screen,
  view,
  actions,
  mobileActions,
  toolbar,
  filters,
  bar,
  children,
}: {
  screen: string
  view: RegulatoryView
  actions?: ReactNode
  mobileActions?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  /** A `FilterBar` in place of the toolbar and filter rows; it carries `MobileViewSwitch` itself. */
  bar?: ReactNode
  children: ReactNode
}) {
  const label = REGULATORY_VIEWS.find((item) => item.id === view)?.label ?? copy.regulatorio.title
  useChromeTitle(label)
  return (
    <div data-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Calendar className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <ObjectSwitch current={view} />
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      {bar ?? (
        <>
          <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
            <MobileViewSwitch current={view} />
            <div className={FRAME_STRIP_SCROLL}>{toolbar}</div>
            {mobileActions ? <div className="flex shrink-0 items-center gap-1.5 md:hidden">{mobileActions}</div> : null}
          </div>
          {filters ? (
            <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
              <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>{filters}</div>
            </div>
          ) : null}
        </>
      )}
      {children}
    </div>
  )
}

export function RecordBar({ actions }: { actions?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
      <Link
        to="/regulatorio"
        aria-label={copy.regulatorio.back}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-900 outline-none hover:bg-fill-hover focus-visible:shadow-(--shadow-focus)"
      >
        <ArrowLeft className="size-4" strokeWidth={iconStroke} />
      </Link>
      <span className="min-w-0 flex-1 truncate text-label text-text-tertiary">{copy.regulatorio.back}</span>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function RecordTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" aria-label={copy.regulatorio.tabs} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={value === item.id}
          aria-controls={`panel-${item.id}`}
          className={cn(
            'h-8 shrink-0 border-b-2 px-2 text-label',
            value === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
          )}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function FactCard({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h2 className="flex items-center gap-1.5 border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">
        {title}
        {help ? <InfoTip label={title}>{help}</InfoTip> : null}
      </h2>
      {children}
    </section>
  )
}

export function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className={cn('text-label break-words text-ink-900', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}

export function StatusBadge({ status, phase, size = 'md' }: { status: string; phase: string; size?: 'sm' | 'md' }) {
  const meta = statusMeta(status, phase)
  return (
    <StatusPill tone={meta.tone} dot size={size}>
      {meta.label}
    </StatusPill>
  )
}

export function Lifecycle({ status, phase }: { status: string; phase: string }) {
  const index = stepIndex(status, phase)
  const steps = [
    copy.regulatorio.statuses.draft,
    copy.regulatorio.statuses.validated,
    copy.regulatorio.statuses.pending_approval,
    copy.regulatorio.statuses.approved,
    copy.regulatorio.statuses.submitted,
    resultStepLabel(status, phase),
  ]
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption">
      {steps.map((label, step) => (
        <li key={`${label}-${step}`} className="inline-flex items-center gap-1.5">
          {step > 0 ? (
            <span className="text-text-tertiary" aria-hidden>
              ·
            </span>
          ) : null}
          <span className={step === index ? 'font-medium text-ink-900' : step < index ? 'text-text-secondary' : 'text-text-tertiary'}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function Retry({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      {copy.error.retry}
    </Button>
  )
}

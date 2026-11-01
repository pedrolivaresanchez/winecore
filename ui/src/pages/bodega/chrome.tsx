import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@/ui/icons'
import { Button } from '@/ui'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'

export function RecordBar({
  backTo,
  backLabel,
  children,
}: {
  backTo: string
  backLabel: string
  children?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
      <Button type="button" variant="ghost" size="sm" iconOnly aria-label={backLabel} onClick={() => navigate(backTo)}>
        <ArrowLeft strokeWidth={iconStroke} />
      </Button>
      <span className="min-w-0 truncate text-label text-text-tertiary">{backLabel}</span>
      {children ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{children}</div> : null}
    </header>
  )
}

export function SectionTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string
  tabs: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" aria-label={label} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={cn(
            'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
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

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}

export function FactCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{title}</h2>
      <dl>{children}</dl>
    </section>
  )
}

export function FillMeter({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full bg-ink-900" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function ReadingColumn({ children, screen, tab }: { children: ReactNode; screen: string; tab?: string }) {
  return (
    <div data-screen={screen} data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}

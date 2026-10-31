import { ChartBar } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'

export function ChartEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-subtle px-4 py-8 text-center">
      <ChartBar className="size-4 text-icon-muted" strokeWidth={iconStroke} aria-hidden />
      <p className="text-label font-medium text-ink-900">{title}</p>
      {hint ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
    </div>
  )
}

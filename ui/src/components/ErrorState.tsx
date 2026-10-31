import { Button } from '@/ui'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'

export function ErrorState({
  title,
  detail,
  onRetry,
  framed = true,
}: {
  title: string
  detail?: string
  onRetry?: () => void
  framed?: boolean
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3',
        framed && 'rounded-2xl border border-border-subtle bg-surface p-4 shadow-(--shadow-card)',
      )}
    >
      <p className="text-body font-medium text-ink-900">{title}</p>
      {detail ? <p className="text-label text-text-secondary">{detail}</p> : null}
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {copy.error.retry}
        </Button>
      ) : null}
    </div>
  )
}

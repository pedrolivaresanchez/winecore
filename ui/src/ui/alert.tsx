import { type ReactNode } from 'react'
import { AlertCircle, X } from './icons'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'

export type AlertTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral'

const tones: Record<AlertTone, { root: string; icon: string }> = {
  danger: { root: 'bg-danger-50 text-danger-700', icon: 'text-danger-500' },
  warning: { root: 'bg-warning-50 text-warning-700', icon: 'text-warning-500' },
  info: { root: 'bg-info-50 text-info-700', icon: 'text-info-500' },
  success: { root: 'bg-success-50 text-success-700', icon: 'text-success-500' },
  neutral: { root: 'bg-ink-50 text-control', icon: 'text-control' },
}

/**
 * Soft tinted banner — Counsel compliance alert pattern.
 */
export function Alert({
  tone = 'danger',
  children,
  icon,
  onDismiss,
  className,
}: {
  tone?: AlertTone
  children: ReactNode
  icon?: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-ink-900/10 px-4 py-2.5 text-body',
        tones[tone].root,
        className,
      )}
    >
      <span className={cn('flex shrink-0', tones[tone].icon)}>
        {icon ?? <AlertCircle className="size-4" strokeWidth={iconStroke} />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex shrink-0 text-ink-400 transition-colors hover:text-ink-600"
        >
          <X className="size-4" strokeWidth={iconStroke} />
        </button>
      )}
    </div>
  )
}

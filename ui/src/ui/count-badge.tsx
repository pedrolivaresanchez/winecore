import { cn } from '../lib/cn'

const FACE: Record<'success' | 'flame' | 'danger', string> = {
  success: 'bg-success-50 text-success-700',
  flame: 'bg-flame-50 text-flame-700',
  /* Solid red, white number: a to-do count, not a size. Always-white so dark
     mode cannot invert the figure into the fill. */
  danger: 'bg-danger-500 text-white',
}

const DOT =
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-caption font-medium leading-none tabular-nums'

/* Glyph-sized, for a count on a 14px icon: the 18px pill covered the icon it counted. */
const DOT_SM =
  'inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-[3px] text-[10px] font-medium leading-none tabular-nums'
/* `.t-badge` sits outside the utility layer, so its offset can only be moved by a style. */
const SM_OFFSET = { top: -4, right: -5 }

/**
 * A small count that slides onto a relatively-positioned trigger
 * (transitions.dev notification badge). Only the badge moves — the trigger
 * stays put.
 *
 * `inline` is the same face sitting in a row (the missed-call count on
 * Llamadas) rather than overlaying a glyph. No slide: it is a caption, not
 * an arrival.
 *
 * `size="sm"` is for a glyph in the collapsed rail, where the count sits on
 * the icon's corner rather than beside a label.
 */
export function CountBadge({
  count,
  tone = 'success',
  inline = false,
  size = 'md',
  className,
  title,
}: {
  count: number
  tone?: 'success' | 'flame' | 'danger'
  inline?: boolean
  size?: 'md' | 'sm'
  className?: string
  title?: string
}) {
  const label = count > 99 ? '99+' : String(count)
  const face = <span className={cn('t-badge-dot', size === 'sm' ? DOT_SM : DOT, FACE[tone])}>{label}</span>

  if (inline) {
    if (count <= 0) return null
    return (
      <span className={className} title={title} aria-label={title}>
        <span className={cn(DOT, FACE[tone])}>{label}</span>
      </span>
    )
  }

  const open = count > 0
  return (
    <span
      className={cn('t-badge', className)}
      style={size === 'sm' ? SM_OFFSET : undefined}
      data-open={open ? 'true' : 'false'}
      title={title}
    >
      {face}
    </span>
  )
}

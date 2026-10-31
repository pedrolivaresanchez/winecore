import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { isTagTone, tagToneClass, type TagTier, type TagTone } from './tag-palette'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'flame'

/** What a state means, drawn in the catalog palette so a status and a category agree on green. */
const STATE_TONE: Record<BadgeTone, TagTone> = {
  neutral: 'neutral',
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'blue',
  flame: 'orange',
}

export function badgeTone(tone: BadgeTone | TagTone): TagTone {
  return isTagTone(tone) ? tone : STATE_TONE[tone]
}

export type BadgeSize = 'sm' | 'md'
export type BadgeVariant = 'tint' | 'dot'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** A state (`success`, `danger`…) or a palette tone (`teal`, `violet`…). */
  tone?: BadgeTone | TagTone
  /** A deeper step of the tone, for the catalog value that has to stay apart from its neighbour. */
  tier?: TagTier
  /** A leading dot in the tone. */
  dot?: boolean
  /**
   * `tint` is the chip. `dot` is the word beside a coloured dot with no fill — a state inside
   * a line of meta, where a row of pills would be louder than the thing they describe.
   */
  variant?: BadgeVariant
  /** `md` is 24px, the grid's; `sm` is 20px, for a chip inside a dense line. */
  size?: BadgeSize
  /** A 12px glyph ahead of the word. */
  icon?: ReactNode
  /** A count after the word, or the whole chip when there is no word. */
  count?: number
}

const SIZE: Record<BadgeSize, { root: string; pad: string; icon: string; square: string }> = {
  md: { root: 'h-6 gap-1.5', pad: 'px-2', icon: 'pl-1.5 pr-2', square: 'min-w-6 justify-center px-1.5' },
  sm: { root: 'h-5 gap-1', pad: 'px-1.5', icon: 'pl-1 pr-1.5', square: 'min-w-5 justify-center px-1' },
}

/**
 * The chip's face as classes, so a button or a cell can wear it without being a `Badge`.
 *
 * Fully round and rimless: a soft tint of the tone with its ink. A chip is a label, not a
 * control — the CRM's controls are square, so a capsule is never mistaken for one of them.
 */
export function badgeClass({
  tone = 'neutral',
  tier = 1,
  size = 'md',
  variant = 'tint',
}: Pick<BadgeProps, 'tone' | 'tier' | 'size' | 'variant'> = {}): string {
  const colour = tagToneClass({ tone: badgeTone(tone), tier })
  return cn(badgeShapeClass(size), colour, variant === 'tint' ? 'tag' : 'gap-1.5 text-text-secondary')
}

/** The chip's geometry alone, for a face whose colour comes from somewhere else. */
export function badgeShapeClass(size: BadgeSize = 'md'): string {
  return cn(
    'inline-flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full text-caption font-medium',
    SIZE[size].root,
  )
}

export function Badge({
  tone = 'neutral',
  tier,
  dot = false,
  variant = 'tint',
  size = 'md',
  icon,
  count,
  className,
  children,
  ...props
}: BadgeProps) {
  const hasWord = children != null && children !== false && children !== ''
  const countOnly = !hasWord && count != null
  const showDot = dot || variant === 'dot'
  return (
    <span
      className={cn(
        badgeClass({ tone, tier, size, variant }),
        variant === 'tint' &&
          (countOnly ? SIZE[size].square : icon || showDot ? SIZE[size].icon : SIZE[size].pad),
        'leading-[var(--text-caption--line-height)]',
        className,
      )}
      {...props}
    >
      {showDot ? <span aria-hidden className="tag-dot size-1.5 shrink-0 rounded-full" /> : null}
      {icon ? <span className="flex shrink-0 items-center [&_svg]:size-3">{icon}</span> : null}
      {hasWord ? children : null}
      {count != null ? (
        <span className={cn('shrink-0 tabular-nums', hasWord && 'opacity-70')}>{count}</span>
      ) : null}
    </span>
  )
}

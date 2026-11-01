import type { ReactNode } from 'react'
import { Badge, badgeClass, type BadgeProps, type BadgeSize } from './badge'
import type { GlyphTint } from './object-glyph'
import type { TagTone } from './tag-palette'
import type { StatusTone } from '../lib/status-tones'

/**
 * A status tone drawn in the catalog palette, so a state chip and a catalog chip share one
 * family of tints and SDR's ladder lands on the same twenty hues. The glyph tints are the
 * solid squares an object mark wears; a status that also marks an object takes its tint here.
 */
export const STATUS_TAG_TONE: Record<StatusTone, TagTone> = {
  neutral: 'neutral',
  slate: 'slate',
  info: 'blue',
  sky: 'sky',
  cyan: 'cyan',
  mint: 'emerald',
  success: 'green',
  warning: 'amber',
  flame: 'orange',
  danger: 'red',
  pink: 'pink',
  purple: 'purple',
  violet: 'violet',
}

export const STATUS_GLYPH_TINT: Record<StatusTone, GlyphTint> = {
  neutral: 'slate',
  slate: 'slate',
  info: 'info',
  sky: 'sky',
  cyan: 'cyan',
  mint: 'mint',
  success: 'success',
  warning: 'warning',
  flame: 'flame',
  danger: 'red',
  pink: 'pink',
  purple: 'purple',
  violet: 'violet',
}

/** The pill's face as classes, for a button or a menu row that has to wear it. */
export function statusPillClass(tone: StatusTone, size: BadgeSize = 'md'): string {
  return badgeClass({ tone: STATUS_TAG_TONE[tone], size })
}

export type StatusPillProps = Omit<BadgeProps, 'tone' | 'tier' | 'variant'> & {
  tone: StatusTone
  /** `dot` is the word beside a coloured dot, for a state inside a line of meta. */
  variant?: BadgeProps['variant']
  children?: ReactNode
}

/** A state as a chip: «Pagado» in green, «Vencido» in red. Tones from `@/lib/status-tones`. */
export function StatusPill({ tone, size = 'sm', ...props }: StatusPillProps) {
  return <Badge tone={STATUS_TAG_TONE[tone]} size={size} {...props} />
}

import { forwardRef, type ReactNode } from 'react'
import { ChevronDown } from './icons'
import { cn } from '../lib/cn'
import { textureSecondary } from './button'
import { iconStroke } from '../lib/motion'

/**
 * A control that looks like a field and opens a menu.
 *
 * The filter, sort and view-settings panels are built out of rows of these, and they are
 * neither buttons nor selects. A `Button` is an action — pressing it does something — and
 * these do not: they show the current value of one slot in a sentence the reader is
 * assembling, and pressing one opens the list of other values it could hold. A native
 * `Select` would be the honest control but cannot show an icon, a two-part path, a colour
 * chip or a search field, which is most of what these slots contain.
 *
 * Chrome is `textureSecondary`, the same white face the secondary button and every input
 * wear, so a row of them reads as one line of fields rather than three unrelated widgets.
 *
 * Pair with `GlassMenu`: this is the trigger, the menu is the list.
 */
export type FieldButtonProps = {
  children?: ReactNode
  onClick?: () => void
  /** Leading glyph — the attribute's type icon, the sort direction, the value's colour. */
  icon?: ReactNode
  /**
   * Right-hand slot, replacing the chevron. For the and/or joiner's swap glyph, which is
   * a different promise: it cycles rather than opens.
   */
  trailing?: ReactNode
  /** Drops the chevron for a field whose whole affordance is its trailing slot. */
  chevron?: boolean
  /** Shown, greyed, when there is no value yet. */
  placeholder?: string
  /**
   * `field` — the default white face.
   * `quiet` — no face at all, for a slot that states a fixed word rather than offering
   *   a choice (the leading `Where` of a filter row).
   * `outline` — a dashed rim, for a slot that repeats a choice made on another row.
   */
  variant?: 'field' | 'quiet' | 'outline'
  disabled?: boolean
  active?: boolean
  title?: string
  /** Off for short fixed labels (and/or joiners) that must not ellipsize. */
  truncate?: boolean
  className?: string
}

export const FieldButton = forwardRef<HTMLButtonElement, FieldButtonProps>(function FieldButton(
  {
    children,
    onClick,
    icon,
    trailing,
    chevron = true,
    placeholder,
    variant = 'field',
    disabled,
    active,
    title,
    truncate = true,
    className,
  },
  ref,
) {
  const empty = children === null || children === undefined || children === ''

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      title={title}
      aria-expanded={active === undefined ? undefined : active}
      className={cn(
        'inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-left text-label',
        'outline-none transition-[background-image,border-color,box-shadow,color]',
        'duration-(--duration-quick) ease-(--ease-smooth-out)',
        'focus-visible:border-border-strong focus-visible:shadow-(--shadow-focus)',
        variant === 'field' && textureSecondary,
        variant === 'quiet' && 'border border-transparent text-text-tertiary',
        variant === 'quiet' && onClick && 'hover:bg-fill-hover hover:text-ink-900',
        variant === 'outline' && 'border border-dashed border-border text-text-tertiary',
        variant !== 'quiet' && (active ? 'text-ink-900' : 'text-control'),
        disabled && !onClick && 'pointer-events-none',
        disabled && 'opacity-45',
        className,
      )}
    >
      {icon ? (
        <span className="flex shrink-0 items-center justify-center text-icon-muted [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}

      <span
        className={cn('min-w-0 flex-1', truncate && 'truncate', empty && 'text-text-tertiary')}
      >
        {empty ? placeholder : children}
      </span>

      {trailing ??
        (chevron && variant !== 'quiet' ? (
          <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
        ) : null)}
    </button>
  )
})

/**
 * The row of fields itself, with its grab handle and trailing controls.
 *
 * A row rather than a flex utility at each call site because all three panels lay out the
 * same way — handle, fields, row menu — and a filter row that is two pixels off the sort
 * row above it is the kind of thing nobody reports and everybody notices.
 */
export function FieldRow({
  handle,
  children,
  trailing,
  className,
}: {
  handle?: ReactNode
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {handle ? <span className="flex size-4 shrink-0 items-center justify-center">{handle}</span> : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {trailing ? <span className="flex shrink-0 items-center gap-0.5">{trailing}</span> : null}
    </div>
  )
}

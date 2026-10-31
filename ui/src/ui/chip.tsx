import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'
import { X } from './icons'

/**
 * A named thing on a form: a recipient, a guest, the account a task is about, a search
 * term. The chip the mail composer introduced, made the chip for every entity token.
 *
 * ## The shape
 *
 * A 24px pill on the `fill-selected` wash — no rim, no lift — with the name in caption type
 * and, when the thing can be taken off, a faint × that only turns to ink under the pointer.
 * The wash says "this is held", the missing rim says it is not a control: a chip that lights
 * up on hover must do something, and this one only shows what has been chosen. The × is the
 * control, and it is its own hit target (24px through the padded pseudo-element) so the
 * chip does not have to grow around it.
 *
 * A pill even in the CRM, whose chrome is square: the token is not chrome. It carries a
 * round face — an avatar, a company mark — and a capsule around a circle is the one place
 * a square corner reads as a cropped mistake rather than a house style. Status chips
 * (`CatalogChip`, `Badge`) keep their squared candy; this is for *who* and *what*, not
 * *which state*.
 *
 * ## Padding
 *
 * A leading mark hugs the round end (`pl-1`); text alone sits at `pl-2`. The × side closes
 * to `pr-1` so the button's own circle finishes the capsule.
 */
export interface EntityChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** An avatar, a record mark, a glyph. 16px — `size="2xs"` on the marks. */
  leading?: ReactNode
  /** Present when the thing can be taken off. The × is rendered for you. */
  onRemove?: () => void
  /** Required with `onRemove`: what the × does, for the screen reader. */
  removeLabel?: string
}

export const entityChipClass = cn(
  'inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full',
  'bg-fill-selected text-caption text-text',
)

export const EntityChip = forwardRef<HTMLSpanElement, EntityChipProps>(
  ({ leading, onRemove, removeLabel, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        entityChipClass,
        leading ? 'pl-1' : 'pl-2',
        onRemove ? 'pr-1' : 'pr-2',
        className,
      )}
      {...props}
    >
      {leading ? <span className="flex shrink-0 items-center [&>*]:shrink-0">{leading}</span> : null}
      {children}
      {onRemove ? <ChipRemove aria-label={removeLabel} onClick={onRemove} /> : null}
    </span>
  ),
)
EntityChip.displayName = 'EntityChip'

/**
 * The × on a chip. 16px drawn, 24px reachable: the pseudo-element pads the target out
 * without the chip growing to fit it. Faint at rest so a row of ten does not read as a row
 * of ten buttons; ink and a wash under the pointer.
 */
export const ChipRemove = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'relative inline-flex size-4 shrink-0 items-center justify-center rounded-full',
        'text-text-tertiary outline-none',
        'before:absolute before:-inset-1 before:content-[""]',
        'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
        /* `ink-200`, not `fill-hover`: the hover wash is mixed for paper, and on the chip's
           own wash it would come out a shade *lighter* — a hole where a press should be. */
        'hover:bg-ink-200 hover:text-text focus-visible:shadow-(--shadow-focus)',
        '[&_svg]:size-2.5',
        className,
      )}
      {...props}
    >
      {children ?? <X strokeWidth={iconStroke} />}
    </button>
  ),
)
ChipRemove.displayName = 'ChipRemove'

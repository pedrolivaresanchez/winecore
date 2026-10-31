import { useId, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '../lib/cn'
import { nestedRadius } from '../lib/radius'
import { tabsMotion } from '../lib/motion'

export interface SegmentedOption<T extends string> {
  value: T
  content: ReactNode
  'aria-label'?: string
  /**
   * An option that exists but is not available to this user. Shown rather than removed:
   * a ladder missing its top rung reads as a shorter ladder, and the person looking at it
   * needs to know the rung is there and closed to them.
   */
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** `pill` fully rounds the track and thumb — filter chips, tab-like tools. */
  shape?: 'default' | 'pill'
  /**
   * `md` (32px) is the default for page filters and inspectors.
   * `sm` (28px) is for dense chrome — account menus, tight toolbars.
   */
  size?: 'sm' | 'md'
  /**
   * Stretch to the parent width with equal segments. Default is fit-content —
   * page filter bars should stay compact; use `fill` only for panel tabs.
   */
  fill?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Two sizes on the control-height grid: `md` 32px (default), `sm` 28px for
 * dense chrome. Page filters and inspectors stay on `md` so side-by-side
 * switches never drift; menus use `sm`.
 *
 * Sizes to its labels by default. Pass `fill` when the control should span its
 * parent (inspector tabs). Never pass ad-hoc widths to fake either mode.
 *
 * 1px track padding — white thumb nearly flush with the gray track.
 * Icons inherit text-control (#52525A) at 14px / 1.5 stroke (`md`).
 */
const SIZES = {
  sm: {
    height: 'h-7',
    segment: 'px-1.5 [&_svg]:size-3',
    pillSegment: 'px-2',
    label: 'text-caption',
  },
  md: {
    height: 'h-8',
    segment: 'px-2.5 [&_svg]:size-3.5',
    pillSegment: 'px-3.5',
    label: 'text-label',
  },
} as const

const RADIUS = 8
const PADDING = 1

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  shape = 'default',
  size = 'md',
  fill = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const trackRadius = shape === 'pill' ? 999 : RADIUS
  const segmentRadius = shape === 'pill' ? 999 : nestedRadius(RADIUS, PADDING)
  const reduce = useReducedMotion()
  const thumbId = useId()
  const sizeStyles = SIZES[size]

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ borderRadius: trackRadius, padding: PADDING }}
      className={cn(
        'relative inline-flex items-stretch bg-ink-100',
        sizeStyles.height,
        fill ? 'w-full max-w-full' : 'w-fit shrink-0',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option['aria-label']}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-0 inline-flex items-center justify-center outline-none select-none',
              'transition-colors duration-(--duration-fast) ease-(--ease-smooth-out)',
              'focus-visible:shadow-(--shadow-focus)',
              '[&_svg]:shrink-0 [&_svg]:stroke-[1.5]',
              sizeStyles.segment,
              shape === 'pill' && sizeStyles.pillSegment,
              fill ? 'min-w-0 flex-1' : 'shrink-0',
              /* The pressed segment is the answer, so it reads a weight heavier and the rest a
                 shade quieter: on a light track a white thumb alone was not enough to tell
                 which of three words was chosen (Pedro, 9 September). */
              option.disabled
                ? 'cursor-not-allowed text-control/35'
                : active
                  ? 'font-medium text-control'
                  : 'text-control/60 hover:text-control',
            )}
          >
            {active && (
              /* Symmetric, and deliberately not split into an open/close pair: the thumb
                 reads as one reversible motion, so both directions share the tab timing. */
              <motion.span
                layoutId={thumbId}
                className="absolute inset-0 -z-10 border border-border bg-surface shadow-(--shadow-raised)"
                style={{ borderRadius: segmentRadius }}
                transition={tabsMotion(reduce)}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex items-center justify-center gap-1.5 leading-none',
                sizeStyles.label,
              )}
            >
              {option.content}
            </span>
          </button>
        )
      })}
    </div>
  )
}

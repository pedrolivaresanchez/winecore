import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Empty / instructional state.
 *
 * Page empties (`lg`, the default) are an isometric stage, a heading, a lede and an
 * optional action — the composition of a first-use canvas, not a card floating in a
 * table. Compact `sm` uses the same stage, scaled down, for drawers and side panes.
 *
 * Pass the raw icon glyph; EmptyState sizes it and lays it on the isometric top face. Pass
 * `illustration` instead when the empty state is about something with a face of its own —
 * the marks of the channels a rep has not connected yet — and it takes the stage's box.
 *
 * It arrives on the skeleton-reveal timing, because it is usually what a load resolved to.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  footer,
  className,
  framed = false,
  size = 'lg',
}: {
  icon?: ReactNode
  /** Replaces the isometric stage, inside the same 160×144 box (120×108 at `sm`). */
  illustration?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** Optional “learn more” row under the action. Full width of the copy column. */
  footer?: ReactNode
  className?: string
  framed?: boolean
  size?: 'sm' | 'lg'
}) {
  const large = size === 'lg'

  return (
    <div
      role="status"
      className={cn(
        'flex animate-fade-up flex-col items-center justify-center text-center motion-reduce:animate-none',
        framed &&
          'rounded-2xl border border-border bg-surface-subtle px-6 py-16 shadow-(--shadow-panel)',
        !framed && (large ? 'w-full max-w-md px-6 py-4' : 'px-6 py-12'),
        className,
      )}
    >
      {illustration ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none flex items-center justify-center',
            large ? 'h-36 w-40' : 'h-27 w-30',
          )}
        >
          {illustration}
        </div>
      ) : (
        <EmptyFigure compact={!large}>{icon}</EmptyFigure>
      )}
      <h3
        className={cn(
          'mt-6 max-w-sm text-balance font-medium tracking-tight text-ink-900',
          large ? 'text-heading' : 'text-body',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            'mt-2 text-pretty leading-relaxed text-text-secondary',
            large ? 'max-w-xs text-body' : 'max-w-sm text-label',
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
      {footer ? <div className="mt-16 w-full max-w-md text-left">{footer}</div> : null}
    </div>
  )
}

/** Top-face centre Y in the 160×144 stage (cy 52). */
const TOP_FACE_Y = `${(52 / 144) * 100}%`
/** Vertical/horizontal diagonals of the top-face diamond (52 / 96). */
const ISO_SQUASH = 52 / 96

/**
 * Isometric slab. The glyph is laid on the top face so it reads as part of
 * the object — a mark on the plane, not a 2D sticker in front of it.
 *
 * Stage is 160×144. Top-face diamond: (80,26) (128,52) (80,78) (32,52).
 * rotate(-45deg) then scaleY(ISO_SQUASH) maps a square onto that diamond.
 * Compact is the same geometry at 3/4 (h-27 w-30 = 0.75 × h-36 w-40).
 */
function EmptyFigure({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none relative text-border-strong',
        compact ? 'h-27 w-30' : 'h-36 w-40',
      )}
      aria-hidden
    >
      <svg viewBox="0 0 160 144" className="size-full overflow-visible" fill="none">
        <ellipse cx="80" cy="128" rx="38" ry="7" className="fill-ink-900/8" />
        <path d="M80 78 L128 52 L128 94 L80 120 Z" className="fill-surface-muted" />
        <path d="M32 52 L80 78 L80 120 L32 94 Z" className="fill-surface-subtle" />
        <path d="M80 26 L128 52 L80 78 L32 52 Z" className="fill-surface" />
        <path
          d="M80 26 L128 52 L128 94 L80 120 L32 94 L32 52 Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M32 52 L80 78 L128 52 M80 78 L80 120"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className={cn(
          'absolute left-1/2 origin-center text-ink-900 [&_svg]:overflow-visible',
          compact ? '[&_svg]:size-6' : '[&_svg]:size-8',
        )}
        style={{
          top: TOP_FACE_Y,
          transform: `translate(-50%, -50%) scaleY(${ISO_SQUASH}) rotate(-45deg)`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

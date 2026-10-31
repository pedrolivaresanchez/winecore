import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Loading placeholder — the transitions.dev skeleton pulse.
 *
 * Size it with width/height utilities to match the content it stands in for;
 * never leave it square by default.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('t-skel-bar rounded-md bg-ink-100', className)} {...props} />
}

/** Widths that repeat without a rhythm the eye can catch — a column of equal bars reads as a table of blanks. */
const ROW_WIDTHS = ['w-1/2', 'w-2/5', 'w-3/5', 'w-1/3', 'w-[45%]'] as const

/**
 * A paragraph in waiting: 12px bars on the 20px line of `text-label`, the last one short
 * because that is how prose ends.
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3', lines > 1 && index === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  )
}

/**
 * Rows of a list or a feed: the 20px mark every row leads with, a title, and the meta that
 * sits at the end — so the loaded rows land where the placeholders were instead of under them.
 */
export function SkeletonRows({
  rows = 4,
  meta = true,
  className,
}: {
  rows?: number
  meta?: boolean
  className?: string
}) {
  return (
    <div aria-hidden className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-9 items-center gap-2.5">
          <Skeleton className="size-5 shrink-0 rounded-xs" />
          <div className="min-w-0 flex-1">
            <Skeleton className={cn('h-3', ROW_WIDTHS[index % ROW_WIDTHS.length])} />
          </div>
          {meta ? <Skeleton className="h-3 w-14 shrink-0" /> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Pulse a placeholder, then cross-fade + cross-blur to the loaded content
 * in the same slot (transitions.dev skeleton reveal).
 *
 * Mount both layers when you can; if `children` is null while loading, the
 * skeleton owns the size, then the content fades in over it.
 */
export function SkeletonReveal({
  loading,
  skeleton,
  children,
  className,
}: {
  loading: boolean
  skeleton: ReactNode
  children?: ReactNode
  className?: string
}) {
  const [revealed, setRevealed] = useState(!loading)

  useEffect(() => {
    if (loading) {
      setRevealed(false)
      return
    }
    const id = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(id)
  }, [loading])

  return (
    <div
      className={cn('t-skel', revealed && 'is-revealed', className)}
      data-state={loading ? 'loading' : 'ready'}
      aria-busy={loading || undefined}
    >
      <div className="t-skel-skeleton is-pulsing" aria-hidden>
        {skeleton}
      </div>
      <div className="t-skel-content">{children}</div>
    </div>
  )
}

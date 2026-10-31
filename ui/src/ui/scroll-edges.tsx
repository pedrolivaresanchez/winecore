import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cn } from '../lib/cn'

export type ScrollEdges = {
  /** Content has passed under the left edge: the pinned column wears its veil. */
  start: boolean
  /** More columns wait past the right edge. */
  end: boolean
}

/**
 * Which horizontal edges of `ref` hide content right now. Read on scroll and whenever the
 * scroller or its content resizes — a column that widens to fit its numbers can push the
 * table past the frame without anybody scrolling.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const read = () => {
      const start = node.scrollLeft > 0
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    read()
    node.addEventListener('scroll', read, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    observer?.observe(node)
    if (node.firstElementChild) observer?.observe(node.firstElementChild)
    return () => {
      node.removeEventListener('scroll', read)
      observer?.disconnect()
    }
  }, [ref])

  return edges
}

/**
 * The cue that a table runs on past the right edge: the pinned column's veil, mirrored.
 * At rest a scrollbar is invisible on most machines, and a column cut by the frame reads
 * as the last one. Sits over the scroller, not in it, so it stays on the edge.
 */
export function ScrollEdgeVeil({ show, className }: { show: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      data-scroll-veil
      className={cn(
        'scroll-veil-end pointer-events-none absolute inset-y-0 right-0 z-(--z-sticky)',
        'transition-opacity duration-(--duration-quick) ease-(--ease-smooth-out)',
        show ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}

/**
 * What `Table` does by itself, for a `<table>` built by hand: past `minWidth` it scrolls
 * sideways instead of crushing its columns into each other, and the far edge says when
 * more waits there.
 */
export function TableScroller({
  minWidth,
  className,
  children,
}: {
  /**
   * The narrowest a fixed-layout table reads at — every column at the width its content
   * needs. An auto-layout table already sizes to its content and leaves this out.
   */
  minWidth?: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref)
  return (
    <div className={cn('relative min-w-0', className)}>
      <div ref={ref} className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>{children}</div>
      </div>
      <ScrollEdgeVeil show={edges.end} />
    </div>
  )
}

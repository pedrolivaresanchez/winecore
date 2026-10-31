import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { Tooltip } from './tooltip'

/**
 * A figure in a tile. The full amount stays when it fits; otherwise the short
 * form (`176,1 mil €`) is shown and the exact value is the tooltip.
 */
export function FitAmount({
  full,
  short,
  className,
}: {
  full: string
  short: string
  className?: string
}) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const [tight, setTight] = useState(false)

  useLayoutEffect(() => {
    const box = boxRef.current
    const probe = probeRef.current
    if (!box || !probe) return
    const measure = () => {
      const overflow = short !== full && probe.scrollWidth > box.clientWidth + 1
      setTight((current) => (current === overflow ? current : overflow))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [full, short])

  const text = tight ? short : full
  return (
    <span ref={boxRef} className={cn('relative block min-w-0 max-w-full', className)}>
      <span ref={probeRef} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap">
        {full}
      </span>
      {tight ? (
        <Tooltip label={full}>
          <span tabIndex={0} className="block truncate outline-none focus-visible:shadow-(--shadow-focus)">
            {text}
          </span>
        </Tooltip>
      ) : (
        <span className="block truncate">{text}</span>
      )}
    </span>
  )
}

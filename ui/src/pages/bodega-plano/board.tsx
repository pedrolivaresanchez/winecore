import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { attachmentUrl } from '@/pages/bodega-plano/api'
import { clampGeom } from '@/pages/bodega-plano/geom'
import type { Geom, PlanMarker } from '@/pages/bodega-plano/types'

function boxStyle(geom: Geom, board: { w: number; h: number }): CSSProperties {
  return {
    left: `${(geom.x / board.w) * 100}%`,
    top: `${(geom.y / board.h) * 100}%`,
    width: `${(geom.width / board.w) * 100}%`,
    height: `${(geom.height / board.h) * 100}%`,
    transform: geom.rotation ? `rotate(${geom.rotation}deg)` : undefined,
  }
}

function face(): string {
  return 'rounded-2xl'
}

function caption(marker: PlanMarker): string {
  if (marker.lot) return marker.lot
  if (marker.outdoor) return copy.plano.intemperie
  return copy.plano.empty
}

export function PlanBoard({
  imageId,
  markers,
  board,
  editing,
  selected,
  highlight,
  onSelect,
  onChange,
  fit = false,
}: {
  imageId: string | null
  markers: PlanMarker[]
  board: { w: number; h: number }
  editing: boolean
  selected: string | null
  highlight: string | null
  onSelect: (key: string | null) => void
  onChange: (positionId: string, geom: Geom) => void
  /** Fill the remaining column while a strip sits under the plan. */
  fit?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<(() => void) | null>(null)

  useEffect(() => () => drag.current?.(), [])

  function begin(event: ReactPointerEvent, mode: 'move' | 'resize', marker: PlanMarker) {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    const el = root.current
    if (!el) return
    onSelect(marker.key)
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const origin = marker.geom
    const startX = event.clientX
    const startY = event.clientY
    function move(ev: PointerEvent) {
      const dx = ((ev.clientX - startX) / rect.width) * board.w
      const dy = ((ev.clientY - startY) / rect.height) * board.h
      const next =
        mode === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : { ...origin, width: origin.width + dx, height: origin.height + dy }
      onChange(marker.positionId, clampGeom(next, board.w, board.h))
    }
    function end() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      drag.current = null
    }
    drag.current = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <div
      ref={root}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border-subtle bg-surface-subtle',
        editing && 'touch-none',
        fit ? 'mx-auto h-full w-auto max-w-full' : 'w-full',
      )}
      style={{ aspectRatio: `${board.w} / ${board.h}` }}
      onPointerDown={() => {
        if (editing) onSelect(null)
      }}
    >
      <PlanBackdrop imageId={imageId} />
      {markers.map((marker) => {
        const active = selected === marker.key || highlight === marker.code
        const label = `${marker.code}, ${Math.round(marker.fill)} %, ${caption(marker)}`
        const style = boxStyle(marker.geom, board)
        const card = (
          <span
            className={cn(
              'flex h-full w-full min-w-0 flex-col gap-1 overflow-hidden border bg-surface px-2 py-1.5 text-left shadow-(--shadow-card)',
              face(),
              active ? 'border-ink-900' : 'border-border',
            )}
          >
            <span className="truncate text-label font-medium leading-none text-ink-900">{marker.code}</span>
            <span className="truncate text-caption leading-none text-text-tertiary">{caption(marker)}</span>
            <span
              className="mt-auto h-1 w-full overflow-hidden rounded-full bg-ink-100"
              role="meter"
              aria-valuenow={Math.round(marker.fill)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${copy.plano.fill} ${Math.round(marker.fill)} %`}
            >
              <span className="block h-full bg-ink-900" style={{ width: `${marker.fill}%` }} />
            </span>
          </span>
        )
        if (!editing) {
          return (
            <Link
              key={marker.key}
              to={marker.href}
              data-code={marker.code}
              aria-label={label}
              className="absolute hover:z-sticky"
              style={style}
            >
              {card}
            </Link>
          )
        }
        return (
          <div
            key={marker.key}
            role="button"
            tabIndex={0}
            data-code={marker.code}
            aria-label={label}
            aria-pressed={selected === marker.key}
            className="absolute cursor-grab outline-none focus-visible:shadow-(--shadow-focus) active:cursor-grabbing"
            style={style}
            onPointerDown={(event) => begin(event, 'move', marker)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(marker.key)
              }
            }}
          >
            {card}
            <span
              role="button"
              aria-label={copy.plano.resize}
              tabIndex={-1}
              className="absolute -right-1 -bottom-1 size-3.5 cursor-nwse-resize rounded-full border border-ink-900 bg-surface shadow-(--shadow-card)"
              onPointerDown={(event) => begin(event, 'resize', marker)}
            />
          </div>
        )
      })}
    </div>
  )
}

function PlanBackdrop({ imageId }: { imageId: string | null }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    let current: string | null = null
    attachmentUrl(imageId)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        current = next
        setUrl(next)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (current) URL.revokeObjectURL(current)
    }
  }, [imageId])

  if (url) return <img src={url} alt="" className="absolute inset-0 size-full object-fill" />
  return (
    <svg className="absolute inset-0 size-full text-border-subtle" aria-hidden="true">
      <defs>
        <pattern id="plano-rejilla" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#plano-rejilla)" />
    </svg>
  )
}

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { attachmentUrl } from '@/pages/bodega-plano/api'
import { bandOf, faceClass, shapeClass, type ColourMode } from '@/pages/bodega-plano/colours'
import { clampGeom, NUDGE_STEP } from '@/pages/bodega-plano/geom'
import { PlanSchematic } from '@/pages/bodega-plano/schematic'
import type { Geom, PlanMarker, ZoneKind } from '@/pages/bodega-plano/types'

function boxStyle(geom: Geom, board: { w: number; h: number }): CSSProperties {
  return {
    left: `${(geom.x / board.w) * 100}%`,
    top: `${(geom.y / board.h) * 100}%`,
    width: `${(geom.width / board.w) * 100}%`,
    height: `${(geom.height / board.h) * 100}%`,
    transform: geom.rotation ? `rotate(${geom.rotation}deg)` : undefined,
  }
}

function litresLabel(raw: string): string | null {
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const negative = value < 0
  const [whole, frac] = Math.abs(value).toFixed(2).split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped},${frac ?? '00'} L`
}

function markerDetail(marker: PlanMarker): string {
  const litres = litresLabel(marker.litres)
  if (litres && Number(marker.litres.replace(',', '.')) > 0) return litres
  if (marker.fill > 0) return `${Math.round(marker.fill)} %`
  return litres ?? '0,00 L'
}

export function PlanBoard({
  imageId,
  zoneKind,
  markers,
  board,
  editing,
  selected,
  highlight,
  colourMode,
  boardRef,
  onSelect,
  onOpen,
  onChange,
}: {
  imageId: string | null
  zoneKind: ZoneKind | string
  markers: PlanMarker[]
  board: { w: number; h: number }
  editing: boolean
  selected: string | null
  highlight: string | null
  colourMode: ColourMode
  boardRef: RefObject<HTMLDivElement | null>
  onSelect: (key: string | null) => void
  onOpen: (marker: PlanMarker) => void
  onChange: (positionId: string, geom: Geom) => void
}) {
  const drag = useRef<(() => void) | null>(null)

  useEffect(() => () => drag.current?.(), [])

  function begin(event: ReactPointerEvent, mode: 'move' | 'resize', marker: PlanMarker) {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    const el = boardRef.current
    if (!el) return
    onSelect(marker.key)
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const origin = marker.geom
    const startX = event.clientX
    const startY = event.clientY
    function movePointer(ev: PointerEvent) {
      const dx = ((ev.clientX - startX) / rect.width) * board.w
      const dy = ((ev.clientY - startY) / rect.height) * board.h
      const next =
        mode === 'move'
          ? { ...origin, x: origin.x + dx, y: origin.y + dy }
          : { ...origin, width: origin.width + dx, height: origin.height + dy }
      onChange(marker.positionId, clampGeom(next, board.w, board.h))
    }
    function end() {
      window.removeEventListener('pointermove', movePointer)
      window.removeEventListener('pointerup', end)
      drag.current = null
    }
    drag.current = end
    window.addEventListener('pointermove', movePointer)
    window.addEventListener('pointerup', end)
  }

  function nudge(marker: PlanMarker, dx: number, dy: number) {
    onSelect(marker.key)
    onChange(
      marker.positionId,
      clampGeom({ ...marker.geom, x: marker.geom.x + dx, y: marker.geom.y + dy }, board.w, board.h),
    )
  }

  return (
    <div
      ref={boardRef}
      data-plan-board=""
      className="relative mx-auto rounded-2xl border border-border-subtle bg-surface-subtle"
      style={{ width: board.w, height: board.h }}
      onPointerDown={() => {
        if (editing) onSelect(null)
      }}
    >
      <PlanBackdrop imageId={imageId} zoneKind={zoneKind} />
      {markers.map((marker) => {
        const active = selected === marker.key || highlight === marker.code
        const kind = marker.subject === 'holder' ? marker.holderKind : marker.vesselKind
        const band = bandOf(colourMode, marker)
        const detail = markerDetail(marker)
        const label = `${marker.code}, ${detail}`
        const style = boxStyle(marker.geom, board)
        const face = (
          <span
            className={cn(
              'flex h-full w-full flex-col items-center justify-center overflow-hidden border-2 px-1 text-center shadow-(--shadow-card)',
              shapeClass(marker.subject, kind),
              faceClass(colourMode, marker),
              active && 'outline-2 outline-offset-2 outline-ink-900',
            )}
          >
            <span className="max-w-full truncate text-label font-medium leading-none">{marker.code}</span>
            <span className="max-w-full truncate text-caption leading-none opacity-80">{detail}</span>
          </span>
        )
        if (!editing) {
          return (
            <button
              key={marker.key}
              type="button"
              data-code={marker.code}
              data-kind={kind ?? ''}
              data-band={band}
              aria-label={label}
              className="absolute p-0 hover:z-sticky"
              style={style}
              onClick={() => onOpen(marker)}
            >
              {face}
            </button>
          )
        }
        return (
          <div
            key={marker.key}
            role="button"
            tabIndex={0}
            data-code={marker.code}
            data-kind={kind ?? ''}
            data-band={band}
            aria-label={label}
            aria-pressed={selected === marker.key}
            className="absolute cursor-grab touch-none p-0 outline-none focus-visible:shadow-(--shadow-focus) active:cursor-grabbing"
            style={style}
            onPointerDown={(event) => begin(event, 'move', marker)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(marker.key)
                return
              }
              const step = event.shiftKey ? 1 : NUDGE_STEP
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                nudge(marker, 0, -step)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                nudge(marker, 0, step)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                nudge(marker, -step, 0)
              } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                nudge(marker, step, 0)
              }
            }}
          >
            {face}
            <span
              role="button"
              aria-label={copy.plano.resize}
              tabIndex={-1}
              className="absolute right-1 bottom-1 z-sticky size-7 cursor-nwse-resize rounded-full border-2 border-ink-900 bg-surface shadow-(--shadow-card) max-sm:after:absolute max-sm:after:-inset-2 max-sm:after:content-['']"
              onPointerDown={(event) => begin(event, 'resize', marker)}
            />
          </div>
        )
      })}
    </div>
  )
}

function PlanBackdrop({ imageId, zoneKind }: { imageId: string | null; zoneKind: ZoneKind | string }) {
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

  if (url) return <img src={url} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
  return <PlanSchematic kind={zoneKind} />
}

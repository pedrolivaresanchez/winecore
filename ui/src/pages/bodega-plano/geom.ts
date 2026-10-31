import type { Geom } from '@/pages/bodega-plano/types'

export const BOARD_W = 1000
export const BOARD_H = 640

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function pctOf(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, parsed))
}

export function sameGeom(left: Geom, right: Geom): boolean {
  return (
    Math.abs(left.x - right.x) < 0.05 &&
    Math.abs(left.y - right.y) < 0.05 &&
    Math.abs(left.width - right.width) < 0.05 &&
    Math.abs(left.height - right.height) < 0.05 &&
    Math.abs(left.rotation - right.rotation) < 0.05
  )
}

export function clampGeom(geom: Geom, boardW = BOARD_W, boardH = BOARD_H): Geom {
  const width = Math.min(Math.max(48, geom.width), boardW)
  const height = Math.min(Math.max(36, geom.height), boardH)
  const x = Math.min(Math.max(0, geom.x), Math.max(0, boardW - width))
  const y = Math.min(Math.max(0, geom.y), Math.max(0, boardH - height))
  let rotation = geom.rotation
  if (!Number.isFinite(rotation)) rotation = 0
  rotation = Math.max(-360, Math.min(360, rotation))
  return {
    x: round1(x),
    y: round1(y),
    width: round1(width),
    height: round1(height),
    rotation: round1(rotation),
  }
}

export function boardSize(geoms: readonly Geom[]): { w: number; h: number } {
  let w = BOARD_W
  let h = BOARD_H
  for (const geom of geoms) {
    w = Math.max(w, geom.x + geom.width + 24)
    h = Math.max(h, geom.y + geom.height + 24)
  }
  return { w, h }
}

export const NUDGE_STEP = 10

/** Width and height that keep the code readable and the kind recognisable. */
export function markerSize(subject: 'vessel' | 'holder', kind: string | null): { width: number; height: number } {
  if (subject === 'holder') return kind === 'nicho' ? { width: 88, height: 64 } : { width: 168, height: 104 }
  switch (kind) {
    case 'barrel':
      return { width: 108, height: 64 }
    case 'demijohn':
      return { width: 92, height: 92 }
    case 'ibc':
      return { width: 96, height: 96 }
    case 'tank_fermenter':
      return { width: 108, height: 118 }
    case 'tank_storage':
      return { width: 136, height: 88 }
    default:
      return { width: 110, height: 78 }
  }
}

/** First free cell on the plan, scanning left to right, then below the last row. */
export function nextSlot(taken: readonly Geom[], width = 110, height = 78): Geom {
  const gap = 16
  const cols = Math.max(1, Math.floor((BOARD_W - 48) / (width + gap)))
  for (let index = 0; index < 96; index += 1) {
    const x = 24 + (index % cols) * (width + gap)
    const y = 24 + Math.floor(index / cols) * (height + gap)
    const hits = taken.some(
      (geom) =>
        x < geom.x + geom.width &&
        x + width > geom.x &&
        y < geom.y + geom.height &&
        y + height > geom.y,
    )
    if (!hits) return { x, y, width, height, rotation: 0 }
  }
  const bottom = taken.reduce((max, geom) => Math.max(max, geom.y + geom.height), 24)
  return { x: 24, y: bottom + gap, width, height, rotation: 0 }
}

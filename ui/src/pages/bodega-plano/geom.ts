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

/** First free cell on the plan, scanning left to right. */
export function nextSlot(taken: readonly Geom[]): Geom {
  const width = 110
  const height = 78
  const gap = 18
  const cols = 7
  for (let index = 0; index < 70; index += 1) {
    const x = 36 + (index % cols) * (width + gap)
    const y = 36 + Math.floor(index / cols) * (height + gap)
    const candidate = { x, y, width, height, rotation: 0 }
    const hits = taken.some(
      (geom) =>
        x < geom.x + geom.width &&
        x + width > geom.x &&
        y < geom.y + geom.height &&
        y + height > geom.y,
    )
    if (!hits && x + width <= BOARD_W && y + height <= BOARD_H) return candidate
  }
  return { x: 36, y: 36, width, height, rotation: 0 }
}

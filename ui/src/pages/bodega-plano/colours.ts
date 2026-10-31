export type ColourMode = 'fill' | 'state'

export type FillBand = 'empty' | 'low' | 'mid' | 'high' | 'full'
export type StateBand = 'empty' | 'wine' | 'fermenting' | 'aging' | 'offline'

type Paint = { status: string; state: string; fill: number }

const FILL_FACE: Record<FillBand, string> = {
  empty: 'border-ink-300 bg-ink-100 text-ink-900',
  low: 'border-warning-600 bg-warning-50 text-ink-900',
  mid: 'border-info-600 bg-info-50 text-ink-900',
  high: 'border-success-600 bg-success-50 text-ink-900',
  full: 'border-success-700 bg-success-700 text-ink-0',
}

const STATE_FACE: Record<StateBand, string> = {
  empty: 'border-ink-300 bg-ink-100 text-ink-900',
  wine: 'border-tag-rose-dot bg-tag-rose-bg text-tag-rose-fg',
  fermenting: 'border-tag-amber-dot bg-tag-amber-bg text-tag-amber-fg',
  aging: 'border-tag-orange-3-dot bg-tag-orange-3-bg text-tag-orange-3-fg',
  offline: 'border-danger-600 bg-danger-50 text-danger-700',
}

export function fillBand(pct: number): FillBand {
  if (pct <= 0) return 'empty'
  if (pct < 25) return 'low'
  if (pct < 75) return 'mid'
  if (pct < 100) return 'high'
  return 'full'
}

export function stateBand(marker: Paint): StateBand {
  if (
    marker.status === 'out_of_service' ||
    marker.status === 'retired' ||
    marker.state === 'out_of_service' ||
    marker.state === 'retired'
  ) {
    return 'offline'
  }
  if (marker.state === 'fermenting' || marker.state === 'must') return 'fermenting'
  if (marker.state === 'aging') return 'aging'
  if (marker.state === 'empty' || marker.fill <= 0) return 'empty'
  return 'wine'
}

export function bandOf(mode: ColourMode, marker: Paint): FillBand | StateBand {
  return mode === 'fill' ? fillBand(marker.fill) : stateBand(marker)
}

export function faceClass(mode: ColourMode, marker: Paint): string {
  return mode === 'fill' ? FILL_FACE[fillBand(marker.fill)] : STATE_FACE[stateBand(marker)]
}

export function swatchClass(mode: ColourMode, band: FillBand | StateBand): string {
  const face = mode === 'fill' ? FILL_FACE[band as FillBand] : STATE_FACE[band as StateBand]
  return face
    .split(' ')
    .filter((token) => !token.startsWith('text-'))
    .join(' ')
}

/** A tank is not drawn as a barrel. The box itself is the silhouette. */
export function shapeClass(subject: 'vessel' | 'holder', kind: string | null): string {
  if (subject === 'holder') return kind === 'nicho' ? 'rounded-md' : 'rounded-lg'
  switch (kind) {
    case 'barrel':
      return 'rounded-full'
    case 'demijohn':
      return 'rounded-full'
    case 'ibc':
      return 'rounded-none'
    case 'tank_fermenter':
      return 'rounded-t-3xl rounded-b-lg'
    case 'tank_storage':
      return 'rounded-xl'
    default:
      return 'rounded-lg'
  }
}

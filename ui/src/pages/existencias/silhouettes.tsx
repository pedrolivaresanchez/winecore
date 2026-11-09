import { useId } from 'react'

/** Silueta de depósito y de barrica, con el mismo relleno de nivel. */
export function VesselSilhouette({
  kind,
  fill,
  label,
  wine,
}: {
  kind: 'tank' | 'barrel'
  fill: number
  label: string
  wine: 'tinto' | 'blanco' | 'rosado' | 'otro' | null
}) {
  const clip = useId().replace(/:/g, '')
  const pct = Math.max(0, Math.min(100, fill))
  const liquid = wine === 'blanco' ? 'var(--color-tag-amber-dot)' : wine === 'rosado' ? 'var(--color-tag-rose-3-dot)' : wine === 'otro' ? 'var(--color-info-500)' : 'var(--color-tag-rose-dot)'
  const empty = pct <= 0
  return (
    <svg viewBox={kind === 'barrel' ? '0 0 72 84' : '0 0 56 96'} className="h-24 w-full" role="img" aria-label={label}>
      <title>{label}</title>
      {kind === 'barrel' ? <BarrelShape clip={clip} pct={pct} liquid={empty ? 'transparent' : liquid} /> : <TankShape clip={clip} pct={pct} liquid={empty ? 'transparent' : liquid} />}
    </svg>
  )
}

function TankShape({ clip, pct, liquid }: { clip: string; pct: number; liquid: string }) {
  const height = 70 * (pct / 100)
  const y = 78 - height
  return (
    <>
      <rect x="8" y="8" width="40" height="74" rx="12" className="fill-ink-100 stroke-ink-300" strokeWidth="2" />
      <clipPath id={clip}>
        <rect x="10" y="10" width="36" height="70" rx="10" />
      </clipPath>
      <rect x="10" y={y} width="36" height={height} clipPath={`url(#${clip})`} fill={liquid} />
      <rect x="6" y="6" width="44" height="8" rx="3" className="fill-ink-300" />
    </>
  )
}

function BarrelShape({ clip, pct, liquid }: { clip: string; pct: number; liquid: string }) {
  const height = 52 * (pct / 100)
  const y = 68 - height
  return (
    <>
      <ellipse cx="36" cy="40" rx="28" ry="30" className="fill-ink-100 stroke-ink-300" strokeWidth="2" />
      <clipPath id={clip}>
        <ellipse cx="36" cy="40" rx="26" ry="28" />
      </clipPath>
      <rect x="8" y={y} width="56" height={height} clipPath={`url(#${clip})`} fill={liquid} />
      <path d="M20 14v52M36 12v56M52 14v52" className="stroke-ink-300" strokeWidth="1.5" fill="none" />
    </>
  )
}

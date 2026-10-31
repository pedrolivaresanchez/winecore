import { formatQty } from '@/pages/lote-diseno/model'

export function MiniColumns({
  points,
  label,
}: {
  points: { key: string; label: string; value: number | null }[]
  label: string
}) {
  const width = 320
  const height = 112
  const padL = 8
  const padR = 8
  const padT = 8
  const padB = 22
  const nums = points.map((point) => point.value).filter((value): value is number => value != null)
  const max = Math.max(1, ...nums)
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const band = innerW / Math.max(1, points.length)

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-caption text-text-tertiary">{label}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
        <line x1={padL} x2={width - padR} y1={padT + innerH} y2={padT + innerH} stroke="var(--color-chart-rule)" />
        {points.map((point, index) => {
          const heightPx = point.value == null ? 0 : (point.value / max) * innerH
          const barW = Math.max(4, band * 0.46)
          const x = padL + index * band + (band - barW) / 2
          const shown = point.value == null ? '—' : formatQty(point.value)
          return (
            <g key={point.key}>
              <title>{`${point.label}: ${shown}`}</title>
              <rect x={x} y={padT + innerH - heightPx} width={barW} height={heightPx} rx={2} fill="var(--color-chart-ink)" />
              <text
                x={padL + index * band + band / 2}
                y={height - 6}
                textAnchor="middle"
                fill="var(--color-text-tertiary)"
                fontSize={12}
              >
                {point.label}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

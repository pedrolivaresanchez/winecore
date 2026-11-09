import type { ReactNode } from 'react'
import { copy } from '@/i18n'
import type { ZoneKind } from '@/pages/bodega-plano/types'

/**
 * Plano esquemático sobre el tablero de 1000×640 (geom.ts).
 * No hay foto: las paredes y las bancadas son inventadas.
 * Cada recipiente se pinta encima, en la posición guardada en cellar.plan_position.
 *
 * Huecos pensados para esa posición (el cargador de datos usa los mismos números):
 * - Barricas: 4×4 desde (48, 96), paso 118×112, pieza 108×64. Dieciséis.
 * - Nichos: 2×13 desde (620, 72), paso 168×40, pieza 152×36. Veintiséis.
 * - Depósitos: 5×6 desde (40, 88), paso 132×86, pieza 116×72. Treinta.
 * - Cajas en la nave: desde (760, 104), paso 0×42, pieza 184×32. Cuatro.
 * - Jaulones en la nave: desde (760, 348), paso 0×96, pieza 184×80. Dos.
 * - Cajas y jaulones también caben en la zona bottle_store (estanterías y 2×2 jaulas).
 * - Damajuanas: 13×2 desde (28, 168), paso 74×200, pieza 66×120. Veintiséis.
 */

const INK = 'var(--color-ink-400)'
const INK_SOFT = 'var(--color-ink-300)'
const WALL = 'var(--color-ink-700)'
const FLOOR = 'var(--color-surface-subtle)'
const PAPER = 'var(--color-surface)'
const HAIR = 'var(--color-border-subtle)'

function Room({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <svg
      viewBox="0 0 1000 640"
      className="pointer-events-none absolute inset-0 size-full"
      role="img"
      aria-label={title}
      data-schematic=""
    >
      <rect width="1000" height="640" fill={PAPER} />
      {children}
      <text x="36" y="36" fill={WALL} fontSize="18" fontFamily="inherit">
        {title}
      </text>
      <text x="36" y="618" fill={INK} fontSize="12" fontFamily="inherit">
        {copy.plano.schematicNote}
      </text>
    </svg>
  )
}

function Walls({ door = 'bottom' }: { door?: 'bottom' | 'left' }) {
  const d =
    door === 'left'
      ? 'M 24 24 H 976 V 616 H 24 V 360 M 24 250 V 24'
      : 'M 24 24 H 976 V 616 H 560 M 440 616 H 24 V 24'
  return (
    <g fill="none" stroke={WALL} strokeWidth="6" strokeLinejoin="round">
      <path d={d} />
      {door === 'bottom' ? (
        <path d="M 440 616 A 60 60 0 0 1 500 556" stroke={INK} strokeWidth="1.5" />
      ) : (
        <path d="M 24 250 A 55 55 0 0 1 79 305" stroke={INK} strokeWidth="1.5" />
      )}
      <text x={door === 'bottom' ? 468 : 40} y={door === 'bottom' ? 600 : 292} fill={INK} fontSize="11" fontFamily="inherit">
        {copy.plano.schematicDoor}
      </text>
    </g>
  )
}

function Label({ x, y, children }: { x: number | string; y: number | string; children: string }) {
  return (
    <text x={x} y={y} fill={INK} fontSize="13" fontFamily="inherit">
      {children}
    </text>
  )
}

function BarrelRoom() {
  const shelves = [96, 208, 320, 432]
  return (
    <Room title={copy.plano.barrelRoom}>
      <Walls />
      <rect x="40" y="64" width="540" height="500" fill={FLOOR} stroke={HAIR} />
      <Label x="52" y="58">{copy.plano.schematicBarrels}</Label>
      {shelves.map((y) => (
        <g key={y}>
          <line x1="52" y1={y + 70} x2="556" y2={y + 70} stroke={INK_SOFT} strokeWidth="8" />
          {Array.from({ length: 4 }, (_, col) => {
            const x = 48 + col * 118
            return <ellipse key={col} cx={x + 54} cy={y + 32} rx="50" ry="26" fill="none" stroke={HAIR} strokeWidth="1.5" />
          })}
        </g>
      ))}
      <rect x="608" y="48" width="348" height="540" fill={FLOOR} stroke={HAIR} />
      <Label x="624" y="58">{copy.plano.schematicNiches}</Label>
      {Array.from({ length: 13 }, (_, row) =>
        Array.from({ length: 2 }, (_, col) => {
          const x = 620 + col * 168
          const y = 72 + row * 40
          return <rect key={`${col}-${row}`} x={x} y={y} width="152" height="36" fill={PAPER} stroke={HAIR} />
        }),
      )}
      <text x="300" y="590" fill={INK} fontSize="12" fontFamily="inherit" textAnchor="middle">
        {copy.plano.schematicAisle}
      </text>
    </Room>
  )
}

function Nave() {
  return (
    <Room title={copy.plano.elaboration}>
      <Walls />
      <rect x="32" y="48" width="692" height="548" fill={FLOOR} stroke={HAIR} />
      <Label x="52" y="58">{copy.plano.schematicTanks}</Label>
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 5 }, (_, col) => {
          const x = 40 + col * 132
          const y = 88 + row * 86
          return (
            <g key={`${col}-${row}`}>
              <rect x={x} y={y} width="116" height="72" rx="16" fill={PAPER} stroke={HAIR} />
              <ellipse cx={x + 58} cy={y + 18} rx="26" ry="7" fill="none" stroke={INK_SOFT} />
            </g>
          )
        }),
      )}
      <rect x="744" y="64" width="216" height="220" fill={FLOOR} stroke={HAIR} />
      <Label x="756" y="88">{copy.plano.schematicBoxes}</Label>
      {[0, 1, 2, 3].map((row) => (
        <rect key={row} x="760" y={104 + row * 42} width="184" height="32" fill={PAPER} stroke={HAIR} />
      ))}
      <rect x="744" y="304" width="216" height="260" fill={FLOOR} stroke={HAIR} />
      <Label x="756" y="328">{copy.plano.schematicCages}</Label>
      {[0, 1].map((row) => (
        <rect key={row} x="760" y={348 + row * 96} width="184" height="80" fill="none" stroke={INK_SOFT} strokeDasharray="4 3" />
      ))}
    </Room>
  )
}

function Courtyard() {
  return (
    <Room title={`${copy.plano.outdoorZone} · ${copy.plano.schematicDemijohns}`}>
      <rect x="24" y="24" width="952" height="560" fill={FLOOR} stroke={WALL} strokeWidth="6" />
      <path d="M 24 250 H 80" stroke={PAPER} strokeWidth="10" />
      <text x="36" y="246" fill={INK} fontSize="11" fontFamily="inherit">
        {copy.plano.schematicDoor}
      </text>
      <Label x="36" y="86">{copy.plano.schematicDemijohns}</Label>
      {Array.from({ length: 2 }, (_, row) =>
        Array.from({ length: 13 }, (_, col) => {
          const x = 28 + col * 74
          const y = 168 + row * 200
          return (
            <g key={`${col}-${row}`}>
              <rect x={x} y={y} width="66" height="120" rx="33" fill={PAPER} stroke={HAIR} />
              <ellipse cx={x + 33} cy={y + 28} rx="18" ry="8" fill="none" stroke={INK_SOFT} />
            </g>
          )
        }),
      )}
    </Room>
  )
}

function BottleStore() {
  return (
    <Room title={copy.plano.bottleStore}>
      <Walls door="left" />
      <rect x="80" y="64" width="420" height="500" fill={FLOOR} stroke={HAIR} />
      <Label x="96" y="88">{copy.plano.schematicBoxes}</Label>
      {Array.from({ length: 4 }, (_, row) => (
        <g key={row}>
          <line x1="100" y1={120 + row * 100} x2="470" y2={120 + row * 100} stroke={INK_SOFT} strokeWidth="6" />
          {Array.from({ length: 4 }, (_, col) => (
            <rect key={col} x={110 + col * 90} y={132 + row * 100} width="72" height="48" fill={PAPER} stroke={HAIR} />
          ))}
        </g>
      ))}
      <rect x="540" y="64" width="400" height="500" fill={FLOOR} stroke={HAIR} />
      <Label x="556" y="88">{copy.plano.schematicCages}</Label>
      {Array.from({ length: 2 }, (_, row) =>
        Array.from({ length: 2 }, (_, col) => (
          <rect
            key={`${col}-${row}`}
            x={564 + col * 180}
            y={120 + row * 200}
            width="160"
            height="160"
            fill="none"
            stroke={INK_SOFT}
            strokeDasharray="5 4"
          />
        )),
      )}
    </Room>
  )
}

export function PlanSchematic({ kind }: { kind: ZoneKind | string }) {
  if (kind === 'barrel_room') return <BarrelRoom />
  if (kind === 'outdoor') return <Courtyard />
  if (kind === 'bottle_store') return <BottleStore />
  return <Nave />
}

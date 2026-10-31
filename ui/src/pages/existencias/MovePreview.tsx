import { useNavigate } from 'react-router-dom'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { periodClosedText } from '@/pages/existencias/explain'
import type { MoveView } from '@/pages/existencias/move-view'
import { formatMl, formatSignedUnits } from '@/pages/existencias/volume'
import { ChevronDown, ChevronUp, Lock } from '@/ui/icons'
import { Alert, Button, Drawer, DrawerBody, DrawerHeader } from '@/ui'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-right text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}

export function MovePreview({
  row,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  row: MoveView | null
  index: number
  total: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const navigate = useNavigate()
  return (
    <Drawer open={Boolean(row)} onClose={onClose} labelledBy="movimiento-preview-title" size="md">
      <DrawerHeader titleId="movimiento-preview-title" title={row?.moveType ?? 'Movimiento'} description={row?.document} onClose={onClose} />
      <DrawerBody>
        {row ? (
          <div data-screen="movimiento-preview" className="grid gap-4">
            <div className="flex items-center justify-between">
              <span className="text-caption text-text-tertiary tabular-nums">
                {index + 1} / {total}
              </span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.stock.prev} disabled={!onPrev} onClick={onPrev}>
                  <ChevronUp strokeWidth={iconStroke} />
                </Button>
                <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.stock.next} disabled={!onNext} onClick={onNext}>
                  <ChevronDown strokeWidth={iconStroke} />
                </Button>
              </div>
            </div>
            {row.locked ? (
              <Alert tone="warning" icon={<Lock className="size-4" strokeWidth={iconStroke} />}>
                {periodClosedText(row.lockedUntil)}
              </Alert>
            ) : (
              <p className="text-label text-text-secondary">{copy.stock.movesReadonly}</p>
            )}
            <dl>
              <Fact label="Fecha" value={row.when} />
              {row.whenDetail ? <Fact label="Otra fecha" value={row.whenDetail} /> : null}
              <Fact label="Tipo" value={row.moveType} />
              <Fact label={row.book === 'fiscal' ? 'Mayor' : 'Dónde'} value={row.place} />
              <Fact label="Lote" value={row.lot} />
              <Fact label="Producto" value={row.product} />
              <Fact label="Litros" value={formatMl(row.volumeMl)} />
              <Fact label="Unidades" value={row.units ? formatSignedUnits(row.units) : '—'} />
              <Fact label="Documento" value={row.document} />
              <Fact label="Justificante" value={row.justification} />
              <Fact label="Asiento SILICIE" value={row.silicie} />
              <Fact label="Usuario" value={row.user} />
            </dl>
            {row.href ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate(row.href ?? '/')}>
                {copy.stock.openDocument}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DrawerBody>
    </Drawer>
  )
}

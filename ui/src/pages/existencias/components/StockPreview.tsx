import { useNavigate } from 'react-router-dom'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import type { StockBalance } from '@/pages/existencias/api'
import { ownerLabel, productLabel, stateLabel } from '@/pages/existencias/labels'
import { formatMl, formatPercentCapacity, formatUnits } from '@/pages/existencias/volume'
import { ChevronDown, ChevronUp } from '@/ui/icons'
import { Button, Drawer, DrawerBody, DrawerHeader } from '@/ui'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}

export function StockPreview({
  row,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  row: StockBalance | null
  index: number
  total: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const navigate = useNavigate()
  const title = row ? (row.vessel_code ?? productLabel(row)) : 'Existencia'
  return (
    <Drawer open={Boolean(row)} onClose={onClose} labelledBy="existencia-preview-title" size="md">
      <DrawerHeader
        titleId="existencia-preview-title"
        title={title}
        description={row ? `${row.location_name} · ${stateLabel(row.product_state)}` : undefined}
        onClose={onClose}
      />
      <DrawerBody>
        {row ? (
          <div data-screen="existencia-preview" className="grid gap-4">
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
            <dl>
              <Fact label="Ubicación" value={`${row.location_name} (${row.location_code})`} />
              <Fact label="Recipiente" value={row.vessel_code ?? '—'} />
              <Fact label="Lote" value={row.lot_code ?? '—'} />
              <Fact label="Producto o vino" value={productLabel(row)} />
              <Fact label="Estado" value={stateLabel(row.product_state)} />
              <Fact label="Propietario" value={ownerLabel(row.owner_code)} />
              <Fact label="Litros" value={formatMl(row.volume_ml)} />
              <Fact label="Unidades" value={row.qty_units ? formatUnits(row.qty_units) : '—'} />
              {row.vessel_capacity_ml ? <Fact label="Llenado" value={formatPercentCapacity(row.volume_ml, row.vessel_capacity_ml)} /> : null}
            </dl>
            <div className="flex flex-wrap gap-2">
              {row.lot_code ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/bodega/lotes/${encodeURIComponent(row.lot_code ?? '')}`)}>
                  {copy.stock.trace}
                </Button>
              ) : null}
              {row.vessel_code ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/bodega/depositos/${encodeURIComponent(row.vessel_code ?? '')}`)}>
                  {copy.stock.openVessel}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DrawerBody>
    </Drawer>
  )
}

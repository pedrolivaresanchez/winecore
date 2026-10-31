import { useNavigate } from 'react-router-dom'
import { copy } from '@/i18n'
import { formatDate, formatDateTime } from '@/lib/format'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { Button, Drawer, DrawerBody, DrawerHeader, Skeleton } from '@/ui'
import { packagedLabel } from '@/pages/bodega-plano/text'
import type { CardTarget, MapHolder, PlanCard } from '@/pages/bodega-plano/types'

function litresLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return `${value.replace('.', ',')} L`
}

function percentLabel(value: string | number | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `${Math.round(parsed)} %`
}

function comma(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return trimmed.replace('.', ',')
}

export function PlanPanel({
  target,
  holder,
  canOperate,
  onClose,
  onRemove,
}: {
  target: CardTarget | null
  holder: MapHolder | null
  canOperate: boolean
  onClose: () => void
  onRemove: (zoneCode: string, positionId: string) => void
}) {
  const navigate = useNavigate()
  const vessel = target?.subject === 'vessel' ? target.code : null
  const card = useApi<PlanCard>(vessel ? `/v1/vessels/${encodeURIComponent(vessel)}/plan-card` : null)
  const titleId = 'plano-ficha-titulo'
  const title = target?.code ?? ''

  return (
    <Drawer open={target !== null} onClose={onClose} side="right" size="md" mobileSheet labelledBy={titleId}>
      <DrawerHeader title={title} titleId={titleId} description={target?.name} onClose={onClose} />
      <DrawerBody>
        {target?.subject === 'vessel' ? (
          card.data && card.data.code === vessel ? (
            <VesselFacts card={card.data} />
          ) : card.error ? (
            <p className="text-label text-danger-700">{card.error instanceof ApiError ? card.error.message : copy.plano.saveFailed}</p>
          ) : (
            <div aria-busy="true" className="grid gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-24" />
            </div>
          )
        ) : holder ? (
          <HolderFacts holder={holder} />
        ) : null}
      </DrawerBody>
      {target ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border-subtle px-4 py-3 sm:px-6">
          {target.subject === 'vessel' ? (
            <>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => navigate(`/bodega/operaciones/nueva?vessel=${encodeURIComponent(target.code)}`)}
              >
                {copy.plano.newOperation}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/bodega/lecturas')}>
                {copy.plano.reading}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/bodega/analiticas')}>
                {copy.plano.analysisAction}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/bodega/depositos/${encodeURIComponent(target.code)}`)}
              >
                {copy.plano.sheet}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/bodega/contenedores/${encodeURIComponent(target.code)}`)}
            >
              {copy.plano.sheet}
            </Button>
          )}
          {canOperate && target.positionId ? (
            <Button type="button" variant="dangerSoft" size="sm" onClick={() => onRemove(target.zoneCode, target.positionId)}>
              {copy.plano.remove}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2">
      <dt className="shrink-0 text-caption text-text-tertiary">{label}</dt>
      <dd className="min-w-0 truncate text-right text-label text-ink-900">{value}</dd>
    </div>
  )
}

function VesselFacts({ card }: { card: PlanCard }) {
  return (
    <div className="grid gap-4">
      <dl>
        <Fact label={copy.plano.code} value={card.code} />
        <Fact label={copy.plano.name} value={card.name} />
        <Fact label={copy.plano.kind} value={card.kind_label} />
        <Fact label={copy.plano.capacity} value={litresLabel(card.capacity_litres)} />
        <Fact label={copy.plano.lot} value={card.lot_code ?? '—'} />
        <Fact label={copy.plano.wine} value={card.wine_name ?? '—'} />
        <Fact label={copy.plano.litres} value={`${litresLabel(card.litres)} · ${percentLabel(card.fill_pct)}`} />
        <Fact label={copy.plano.status} value={card.state_label} />
      </dl>
      <section>
        <h3 className="text-caption text-text-tertiary">{copy.plano.lastOperation}</h3>
        {card.last_operation ? (
          <p className="mt-1 text-label text-ink-900">
            {card.last_operation.op_type_label}
            <span className="text-text-tertiary"> · {formatDateTime(card.last_operation.occurred_at)}</span>
          </p>
        ) : (
          <p className="mt-1 text-label text-text-secondary">{copy.plano.noOperation}</p>
        )}
      </section>
      <section>
        <h3 className="text-caption text-text-tertiary">{copy.plano.lastAnalysis}</h3>
        {card.last_analysis ? (
          <>
            <p className="mt-1 text-label text-ink-900">{formatDate(card.last_analysis.sampled_at)}</p>
            {card.last_analysis.results.length > 0 ? (
              <ul className="mt-1">
                {card.last_analysis.results.map((metric) => (
                  <li key={metric.parameter_code} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="text-label text-text-secondary">{metric.name}</span>
                    <span className="text-label text-ink-900">
                      {comma(metric.value)} {metric.unit}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-label text-text-secondary">{copy.plano.noAnalysis}</p>
        )}
      </section>
    </div>
  )
}

function HolderFacts({ holder }: { holder: MapHolder }) {
  const capacity = holder.capacity_bottles != null ? `${holder.capacity_bottles} ${copy.plano.bottles.toLowerCase()}` : '—'
  return (
    <dl>
      <Fact label={copy.plano.code} value={holder.code} />
      <Fact label={copy.plano.name} value={holder.name} />
      <Fact label={copy.plano.kind} value={holder.kind_label} />
      <Fact label={copy.plano.capacity} value={capacity} />
      <Fact label={copy.plano.lot} value={holder.lot_code ?? '—'} />
      <Fact label={copy.plano.litres} value={litresLabel(holder.litres)} />
      <Fact label={copy.plano.fill} value={percentLabel(holder.fill_pct)} />
      <Fact label={copy.plano.state} value={packagedLabel(holder.state)} />
    </dl>
  )
}

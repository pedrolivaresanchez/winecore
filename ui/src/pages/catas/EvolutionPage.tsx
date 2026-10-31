import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { isAbortError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Badge, EmptyState, SegmentedControl, Select, Skeleton } from '@/ui'
import { CHART_INK, ChartEmpty, LineChart, chartModel } from '@/ui/charts'
import { getEvolution, messageOf } from '@/pages/catas/api'
import { CatasFrame } from '@/pages/catas/frame'
import { formatScore, subjectLabel } from '@/pages/catas/labels'
import type { EvolutionPoint, EvolutionView } from '@/pages/catas/types'
import { useCatalog } from '@/pages/catas/use-catalog'

export function EvolutionPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const catalog = useCatalog(allows(me, 'cellar.read'))
  const lotId = params.get('lot_id') ?? ''
  const wineId = params.get('wine_id') ?? ''
  const scope: 'lot' | 'wine' = wineId && !lotId ? 'wine' : 'lot'
  const activeId = scope === 'lot' ? lotId : wineId
  const [view, setView] = useState<EvolutionView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!activeId) {
      setView(null)
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    getEvolution(scope === 'lot' ? { lot_id: activeId } : { wine_id: activeId }, controller.signal)
      .then((next) => {
        if (!active) return
        setView(next)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setView(null)
        setError(messageOf(err))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [activeId, attempt, scope])

  function setScope(next: 'lot' | 'wine') {
    const query = new URLSearchParams(params)
    if (next === 'lot') query.delete('wine_id')
    else query.delete('lot_id')
    setParams(query)
  }

  function setId(value: string) {
    const query = new URLSearchParams(params)
    if (scope === 'lot') {
      query.delete('wine_id')
      if (value) query.set('lot_id', value)
      else query.delete('lot_id')
    } else {
      query.delete('lot_id')
      if (value) query.set('wine_id', value)
      else query.delete('wine_id')
    }
    setParams(query)
  }

  const model = useMemo(() => {
    const rows = (view?.points ?? []).filter((point) => point.kind === 'tasting' && point.tasting?.overall_score != null)
    return chartModel({
      categoryLabel: copy.catas.chart,
      measureType: 'number',
      temporal: true,
      format: (value) => formatScore(value),
      series: [{ key: 'overall', label: copy.catas.overall, color: CHART_INK }],
      categories: rows.map((point) => {
        const score = point.tasting?.overall_score ?? 0
        return { key: String(point.tasting?.id ?? point.at), label: formatDate(point.at), values: [score], total: score }
      }),
    })
  }, [view])

  const title = view?.scope.kind === 'wine' ? view.scope.wine_name : view?.scope.kind === 'lot' ? view.scope.lot_code : copy.catas.evolution
  const screen = !activeId ? 'catas-evolucion-vacio' : 'catas-evolucion'

  return (
    <CatasFrame
      screen={screen}
      section="evolucion"
      title={copy.catas.evolution}
      filters={
        <>
          <SegmentedControl
            size="sm"
            aria-label={copy.catas.evolution}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'lot', content: copy.catas.lot },
              { value: 'wine', content: copy.catas.wine },
            ]}
          />
          <Select size="sm" aria-label={scope === 'lot' ? copy.catas.lot : copy.catas.wine} value={activeId} className="max-w-52" onChange={(event) => setId(event.target.value)}>
            <option value="">{copy.catas.choose}</option>
            {scope === 'lot'
              ? catalog.lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code}
                  </option>
                ))
              : catalog.wines.map((wine) => (
                  <option key={wine.id} value={wine.id}>
                    {wine.name}
                  </option>
                ))}
          </Select>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-8">
          {!activeId ? <EmptyState size="sm" title={copy.catas.emptyEvolution} /> : null}
          {error ? <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} /> : null}
          {loading ? <Skeleton className="h-48" /> : null}
          {view && !loading ? (
            <>
              <header>
                <h1 className="text-body font-medium text-ink-900">{title}</h1>
              </header>
              {model.categories.length === 0 ? <ChartEmpty height={220} message={copy.catas.emptyChart} /> : <LineChart model={model} height={220} />}
              {view.points.length === 0 ? (
                <EmptyState size="sm" title={copy.catas.emptyPoints} />
              ) : (
                <ol className="overflow-hidden rounded-2xl border border-border-subtle">
                  {view.points.map((point) => (
                    <li key={`${point.kind}-${point.tasting?.id ?? point.analysis?.id ?? point.at}`} className="border-b border-border-subtle px-4 py-2 last:border-b-0">
                      <PointLine point={point} />
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </div>
    </CatasFrame>
  )
}

function PointLine({ point }: { point: EvolutionPoint }) {
  const when = formatDate(point.at)
  if (point.kind === 'tasting' && point.tasting) {
    const score = formatScore(point.tasting.overall_score)
    return (
      <p className="text-label text-ink-900">
        <Link to={`/bodega/catas/notas/${point.tasting.id}`} className="font-medium underline">
          {copy.catas.tasting}
        </Link>
        <span className="text-text-tertiary">{` · ${when} · ${point.tasting.taster_name} · ${subjectLabel(point.tasting.subject)} · ${score}`}</span>
        {point.tasting.defects.length > 0 ? (
          <Badge tone="danger" size="sm" className="ml-2">
            {String(point.tasting.defects.length)}
          </Badge>
        ) : null}
      </p>
    )
  }
  const analysis = point.analysis
  const results = (analysis?.results ?? [])
    .slice(0, 4)
    .map((result) => {
      const name = result.name || result.code
      const unit = result.unit && result.unit.toLowerCase() !== name.toLowerCase() ? ` ${result.unit}` : ''
      return `${name} ${formatScore(result.value)}${unit}`
    })
    .join(' · ')
  return (
    <p className="text-label text-ink-900">
      <span className="font-medium">{copy.catas.analysis}</span>
      <span className="text-text-tertiary">{` · ${when}${analysis?.lab ? ` · ${analysis.lab}` : ''}${results ? ` · ${results}` : ''}`}</span>
    </p>
  )
}

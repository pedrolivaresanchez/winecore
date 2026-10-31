import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { pageMotion, iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { ChartBar, DownloadSimple } from '@/ui/icons'
import { Button, EmptyState, InfoTip, Input, SegmentedControl, Select, Skeleton, Table, useToast, type TableColumn } from '@/ui'
import { downloadVintageCsv, messageOf, readVintage } from '@/pages/lote-diseno/api'
import { MiniColumns } from '@/pages/lote-diseno/charts'
import { formatCivil, formatQty, lastRipeness, sanitaryName, type VintageGroup, type VintageMetrics, type VintageReport } from '@/pages/lote-diseno/model'

type Vista = 'parcela' | 'referencia'

interface Row {
  id: string
  subject: string
  vintage: number
  harvest: string
  kg: string
  yield: string
  ripeness: string
  sanitary: string
  abv: string
  acidity: string
  ph: string
  so2: string
  tasting: string
  weather: string
  kgValue: number | null
  abvValue: number | null
}

export function AnadasPage({ me }: { me: Me }) {
  useChromeTitle(copy.lote.vintages)
  const toast = useToast()
  const reduce = useReducedMotion()
  const [params, setParams] = useSearchParams()
  const [report, setReport] = useState<VintageReport | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [catalog, setCatalog] = useState<{ parcels: { id: string; label: string }[]; wines: { id: string; label: string }[] }>({
    parcels: [],
    wines: [],
  })

  const parcelId = params.get('parcel_id') ?? ''
  const wineId = params.get('wine_id') ?? ''
  const from = params.get('vintage_from') ?? ''
  const to = params.get('vintage_to') ?? ''
  const search = useMemo(() => {
    const query = new URLSearchParams()
    if (parcelId) query.set('parcel_id', parcelId)
    if (wineId) query.set('wine_id', wineId)
    if (/^\d{4}$/.test(from)) query.set('vintage_from', from)
    if (/^\d{4}$/.test(to)) query.set('vintage_to', to)
    const text = query.toString()
    return text ? `?${text}` : ''
  }, [from, parcelId, to, wineId])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    let active = true
    setLoading(true)
    readVintage(search)
      .then((body) => {
        if (!active) return
        setReport(body)
        setError(null)
        setCatalog((current) => ({
          parcels: mergeOptions(current.parcels, body.by_parcel.map((item) => ({ id: item.parcel_id, label: item.name || item.code }))),
          wines: mergeOptions(current.wines, body.by_wine.map((item) => ({ id: item.wine_id, label: item.name || item.code }))),
        }))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [me, search, attempt])

  function write(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const requested = params.get('vista')
  const fallback: Vista = report && report.by_parcel.length === 0 && report.by_wine.length > 0 ? 'referencia' : 'parcela'
  const vista: Vista = requested === 'referencia' || requested === 'parcela' ? requested : fallback
  const groups: VintageGroup[] = (vista === 'parcela' ? (report?.by_parcel ?? []) : (report?.by_wine ?? [])).map((group) => ({
    id: 'parcel_id' in group ? group.parcel_id : group.wine_id,
    code: group.code,
    name: group.name,
    vintages: group.vintages,
  }))
  const rows = groups.flatMap((group) => group.vintages.map((metrics) => rowOf(group, metrics)))
  const chartGroup = groups[0]
  const kgPoints = (chartGroup?.vintages ?? []).map((metrics) => ({
    key: String(metrics.vintage),
    label: String(metrics.vintage),
    value: metrics.kg,
  }))
  const abvFromLab = (chartGroup?.vintages ?? []).some((metrics) => metrics.analyses?.abv != null)
  const abvPoints = (chartGroup?.vintages ?? []).map((metrics) => ({
    key: String(metrics.vintage),
    label: String(metrics.vintage),
    value: metrics.analyses?.abv ?? lastRipeness(metrics)?.probable_abv ?? null,
  }))
  const showKg = kgPoints.some((point) => point.value != null)
  const showAbv = abvPoints.some((point) => point.value != null)

  async function exportCsv() {
    setExporting(true)
    try {
      await downloadVintageCsv(search)
      toast(copy.lote.exported)
    } catch (err: unknown) {
      toast(messageOf(err, copy.lote.exportFail))
    } finally {
      setExporting(false)
    }
  }

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const empty = !loading && rows.length === 0 && !error
  const screen = loading && !report ? 'lote-anadas-cargando' : empty ? 'lote-anadas-vacio' : 'lote-anadas'
  const csv = (
    <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
      <DownloadSimple strokeWidth={iconStroke} />
      {copy.lote.csv}
    </Button>
  )
  const columns: TableColumn<Row>[] = [
    ...(groups.length > 1 ? [{ id: 'subject', header: vista === 'parcela' ? copy.lote.byParcel : copy.lote.byWine, cell: (row: Row) => row.subject, minWidth: '140px' } satisfies TableColumn<Row>] : []),
    { id: 'vintage', header: copy.cellar.vintage, cell: (row) => String(row.vintage), width: '96px' },
    { id: 'harvest', header: copy.lote.harvest, cell: (row) => row.harvest, hideOnMobile: true },
    { id: 'kg', header: copy.lote.kg, align: 'right', cell: (row) => row.kg, width: '88px' },
    { id: 'yield', header: copy.lote.yield, align: 'right', cell: (row) => row.yield, hideOnMobile: true },
    { id: 'ripeness', header: copy.lote.ripeness, align: 'right', cell: (row) => row.ripeness, hideOnMobile: true },
    { id: 'sanitary', header: copy.lote.sanitary, cell: (row) => row.sanitary, hideOnMobile: true },
    { id: 'abv', header: copy.lote.abv, align: 'right', cell: (row) => row.abv, width: '72px' },
    { id: 'acidity', header: copy.lote.acidity, align: 'right', cell: (row) => row.acidity, hideOnMobile: true },
    { id: 'ph', header: copy.lote.ph, align: 'right', cell: (row) => row.ph, hideOnMobile: true },
    { id: 'so2', header: copy.lote.so2, align: 'right', cell: (row) => row.so2, hideOnMobile: true },
    { id: 'tasting', header: copy.lote.tasting, align: 'right', cell: (row) => row.tasting, width: '72px' },
    { id: 'weather', header: copy.lote.weather, cell: (row) => row.weather, hideOnMobile: true, wrap: true },
  ]

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <ChartBar className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.lote.vintages}</h1>
        {report && report.missing.length > 0 ? <InfoTip label={copy.lote.vintages}>{copy.lote.missingTip}</InfoTip> : null}
        <div className="ml-auto">{csv}</div>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <SegmentedControl
            size="sm"
            aria-label={copy.lote.vintages}
            value={vista}
            onChange={(value) => write({ vista: value === 'parcela' ? null : value })}
          options={[
              { value: 'parcela', content: copy.lote.byParcel },
              { value: 'referencia', content: copy.lote.byWine },
            ]}
          />
        </div>
        <div className="ml-auto flex shrink-0 md:hidden">{csv}</div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {vista === 'parcela' ? (
            <Select size="sm" aria-label={copy.lote.byParcel} value={parcelId} onChange={(event) => write({ parcel_id: event.target.value || null })}>
              <option value="">{copy.lote.allParcels}</option>
              {catalog.parcels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          ) : (
            <Select size="sm" aria-label={copy.lote.byWine} value={wineId} onChange={(event) => write({ wine_id: event.target.value || null })}>
              <option value="">{copy.lote.allWines}</option>
              {catalog.wines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
          <Input
            size="sm"
            inputMode="numeric"
            className="w-24"
            aria-label={copy.lote.fromYear}
            placeholder={copy.lote.fromYear}
            value={from}
            onChange={(event) => write({ vintage_from: event.target.value || null })}
          />
          <Input
            size="sm"
            inputMode="numeric"
            className="w-24"
            aria-label={copy.lote.toYear}
            placeholder={copy.lote.toYear}
            value={to}
            onChange={(event) => write({ vintage_to: event.target.value || null })}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <motion.div key={vista} className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:px-4 sm:py-5" {...pageMotion(reduce)}>
          {loading && !report ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-28" />
              <Skeleton className="h-40" />
            </div>
          ) : error ? (
            <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
          ) : empty ? (
            <EmptyState title={copy.lote.emptyVintages} description={copy.lote.emptyVintagesHint} />
          ) : (
            <>
              {showKg || showAbv ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {showKg ? <MiniColumns points={kgPoints} label={chartGroup ? `${copy.lote.chartKg} · ${chartGroup.name}` : copy.lote.chartKg} /> : null}
                  {showAbv ? (
                    <MiniColumns
                      points={abvPoints}
                      label={chartGroup ? `${abvFromLab ? copy.lote.chartAbv : copy.lote.ripeness} · ${chartGroup.name}` : copy.lote.chartAbv}
                    />
                  ) : null}
                </div>
              ) : null}
              <Table columns={columns} rows={rows} rowKey={(row) => row.id} />
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}

function mergeOptions(current: { id: string; label: string }[], next: { id: string; label: string }[]) {
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of next) map.set(item.id, item)
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

function rowOf(group: VintageGroup, metrics: VintageMetrics): Row {
  const ripe = lastRipeness(metrics)
  return {
    id: `${group.id}-${metrics.vintage}`,
    subject: group.name || group.code,
    vintage: metrics.vintage,
    harvest: formatCivil(metrics.harvest_date),
    kg: formatQty(metrics.kg),
    yield: formatQty(metrics.yield_kg_ha),
    ripeness: formatQty(ripe?.probable_abv ?? null),
    sanitary: metrics.intake_sanitary_notes || sanitaryName(ripe?.sanitary_status ?? null),
    abv: formatQty(metrics.analyses?.abv ?? null),
    acidity: formatQty(metrics.analyses?.total_acidity ?? null),
    ph: formatQty(metrics.analyses?.ph ?? null),
    so2: formatQty(metrics.analyses?.free_so2 ?? null),
    tasting: formatQty(metrics.tasting_score),
    weather: metrics.weather_notes || '—',
    kgValue: metrics.kg,
    abvValue: metrics.analyses?.abv ?? ripe?.probable_abv ?? null,
  }
}

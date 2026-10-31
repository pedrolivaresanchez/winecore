import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { ChartBar, ChartColumn, ChartLine, DownloadSimple } from '@/ui/icons'
import {
  Button,
  Chip,
  DateRangePicker,
  FitAmount,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  useToast,
  type TableColumn,
} from '@/ui'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { entityName } from '@/lib/labels'
import { allows } from '@/lib/permissions'
import { iconStroke, pageMotion } from '@/lib/motion'
import type { EntityChoice, Me } from '@/lib/types'
import {
  GROUP_BY,
  chartPoints,
  compactMeasure,
  displayLabel,
  downloadReportCsv,
  entityFilter,
  formatMeasure,
  hasMeasure,
  isGroupBy,
  isIsoDate,
  measureFor,
  metricNumber,
  useReport,
  yearToDate,
  type GroupBy,
  type Measure,
  type ReportBody,
  type ReportName,
  type ReportPoint,
} from '@/lib/reports'
import {
  BarList,
  CHART_INK,
  ChartEmpty,
  ChartLegend,
  ColumnChart,
  LineChart,
  StatTile,
  chartModel,
  seriesColor,
  visibleModel,
  type ChartModel,
  type MeasureType,
} from '@/ui/charts'

const TABS = [
  { id: 'ventas', report: 'sales', label: copy.informes.sales },
  { id: 'gastos', report: 'expenses', label: copy.informes.expenses },
  { id: 'existencias', report: 'stock', label: copy.informes.stock },
] as const

type Tab = (typeof TABS)[number]['id']

const MEASURE_LABEL: Record<Measure, string> = {
  amount: copy.informes.amount,
  volume: copy.informes.volume,
  units: copy.informes.units,
}

function isTab(value: string | null): value is Tab {
  return value === 'ventas' || value === 'gastos' || value === 'existencias'
}

function defaultGroup(tab: Tab): GroupBy {
  return tab === 'existencias' ? 'wine' : 'month'
}

function errorDetail(error: ApiError): string {
  if (!error.fields) return error.message
  const text = Object.values(error.fields).filter(Boolean).join(' ')
  return text || error.message
}

export function InformesPage({ me }: { me: Me }) {
  useChromeTitle(copy.informes.title)
  const toast = useToast()
  const reduce = useReducedMotion()
  const { filter, setFilter, entities } = useEntity()
  const [params, setParams] = useSearchParams()
  const canRead = allows(me, 'reports.read')
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'ventas'
  const reportName: ReportName = TABS.find((item) => item.id === tab)?.report ?? 'sales'
  const groupBy: GroupBy = isGroupBy(params.get('group_by')) ? (params.get('group_by') as GroupBy) : defaultGroup(tab)
  const compare = params.get('compare') === 'previous_year'
  const defaults = useMemo(() => yearToDate(), [])
  const urlFrom = isIsoDate(params.get('from')) ? (params.get('from') as string) : defaults.from
  const urlTo = isIsoDate(params.get('to')) ? (params.get('to') as string) : defaults.to
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null)
  const [chartPick, setChartPick] = useState<'bar' | 'line' | null>(null)
  const [pickedFor, setPickedFor] = useState(`${tab}:${groupBy}`)
  const [exporting, setExporting] = useState(false)
  const from = draft?.from ?? urlFrom
  const to = draft?.to ?? urlTo
  const query = useMemo(
    () => ({ from: urlFrom, to: urlTo, groupBy, entity: entityFilter(filter), compare }),
    [compare, filter, groupBy, urlFrom, urlTo],
  )
  const report = useReport(canRead ? reportName : null, canRead ? query : null)
  const temporal = groupBy === 'month' || groupBy === 'year'
  const chartKey = `${tab}:${groupBy}`
  const chart = (pickedFor === chartKey ? chartPick : null) ?? (temporal ? 'line' : 'bar')

  function write(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  async function exportCsv() {
    setExporting(true)
    try {
      await downloadReportCsv(reportName, query)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.informes.exportFail)
    } finally {
      setExporting(false)
    }
  }

  if (!canRead) return <NoPermission />

  const measure = measureFor(reportName)
  const ready = report.data != null && !report.initial
  const empty = ready && report.data != null && !hasMeasure(report.data, measure)
  const screen = report.initial ? 'informes-cargando' : empty ? 'informes-vacio' : 'informes'
  const csv = (
    <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
      <DownloadSimple strokeWidth={iconStroke} />
      {copy.informes.csv}
    </Button>
  )

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <ChartBar className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.informes.title}</h1>
        <div className="ml-auto">{csv}</div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <SegmentedControl
            size="sm"
            aria-label={copy.informes.title}
            value={tab}
            onChange={(value) => write({ tab: value === 'ventas' ? null : value })}
            options={TABS.map((item) => ({ value: item.id, content: item.label }))}
          />
          <SegmentedControl
            size="sm"
            aria-label={copy.informes.chart}
            value={chart}
            onChange={(value) => {
              setPickedFor(chartKey)
              setChartPick(value)
            }}
            options={[
              { value: 'bar', content: <ChartColumn />, 'aria-label': copy.informes.bars },
              { value: 'line', content: <ChartLine />, 'aria-label': copy.informes.line },
            ]}
          />
        </div>
        <div className="ml-auto flex shrink-0 md:hidden">{csv}</div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <DateRangePicker
            from={from}
            to={to}
            size="sm"
            className="w-64 shrink-0"
            ariaLabel={copy.informes.range}
            placeholder={copy.informes.range}
            labels={{ clear: copy.informes.clear, today: copy.informes.today }}
            onChange={(next) => {
              if (next.from && next.to) {
                setDraft(null)
                write({ from: next.from, to: next.to })
              } else if (!next.from && !next.to) {
                setDraft(null)
                write({ from: null, to: null })
              } else {
                setDraft(next)
              }
            }}
          />
          <Select
            size="sm"
            aria-label={copy.informes.group}
            value={groupBy}
            onChange={(event) => {
              const value = event.target.value
              write({ group_by: isGroupBy(value) && value !== defaultGroup(tab) ? value : null })
            }}
          >
            {GROUP_BY.map((id) => (
              <option key={id} value={id}>
                {copy.informes.groups[id]}
              </option>
            ))}
          </Select>
          <SegmentedControl<EntityChoice>
            size="sm"
            aria-label={copy.entity.label}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', content: copy.entity.all },
              ...entities.map((entity) => ({ value: entity.code, content: entityName(entity.code) })),
            ]}
          />
          <Chip pressed={compare} active={compare} onClick={() => write({ compare: compare ? null : 'previous_year' })}>
            {copy.informes.compare}
          </Chip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <motion.div
          key={tab}
          className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:px-4 sm:py-5"
          {...pageMotion(reduce)}
        >
          {report.initial ? (
            <ReportSkeleton />
          ) : report.data ? (
            <ReportBody body={report.data} chart={chart} measure={measure} />
          ) : report.error ? (
            <ErrorState title={`${copy.error.load} (${report.error.code})`} detail={errorDetail(report.error)} onRetry={report.reload} />
          ) : null}
        </motion.div>
      </div>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
      </div>
      <Skeleton className="h-60 w-full rounded-xl" />
    </div>
  )
}

function ReportBody({ body, chart, measure }: { body: ReportBody; chart: 'bar' | 'line'; measure: Measure }) {
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const temporal = body.group_by === 'month' || body.group_by === 'year'
  const compare = body.compare === 'previous_year'
  const alive = hasMeasure(body, measure)
  const polarity = body.report === 'expenses' ? 'down-good' : body.report === 'sales' ? 'up-good' : 'neutral'
  const stats = statsFor(body, measure)
  const rows = useMemo(() => sortedRows(body.series, sort, measure, temporal), [body.series, measure, sort, temporal])
  const columns = useMemo(() => columnsFor(body, measure), [body, measure])
  const model = useMemo(() => reportModel(body, measure), [body, measure])
  const shown = visibleModel(model, hidden)
  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next.size >= model.series.length ? new Set() : next
    })

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            type={MEASURE_TYPE[stat.measure]}
            formatted={<FitAmount full={formatMeasure(stat.value, stat.measure)} short={compactMeasure(stat.value, stat.measure)} className="w-full" />}
            previous={stat.delta ? stat.previous : null}
            previousText={stat.delta && stat.previous != null ? formatMeasure(stat.previous, stat.measure) : undefined}
            polarity={stat.delta ? polarity : 'neutral'}
          />
        ))}
      </div>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-label font-medium text-ink-900">{MEASURE_LABEL[measure]}</h3>
          {compare ? <ChartLegend series={model.series} hidden={hidden} onToggle={toggle} onIsolate={(key) => setHidden(new Set(model.series.filter((entry) => entry.key !== key).map((entry) => entry.key)))} /> : null}
        </div>
        {!alive ? (
          <ChartEmpty height={240} message={copy.informes.emptyHint} />
        ) : chart === 'line' ? (
          <LineChart model={shown} />
        ) : temporal || compare ? (
          <ColumnChart model={shown} />
        ) : (
          <BarList model={shown} />
        )}
      </section>

      {alive ? (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          sortBy={sort?.id}
          sortDir={sort?.dir}
          onSort={(id, dir) => setSort({ id, dir })}
        />
      ) : null}
    </>
  )
}

const MEASURE_TYPE: Record<Measure, MeasureType> = { amount: 'currency', volume: 'number', units: 'number' }

function reportModel(body: ReportBody, measure: Measure): ChartModel {
  const temporal = body.group_by === 'month' || body.group_by === 'year'
  const compare = body.compare === 'previous_year'
  const { points } = chartPoints(body, measure, Number.POSITIVE_INFINITY)
  const type = MEASURE_TYPE[measure]
  return chartModel({
    categoryLabel: copy.informes.groups[body.group_by],
    measureType: type,
    temporal,
    comparison: compare,
    format: (value) => formatMeasure(value, measure),
    series: compare
      ? [
          { key: 'current', label: copy.informes.current, color: seriesColor(0), type },
          { key: 'previous', label: copy.informes.previous, color: seriesColor(1), type },
        ]
      : [{ key: 'current', label: MEASURE_LABEL[measure], color: CHART_INK, type }],
    categories: points.map((point) => {
      const values = compare ? [metricNumber(point, measure), metricNumber(point.previous, measure)] : [metricNumber(point, measure)]
      return {
        key: point.key,
        label: displayLabel(body.group_by, point),
        values,
        total: values.reduce((sum, value) => sum + value, 0),
      }
    }),
  })
}

function statsFor(body: ReportBody, measure: Measure) {
  const previous = body.compare === 'previous_year'
  if (body.report === 'stock') {
    return [
      { label: copy.informes.volume, measure: 'volume' as const, value: metricNumber(body.totals, 'volume'), previous: metricNumber(body.previous_totals, 'volume'), delta: previous },
      { label: copy.informes.units, measure: 'units' as const, value: metricNumber(body.totals, 'units'), previous: metricNumber(body.previous_totals, 'units'), delta: false },
    ]
  }
  if (body.report === 'expenses') {
    return [
      { label: copy.informes.amount, measure: 'amount' as const, value: metricNumber(body.totals, 'amount'), previous: metricNumber(body.previous_totals, 'amount'), delta: previous },
      { label: copy.informes.base, measure: 'amount' as const, value: Number(body.totals.base) || 0, previous: Number(body.previous_totals?.base) || 0, delta: false },
      { label: copy.informes.tax, measure: 'amount' as const, value: Number(body.totals.tax) || 0, previous: Number(body.previous_totals?.tax) || 0, delta: false },
    ]
  }
  return [
    { label: MEASURE_LABEL[measure], measure, value: metricNumber(body.totals, measure), previous: metricNumber(body.previous_totals, measure), delta: previous },
    { label: copy.informes.units, measure: 'units' as const, value: metricNumber(body.totals, 'units'), previous: null, delta: false },
    { label: copy.informes.volume, measure: 'volume' as const, value: metricNumber(body.totals, 'volume'), previous: null, delta: false },
  ]
}

function columnsFor(body: ReportBody, measure: Measure): TableColumn<ReportPoint>[] {
  const money = body.report !== 'stock'
  const columns: TableColumn<ReportPoint>[] = [
    { id: 'label', header: copy.informes.label, cell: (row) => displayLabel(body.group_by, row), minWidth: '160px' },
    {
      id: 'value',
      header: MEASURE_LABEL[measure],
      align: 'right',
      sortable: true,
      cell: (row) => formatMeasure(metricNumber(row, measure), measure),
    },
  ]
  if (body.compare === 'previous_year') {
    columns.push({
      id: 'previous',
      header: copy.informes.previous,
      align: 'right',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatMeasure(metricNumber(row.previous, measure), measure),
    })
  }
  if (money && measure !== 'amount') {
    columns.push({
      id: 'amount',
      header: copy.informes.amount,
      align: 'right',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatMeasure(metricNumber(row, 'amount'), 'amount'),
    })
  }
  if (money) {
    columns.push(
      {
        id: 'base',
        header: copy.informes.base,
        align: 'right',
        sortable: true,
        hideOnMobile: true,
        cell: (row) => formatMeasure(Number(row.base) || 0, 'amount'),
      },
      {
        id: 'tax',
        header: copy.informes.tax,
        align: 'right',
        sortable: true,
        hideOnMobile: true,
        cell: (row) => formatMeasure(Number(row.tax) || 0, 'amount'),
      },
    )
  }
  if (measure !== 'units') {
    columns.push({
      id: 'units',
      header: copy.informes.units,
      align: 'right',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatMeasure(metricNumber(row, 'units'), 'units'),
    })
  }
  if (measure !== 'volume') {
    columns.push({
      id: 'volume',
      header: copy.informes.volume,
      align: 'right',
      sortable: true,
      hideOnMobile: true,
      cell: (row) => formatMeasure(metricNumber(row, 'volume'), 'volume'),
    })
  }
  return columns
}

function sortedRows(rows: ReportPoint[], sort: { id: string; dir: 'asc' | 'desc' } | null, measure: Measure, temporal: boolean) {
  const next = [...rows]
  const dir = sort?.dir === 'asc' ? 1 : -1
  const valueOf = (row: ReportPoint) => {
    if (!sort || sort.id === 'value') return metricNumber(row, measure)
    if (sort.id === 'previous') return metricNumber(row.previous, measure)
    if (sort.id === 'amount') return metricNumber(row, 'amount')
    if (sort.id === 'base') return Number(row.base) || 0
    if (sort.id === 'tax') return Number(row.tax) || 0
    if (sort.id === 'units') return metricNumber(row, 'units')
    if (sort.id === 'volume') return metricNumber(row, 'volume')
    return 0
  }
  if (!sort) {
    if (temporal) return next.sort((left, right) => left.key.localeCompare(right.key, 'es'))
    return next.sort((left, right) => metricNumber(right, measure) - metricNumber(left, measure))
  }
  if (sort.id === 'label') {
    return next.sort((left, right) => dir * left.label.localeCompare(right.label, 'es'))
  }
  return next.sort((left, right) => dir * (valueOf(left) - valueOf(right)))
}

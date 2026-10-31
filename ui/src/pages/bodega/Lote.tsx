import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { AuditTrail } from '@/components/AuditTrail'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import type { Lot, Traceability, TraceEdge, TraceNode } from '@/lib/cellar'
import type { AuditEvent } from '@/lib/contacts'
import { formatDateTime, formatLitres, formatPercent } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { Alert, Badge, EmptyState, Skeleton } from '@/ui'
import { ReadingColumn, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { DisenoTab } from '@/pages/lote-diseno/DisenoTab'
import { lotKindLabel, lotStatusLabel, moveLabel } from '@/pages/bodega/labels'

const TABS = [
  { id: 'resumen', label: copy.cellar.summary },
  { id: 'diseno', label: copy.cellar.design },
  { id: 'genealogia', label: copy.cellar.genealogy },
  { id: 'analiticas', label: copy.cellar.analyses },
  { id: 'adiciones', label: copy.cellar.additions },
  { id: 'movimientos', label: copy.cellar.moves },
  { id: 'ventas', label: copy.cellar.sales },
  { id: 'catas', label: copy.cellar.tastings },
  { id: 'historial', label: copy.cellar.history },
] as const

type TabId = (typeof TABS)[number]['id']
type Page<T> = { items: T[]; next_cursor: string | null; total?: number }
type Wine = { id: string; name: string }

function formatAmount(volumeMl: number, massG = 0): string {
  if (volumeMl > 0) return formatLitres(volumeMl / 1000)
  if (massG > 0) {
    const kg = massG / 1000
    const [whole, frac] = kg.toFixed(3).split('.')
    const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${grouped},${frac} kg`
  }
  return formatLitres(0)
}

function so2Over(items: Record<string, unknown>[]): boolean {
  return items.some((item) => {
    const raw = item.so2_total ?? item.total_so2_mg_l ?? item.so2
    const value = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(value) && value > 100
  })
}

export function LotePage({ me }: { me: Me }) {
  const { lotId = '' } = useParams()
  const allowed = allows(me, 'cellar.read') && Boolean(lotId)
  const code = encodeURIComponent(lotId)
  const lot = useApi<Lot>(allowed ? `/v1/lots/${code}` : null)
  const trace = useApi<Traceability>(allowed ? `/v1/lots/${code}/traceability?direction=both` : null)
  const wines = useApi<{ items: Wine[] }>(allowed ? '/v1/wines?limit=100' : null)
  const [tab, setTab] = useState<TabId>('resumen')
  const analyses = useApi<Page<Record<string, unknown>>>(allowed && tab === 'analiticas' ? `/v1/lots/${code}/analyses` : null)
  const additions = useApi<Page<Record<string, unknown>>>(allowed && tab === 'adiciones' ? `/v1/lots/${code}/additions` : null)
  const moves = useApi<Page<Record<string, unknown>>>(allowed && tab === 'movimientos' ? `/v1/lots/${code}/moves?limit=20` : null)
  const sales = useApi<Page<Record<string, unknown>>>(allowed && tab === 'ventas' ? `/v1/lots/${code}/sales` : null)
  const history = useApi<{ items: AuditEvent[]; next_cursor: string | null }>(
    allowed && tab === 'historial' && lot.data ? `/v1/audit?table=inventory.lot&row_id=${lot.data.id}` : null,
  )
  useChromeTitle(lot.data?.code || copy.cellar.lots)

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (lot.loading && !lot.data) {
    return (
      <div aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    )
  }
  if (lot.error || !lot.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${lot.error?.code ?? 'WC_ERROR'})`} detail={lot.error?.message} onRetry={lot.reload} />
      </div>
    )
  }

  const item = lot.data
  const wineName = item.wine_name || wines.data?.items.find((wine) => wine.id === item.wine_id)?.name || null
  const places = item.positions.filter((place) => (place.vessel_code ?? '') !== '' && place.volume_ml !== 0)
  const volumeMl = places.reduce((sum, place) => sum + place.volume_ml, 0) || item.positions.reduce((sum, place) => sum + place.volume_ml, 0)

  return (
    <ReadingColumn screen="bodega-lote" tab={tab}>
      <RecordBar backTo="/bodega/lotes" backLabel={copy.cellar.lots} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{item.code}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {[lotKindLabel(item.kind), wineName, item.vintage].filter(Boolean).join(' · ')}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>{lotStatusLabel(item.status)}</Badge>
            <Badge tone={item.is_organic ? 'success' : 'neutral'}>{item.is_organic ? copy.cellar.organic : copy.cellar.conventional}</Badge>
            <Badge tone="neutral">{lotKindLabel(item.kind)}</Badge>
          </div>
          {item.is_organic && analyses.data && so2Over(analyses.data.items) ? (
            <Alert tone="warning">{copy.cellar.organicSo2}</Alert>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label={copy.cellar.volume} value={formatLitres(volumeMl / 1000)} />
            <Metric label={copy.cellar.status} value={lotStatusLabel(item.status)} />
            <Metric label={copy.cellar.kind} value={lotKindLabel(item.kind)} />
            <Metric label={copy.cellar.crop} value={item.is_organic ? copy.cellar.organic : copy.cellar.conventional} />
          </div>
          <SectionTabs label="Secciones" tabs={TABS} value={tab} onChange={setTab} />

          {tab === 'resumen' ? (
            <div className="grid gap-4">
              <section className="grid gap-2">
                <h2 className="text-label font-medium text-ink-900">{copy.cellar.where}</h2>
                {places.length === 0 ? (
                  <p className="text-label text-text-secondary">{copy.cellar.emptyPlace}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {places.map((place) => (
                      <li key={place.vessel_code ?? place.location_code}>
                        <Link
                          to={place.vessel_code ? `/bodega/depositos/${encodeURIComponent(place.vessel_code)}` : '/bodega/depositos'}
                          className="block rounded-2xl border border-border-subtle px-4 py-3"
                        >
                          <p className="text-label font-medium text-ink-900">{place.vessel_code || place.location_name || place.location_code}</p>
                          <p className="text-caption tabular-nums text-text-tertiary">{formatLitres(place.volume_ml / 1000)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="grid gap-2">
                <h2 className="text-label font-medium text-ink-900">{copy.cellar.composition}</h2>
                <Composition trace={trace.data} current={item.code} />
              </section>
              {item.notes ? <p className="text-label text-text-secondary">{item.notes}</p> : null}
            </div>
          ) : null}

          {tab === 'diseno' ? <DisenoTab me={me} lotCode={item.code} /> : null}

          {tab === 'genealogia' ? (
            trace.loading ? (
              <Skeleton className="h-24" />
            ) : trace.error ? (
              <ErrorState title={trace.error.message} onRetry={trace.reload} />
            ) : trace.data ? (
              <Genealogy trace={trace.data} current={item.code} />
            ) : null
          ) : null}

          {tab === 'analiticas' ? (
            <RecordList
              page={analyses}
              emptyTitle={copy.cellar.emptyAnalyses}
              emptyHint={copy.cellar.emptyAnalysesHint}
              render={(row) => String(row.parameter ?? row.kind ?? row.id ?? 'Analítica')}
            />
          ) : null}
          {tab === 'adiciones' ? (
            <RecordList
              page={additions}
              emptyTitle={copy.cellar.emptyAdditions}
              emptyHint="Sulfitados y otras prácticas."
              render={(row) =>
                `${String(row.purpose ?? 'Adición')} · ${String(row.quantity ?? '')} ${String(row.quantity_unit ?? '')}`.trim()
              }
            />
          ) : null}
          {tab === 'movimientos' ? (
            <RecordList
              page={moves}
              emptyTitle={copy.cellar.emptyMoves}
              emptyHint="Entradas y salidas del lote."
              render={(row) => {
                const volume = Number(row.volume_ml ?? 0)
                const when = typeof row.occurred_at === 'string' ? formatDateTime(row.occurred_at) : ''
                return `${moveLabel(String(row.move_type ?? ''))} · ${formatLitres(volume / 1000)}${when ? ` · ${when}` : ''}`
              }}
            />
          ) : null}
          {tab === 'ventas' ? <RecordList page={sales} emptyTitle={copy.cellar.emptySales} emptyHint="Albaranes y facturas de este lote." render={(row) => String(row.id ?? 'Venta')} /> : null}
          {tab === 'catas' ? <EmptyState size="sm" title={copy.cellar.emptyTastings} description="Las notas de cata se anotarán aquí." /> : null}
          {tab === 'historial' ? (
            <AuditTrail
              items={history.data?.items ?? []}
              loading={history.loading}
              error={history.error ? `${copy.error.load} (${history.error.code})` : undefined}
              onRetry={history.reload}
            />
          ) : null}
        </div>
      </div>
    </ReadingColumn>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle px-3 py-2">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="text-label font-medium break-words text-ink-900">{value}</p>
    </div>
  )
}

function RecordList({
  page,
  emptyTitle,
  emptyHint,
  render,
}: {
  page: ReturnType<typeof useApi<Page<Record<string, unknown>>>>
  emptyTitle: string
  emptyHint: string
  render: (row: Record<string, unknown>) => string
}) {
  if (page.loading && !page.data) return <Skeleton className="h-24" />
  if (page.error) return <ErrorState title={page.error.message} onRetry={page.reload} />
  const items = page.data?.items ?? []
  if (items.length === 0) return <EmptyState size="sm" title={emptyTitle} description={emptyHint} />
  return (
    <ul className="overflow-hidden rounded-2xl border border-border-subtle">
      {items.map((row, index) => (
        <li key={String(row.id ?? index)} className="border-b border-border-subtle px-4 py-2 text-label text-ink-900 last:border-b-0">
          {render(row)}
        </li>
      ))}
    </ul>
  )
}

function nodeCode(trace: Traceability, id: string): string {
  return trace.nodes.find((node) => node.lot_id === id)?.code ?? id
}

function edgeEnds(trace: Traceability, edge: TraceEdge): { parent: string; child: string } {
  return {
    parent: edge.parent_code ?? nodeCode(trace, edge.parent_lot_id),
    child: edge.child_code ?? nodeCode(trace, edge.child_lot_id),
  }
}

function Composition({ trace, current }: { trace: Traceability | null; current: string }) {
  if (!trace) return <p className="text-label text-text-secondary">Cargando el origen…</p>
  const parents = trace.edges.filter((edge) => edgeEnds(trace, edge).child === current)
  if (parents.length === 0) return <p className="text-label text-text-secondary">{copy.cellar.originLot}</p>
  const volumeTotal = parents.reduce((sum, edge) => sum + edge.volume_ml, 0)
  return (
    <ul className="overflow-hidden rounded-2xl border border-border-subtle">
      {parents.map((edge) => {
        const ends = edgeEnds(trace, edge)
        const pct = volumeTotal > 0 ? (edge.volume_ml / volumeTotal) * 100 : null
        return (
          <li key={ends.parent} className="border-b border-border-subtle px-4 py-2 text-label last:border-b-0">
            <Link to={`/bodega/lotes/${encodeURIComponent(ends.parent)}`} className="font-medium text-ink-900 underline">
              {ends.parent}
            </Link>
            <span className="text-text-tertiary">
              {' '}
              · {formatAmount(edge.volume_ml, edge.mass_g)}
              {pct !== null ? ` · ${formatPercent(pct)}` : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Genealogy({ trace, current }: { trace: Traceability; current: string }) {
  const rows = treeRows(trace)
  const levels = generations(trace)
  return (
    <>
      <ul className="grid gap-1 lg:hidden" data-tree="lista">
        {rows.map(({ node, depth }) => (
          <li key={node.code} className="min-h-9 border-l border-border-subtle py-1 pl-3" style={{ marginLeft: depth * 12 }}>
            <NodeLine node={node} current={current} />
          </li>
        ))}
      </ul>
      <div className="hidden min-w-0 lg:block">
        <div className="flex items-center gap-2 overflow-x-auto pb-2" data-tree="grafo">
          {levels.map((level, index) => (
            <div key={level[0]?.code ?? index} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden className="text-text-tertiary">→</span> : null}
              <div className="grid content-start gap-3">
                {level.map((node) => (
                  <div
                    key={node.code}
                    className={cn(
                      'w-40 rounded-2xl border border-border-subtle bg-surface p-3',
                      node.code === current && 'border-ink-900',
                    )}
                  >
                    <p className="text-label font-medium text-ink-900">{node.code}</p>
                    <p className="text-caption text-text-tertiary">{lotKindLabel(node.kind)}</p>
                    {node.wine_name ? <p className="truncate text-caption">{node.wine_name}</p> : null}
                    {node.vintage ? <p className="text-caption text-text-tertiary">{node.vintage}</p> : null}
                    {node.volume_ml ? <p className="text-caption tabular-nums">{formatAmount(node.volume_ml, node.mass_g)}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function NodeLine({ node, current }: { node: TraceNode; current: string }) {
  const meta = [lotKindLabel(node.kind), node.vintage ? String(node.vintage) : '', node.volume_ml ? formatAmount(node.volume_ml, node.mass_g) : '']
    .filter(Boolean)
    .join(' · ')
  if (node.code === current) {
    return (
      <span className="text-label font-medium text-ink-900">
        {node.code} · {copy.cellar.thisLot}
        <span className="font-normal text-text-tertiary"> · {meta}</span>
      </span>
    )
  }
  return (
    <span className="text-label">
      <Link to={`/bodega/lotes/${encodeURIComponent(node.code)}`} className="underline">
        {node.code}
      </Link>
      <span className="text-text-tertiary"> · {meta}</span>
    </span>
  )
}

function treeRows(trace: Traceability): { node: TraceNode; depth: number }[] {
  const byCode = new Map(trace.nodes.map((node) => [node.code, node]))
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()
  for (const edge of trace.edges) {
    const ends = edgeEnds(trace, edge)
    children.set(ends.parent, [...(children.get(ends.parent) ?? []), ends.child])
    hasParent.add(ends.child)
  }
  const roots = trace.nodes.filter((node) => !hasParent.has(node.code))
  const rows: { node: TraceNode; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (code: string, depth: number) => {
    if (seen.has(code) || depth > 8) return
    const node = byCode.get(code)
    if (!node) return
    seen.add(code)
    rows.push({ node, depth })
    for (const child of children.get(code) ?? []) walk(child, depth + 1)
  }
  for (const root of roots.length > 0 ? roots : trace.nodes) walk(root.code, 0)
  return rows
}

function generations(trace: Traceability): TraceNode[][] {
  const depth = new Map<string, number>()
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()
  for (const edge of trace.edges) {
    const ends = edgeEnds(trace, edge)
    children.set(ends.parent, [...(children.get(ends.parent) ?? []), ends.child])
    hasParent.add(ends.child)
  }
  const roots = trace.nodes.map((node) => node.code).filter((code) => !hasParent.has(code))
  const queue = (roots.length > 0 ? roots : trace.nodes.map((node) => node.code)).map((code) => ({ code, level: 0 }))
  while (queue.length > 0) {
    const item = queue.shift()
    if (!item || depth.has(item.code)) continue
    depth.set(item.code, item.level)
    for (const child of children.get(item.code) ?? []) queue.push({ code: child, level: item.level + 1 })
  }
  const levels: TraceNode[][] = []
  for (const node of trace.nodes) {
    const level = depth.get(node.code) ?? 0
    levels[level] = [...(levels[level] ?? []), node]
  }
  return levels.filter((level) => level.length > 0)
}

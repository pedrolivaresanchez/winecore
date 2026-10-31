import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { entityName } from '@/lib/labels'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { formatDateTime } from '@/lib/format'
import type { Me } from '@/lib/types'
import { toBalance, toFiscal } from '@/pages/existencias/adapt'
import {
  downloadInspection,
  fetchInspection,
  fiscalBalancesPath,
  ownerEntityId,
  saveBlob,
  type FiscalBalance,
  type InspectionDocument,
  type StockBalance,
} from '@/pages/existencias/api'
import { useCatalog } from '@/pages/existencias/catalog'
import { explainStockError } from '@/pages/existencias/explain'
import { filterBalances, filterFiscal } from '@/pages/existencias/filters'
import { groupBalances } from '@/pages/existencias/groups'
import { classLabel, ownerLabel, productLabel, stateLabel } from '@/pages/existencias/labels'
import { summarizeFiscal, summarizePhysical } from '@/pages/existencias/summarize'
import { isBeforeStockEpoch, madridDate } from '@/pages/existencias/time'
import { useList } from '@/pages/existencias/use-list'
import { formatMl, formatUnits } from '@/pages/existencias/volume'
import { ArrowLeft, FileText } from '@/ui/icons'
import { Button, EmptyState, useToast } from '@/ui'

export function InspectionPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { filter, entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const ownerId = ownerEntityId(filter, entities)
  const [params] = useSearchParams()
  const at = params.get('at') || new Date().toISOString()
  const before = isBeforeStockEpoch(at)
  const [document, setDocument] = useState<InspectionDocument | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(!before)
  const fiscal = useList<unknown>(before ? null : fiscalBalancesPath({ at: madridDate(at), legalEntityId: ownerId }))
  useChromeTitle(copy.stock.inspection)

  useEffect(() => {
    if (before) return
    const controller = new AbortController()
    setDocLoading(true)
    setPdfError(null)
    fetchInspection(at, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setDocument(result)
        setDocLoading(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
        setPdfError(explainStockError(apiError))
        setDocLoading(false)
      })
    return () => controller.abort()
  }, [at, before])

  const rows = useMemo(
    () => filterBalances((document?.items ?? []).map((row) => toBalance(row, catalog)), { ownerEntityId: ownerId }),
    [catalog, document?.items, ownerId],
  )
  const fiscalRows = useMemo(
    () => filterFiscal(fiscal.items.map((row) => toFiscal(row, catalog)), { legalEntityId: ownerId }),
    [catalog, fiscal.items, ownerId],
  )
  const groups = useMemo(() => groupBalances(rows), [rows])
  const stats = useMemo(() => summarizePhysical(rows), [rows])
  const fiscalStats = useMemo(() => summarizeFiscal(fiscalRows), [fiscalRows])

  if (!allows(me, 'inventory.read')) return <NoPermission />

  const loading = !before && (docLoading || fiscal.loading)
  const error = fiscal.error
  const screen = loading ? 'informe-cargando' : before ? 'informe-antes' : 'informe'
  const entity = filter === 'all' ? copy.entity.all : entityName(filter)
  const sha = document?.hash ?? null

  async function download() {
    try {
      const blob = await downloadInspection(at, 'csv')
      saveBlob(blob, `existencias-${madridDate(at)}.csv`)
      toast(copy.stock.csvDone)
    } catch (err: unknown) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load)
      toast(explainStockError(apiError))
    }
  }

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <style>{`@media print { aside, [data-print-hide] { display: none !important; } #contenido { overflow: visible !important; background: white !important; } }`}</style>
      <header data-print-hide className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.stock.back} onClick={() => navigate(`/stock?at=${encodeURIComponent(at)}`)}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">{copy.stock.inspection}</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
          {copy.stock.print}
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={!document} onClick={() => void download()}>
          {copy.stock.downloadCsv}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header className="grid gap-1">
            <p className="text-caption text-text-tertiary">WineCore · {copy.stock.inspection}</p>
            <h1 className="text-heading font-medium tracking-tight text-ink-900">{formatDateTime(at)}</h1>
            <p className="text-label text-text-secondary">{entity}</p>
            <p className="text-label text-text-secondary">{copy.stock.booksLine}</p>
            {sha ? <p className="font-mono text-caption break-all text-text-tertiary">{copy.stock.hash} {sha}</p> : null}
            {pdfError ? <p className="text-label text-danger-700">{pdfError}</p> : null}
          </header>
          {before ? (
            <EmptyState icon={<FileText strokeWidth={iconStroke} />} title={copy.stock.beforeTitle} description={copy.stock.beforeHint} />
          ) : error && !document ? (
            <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={fiscal.reload} />
          ) : loading ? (
            <p className="text-label text-text-tertiary">{copy.loading}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Granel físico" value={formatMl(stats.bulkMl)} />
                <Metric label="Envasado físico" value={`${formatUnits(stats.formats.reduce((sum, item) => sum + item.units, 0))} ud`} />
                <Metric label="Granel fiscal" value={formatMl(fiscalStats.bulk.volumeMl + fiscalStats.bulk_wood.volumeMl)} />
                <Metric label="Envasado fiscal" value={`${formatUnits(fiscalStats.packaged.units)} ud`} />
              </div>
              <section className="grid min-w-0 gap-3">
                <h2 className="text-label font-medium text-ink-900">{copy.stock.physicalBook}</h2>
                {groups.length === 0 ? <p className="text-label text-text-tertiary">{copy.stock.noPhysical}</p> : null}
                {groups.map((group) => (
                  <div key={group.id} className="overflow-hidden rounded-2xl border border-border-subtle">
                    <h3 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">
                      {group.name} ({group.code}) · {formatMl(group.volumeMl)}
                    </h3>
                    <ul className="md:hidden">
                      {group.rows.map((row) => (
                        <Line key={lineKey(row)} row={row} />
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full border-collapse text-label">
                        <thead>
                          <tr className="text-caption text-text-tertiary">
                            {['Recipiente', 'Lote', 'Añada', 'Producto o vino', 'Estado', 'Propietario', 'Litros', 'Unidades'].map((header) => (
                              <th key={header} className="h-9 border-b border-border-subtle px-3 text-left font-medium">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => (
                            <tr key={lineKey(row)} className="border-b border-border-subtle last:border-b-0">
                              <td className="px-3 py-2">{row.vessel_code ?? '—'}</td>
                              <td className="px-3 py-2">{row.lot_code ?? '—'}</td>
                              <td className="px-3 py-2">{row.vintage ?? '—'}</td>
                              <td className="px-3 py-2">{productLabel(row)}</td>
                              <td className="px-3 py-2">{stateLabel(row.product_state)}</td>
                              <td className="px-3 py-2">{ownerLabel(row.owner_code)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{row.qty_units ? formatUnits(row.qty_units) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
              <section className="grid min-w-0 gap-3">
                <h2 className="text-label font-medium text-ink-900">{copy.stock.fiscalBook}</h2>
                {fiscalRows.length === 0 ? <p className="text-label text-text-tertiary">{copy.stock.noFiscal}</p> : null}
                {fiscalRows.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-border-subtle">
                    <ul className="md:hidden">
                      {fiscalRows.map((row) => (
                        <li key={fiscalKey(row)} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
                          <p className="text-label font-medium text-ink-900">
                            {classLabel(row.product_class)} · {row.excise_product_key ?? row.tax_warehouse_name}
                          </p>
                          <p className="text-caption text-text-tertiary">{productLabel(row)}</p>
                          <p className="text-label tabular-nums">{row.units ? `${formatUnits(row.units)} ud` : formatMl(row.volume_ml)}</p>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full border-collapse text-label">
                        <thead>
                          <tr className="text-caption text-text-tertiary">
                            {['Establecimiento', 'Mayor', 'Referencia', 'Lote', 'Añada', 'Litros', 'Unidades'].map((header) => (
                              <th key={header} className="h-9 border-b border-border-subtle px-3 text-left font-medium">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {fiscalRows.map((row) => (
                            <tr key={fiscalKey(row)} className="border-b border-border-subtle last:border-b-0">
                              <td className="px-3 py-2">{row.tax_warehouse_name}</td>
                              <td className="px-3 py-2">{classLabel(row.product_class)}</td>
                              <td className="px-3 py-2">{row.excise_product_key ?? '—'}</td>
                              <td className="px-3 py-2">{row.lot_code ?? '—'}</td>
                              <td className="px-3 py-2">{row.vintage ?? '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{row.units ? formatUnits(row.units) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle px-4 py-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 text-label font-medium tabular-nums text-ink-900">{value}</p>
    </div>
  )
}

function Line({ row }: { row: StockBalance }) {
  return (
    <li className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <p className="text-label font-medium text-ink-900">{row.vessel_code ?? productLabel(row)}</p>
      <p className="text-caption text-text-tertiary">
        {row.lot_code ?? 'Sin lote'}
        {row.vintage ? ` · ${row.vintage}` : ''} · {stateLabel(row.product_state)} · {ownerLabel(row.owner_code)}
      </p>
      <p className="text-label tabular-nums">{row.qty_units ? `${formatUnits(row.qty_units)} ud` : formatMl(row.volume_ml)}</p>
    </li>
  )
}

function lineKey(row: StockBalance): string {
  return `${row.vessel_id}:${row.lot_id}:${row.product_id}:${row.product_state}`
}

function fiscalKey(row: FiscalBalance): string {
  return `${row.product_class}:${row.lot_id}:${row.excise_product_key}`
}

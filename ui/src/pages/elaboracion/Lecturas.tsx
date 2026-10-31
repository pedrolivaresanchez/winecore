import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { holding, type Vessel } from '@/lib/cellar'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { createReading } from '@/pages/elaboracion/api'
import { FermentationCurve } from '@/pages/elaboracion/curve'
import { decimalOrNull, showDecimal, type CurvePoint } from '@/pages/elaboracion/model'
import { ReadingColumn } from '@/pages/bodega/chrome'
import { Alert, Button, EmptyState, Input, Select, Skeleton, useToast } from '@/ui'

type List = { items: Vessel[]; next_cursor: string | null; total: number }

function failure(error: unknown): string {
  if (error instanceof ApiError) {
    const field = error.fields ? Object.values(error.fields)[0] : undefined
    return field || error.message
  }
  return copy.elaboracion.saveFail
}

export function LecturasPage({ me }: { me: Me }) {
  useChromeTitle(copy.nav.readings)
  const toast = useToast()
  const allowed = allows(me, 'cellar.read')
  const canWrite = allows(me, 'cellar.operate')
  const vessels = useApi<List>(allowed ? '/v1/vessels?limit=100' : null)
  const [vesselId, setVesselId] = useState('')
  const [density, setDensity] = useState('')
  const [temperature, setTemperature] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vessel = vessels.data?.items.find((item) => item.id === vesselId)
  const inside = holding(vessel)
  const readings = useApi<{ items: CurvePoint[] }>(
    allowed && inside ? `/v1/fermentation-readings?vesselId=${encodeURIComponent(vessel?.id ?? '')}&lotId=${encodeURIComponent(inside.lot_id)}` : null,
  )
  const recent = useMemo(() => [...(readings.data?.items ?? [])].reverse().slice(0, 8), [readings.data])

  if (!allowed) return <NoPermission />

  async function save() {
    if (!vessel || !inside || !canWrite) return
    const densityValue = decimalOrNull(density, 4)
    const temperatureValue = decimalOrNull(temperature, 1)
    if ((density.trim() && densityValue === null) || (temperature.trim() && temperatureValue === null) || (!densityValue && !temperatureValue)) {
      setError(copy.elaboracion.needReading)
      return
    }
    if (densityValue && (Number(densityValue) < 0.98 || Number(densityValue) > 1.2)) {
      setError(copy.elaboracion.needReading)
      return
    }
    if (temperatureValue && (Number(temperatureValue) < -5 || Number(temperatureValue) > 45)) {
      setError(copy.elaboracion.needReading)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createReading({
        lot_id: inside.lot_id,
        vessel_id: vessel.id,
        at: new Date().toISOString(),
        ...(densityValue ? { density: densityValue } : {}),
        ...(temperatureValue ? { temperature_c: temperatureValue } : {}),
        source: 'manual',
      })
      setDensity('')
      setTemperature('')
      readings.reload()
      toast(copy.elaboracion.saved)
    } catch (caught) {
      setError(failure(caught))
    } finally {
      setSaving(false)
    }
  }

  const saveButton = canWrite ? (
    <Button type="button" variant="primary" size="sm" loading={saving} disabled={!inside} onClick={() => void save()}>
      {copy.elaboracion.save}
    </Button>
  ) : null

  return (
    <ReadingColumn screen="elaboracion-lecturas">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <h1 className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">{copy.elaboracion.reading}</h1>
        <div className="hidden sm:block">{saveButton}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          {vessels.loading && !vessels.data ? <Skeleton className="h-24" /> : null}
          {vessels.error ? <ErrorState title={vessels.error.message} onRetry={vessels.reload} /> : null}
          <div className="grid gap-3">
            <Field id="lectura-deposito" label={copy.elaboracion.vessel}>
              <Select id="lectura-deposito" className="w-full" value={vesselId} onChange={(event) => setVesselId(event.target.value)}>
                <option value="">{copy.elaboracion.pickVessel}</option>
                {(vessels.data?.items ?? [])
                  .filter((item) => item.status === 'in_service')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code}
                      {item.lot_code ? ` · ${item.lot_code}` : ''}
                    </option>
                  ))}
              </Select>
            </Field>
            {vessel && !inside ? <Alert tone="warning">{copy.elaboracion.noLot}</Alert> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field id="lectura-densidad" label={copy.elaboracion.density}>
                <Input id="lectura-densidad" className="w-full" inputMode="decimal" autoComplete="off" value={density} onChange={(event) => setDensity(event.target.value)} />
              </Field>
              <Field id="lectura-temperatura" label={copy.elaboracion.temperature}>
                <Input
                  id="lectura-temperatura"
                  className="w-full"
                  inputMode="decimal"
                  autoComplete="off"
                  value={temperature}
                  onChange={(event) => setTemperature(event.target.value)}
                />
              </Field>
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {inside ? (
              <Link className="text-label font-medium text-ink-900 underline" to={`/bodega/lotes/${encodeURIComponent(inside.lot_code)}`}>
                {copy.elaboracion.openLot} {inside.lot_code}
              </Link>
            ) : null}
          </div>
          <section className="grid gap-2">
            <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.last}</h2>
            {readings.loading && inside ? <Skeleton className="h-16" /> : null}
            {readings.error ? <ErrorState title={readings.error.message} onRetry={readings.reload} /> : null}
            {!inside || (!readings.loading && recent.length === 0) ? (
              <EmptyState size="sm" title={copy.elaboracion.emptyReadings} description={copy.elaboracion.emptyReadingsHint} />
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-border-subtle">
                {recent.map((point) => (
                  <li key={point.at} className="border-b border-border-subtle px-4 py-2 text-label last:border-b-0">
                    <span className="text-text-tertiary">{formatDateTime(point.at)}</span>
                    <span className="text-ink-900">
                      {' '}
                      · {showDecimal(point.density, 4)} · {showDecimal(point.temperature_c, 1)} °C
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {saveButton ? <div className="shrink-0 border-t border-border-subtle bg-surface px-3 py-2 sm:hidden">{saveButton}</div> : null}
    </ReadingColumn>
  )
}

export function LotCurve({ lotCode }: { lotCode: string }) {
  const curve = useApi<{ points: CurvePoint[] }>(lotCode ? `/v1/lots/${encodeURIComponent(lotCode)}/fermentation-curve` : null)
  if (curve.loading && !curve.data) return <Skeleton className="h-40" />
  if (curve.error) return <ErrorState title={curve.error.message} onRetry={curve.reload} />
  const points = curve.data?.points ?? []
  if (points.length === 0) return <EmptyState size="sm" title={copy.elaboracion.emptyCurve} description={copy.elaboracion.emptyCurveHint} />
  return <FermentationCurve points={points} />
}

import { useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { formatDateTime } from '@/lib/format'
import type { Me } from '@/lib/types'
import { apiFailure, createLotAnalysis, createParcelAnalysis } from '@/pages/elaboracion/api'
import {
  ANALYSIS_KINDS,
  PARAMETERS,
  decimalOrNull,
  localInputNow,
  phaseLabel,
  showDecimal,
  toInstant,
  type Analysis,
  type Evolution,
  type Page,
} from '@/pages/elaboracion/model'
import { ReadingColumn } from '@/pages/bodega/chrome'
import { WhenField } from '@/pages/elaboracion/WhenField'
import { Alert, Badge, Button, Dialog, DialogBody, DialogFooter, DialogHeader, EmptyState, Input, SegmentedControl, Select, Skeleton, useToast } from '@/ui'

type Subject = 'lot' | 'parcel'

function kindLabel(kind: string): string {
  if (kind in copy.elaboracion.kinds) return copy.elaboracion.kinds[kind as keyof typeof copy.elaboracion.kinds]
  return kind
}

function paramLabel(code: string): string {
  if (code in copy.elaboracion.param) return copy.elaboracion.param[code as keyof typeof copy.elaboracion.param]
  return code
}

function fieldLabel(code: string, unit: string): string {
  const name = paramLabel(code)
  if (name.toLowerCase() === unit.toLowerCase()) return name
  return `${name} · ${unit}`
}

function physicalOut(analysis: Analysis): boolean {
  const flags = analysis.flags ?? []
  if (flags.length > 0) return flags.some((flag) => flag.category && !flag.category.startsWith('assumption'))
  return analysis.out_of_spec === true
}

function MarkRow({ analysis }: { analysis: Analysis }) {
  const marks = analysis.marks
  return (
    <div className="flex flex-wrap gap-1">
      {marks?.volatile ? <Badge tone="warning">{copy.elaboracion.volatile}</Badge> : null}
      {marks?.dry ? <Badge tone="success">{copy.elaboracion.dry}</Badge> : null}
      {marks?.malolactic_finished ? <Badge tone="success">{copy.elaboracion.fmlDone}</Badge> : null}
      {marks?.volatile_overlap ? <Badge tone="warning">{copy.elaboracion.overlap}</Badge> : null}
      {physicalOut(analysis) ? <Badge tone="danger">{copy.elaboracion.outOfSpec}</Badge> : null}
    </div>
  )
}

function AnalysisList({ items }: { items: Analysis[] }) {
  if (items.length === 0) return <EmptyState size="sm" title={copy.elaboracion.emptyAnalyses} description={copy.elaboracion.emptyAnalysesHint} />
  return (
    <ul className="overflow-hidden rounded-2xl border border-border-subtle">
      {items.map((item) => (
        <li key={item.id} className="grid gap-1 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label font-medium text-ink-900">{formatDateTime(item.sampled_at)}</p>
            <Badge tone="neutral">{item.lab === 'internal' ? copy.elaboracion.internal : item.lab_name || copy.elaboracion.external}</Badge>
          </div>
          <MarkRow analysis={item} />
          <p className="text-caption text-text-tertiary">
            {(item.results ?? [])
              .map((result) => `${paramLabel(result.parameter)} ${showDecimal(result.value, 2)} ${result.unit}`)
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function EvolutionTimeline({ lotCode }: { lotCode: string }) {
  const evolution = useApi<Evolution>(lotCode ? `/v1/lots/${encodeURIComponent(lotCode)}/evolution` : null)
  if (evolution.loading && !evolution.data) return <Skeleton className="h-24" />
  if (evolution.error) return <ErrorState title={evolution.error.message} onRetry={evolution.reload} />
  const data = evolution.data
  if (!data) return null
  const rows = [
    ...data.analyses.map((item) => ({
      id: `a-${item.id}`,
      at: item.sampled_at,
      title: kindLabel(item.kind),
      detail: item.lab === 'internal' ? copy.elaboracion.internal : item.lab_name || copy.elaboracion.external,
    })),
    ...data.readings.map((item) => ({
      id: `r-${item.at}`,
      at: item.at,
      title: copy.elaboracion.reading,
      detail: `${showDecimal(item.density, 4)} · ${showDecimal(item.temperature_c, 1)} °C`,
    })),
    ...data.phases.map((item) => ({
      id: `p-${item.id}`,
      at: item.started_at || item.ended_at || '',
      title: phaseLabel(item.phase),
      detail: item.status === 'in_progress' ? copy.elaboracion.inProgress : item.status === 'completed' ? copy.elaboracion.completed : item.status === 'stopped' ? copy.elaboracion.stopped : item.status,
    })),
  ]
    .filter((row) => row.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return (
    <section data-screen="elaboracion-evolucion" className="grid gap-2">
      <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.evolution}</h2>
      {rows.length === 0 ? (
        <EmptyState size="sm" title={copy.elaboracion.emptyEvolution} description={copy.elaboracion.emptyEvolutionHint} />
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border-subtle">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
              <p className="text-label font-medium text-ink-900">{row.title}</p>
              <p className="text-caption text-text-tertiary">
                {formatDateTime(row.at)} · {row.detail}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function AnalysisForm({
  lotCode,
  onLot,
  locked,
  onSaved,
}: {
  lotCode: string
  onLot?: (code: string) => void
  locked: boolean
  onSaved: (analysis: Analysis) => void
}) {
  const toast = useToast()
  const lots = useApi<Page<{ code: string }>>(locked ? null : '/v1/lots?status=active&limit=100')
  const parcels = useApi<{ items: { code: string; name: string }[] }>(locked ? null : '/v1/parcels')
  const contacts = useApi<Page<{ id: string; legal_name: string }>>('/v1/contacts?role=supplier&limit=50')
  const samples = useApi<Page<{ id: string; number: string | null; occurred_at: string }>>('/v1/cellar-operations?op_type=sampling&limit=20')
  const [subject, setSubject] = useState<Subject>('lot')
  const [parcel, setParcel] = useState('')
  const [lab, setLab] = useState<'internal' | 'external'>('internal')
  const [contactId, setContactId] = useState('')
  const [labName, setLabName] = useState('')
  const [sampleId, setSampleId] = useState('')
  const [sampledAt, setSampledAt] = useState(localInputNow)
  const [resultAt, setResultAt] = useState('')
  const [kind, setKind] = useState<(typeof ANALYSIS_KINDS)[number]>('control')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeLot = lotCode

  async function save() {
    const results: { parameter: string; value: string; unit: string }[] = []
    let invalid = false
    for (const parameter of PARAMETERS) {
      const raw = values[parameter.code] ?? ''
      if (!raw.trim()) continue
      const value = decimalOrNull(raw, parameter.scale)
      if (value === null) invalid = true
      else results.push({ parameter: parameter.code, value, unit: parameter.unit })
    }
    if (invalid || results.length === 0) {
      setError(copy.elaboracion.needParameter)
      return
    }
    if (subject === 'parcel' && !locked && !parcels.data?.items.some((item) => item.code === parcel)) {
      setError(copy.elaboracion.pickParcel)
      return
    }
    if ((locked || subject === 'lot') && !activeLot) {
      setError(copy.elaboracion.pickLot)
      return
    }
    if (resultAt && new Date(resultAt).getTime() < new Date(sampledAt).getTime()) {
      setError(copy.elaboracion.resultAt)
      return
    }
    const contact = contacts.data?.items.find((item) => item.id === contactId)
    const body = {
      at: toInstant(sampledAt),
      lab,
      ...(lab === 'external' && (labName.trim() || contact?.legal_name) ? { lab_name: labName.trim() || contact?.legal_name } : {}),
      ...(lab === 'external' && contactId && (locked || subject === 'lot') ? { lab_contact_id: contactId } : {}),
      ...(sampleId && (locked || subject === 'lot') ? { sample_operation_id: sampleId } : {}),
      ...(resultAt ? { result_at: toInstant(resultAt) } : {}),
      kind: locked || subject === 'lot' ? kind : 'grape',
      results,
    }
    setSaving(true)
    setError(null)
    try {
      const created = locked || subject === 'lot' ? await createLotAnalysis(activeLot, body) : await createParcelAnalysis(parcel.trim(), body)
      setValues({})
      toast(copy.elaboracion.analysisSaved)
      onSaved(created)
    } catch (caught) {
      setError(apiFailure(caught, copy.elaboracion.saveFail))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-3">
      {locked ? null : (
        <SegmentedControl
          aria-label={copy.elaboracion.subject}
          value={subject}
          onChange={setSubject}
          options={[
            { value: 'lot', content: copy.elaboracion.lot },
            { value: 'parcel', content: copy.elaboracion.parcel },
          ]}
        />
      )}
      {locked || subject === 'lot' ? (
        locked ? null : (
          <Field id="analitica-lote" label={copy.elaboracion.lot}>
            <Select id="analitica-lote" className="w-full" value={lotCode} onChange={(event) => onLot?.(event.target.value)}>
              <option value="">{copy.elaboracion.pickLot}</option>
              {(lots.data?.items ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
        )
      ) : (
        <Field id="analitica-parcela" label={copy.elaboracion.parcel}>
          <Select id="analitica-parcela" className="w-full" value={parcel} onChange={(event) => setParcel(event.target.value)}>
            <option value="">{copy.elaboracion.pickParcel}</option>
            {(parcels.data?.items ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field id="analitica-origen" label={copy.elaboracion.origin}>
        <Select id="analitica-origen" className="w-full" value={lab} onChange={(event) => setLab(event.target.value as 'internal' | 'external')}>
          <option value="internal">{copy.elaboracion.internal}</option>
          <option value="external">{copy.elaboracion.external}</option>
        </Select>
      </Field>
      {lab === 'external' ? (
        <>
          <Field id="analitica-lab" label={copy.elaboracion.labContact}>
            <Select id="analitica-lab" className="w-full" value={contactId} onChange={(event) => setContactId(event.target.value)}>
              <option value="">{copy.elaboracion.pickLab}</option>
              {(contacts.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="analitica-lab-nombre" label={copy.elaboracion.labName}>
            <Input id="analitica-lab-nombre" className="w-full" value={labName} onChange={(event) => setLabName(event.target.value)} />
          </Field>
        </>
      ) : null}
      {locked || subject === 'lot' ? (
        <Field id="analitica-muestra" label={copy.elaboracion.sample}>
          <Select id="analitica-muestra" className="w-full" value={sampleId} onChange={(event) => setSampleId(event.target.value)}>
            <option value="">{copy.elaboracion.noSample}</option>
            {(samples.data?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.number || formatDateTime(item.occurred_at)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="analitica-muestra-fecha" label={copy.elaboracion.sampledAt}>
          <WhenField value={sampledAt} onChange={setSampledAt} />
        </Field>
        <Field id="analitica-resultado" label={copy.elaboracion.resultAt}>
          <WhenField value={resultAt} onChange={setResultAt} />
        </Field>
      </div>
      {locked || subject === 'lot' ? (
        <Field id="analitica-tipo" label={copy.elaboracion.kind}>
          <Select id="analitica-tipo" className="w-full" value={kind} onChange={(event) => setKind(event.target.value as (typeof ANALYSIS_KINDS)[number])}>
            {ANALYSIS_KINDS.map((item) => (
              <option key={item} value={item}>
                {kindLabel(item)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-2">
        <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.parameters}</h2>
        <div className="grid grid-cols-2 gap-3">
          {PARAMETERS.map((parameter) => (
            <Field key={parameter.code} id={`param-${parameter.code}`} label={fieldLabel(parameter.code, parameter.unit)}>
              <Input
                id={`param-${parameter.code}`}
                className="w-full"
                inputMode="decimal"
                autoComplete="off"
                value={values[parameter.code] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [parameter.code]: event.target.value }))}
              />
            </Field>
          ))}
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="hidden sm:flex sm:justify-end">
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.elaboracion.save}
        </Button>
      </div>
      <div className="sm:hidden">
        <Button type="button" variant="primary" size="sm" className="w-full" loading={saving} onClick={() => void save()}>
          {copy.elaboracion.save}
        </Button>
      </div>
    </div>
  )
}

export function AnaliticasPage({ me }: { me: Me }) {
  useChromeTitle(copy.nav.analyses)
  const allowed = allows(me, 'cellar.read')
  const [lot, setLot] = useState('')
  const [parcelHit, setParcelHit] = useState<Analysis | null>(null)
  const lots = useApi<Page<{ code: string }>>(allowed && !allows(me, 'cellar.operate') ? '/v1/lots?status=active&limit=100' : null)
  const analyses = useApi<Page<Analysis>>(allowed && lot ? `/v1/lots/${encodeURIComponent(lot)}/analyses` : null)
  if (!allowed) return <NoPermission />
  return (
    <ReadingColumn screen="elaboracion-analiticas">
      <header className="flex h-11 shrink-0 items-center border-b border-border-subtle px-3 sm:px-4">
        <h1 className="text-label font-medium text-ink-900">{copy.elaboracion.newAnalysis}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          {allows(me, 'cellar.operate') ? (
            <AnalysisForm
              lotCode={lot}
              onLot={setLot}
              locked={false}
              onSaved={(created) => {
                if (created.lot_id) analyses.reload()
                else setParcelHit(created)
              }}
            />
          ) : (
            <Field id="analitica-lote-lectura" label={copy.elaboracion.lot}>
              <Select id="analitica-lote-lectura" className="w-full" value={lot} onChange={(event) => setLot(event.target.value)}>
                <option value="">{copy.elaboracion.pickLot}</option>
                {(lots.data?.items ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {parcelHit && !parcelHit.lot_id ? <AnalysisList items={[parcelHit]} /> : null}
          <section className="grid gap-2">
            <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.analyses}</h2>
            {analyses.loading && lot ? <Skeleton className="h-16" /> : null}
            {analyses.error ? <ErrorState title={analyses.error.message} onRetry={analyses.reload} /> : null}
            {lot ? <AnalysisList items={analyses.data?.items ?? []} /> : <EmptyState size="sm" title={copy.elaboracion.emptyAnalyses} description={copy.elaboracion.emptyAnalysesHint} />}
          </section>
          {lot ? <EvolutionTimeline lotCode={lot} /> : null}
        </div>
      </div>
    </ReadingColumn>
  )
}

export function LotAnalyses({ me, lotCode }: { me: Me; lotCode: string }) {
  const analyses = useApi<Page<Analysis>>(lotCode ? `/v1/lots/${encodeURIComponent(lotCode)}/analyses` : null)
  const [open, setOpen] = useState(false)
  const canWrite = allows(me, 'cellar.operate')
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.analyses}</h2>
        {canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
            {copy.elaboracion.newAnalysis}
          </Button>
        ) : null}
      </div>
      {analyses.loading && !analyses.data ? <Skeleton className="h-16" /> : null}
      {analyses.error ? <ErrorState title={analyses.error.message} onRetry={analyses.reload} /> : null}
      <AnalysisList items={analyses.data?.items ?? []} />
      <EvolutionTimeline lotCode={lotCode} />
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="analitica-dialogo" size="lg">
        <DialogHeader titleId="analitica-dialogo" title={copy.elaboracion.newAnalysis} onClose={() => setOpen(false)} />
        <DialogBody>
          <div data-screen="elaboracion-analitica">
            <AnalysisForm
              lotCode={lotCode}
              locked
              onSaved={() => {
                setOpen(false)
                analyses.reload()
              }}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {copy.elaboracion.cancel}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

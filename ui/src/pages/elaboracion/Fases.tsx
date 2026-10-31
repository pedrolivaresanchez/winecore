import { useEffect, useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { formatDateTime } from '@/lib/format'
import type { Me } from '@/lib/types'
import type { Vessel } from '@/lib/cellar'
import { apiFailure, endPhase, startPhase, stopPhase } from '@/pages/elaboracion/api'
import {
  COLD_PHASES,
  FERMENTATIONS,
  PHASES,
  decimalOrNull,
  localInputNow,
  phaseLabel,
  toInstant,
  type Analysis,
  type LotPhase,
  type Page,
  type PhaseName,
} from '@/pages/elaboracion/model'
import { ReadingColumn } from '@/pages/bodega/chrome'
import { WhenField } from '@/pages/elaboracion/WhenField'
import { MoreVertical } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  Input,
  MenuItem,
  Select,
  Skeleton,
  Textarea,
  useMenuOpen,
  useToast,
} from '@/ui'

type DialogMode = { kind: 'start' } | { kind: 'end' | 'stop'; phase: LotPhase }

function statusLabel(status: string): string {
  if (status === 'in_progress') return copy.elaboracion.inProgress
  if (status === 'completed') return copy.elaboracion.completed
  if (status === 'stopped') return copy.elaboracion.stopped
  return status
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success'
  if (status === 'in_progress') return 'warning'
  return 'neutral'
}

export function FasesPage({ me }: { me: Me }) {
  useChromeTitle(copy.nav.phases)
  const allowed = allows(me, 'cellar.read')
  const lots = useApi<Page<{ code: string }>>(allowed ? '/v1/lots?status=active&limit=100' : null)
  const [code, setCode] = useState('')
  if (!allowed) return <NoPermission />
  return (
    <ReadingColumn screen="elaboracion-fases">
      <header className="flex h-11 shrink-0 items-center border-b border-border-subtle px-3 sm:px-4">
        <h1 className="text-label font-medium text-ink-900">{copy.elaboracion.phases}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-8">
          <Field id="fase-lote" label={copy.elaboracion.lot}>
            <Select id="fase-lote" className="w-full" value={code} onChange={(event) => setCode(event.target.value)}>
              <option value="">{copy.elaboracion.pickLot}</option>
              {(lots.data?.items ?? []).map((lot) => (
                <option key={lot.code} value={lot.code}>
                  {lot.code}
                </option>
              ))}
            </Select>
          </Field>
          {lots.error ? <ErrorState title={lots.error.message} onRetry={lots.reload} /> : null}
          {code ? <PhaseBoard me={me} lotCode={code} /> : <EmptyState size="sm" title={copy.elaboracion.emptyPhases} description={copy.elaboracion.emptyPhasesHint} />}
        </div>
      </div>
    </ReadingColumn>
  )
}

export function PhaseBoard({ me, lotCode }: { me: Me; lotCode: string }) {
  const toast = useToast()
  const canWrite = allows(me, 'cellar.operate')
  const phases = useApi<Page<LotPhase>>(lotCode ? `/v1/lots/${encodeURIComponent(lotCode)}/phases` : null)
  const [dialog, setDialog] = useState<DialogMode | null>(null)

  if (phases.loading && !phases.data) return <Skeleton className="h-24" />
  if (phases.error) return <ErrorState title={phases.error.message} onRetry={phases.reload} />
  const items = phases.data?.items ?? []

  return (
    <div className="grid gap-3">
      {canWrite ? (
        <div className="sticky top-0 flex justify-end bg-surface pb-2" style={{ zIndex: 'var(--z-sticky)' }}>
          <Button type="button" variant="primary" size="sm" onClick={() => setDialog({ kind: 'start' })}>
            {copy.elaboracion.start}
          </Button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState size="sm" title={copy.elaboracion.emptyPhases} description={copy.elaboracion.emptyPhasesHint} />
      ) : (
        <ol className="grid pb-24">
          {items.map((phase, index) => (
            <PhaseRow
              key={phase.id}
              phase={phase}
              last={index === items.length - 1}
              canWrite={canWrite}
              onEnd={() => setDialog({ kind: 'end', phase })}
              onStop={() => setDialog({ kind: 'stop', phase })}
            />
          ))}
        </ol>
      )}
      <PhaseDialog
        lotCode={lotCode}
        mode={dialog}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null)
          phases.reload()
          toast(copy.elaboracion.phaseSaved)
        }}
      />
    </div>
  )
}

function PhaseRow({
  phase,
  last,
  canWrite,
  onEnd,
  onStop,
}: {
  phase: LotPhase
  last: boolean
  canWrite: boolean
  onEnd: () => void
  onStop: () => void
}) {
  const more = useMenuOpen()
  const open = phase.status === 'in_progress'
  const meta = [
    phase.inoculation === 'spontaneous' ? copy.elaboracion.spontaneous : phase.inoculation === 'commercial' ? copy.elaboracion.commercial : '',
    phase.target_temp_c ? `${copy.elaboracion.target} ${phase.target_temp_c} °C` : '',
    phase.aging_method === 'tank' ? copy.elaboracion.tank : phase.aging_method === 'barrel' ? copy.elaboracion.barrel : phase.aging_method === 'demijohn_outdoor' ? copy.elaboracion.demijohn : '',
    phase.end_evidence === 'sensory' ? copy.elaboracion.sensory : phase.end_evidence === 'analysis' ? copy.elaboracion.byAnalysis : phase.end_evidence === 'both' ? copy.elaboracion.both : '',
  ].filter(Boolean)
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-3">
      <span className="relative" aria-hidden>
        <span className="absolute top-2 left-1/2 size-2 -translate-x-1/2 rounded-full bg-ink-900" />
        {last ? null : <span className="absolute top-4 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border" />}
      </span>
      <div className="min-w-0 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-label font-medium text-ink-900">{phaseLabel(phase.phase)}</p>
            <p className="text-caption text-text-tertiary">
              {[phase.started_at ? formatDateTime(phase.started_at) : null, phase.ended_at ? formatDateTime(phase.ended_at) : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge tone={statusTone(phase.status)}>{statusLabel(phase.status)}</Badge>
            {open && canWrite ? (
              <Button type="button" variant="primary" size="sm" onClick={onEnd}>
                {copy.elaboracion.end}
              </Button>
            ) : null}
            {open && canWrite ? (
              <GlassMenu
                open={more.open}
                onOpenChange={more.setOpen}
                placement="bottom-end"
                trigger={
                  <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.elaboracion.more} onClick={more.toggle}>
                    <MoreVertical strokeWidth={iconStroke} />
                  </Button>
                }
              >
                <MenuItem
                  tone="danger"
                  onClick={() => {
                    more.close()
                    onStop()
                  }}
                >
                  {copy.elaboracion.stop}
                </MenuItem>
              </GlassMenu>
            ) : null}
          </div>
        </div>
        {meta.length > 0 ? <p className="mt-1 text-caption text-text-secondary">{meta.join(' · ')}</p> : null}
        {phase.observations ? <p className="mt-1 text-label text-text-secondary">{phase.observations}</p> : null}
      </div>
    </li>
  )
}

function PhaseDialog({
  lotCode,
  mode,
  onClose,
  onSaved,
}: {
  lotCode: string
  mode: DialogMode | null
  onClose: () => void
  onSaved: () => void
}) {
  const vessels = useApi<{ items: Vessel[] }>(mode ? '/v1/vessels?limit=100' : null)
  const analyses = useApi<Page<Analysis>>(mode && mode.kind !== 'start' ? `/v1/lots/${encodeURIComponent(lotCode)}/analyses` : null)
  const products = useApi<{ items: { id: string; name: string }[] }>(mode?.kind === 'start' ? '/v1/products?limit=50' : null)
  const [phase, setPhase] = useState<PhaseName>('alcoholic_fermentation')
  const [when, setWhen] = useState(localInputNow)
  const [vesselId, setVesselId] = useState('')
  const [inoculation, setInoculation] = useState<'spontaneous' | 'commercial'>('spontaneous')
  const [productId, setProductId] = useState('')
  const [target, setTarget] = useState('')
  const [aging, setAging] = useState<'tank' | 'barrel' | 'demijohn_outdoor'>('tank')
  const [evidence, setEvidence] = useState<'' | 'sensory' | 'analysis' | 'both'>('')
  const [analysisId, setAnalysisId] = useState('')
  const [observations, setObservations] = useState('')
  const [whiteAsRed, setWhiteAsRed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = mode !== null
  const closing = mode && mode.kind !== 'start' ? mode.phase : null

  useEffect(() => {
    if (!mode) return
    setWhen(localInputNow())
    setError(null)
    setObservations('')
    setEvidence('')
    setAnalysisId('')
  }, [mode])
  const needsEvidence = closing?.phase === 'malolactic_fermentation' && mode?.kind === 'end'

  async function submit() {
    if (!mode) return
    setSaving(true)
    setError(null)
    try {
      if (mode.kind === 'start') {
        const temp = decimalOrNull(target, 1)
        if (target.trim() && temp === null) {
          setError(copy.elaboracion.target)
          setSaving(false)
          return
        }
        await startPhase(lotCode, {
          phase,
          started_at: toInstant(when),
          ...(vesselId ? { vessel_id: vesselId } : {}),
          ...(FERMENTATIONS.has(phase) ? { inoculation } : {}),
          ...(FERMENTATIONS.has(phase) && inoculation === 'commercial' && productId ? { inoculum_product_id: productId } : {}),
          ...(COLD_PHASES.has(phase) && temp ? { target_temp_c: temp } : {}),
          ...(phase === 'aging' ? { aging_method: aging } : {}),
          ...(observations.trim() ? { observations: observations.trim() } : {}),
          ...(whiteAsRed ? { white_as_red: true } : {}),
        })
      } else {
        await (mode.kind === 'end' ? endPhase : stopPhase)(lotCode, mode.phase.id, {
          ended_at: toInstant(when),
          ...(evidence ? { end_evidence: evidence } : {}),
          ...(analysisId ? { end_analysis_id: analysisId } : {}),
          ...(observations.trim() ? { observations: observations.trim() } : {}),
        })
      }
      onSaved()
    } catch (caught) {
      setError(apiFailure(caught, copy.elaboracion.saveFail))
    } finally {
      setSaving(false)
    }
  }

  const title = mode?.kind === 'stop' ? copy.elaboracion.stop : mode?.kind === 'end' ? copy.elaboracion.end : copy.elaboracion.start

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="fase-dialogo"
      size="md"
    >
      <DialogHeader titleId="fase-dialogo" title={title} onClose={onClose} />
      <DialogBody>
        <div data-screen="elaboracion-fase" className="grid gap-3">
          {mode?.kind === 'start' ? (
            <>
              <Field id="fase-tipo" label={copy.elaboracion.kind}>
                <Select id="fase-tipo" className="w-full" value={phase} onChange={(event) => setPhase(event.target.value as PhaseName)}>
                  {PHASES.map((item) => (
                    <option key={item} value={item}>
                      {phaseLabel(item)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="fase-inicio" label={copy.elaboracion.started}>
                <WhenField value={when} onChange={setWhen} />
              </Field>
              <Field id="fase-deposito" label={copy.elaboracion.vessel}>
                <Select id="fase-deposito" className="w-full" value={vesselId} onChange={(event) => setVesselId(event.target.value)}>
                  <option value="">{copy.elaboracion.pickVessel}</option>
                  {(vessels.data?.items ?? [])
                    .filter((item) => item.status === 'in_service')
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code}
                        {item.lot_code === lotCode ? ` · ${item.lot_code}` : ''}
                      </option>
                    ))}
                </Select>
              </Field>
              {FERMENTATIONS.has(phase) ? (
                <Field id="fase-inoculo" label={copy.elaboracion.inoculation}>
                  <Select id="fase-inoculo" className="w-full" value={inoculation} onChange={(event) => setInoculation(event.target.value as 'spontaneous' | 'commercial')}>
                    <option value="spontaneous">{copy.elaboracion.spontaneous}</option>
                    <option value="commercial">{copy.elaboracion.commercial}</option>
                  </Select>
                </Field>
              ) : null}
              {FERMENTATIONS.has(phase) && inoculation === 'commercial' ? (
                <Field id="fase-producto" label={copy.elaboracion.product}>
                  <Select id="fase-producto" className="w-full" value={productId} onChange={(event) => setProductId(event.target.value)}>
                    <option value="">{copy.elaboracion.product}</option>
                    {(products.data?.items ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {COLD_PHASES.has(phase) ? (
                <Field id="fase-consigna" label={copy.elaboracion.target} hint={copy.elaboracion.targetHint}>
                  <Input id="fase-consigna" className="w-full" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} />
                </Field>
              ) : null}
              {phase === 'aging' ? (
                <Field id="fase-crianza" label={copy.elaboracion.aging}>
                  <Select id="fase-crianza" className="w-full" value={aging} onChange={(event) => setAging(event.target.value as 'tank' | 'barrel' | 'demijohn_outdoor')}>
                    <option value="tank">{copy.elaboracion.tank}</option>
                    <option value="barrel">{copy.elaboracion.barrel}</option>
                    <option value="demijohn_outdoor">{copy.elaboracion.demijohn}</option>
                  </Select>
                </Field>
              ) : null}
              {phase === 'skin_maceration' || phase === 'alcoholic_fermentation' ? (
                <Checkbox checked={whiteAsRed} onChange={setWhiteAsRed} label={copy.elaboracion.whiteAsRed} />
              ) : null}
            </>
          ) : (
            <>
              <Field id="fase-fin" label={copy.elaboracion.ended}>
                <WhenField value={when} onChange={setWhen} />
              </Field>
              {needsEvidence || closing?.phase === 'malolactic_fermentation' ? (
                <Field id="fase-cierre" label={copy.elaboracion.evidence}>
                  <Select id="fase-cierre" className="w-full" value={evidence} onChange={(event) => setEvidence(event.target.value as '' | 'sensory' | 'analysis' | 'both')}>
                    <option value="">{copy.elaboracion.evidence}</option>
                    <option value="sensory">{copy.elaboracion.sensory}</option>
                    <option value="analysis">{copy.elaboracion.byAnalysis}</option>
                    <option value="both">{copy.elaboracion.both}</option>
                  </Select>
                </Field>
              ) : null}
              {evidence === 'analysis' || evidence === 'both' ? (
                <Field id="fase-analitica" label={copy.elaboracion.byAnalysis}>
                  <Select id="fase-analitica" className="w-full" value={analysisId} onChange={(event) => setAnalysisId(event.target.value)}>
                    <option value="">{copy.elaboracion.byAnalysis}</option>
                    {(analyses.data?.items ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {formatDateTime(item.sampled_at)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          )}
          <Field id="fase-notas" label={copy.elaboracion.observations}>
            <Textarea id="fase-notas" value={observations} onChange={(event) => setObservations(event.target.value)} />
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.elaboracion.cancel}
        </Button>
        <Button type="button" variant={mode?.kind === 'stop' ? 'danger' : 'primary'} size="sm" loading={saving} onClick={() => void submit()}>
          {title}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

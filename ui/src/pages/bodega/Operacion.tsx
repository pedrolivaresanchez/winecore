import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import {
  confirmOperation,
  contentLabel,
  createOperation,
  describeCellarError,
  holding,
  mlToEdit,
  OP_TYPES,
  previewOperation,
  rectifyOperation,
  updateOperation,
  type CellarOperation,
  type OperationPreview,
  type OpType,
  type PreviewMaterial,
  type Vessel,
} from '@/lib/cellar'
import { formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import { cn } from '@/lib/cn'
import {
  applyKey,
  balanceFor,
  blocksStep,
  buildPayload,
  destApplies,
  effectsFor,
  emptyDraft,
  emptyLine,
  lossApplies,
  mlOf,
  needsApproval,
  nextStep,
  parseQty,
  prefillLosses,
  prevStep,
  problems,
  readTipo,
  withVessel,
  WIZARD_STEPS,
  type ActiveField,
  type Balance,
  type Draft,
  type DraftLine,
  type Issue,
  type LineRole,
  type WizardStep,
} from '@/lib/operation-draft'
import type { Me } from '@/lib/types'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  Input,
  MenuItem,
  Select,
  Textarea,
  useMenuOpen,
  useToast,
} from '@/ui'
import { ArrowDown, ArrowLeft, ArrowRight, Box, Eraser, Filter, MergeCells, Minus, MoreVertical, Plus, RefreshCw, Sliders, SplitBranch, Tag, Trash2, type IconComponent } from '@/ui/icons'
import { ReadingColumn, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { classLabel, fiscalLabel, moveLabel, opLabel, opStatusLabel, opStatusTone, roleLabel } from '@/pages/bodega/labels'
import { ElaborationFields, ElaborationSummary } from '@/pages/elaboracion/OpFields'

const ICONS: Record<OpType, IconComponent> = {
  racking: ArrowRight,
  blend: MergeCells,
  filtration: Filter,
  bottling: Box,
  labeling: Tag,
  addition: Plus,
  loss: Minus,
  destruction: Trash2,
  cleaning: Eraser,
  bleeding: SplitBranch,
  pressing_off: ArrowDown,
  delestage: RefreshCw,
  temperature_control: Sliders,
}

type List = { items: Vessel[]; next_cursor: string | null; total: number }

type OperationDetail = CellarOperation & {
  lines?: {
    id: string | null
    role: string
    vessel_id: string | null
    lot_id: string | null
    volume_ml: number
    qty_units: number
    loss_kind: string | null
  }[]
}

function stepHint(op: OpType | '', step: WizardStep): string {
  if (step === 'tipo') return 'Elige qué vas a registrar.'
  if (step === 'origenes') {
    if (op === 'cleaning') return 'Qué depósito se limpia y con qué.'
    if (op === 'addition') return 'Dónde y qué producto echas.'
    if (op === 'labeling') return 'Botellas que vas a etiquetar.'
    if (op === 'loss' || op === 'destruction') return 'De dónde sale el vino que se pierde.'
    if (op === 'bleeding') return 'De dónde sale el sangrado.'
    if (op === 'pressing_off') return 'Depósito con hollejos.'
    if (op === 'delestage') return 'Depósito, inicio y fin.'
    if (op === 'temperature_control') return 'Consigna anterior, nueva y motivo.'
    return 'De dónde sale el vino.'
  }
  if (step === 'destinos') {
    if (!destApplies(op)) return 'Este tipo no tiene destino.'
    if (op === 'blend') return 'Depósito vacío y código del lote nuevo.'
    if (op === 'bottling') return 'Botellas y lote envasado.'
    if (op === 'bleeding') return 'Depósito vacío y lote hijo.'
    if (op === 'pressing_off') return 'Yema y vino de prensa.'
    return 'A qué depósito va el vino.'
  }
  if (step === 'mermas') {
    if (!lossApplies(op)) return 'Este tipo no tiene merma.'
    if (op === 'destruction') return 'La destrucción exige un motivo.'
    return 'Lías u otras pérdidas. Tiene que cuadrar.'
  }
  return 'Revisa el cuadre antes de confirmar.'
}

function lineMessages(issues: Issue[], key: string, view: WizardStep): string[] {
  return issues.filter((issue) => issue.key === key && (view === 'revision' || issue.step === view)).map((issue) => issue.message)
}

function describeLine(op: OpType, role: LineRole, line: DraftLine, vessels: Vessel[], lotCode: string): string {
  const vessel = vessels.find((item) => item.code === line.vessel_code)
  const place = vessel ? `${vessel.code} · ${vessel.name}` : 'Sin depósito'
  if (op === 'bottling' && role === 'output') {
    const lot = lotCode ? ` · ${lotCode}` : ''
    return `${parseQty(line.qty_text)} botellas × ${line.nominal_text || '0'} L = ${formatLitres(mlOf(op, role, line) / 1000)}${lot}`
  }
  if (op === 'labeling') {
    const kind = role === 'loss' ? (line.loss_kind === 'incident' ? ' · incidencia' : ' · rotura') : ''
    return `${place} · ${parseQty(line.qty_text)} botellas${kind}`
  }
  if (op === 'pressing_off' && role === 'output' && line.child_lot_code.trim()) {
    return `${place} · ${formatLitres(mlOf(op, role, line) / 1000)} · ${line.child_lot_code.trim()}`
  }
  const wine = role === 'input' ? holding(vessel)?.wine_name : null
  const lot = role === 'output' && op === 'blend' ? lotCode : line.lot_code
  const extra = [lot, wine].filter(Boolean).join(' · ')
  const kind = role === 'loss' ? (line.loss_kind === 'incident' ? ' · incidencia' : ' · autorizada') : ''
  return `${place}${extra ? ` · ${extra}` : ''} · ${formatLitres(mlOf(op, role, line) / 1000)}${kind}`
}

function matchKey(draft: Draft, vessel?: string, role?: string): string {
  const pools: [string, DraftLine[]][] = [
    ['input', draft.inputs],
    ['output', draft.outputs],
    ['loss', draft.losses],
  ]
  for (const [name, lines] of pools) {
    if (role && role !== name) continue
    const hit = lines.find((line) => vessel && line.vessel_code === vessel)
    if (hit) return hit.key
  }
  return 'banner'
}

function serverIssues(error: unknown, draft: Draft): Issue[] {
  if (!(error instanceof ApiError)) {
    return [{ step: 'revision', key: 'banner', code: 'WC_ERROR', message: 'No se ha podido guardar la operación' }]
  }
  const described = describeCellarError(error)
  const issues: Issue[] = [
    { step: 'revision', key: matchKey(draft, described.vessel, described.role), code: described.code, message: described.message },
  ]
  if (error.fields?.reason) {
    issues.push({
      step: draft.op_type === 'temperature_control' ? 'origenes' : 'mermas',
      key: 'reason',
      code: described.code,
      message: error.fields.reason,
    })
  }
  if (error.fields?.previous_setpoint_c || error.fields?.new_setpoint_c) {
    issues.push({ step: 'origenes', key: 'setpoint', code: described.code, message: error.fields.previous_setpoint_c || error.fields.new_setpoint_c || described.message })
  }
  if (error.fields?.started_at || error.fields?.ended_at) {
    issues.push({ step: 'origenes', key: 'window', code: described.code, message: error.fields.started_at || error.fields.ended_at || described.message })
  }
  return issues
}

function caption(vessel: Vessel | undefined): string {
  if (!vessel) return 'Elige un depósito.'
  const inside = holding(vessel)
  if (!inside) return `${vessel.name} · ${contentLabel(vessel)}`
  return `${vessel.name} · ${inside.lot_code}${inside.wine_name ? ` · ${inside.wine_name}` : ''}`
}

export function OperacionPage({ me }: { me: Me }) {
  const { id } = useParams()
  if (id) return <OperacionRecord me={me} id={id} />
  return <Nueva me={me} />
}

function OperacionRecord({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const allowed = allows(me, 'cellar.read')
  const data = useApi<OperationDetail>(allowed ? `/v1/cellar-operations/${encodeURIComponent(id)}` : null)
  const vessels = useApi<List>(allowed ? '/v1/vessels?limit=100' : null)
  const [rectifyOpen, setRectifyOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState<OperationPreview | null>(null)
  useChromeTitle(data.data ? opLabel(data.data.op_type) : copy.cellar.operation)

  if (!allowed) return <NoPermission />
  if (data.loading && !data.data) {
    return <RecordSkeleton screen="bodega-operacion" />
  }
  if (data.error || !data.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${data.error?.code ?? 'WC_ERROR'})`} detail={data.error?.message} onRetry={data.reload} />
      </div>
    )
  }

  const operation = data.data
  const pending = Boolean(operation.approval_request_id) && operation.status === 'draft'
  const canOperate = allows(me, 'cellar.operate')
  const byId = new Map((vessels.data?.items ?? []).map((item) => [item.id, item.code]))

  async function openConfirm() {
    setConfirmOpen(true)
    try {
      setPreview(await previewOperation(operation.id))
    } catch {
      setPreview(null)
    }
  }

  async function confirm() {
    setBusy(true)
    try {
      await confirmOperation(operation.id)
      setConfirmOpen(false)
      toast(copy.cellar.confirmed)
      data.reload()
    } catch (error: unknown) {
      const described = error instanceof ApiError ? describeCellarError(error) : null
      if (described?.code === 'WC_NOT_APPROVED') {
        setConfirmOpen(false)
        toast(described.message)
        data.reload()
        return
      }
      toast(described?.message ?? 'No se ha podido confirmar.')
    } finally {
      setBusy(false)
    }
  }

  async function rectify() {
    setBusy(true)
    try {
      const created = await rectifyOperation(operation.id, reason.trim())
      setRectifyOpen(false)
      toast('Rectificación creada')
      navigate(`/bodega/operaciones/${created.id}`)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : 'No se ha podido rectificar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReadingColumn screen={pending ? 'bodega-pendiente' : 'bodega-operacion-ficha'}>
      <RecordBar backTo="/bodega/depositos" backLabel={copy.cellar.vessels}>
        {canOperate && operation.status === 'draft' ? (
          <Button type="button" variant="primary" size="sm" onClick={() => void openConfirm()}>
            {copy.cellar.confirm}
          </Button>
        ) : null}
        {canOperate && operation.status === 'confirmed' ? (
          <GlassMenu
            open={more.open}
            onOpenChange={more.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.cellar.more} onClick={more.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              onClick={() => {
                more.close()
                setRectifyOpen(true)
              }}
            >
              {copy.cellar.rectify}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </RecordBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium text-ink-900">{operation.number || opLabel(operation.op_type)}</h1>
            <p className="mt-0.5 text-label text-text-secondary">{operation.performed_by}</p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={opStatusTone(operation.status)}>{opStatusLabel(operation.status)}</Badge>
            {pending ? <Badge tone="warning">{copy.cellar.pending}</Badge> : null}
            <Badge tone="neutral">{opLabel(operation.op_type)}</Badge>
          </div>
          {pending ? (
            <Alert tone="warning">
              <span>
                {copy.cellar.pendingHint}{' '}
                {operation.approval_request_id ? (
                  <Link className="underline" to={`/aprobaciones/${operation.approval_request_id}`}>
                    {copy.cellar.pending}
                  </Link>
                ) : null}
              </span>
            </Alert>
          ) : null}
          {operation.reason ? <p className="text-label text-text-secondary">{operation.reason}</p> : null}
          <ul className="overflow-hidden rounded-2xl border border-border-subtle">
            {(operation.lines ?? []).map((line, index) => (
              <li key={line.id ?? index} className="border-b border-border-subtle px-4 py-2 text-label last:border-b-0">
                <span className="text-text-tertiary">{roleLabel(line.role)} · </span>
                {line.vessel_id ? byId.get(line.vessel_id) ?? 'Depósito' : 'Sin depósito'}
                {' · '}
                {line.qty_units ? `${line.qty_units} ud` : formatLitres(line.volume_ml / 1000)}
                {line.loss_kind === 'incident' ? ' · incidencia' : ''}
              </li>
            ))}
          </ul>
          {(operation.lines ?? []).length === 0 ? <EmptyState size="sm" title="Sin líneas" description="El borrador no tiene movimientos." /> : null}
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} labelledBy="confirmar-op" size="lg">
        <DialogHeader titleId="confirmar-op" title={copy.cellar.confirm} description={opLabel(operation.op_type)} onClose={() => setConfirmOpen(false)} />
        <DialogBody>
          <div data-screen="bodega-vista-previa">
            {pending ? <Alert tone="warning">{copy.cellar.approvalWarn}</Alert> : null}
            <EffectsView preview={preview} vessels={vessels.data?.items ?? []} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void confirm()}>
            {copy.cellar.confirm}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={rectifyOpen} onClose={() => setRectifyOpen(false)} labelledBy="rectificar-titulo" size="sm">
        <DialogHeader titleId="rectificar-titulo" title={copy.cellar.rectifyTitle} description={copy.cellar.rectifyHint} onClose={() => setRectifyOpen(false)} />
        <DialogBody>
          <Textarea id="motivo-rectificar" aria-label={copy.cellar.reason} value={reason} onChange={(event) => setReason(event.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRectifyOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => void rectify()}>
            {copy.cellar.rectify}
          </Button>
        </DialogFooter>
      </Dialog>
    </ReadingColumn>
  )
}

function Nueva({ me }: { me: Me }) {
  const allowed = allows(me, 'cellar.operate')
  const data = useApi<List>(allowed ? '/v1/vessels?limit=100' : null)
  useChromeTitle(copy.cellar.newOperation)
  if (!allowed) return <NoPermission />
  if (data.loading && !data.data) {
    return <RecordSkeleton screen="bodega-operacion" step="cargando" />
  }
  if (data.error || !data.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${data.error?.code ?? 'WC_ERROR'})`} detail={data.error?.message} onRetry={data.reload} />
      </div>
    )
  }
  return <Wizard me={me} vessels={data.data.items} />
}

function Wizard({ me, vessels }: { me: Me; vessels: Vessel[] }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const { entities } = useEntity()
  const legalEntityId = entities.find((item) => item.code === 'PO')?.id ?? entities[0]?.id ?? ''
  const [draft, setDraft] = useState(() => emptyDraft(readTipo(params.get('tipo')), me.display_name))
  const [step, setStep] = useState<WizardStep>('tipo')
  const [tried, setTried] = useState(false)
  const [active, setActive] = useState<ActiveField | null>(null)
  const [server, setServer] = useState<Issue[]>([])
  const [saving, setSaving] = useState(false)
  const [serverPreview, setServerPreview] = useState<OperationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<CellarOperation | null>(null)
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const draftRef = useRef(draft)
  const vesselsRef = useRef(vessels)
  const draftIdRef = useRef<string | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  draftRef.current = draft
  vesselsRef.current = vessels
  const vesselQuery = params.get('vessel') ?? ''
  const op = draft.op_type

  const ensureDraft = useCallback(async (): Promise<string | null> => {
    const run = queueRef.current.then(async () => {
      const current = draftRef.current
      if (!current.op_type) return null
      const body = buildPayload(current, vesselsRef.current, legalEntityId)
      const id = draftIdRef.current
      const saved = id ? await updateOperation(id, body) : await createOperation(body)
      draftIdRef.current = saved.id
      setApprovalId(saved.approval_request_id)
      return saved.id
    })
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }, [legalEntityId])

  useEffect(() => {
    if (!vesselQuery) return
    const vessel = vessels.find((item) => item.code === vesselQuery)
    if (!vessel || vessel.status !== 'in_service') return
    setDraft((current) => {
      if (current.inputs.some((line) => line.vessel_code === vessel.code)) return current
      const base = current.inputs[0] ?? emptyLine()
      if (base.vessel_code) return current
      const next = withVessel(base, vessel)
      const inside = holding(vessel)
      if (inside && current.op_type !== 'cleaning' && current.op_type !== 'addition' && current.op_type !== 'labeling' && current.op_type !== 'delestage' && current.op_type !== 'temperature_control') {
        next.volume_text = mlToEdit(inside.volume_ml)
      }
      return { ...current, inputs: [next, ...current.inputs.slice(1)] }
    })
  }, [vesselQuery, vessels])

  const balance = useMemo(() => balanceFor(draft), [draft])
  const issues = useMemo(() => [...problems(draft, vessels, tried || step === 'revision'), ...server], [draft, vessels, tried, step, server])
  const ready = useMemo(() => problems(draft, vessels, true).length === 0, [draft, vessels])
  const effects = effectsFor(draft, vessels)

  useEffect(() => {
    if (step !== 'revision' || !op) return
    let cancel = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const id = await ensureDraft()
          if (!id || cancel) return
          const next = await previewOperation(id)
          if (!cancel) {
            setServerPreview(next)
            setPreviewError(null)
          }
        } catch (error: unknown) {
          if (cancel) return
          setServerPreview(null)
          setPreviewError(error instanceof ApiError ? describeCellarError(error).message : null)
        }
      })()
    }, 150)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [step, draft, op, ensureDraft])

  function change(recipe: (current: Draft) => Draft) {
    setServer([])
    setDraft(recipe)
  }

  function jump(target: WizardStep) {
    setActive(null)
    setStep(target)
  }

  function forward() {
    if (blocksStep(problems(draft, vessels, true), step)) {
      setTried(true)
      return
    }
    setTried(false)
    setActive(null)
    const following = nextStep(step)
    if (following === 'mermas') setDraft((current) => prefillLosses(current))
    setStep(following)
  }

  function back() {
    setTried(false)
    setActive(null)
    setStep((current) => prevStep(current))
  }

  async function persist(confirm: boolean) {
    if (!op) return
    if (confirm && problems(draft, vessels, true).length > 0) {
      setTried(true)
      setConfirmOpen(false)
      return
    }
    setSaving(true)
    try {
      const id = await ensureDraft()
      if (!id) return
      if (!confirm) {
        toast(copy.cellar.draftSaved)
        navigate(`/bodega/operaciones/${id}`)
        return
      }
      const saved = await confirmOperation(id)
      setConfirmOpen(false)
      setResult(saved)
    } catch (error: unknown) {
      const described = error instanceof ApiError ? describeCellarError(error) : null
      if (described?.code === 'WC_NOT_APPROVED' && draftIdRef.current) {
        setConfirmOpen(false)
        setResult({
          id: draftIdRef.current,
          number: null,
          op_type: op,
          occurred_at: draft.occurred_at,
          status: 'draft',
          reason: draft.reason || null,
          performed_by: draft.performed_by,
          approval_request_id: approvalId,
        })
        return
      }
      setServer(serverIssues(error, draft))
      setStep('revision')
      setConfirmOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (result?.approval_request_id && result.status !== 'confirmed') {
    return (
      <ReadingColumn screen="bodega-pendiente">
        <RecordBar backTo="/bodega/depositos" backLabel={copy.cellar.vessels} />
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          <h1 className="text-body font-medium text-ink-900">{opLabel(result.op_type)} registrada</h1>
          <Badge tone="warning">{copy.cellar.pending}</Badge>
          <Alert tone="warning">{copy.cellar.pendingHint}</Alert>
          {result.reason ? <p className="text-label text-text-secondary">{result.reason}</p> : null}
          <Link className="text-label font-medium text-ink-900 underline" to={`/aprobaciones/${result.approval_request_id}`}>
            {copy.cellar.pending}
          </Link>
          <Link className="text-label text-text-secondary underline" to={`/bodega/operaciones/${result.id}`}>
            Ver la operación
          </Link>
        </div>
      </ReadingColumn>
    )
  }

  if (result?.status === 'confirmed') {
    const backCode = draft.inputs[0]?.vessel_code
    return (
      <ReadingColumn screen="bodega-confirmada">
        <RecordBar backTo="/bodega/depositos" backLabel={copy.cellar.vessels} />
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          <h1 className="text-body font-medium text-ink-900">{copy.cellar.confirmed}</h1>
          <p className="text-label text-text-secondary">{result.number ?? copy.cellar.confirmedHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => navigate(`/bodega/operaciones/${result.id}`)}>
              Ver la operación
            </Button>
            {backCode ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/bodega/depositos/${encodeURIComponent(backCode)}`)}>
                Volver a {backCode}
              </Button>
            ) : null}
          </div>
        </div>
      </ReadingColumn>
    )
  }

  const showKeys = active !== null && step !== 'tipo' && step !== 'revision'
  const balanceAttr = !balance ? 'na' : balance.ok ? 'ok' : balance.text ? 'wc020' : 'vacio'

  return (
    <div
      data-screen="bodega-operacion"
      data-step={step}
      data-op={op || 'ninguno'}
      data-balance={balanceAttr}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.cellar.vessels} onClick={() => navigate('/bodega/depositos')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="shrink-0 text-label text-text-tertiary">{copy.cellar.vessels}</span>
        <h1 className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">
          {op ? opLabel(op) : copy.cellar.newOperation}
        </h1>
        <div className="ml-auto hidden shrink-0 items-center gap-1.5 sm:flex">
          <Button type="button" variant="ghost" size="sm" disabled={step === 'tipo'} onClick={back}>
            {copy.cellar.back}
          </Button>
          {step === 'revision' ? (
            <>
              <Button type="button" variant="secondary" size="sm" loading={saving && !confirmOpen} disabled={!op} onClick={() => void persist(false)}>
                {copy.cellar.saveDraft}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!ready}
                aria-describedby={balance && !balance.ok ? 'conservacion' : undefined}
                onClick={() => setConfirmOpen(true)}
              >
                {copy.cellar.confirm}
              </Button>
            </>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={forward}>
              {copy.cellar.next}
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-8">
          <p className="text-label text-text-secondary">{stepHint(op, step)}</p>
          <SectionTabs
            label="Pasos"
            tabs={WIZARD_STEPS.map((item) => ({ id: item.id, label: item.label }))}
            value={step}
            onChange={(target) => {
              const index = WIZARD_STEPS.findIndex((item) => item.id === target)
              const current = WIZARD_STEPS.findIndex((item) => item.id === step)
              if (index <= current) jump(target)
            }}
          />

          {step === 'tipo' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {OP_TYPES.map((item) => {
                const Icon = ICONS[item.id]
                const on = op === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      change((current) => ({
                        ...current,
                        op_type: item.id,
                        losses: current.losses.map((line) => ({
                          ...line,
                          loss_kind: item.id === 'destruction' ? 'incident' : item.id === 'bleeding' || item.id === 'pressing_off' ? 'authorized' : line.loss_kind,
                        })),
                      }))
                    }
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border bg-surface p-3 text-left',
                      on ? 'border-ink-900' : 'border-border-subtle',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-subtle text-ink-900">
                      <Icon className="size-4" strokeWidth={iconStroke} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-label font-medium text-ink-900">{item.label}</span>
                      <span className="block text-caption text-text-tertiary">{item.hint}</span>
                    </span>
                  </button>
                )
              })}
              <Alerts messages={lineMessages(issues, 'tipo', step)} />
            </div>
          ) : null}

          {step === 'origenes' && op ? (
            <div className="grid gap-3">
              {draft.inputs.map((line, index) => (
                <LineCard
                  key={line.key}
                  title={draft.inputs.length > 1 ? `Origen ${index + 1}` : 'Origen'}
                  line={line}
                  index={index}
                  op={op}
                  role="input"
                  vessels={vessels}
                  messages={lineMessages(issues, line.key, step)}
                  hideAmount={op === 'cleaning' || op === 'addition' || op === 'delestage' || op === 'temperature_control'}
                  onVessel={(vessel) =>
                    change((current) => ({
                      ...current,
                      inputs: current.inputs.map((item, itemIndex) => {
                        if (itemIndex !== index) return item
                        const next = withVessel(item, vessel)
                        const inside = holding(vessel)
                        if (inside && op !== 'cleaning' && op !== 'addition' && op !== 'labeling') next.volume_text = mlToEdit(inside.volume_ml)
                        return next
                      }),
                    }))
                  }
                  onChange={(field, value) =>
                    change((current) => ({
                      ...current,
                      inputs: current.inputs.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                    }))
                  }
                  onFocus={(field) => setActive({ list: 'inputs', index, field })}
                  onRemove={
                    draft.inputs.length > 1
                      ? () => change((current) => ({ ...current, inputs: current.inputs.filter((_, itemIndex) => itemIndex !== index) }))
                      : undefined
                  }
                />
              ))}
              {op !== 'cleaning' && op !== 'addition' && op !== 'delestage' && op !== 'temperature_control' ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => change((current) => ({ ...current, inputs: [...current.inputs, emptyLine()] }))}>
                  {copy.cellar.addOrigin}
                </Button>
              ) : null}
              {op === 'addition' ? <AdditionFields draft={draft} issues={issues} step={step} onChange={change} /> : null}
              {op === 'cleaning' ? <CleaningFields draft={draft} issues={issues} step={step} onChange={change} /> : null}
              {op === 'delestage' || op === 'temperature_control' ? <ElaborationFields draft={draft} issues={issues} step={step} onChange={change} /> : null}
            </div>
          ) : null}

          {step === 'destinos' && op ? (
            <div className="grid gap-3">
              {!destApplies(op) ? <p className="rounded-2xl border border-border-subtle px-4 py-3 text-label">Esta operación no tiene destino.</p> : null}
              {destApplies(op) ? (
                <>
                  {op === 'blend' || op === 'bottling' || op === 'bleeding' ? (
                    <Field id="new_lot_code" label="Lote nuevo" error={lineMessages(issues, 'new_lot_code', step)[0]} hint="Mayúsculas, sin espacios.">
                      <Input
                        id="new_lot_code"
                        value={draft.new_lot_code}
                        autoCapitalize="characters"
                        invalid={lineMessages(issues, 'new_lot_code', step).length > 0}
                        onChange={(event) => change((current) => ({ ...current, new_lot_code: event.target.value.toUpperCase() }))}
                      />
                    </Field>
                  ) : null}
                  {draft.outputs.map((line, index) => (
                    <div key={line.key} className="grid gap-3">
                    <LineCard
                      title={draft.outputs.length > 1 ? `Destino ${index + 1}` : 'Destino'}
                      line={line}
                      index={index}
                      op={op}
                      role="output"
                      vessels={vessels}
                      messages={lineMessages(issues, line.key, step)}
                      onVessel={(vessel) =>
                        change((current) => ({
                          ...current,
                          outputs: current.outputs.map((item, itemIndex) => (itemIndex === index ? withVessel(item, vessel) : item)),
                        }))
                      }
                      onChange={(field, value) =>
                        change((current) => ({
                          ...current,
                          outputs: current.outputs.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                        }))
                      }
                      onFocus={(field) => setActive({ list: 'outputs', index, field })}
                      onRemove={
                        draft.outputs.length > 1
                          ? () => change((current) => ({ ...current, outputs: current.outputs.filter((_, itemIndex) => itemIndex !== index) }))
                          : undefined
                      }
                    />
                    {op === 'pressing_off' ? (
                      <Field id={`prensa-${line.key}`} label={copy.elaboracion.pressLot} hint={copy.elaboracion.pressLotHint} error={lineMessages(issues, line.key, step).find((message) => message.includes('prensa') || message.includes('código'))}>
                        <Input
                          id={`prensa-${line.key}`}
                          value={line.child_lot_code}
                          autoCapitalize="characters"
                          onChange={(event) =>
                            change((current) => ({
                              ...current,
                              outputs: current.outputs.map((item, itemIndex) => (itemIndex === index ? { ...item, child_lot_code: event.target.value.toUpperCase() } : item)),
                            }))
                          }
                        />
                      </Field>
                    ) : null}
                    </div>
                  ))}
                  <Button type="button" variant="secondary" size="sm" onClick={() => change((current) => ({ ...current, outputs: [...current.outputs, emptyLine()] }))}>
                    {copy.cellar.addDest}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 'mermas' && op ? (
            <div className="grid gap-3">
              {!lossApplies(op) ? <p className="rounded-2xl border border-border-subtle px-4 py-3 text-label">Esta operación no tiene merma.</p> : null}
              {lossApplies(op) && op === 'destruction' ? <Alert tone="warning">{copy.cellar.approvalWarn}</Alert> : null}
              {lossApplies(op)
                ? draft.losses.map((line, index) => (
                    <section key={line.key} className="grid gap-3 rounded-2xl border border-border-subtle p-3">
                      <p className="text-label font-medium">{draft.losses.length > 1 ? `Merma ${index + 1}` : 'Merma'}</p>
                      {op === 'destruction' || op === 'bleeding' || op === 'pressing_off' ? null : (
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant={line.loss_kind === 'authorized' ? 'primary' : 'secondary'}
                            aria-pressed={line.loss_kind === 'authorized'}
                            onClick={() =>
                              change((current) => ({
                                ...current,
                                losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, loss_kind: 'authorized' } : item)),
                              }))
                            }
                          >
                            {op === 'labeling' ? 'Rotura' : 'Lías / autorizada'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={line.loss_kind === 'incident' ? 'primary' : 'secondary'}
                            aria-pressed={line.loss_kind === 'incident'}
                            onClick={() =>
                              change((current) => ({
                                ...current,
                                losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, loss_kind: 'incident' } : item)),
                              }))
                            }
                          >
                            Incidencia
                          </Button>
                        </div>
                      )}
                      <LineFields
                        line={line}
                        index={index}
                        idPrefix="merma"
                        op={op}
                        role="loss"
                        messages={lineMessages(issues, line.key, step)}
                        onChange={(field, value) =>
                          change((current) => ({
                            ...current,
                            losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                          }))
                        }
                        onFocus={(field) => setActive({ list: 'losses', index, field })}
                      />
                      {op === 'loss' || op === 'destruction' ? (
                        <VesselChips
                          vessels={vessels}
                          selected={line.vessel_code}
                          onSelect={(vessel) =>
                            change((current) => ({
                              ...current,
                              losses: current.losses.map((item, itemIndex) => (itemIndex === index ? withVessel(item, vessel) : item)),
                            }))
                          }
                        />
                      ) : (
                        <p className="text-caption text-text-tertiary">Se descuenta de {draft.inputs[0]?.vessel_code || 'el origen'}.</p>
                      )}
                    </section>
                  ))
                : null}
              {lossApplies(op) && (op === 'destruction' || draft.losses.some((line) => line.loss_kind === 'incident')) ? (
                <Field id="motivo" label={copy.cellar.reason} error={lineMessages(issues, 'reason', step)[0]}>
                  <Textarea id="motivo" value={draft.reason} invalid={lineMessages(issues, 'reason', step).length > 0} onChange={(event) => change((current) => ({ ...current, reason: event.target.value }))} />
                </Field>
              ) : null}
              {balance?.text ? <BalanceBanner balance={balance} /> : null}
            </div>
          ) : null}

          {step === 'revision' && op ? (
            <div className="grid gap-4">
              {balance?.text ? <BalanceBanner balance={balance} /> : null}
              {needsApproval(draft) || approvalId ? <Alert tone="warning">{copy.cellar.approvalWarn}</Alert> : null}
              {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
              <ElaborationSummary draft={draft} />
              <EffectsView preview={serverPreview} fallback={effects} vessels={vessels} draft={draft} />
              {lineMessages(issues, 'banner', step).map((message) => (
                <p key={message} role="alert" data-server-error className="text-label text-danger-700">
                  {message}
                </p>
              ))}
              <Summary title="Orígenes" lines={draft.inputs} op={op} role="input" vessels={vessels} lotCode={draft.new_lot_code} issues={issues} onFix={() => jump('origenes')} />
              <Summary title="Destinos" lines={destApplies(op) ? draft.outputs : []} op={op} role="output" vessels={vessels} lotCode={draft.new_lot_code} issues={issues} empty="Sin destino" onFix={() => jump('destinos')} />
              <Summary
                title="Merma"
                lines={
                  lossApplies(op)
                    ? draft.losses.filter((line) => mlOf(op, 'loss', line) > 0 || (op === 'labeling' && parseQty(line.qty_text) > 0) || lineMessages(issues, line.key, 'revision').length > 0)
                    : []
                }
                op={op}
                role="loss"
                vessels={vessels}
                lotCode={draft.new_lot_code}
                issues={issues}
                empty="Sin merma"
                onFix={() => jump('mermas')}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="occurred_at" label="Fecha" error={lineMessages(issues, 'occurred_at', step)[0]}>
                  <Input id="occurred_at" type="datetime-local" value={draft.occurred_at} onChange={(event) => change((current) => ({ ...current, occurred_at: event.target.value }))} />
                </Field>
                <Field id="performed_by" label="Quién" error={lineMessages(issues, 'performed_by', step)[0]}>
                  <Input id="performed_by" value={draft.performed_by} onChange={(event) => change((current) => ({ ...current, performed_by: event.target.value }))} />
                </Field>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface px-3 py-2 sm:hidden">
        {showKeys && active ? <Keypad onPress={(key) => setDraft((current) => applyKey(current, active, key))} /> : null}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={step === 'tipo'} onClick={back}>
            {copy.cellar.back}
          </Button>
          {step === 'revision' ? (
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="secondary" size="sm" className="sm:hidden" loading={saving && !confirmOpen} disabled={!op} onClick={() => void persist(false)}>
                Borrador
              </Button>
              <Button type="button" variant="primary" size="sm" disabled={!ready} onClick={() => setConfirmOpen(true)}>
                {copy.cellar.confirm}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={forward}>
              {copy.cellar.next}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} labelledBy="confirmar-nueva" size="lg">
        <DialogHeader
          titleId="confirmar-nueva"
          title={copy.cellar.confirm}
          description={op ? opLabel(op) : undefined}
          onClose={() => setConfirmOpen(false)}
        />
        <DialogBody>
          <div data-screen="bodega-vista-previa" className="grid gap-3">
            {balance?.text ? <BalanceBanner balance={balance} /> : null}
            {needsApproval(draft) ? <Alert tone="warning">{copy.cellar.pendingHint}</Alert> : null}
            {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
            <ElaborationSummary draft={draft} />
            <EffectsView preview={serverPreview} fallback={effects} vessels={vessels} draft={draft} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" size="sm" loading={saving} disabled={!ready} onClick={() => void persist(true)}>
            {copy.cellar.confirm}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function Alerts({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <div className="grid gap-1">
      {messages.map((message) => (
        <p key={message} role="alert" className="text-caption text-danger-700">
          {message}
        </p>
      ))}
    </div>
  )
}

function BalanceBanner({ balance }: { balance: Balance }) {
  return (
    <div id="conservacion" role={balance.ok ? 'status' : 'alert'} data-code={balance.ok ? 'ok' : 'WC020'}>
      <Alert tone={balance.ok ? 'success' : 'danger'}>{balance.text}</Alert>
    </div>
  )
}

function EffectsView({
  preview,
  fallback,
  vessels,
  draft,
}: {
  preview: OperationPreview | null
  fallback?: { fisico: string; sisv: string; silicie: string } | null
  vessels: Vessel[]
  draft?: Draft
}) {
  if (preview) {
    const lines = draft ? [...draft.inputs, ...draft.outputs, ...draft.losses] : []
    return (
      <section data-effects="server" className="grid gap-1 rounded-2xl border border-border-subtle p-3 text-label">
        <h2 className="text-caption text-text-tertiary">{copy.cellar.effects}</h2>
        {preview.stock_moves.length === 0 ? <p className="text-text-tertiary">{copy.cellar.noPhysical}</p> : null}
        {preview.stock_moves.map((move, index) => {
          const vessel = vessels.find((item) => item.id === move.vessel_id)?.code
          const lot = lines.find((item) => item.lot_id && item.lot_id === move.lot_id)?.lot_code
          const amount = move.qty_units !== 0 ? `${Math.abs(move.qty_units)} botellas` : formatLitres(Math.abs(move.volume_ml) / 1000)
          return (
            <p key={`${move.move_type}-${move.vessel_id ?? ''}-${index}`}>
              {moveLabel(move.move_type)}
              {vessel ? ` · ${vessel}` : ''}
              {lot ? ` · ${lot}` : ''}
              {` · ${amount}`}
            </p>
          )
        })}
        {preview.fiscal_moves.length === 0 ? <p className="text-text-tertiary">{copy.cellar.noFiscal}</p> : null}
        {preview.fiscal_moves.map((move, index) => (
          <p key={`${move.move_type}-${index}`}>
            {fiscalLabel(move.move_type)}
            {` · ${classLabel(move.product_class)}`}
            {move.excise_product_key ? ` · ${move.excise_product_key}` : ''}
            {` · ${formatLitres(Math.abs(move.volume_ml) / 1000)}`}
          </p>
        ))}
        {preview.new_lots.map((lot) => (
          <p key={lot.code}>
            Lote nuevo · {lot.code}
            {lot.volume_ml ? ` · ${formatLitres(lot.volume_ml / 1000)}` : ''}
          </p>
        ))}
        <Materials lines={preview.materials} />
      </section>
    )
  }
  if (!fallback) return null
  return (
    <section data-effects="local" className="grid gap-2 rounded-2xl border border-border-subtle p-3 text-label">
      <h2 className="text-caption text-text-tertiary">{copy.cellar.effects}</h2>
      <p>
        <span className="text-text-tertiary">Físico · </span>
        {fallback.fisico}
      </p>
      <p>
        <span className="text-text-tertiary">SISV · </span>
        {fallback.sisv}
      </p>
      <p>
        <span className="text-text-tertiary">SILICIE · </span>
        {fallback.silicie}
      </p>
    </section>
  )
}

function Materials({ lines }: { lines: PreviewMaterial[] | undefined }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="mt-2 grid gap-1 border-t border-border-subtle pt-2">
      <h3 className="text-caption text-text-tertiary">{copy.cellar.materials}</h3>
      {lines.map((line) => (
        <p key={`${line.sku}-${line.per}`}>
          {line.name} · {line.sku} · {line.quantity} ud
          {line.short ? <span className="text-warning-700"> · {line.warning ?? copy.cellar.materialShort}</span> : null}
        </p>
      ))}
    </div>
  )
}

function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
  return (
    <div className="mb-2 grid grid-cols-3 gap-1.5 md:hidden" role="group" aria-label="Teclado numérico">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === '⌫' ? 'Borrar' : key === ',' ? 'Coma' : key}
          className="h-11 rounded-lg bg-surface-subtle text-label font-medium"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPress(key)}
        >
          {key}
        </button>
      ))}
    </div>
  )
}

function VesselChips({ vessels, selected, onSelect }: { vessels: Vessel[]; selected: string; onSelect: (vessel: Vessel) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 max-sm:max-h-44 max-sm:flex-wrap max-sm:overflow-x-visible max-sm:overflow-y-auto max-sm:overscroll-contain">
      {vessels.map((vessel) => {
        const on = vessel.code === selected
        const disabled = vessel.status !== 'in_service'
        const inside = holding(vessel)
        return (
          <Button
            key={vessel.id}
            type="button"
            size="sm"
            variant={on ? 'primary' : 'secondary'}
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onSelect(vessel)}
          >
            {vessel.code}
            <span className="sr-only">
              {disabled ? 'Fuera de servicio' : inside ? formatLitres(inside.volume_ml / 1000) : 'Vacío'}
            </span>
          </Button>
        )
      })}
    </div>
  )
}

function LineCard({
  title,
  line,
  index,
  op,
  role,
  vessels,
  messages,
  hideAmount,
  onVessel,
  onChange,
  onFocus,
  onRemove,
}: {
  title: string
  line: DraftLine
  index: number
  op: OpType
  role: LineRole
  vessels: Vessel[]
  messages: string[]
  hideAmount?: boolean
  onVessel: (vessel: Vessel) => void
  onChange: (field: 'volume_text' | 'qty_text' | 'nominal_text', value: string) => void
  onFocus: (field: ActiveField['field']) => void
  onRemove?: () => void
}) {
  const vessel = vessels.find((item) => item.code === line.vessel_code)
  return (
    <section className="grid gap-3 rounded-2xl border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-medium">{title}</h2>
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {copy.cellar.remove}
          </Button>
        ) : null}
      </div>
      <VesselChips vessels={vessels} selected={line.vessel_code} onSelect={onVessel} />
      <p className="text-caption text-text-tertiary">{caption(vessel)}</p>
      {hideAmount ? <Alerts messages={messages} /> : (
        <LineFields line={line} index={index} idPrefix={role} op={op} role={role} messages={messages} onChange={onChange} onFocus={onFocus} />
      )}
    </section>
  )
}

function LineFields({
  line,
  index,
  idPrefix,
  op,
  role,
  messages,
  onChange,
  onFocus,
}: {
  line: DraftLine
  index: number
  idPrefix: string
  op: OpType
  role: LineRole
  messages: string[]
  onChange: (field: 'volume_text' | 'qty_text' | 'nominal_text', value: string) => void
  onFocus: (field: ActiveField['field']) => void
}) {
  const units = op === 'labeling' || (op === 'bottling' && role === 'output')
  if (units) {
    const qtyId = `${idPrefix}-${index}-unidades`
    return (
      <div className="grid gap-3">
        <Field id={qtyId} label="Botellas" error={messages[0]}>
          <Input
            id={qtyId}
            inputMode="numeric"
            autoComplete="off"
            value={line.qty_text}
            invalid={messages.length > 0}
            onFocus={() => onFocus('qty_text')}
            onChange={(event) => onChange('qty_text', event.target.value)}
          />
        </Field>
        {messages.length > 1 ? <Alerts messages={messages.slice(1)} /> : null}
        {op === 'bottling' && role === 'output' ? (
          <Field id={`${idPrefix}-${index}-nominal`} label="Litros por botella">
            <Input
              id={`${idPrefix}-${index}-nominal`}
              inputMode="decimal"
              autoComplete="off"
              value={line.nominal_text}
              onFocus={() => onFocus('nominal_text')}
              onChange={(event) => onChange('nominal_text', event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    )
  }
  const id = `${idPrefix}-${index}-volumen`
  return (
    <Field id={id} label={copy.cellar.litres} error={messages[0]} hint={formatLitres(mlOf(op, role, line) / 1000)}>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={line.volume_text}
        invalid={messages.length > 0}
        onFocus={() => onFocus('volume_text')}
        onChange={(event) => onChange('volume_text', event.target.value)}
      />
    </Field>
  )
}

function AdditionFields({
  draft,
  issues,
  step,
  onChange,
}: {
  draft: Draft
  issues: Issue[]
  step: WizardStep
  onChange: (recipe: (current: Draft) => Draft) => void
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border-subtle p-3">
      <Field id="additive_name" label="Producto" error={lineMessages(issues, 'additive_name', step)[0]}>
        <Input id="additive_name" value={draft.additive_name} onChange={(event) => onChange((current) => ({ ...current, additive_name: event.target.value }))} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Field id="quantity_text" label="Cantidad" error={lineMessages(issues, 'quantity_text', step)[0]}>
          <Input id="quantity_text" inputMode="decimal" value={draft.quantity_text} onChange={(event) => onChange((current) => ({ ...current, quantity_text: event.target.value }))} />
        </Field>
        <Field id="quantity_unit" label="Unidad">
          <Select id="quantity_unit" value={draft.quantity_unit} onChange={(event) => onChange((current) => ({ ...current, quantity_unit: event.target.value as Draft['quantity_unit'] }))}>
            <option value="g">g</option>
            <option value="kg">kg</option>
            <option value="ml">ml</option>
            <option value="l">l</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Field id="dose_text" label="Dosis" error={lineMessages(issues, 'dose_text', step)[0]}>
          <Input id="dose_text" inputMode="decimal" value={draft.dose_text} onChange={(event) => onChange((current) => ({ ...current, dose_text: event.target.value }))} />
        </Field>
        <Field id="dose_unit" label="Unidad">
          <Select id="dose_unit" value={draft.dose_unit} onChange={(event) => onChange((current) => ({ ...current, dose_unit: event.target.value as Draft['dose_unit'] }))}>
            <option value="g/hl">g/hL</option>
            <option value="mg/l">mg/L</option>
            <option value="g/l">g/L</option>
          </Select>
        </Field>
      </div>
    </div>
  )
}

function CleaningFields({
  draft,
  issues,
  step,
  onChange,
}: {
  draft: Draft
  issues: Issue[]
  step: WizardStep
  onChange: (recipe: (current: Draft) => Draft) => void
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border-subtle p-3">
      <Field id="cleaning_product" label="Producto">
        <Input id="cleaning_product" value={draft.cleaning_product} onChange={(event) => onChange((current) => ({ ...current, cleaning_product: event.target.value }))} />
      </Field>
      <Field id="active_substance" label="Sustancia activa" error={lineMessages(issues, 'active_substance', step)[0]}>
        <Input id="active_substance" value={draft.active_substance} placeholder="Ácido peracético" onChange={(event) => onChange((current) => ({ ...current, active_substance: event.target.value }))} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Field id="cleaning_qty" label="Cantidad" error={lineMessages(issues, 'cleaning_qty', step)[0]}>
          <Input id="cleaning_qty" inputMode="decimal" value={draft.cleaning_qty} onChange={(event) => onChange((current) => ({ ...current, cleaning_qty: event.target.value }))} />
        </Field>
        <Field id="cleaning_unit" label="Unidad">
          <Select id="cleaning_unit" value={draft.cleaning_unit} onChange={(event) => onChange((current) => ({ ...current, cleaning_unit: event.target.value as Draft['cleaning_unit'] }))}>
            <option value="ml">ml</option>
            <option value="l">l</option>
            <option value="g">g</option>
            <option value="kg">kg</option>
          </Select>
        </Field>
      </div>
      <Field id="efficacy_check" label="Comprobación" error={lineMessages(issues, 'efficacy_check', step)[0]}>
        <Textarea id="efficacy_check" value={draft.efficacy_check} placeholder="Aclarado y tira de pH" onChange={(event) => onChange((current) => ({ ...current, efficacy_check: event.target.value }))} />
      </Field>
    </div>
  )
}

function Summary({
  title,
  lines,
  op,
  role,
  vessels,
  lotCode,
  issues,
  empty,
  onFix,
}: {
  title: string
  lines: DraftLine[]
  op: OpType
  role: LineRole
  vessels: Vessel[]
  lotCode: string
  issues: Issue[]
  empty?: string
  onFix: () => void
}) {
  return (
    <section className="rounded-2xl border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-caption text-text-tertiary">{title}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onFix}>
          {copy.cellar.fix}
        </Button>
      </div>
      {lines.length === 0 ? <p className="mt-2 text-label">{empty}</p> : null}
      <ul className="mt-2 grid gap-2">
        {lines.map((line) => (
          <li key={line.key}>
            <p className="text-label">{describeLine(op, role, line, vessels, lotCode)}</p>
            <Alerts messages={lineMessages(issues, line.key, 'revision')} />
          </li>
        ))}
      </ul>
    </section>
  )
}

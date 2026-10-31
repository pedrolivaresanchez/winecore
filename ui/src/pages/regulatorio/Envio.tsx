import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { formatDate } from '@/lib/format'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { MoreVertical } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
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
  InfoTip,
  Input,
  MenuItem,
  Select,
  Skeleton,
  Textarea,
  useMenuOpen,
  useToast,
} from '@/ui'
import {
  downloadSubmissionFile,
  postAction,
  submissionOf,
  uploadReceipt,
  type ApprovalPeek,
  type Issue,
  type Submission,
  type SubmissionEntry,
  type SubmissionFile,
} from '@/pages/regulatorio/api'
import { Fact, FactCard, Lifecycle, RecordBar, RecordTabs, StatusBadge } from '@/pages/regulatorio/frame'
import {
  canPrepare,
  entityLabel,
  entryStatusMeta,
  flowLabel,
  litresLabel,
  periodRange,
  periodTitle,
  primaryAction,
  shortHash,
  validRef,
  warehouseLabel,
  type PrimaryAction,
} from '@/pages/regulatorio/model'
import { useWarehouses } from '@/pages/regulatorio/warehouses'

const TABS = [
  { id: 'resumen', label: copy.regulatorio.summary },
  { id: 'fichero', label: copy.regulatorio.file },
  { id: 'aprobacion', label: copy.regulatorio.approval },
  { id: 'presentacion', label: copy.regulatorio.filing },
  { id: 'correccion', label: copy.regulatorio.correction },
] as const

type TabId = (typeof TABS)[number]['id']

const ACTION_LABEL: Record<PrimaryAction, string> = {
  validate: copy.regulatorio.validate,
  request: copy.regulatorio.requestApproval,
  approval: copy.regulatorio.openApproval,
  register: copy.regulatorio.register,
  result: copy.regulatorio.recordResult,
  correct: copy.regulatorio.createCorrection,
}

function tabOf(value: string | null): TabId {
  return TABS.some((item) => item.id === value) ? (value as TabId) : 'resumen'
}

function fileLabel(file: SubmissionFile): string {
  return file.kind === 'anulaciones' ? 'IESX4' : 'IESA1 V2'
}

export function EnvioPage({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const places = useWarehouses()
  const [params, setParams] = useSearchParams()
  const tab = tabOf(params.get('seccion'))
  const record = useApi<Submission>(id ? `/v1/regulatory/submissions/${id}` : null)
  const submission = record.data ? submissionOf(record.data) : null
  useChromeTitle(submission ? periodTitle(submission.period_start, submission.period_end) : copy.regulatorio.filing)
  const approval = useApi<ApprovalPeek>(submission?.approval_request_id ? `/v1/approvals/${submission.approval_request_id}` : null)
  const prepare = canPrepare(me)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [refError, setRefError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [result, setResult] = useState<'accepted' | 'rejected' | 'accepted_with_errors'>('accepted')
  const [numbers, setNumbers] = useState<Record<string, string>>({})
  const [entryResults, setEntryResults] = useState<Record<string, 'accepted' | 'rejected'>>({})
  const [numberErrors, setNumberErrors] = useState<Record<string, string>>({})
  const [motive, setMotive] = useState<'1' | '2' | '3'>('1')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const more = useMenuOpen()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)

  function setTab(next: TabId) {
    const query = new URLSearchParams(params)
    if (next === 'resumen') query.delete('seccion')
    else query.set('seccion', next)
    setParams(query, { replace: true })
  }

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setBanner(null)
    try {
      await work()
    } catch (error: unknown) {
      setBanner(error instanceof ApiError ? error.message : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  if (!allows(me, 'regulatory.read')) return <NoPermission />

  if (record.loading && !submission) {
    return (
      <div data-screen="regulatorio-envio-cargando" aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (record.error || !submission) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${record.error?.code ?? 'WC_ERROR'})`}
          detail={record.error?.message}
          onRetry={record.reload}
        />
      </div>
    )
  }

  const action = primaryAction(submission)
  const approvalId = submission.approval_request_id
  const showAction = action !== null && (action === 'approval' || prepare)
  const warehouse = warehouseLabel(places.warehouses, submission.tax_warehouse_id, submission.files)
  const selection = picked ?? new Set(submission.entries.filter((entry) => entry.aeat_entry_number).map((entry) => entry.id))

  async function validate() {
    await run(async () => {
      await postAction(submission!.id, 'validate')
      toast(copy.regulatorio.validatedToast, { tone: 'success' })
      setTab('resumen')
      record.reload()
    })
  }

  async function requestApproval() {
    await run(async () => {
      await postAction(submission!.id, 'request-approval')
      toast(copy.regulatorio.approvalToast, { tone: 'success' })
      setTab('aprobacion')
      record.reload()
    })
  }

  async function register(event: FormEvent) {
    event.preventDefault()
    setTab('presentacion')
    const value = ref.trim()
    if (!validRef(value)) {
      setRefError(copy.regulatorio.aeatHint)
      return
    }
    setRefError(null)
    await run(async () => {
      let receiptId: string | undefined
      if (receipt) {
        const uploaded = await uploadReceipt(submission!.id, receipt)
        receiptId = uploaded.id
      }
      await postAction(submission!.id, 'mark-submitted', {
        external_ref: value,
        receipt_attachment_id: receiptId,
      })
      toast(copy.regulatorio.registered, { tone: 'success' })
      setReceipt(null)
      record.reload()
    })
  }

  async function saveResult(event: FormEvent) {
    event.preventDefault()
    setTab('presentacion')
    const errors: Record<string, string> = {}
    const items = submission!.entries.map((entry) => {
      const entryResult = result === 'rejected' ? 'rejected' : result === 'accepted_with_errors' ? (entryResults[entry.id] ?? 'accepted') : 'accepted'
      const number = (numbers[entry.id] ?? entry.aeat_entry_number ?? '').trim()
      if (result !== 'rejected' && entryResult === 'accepted' && number === '') errors[entry.id] = copy.regulatorio.aeatNumber
      return { entry_id: entry.id, aeat_entry_number: number || undefined, result: entryResult }
    })
    setNumberErrors(errors)
    if (Object.keys(errors).length > 0) return
    await run(async () => {
      await postAction(submission!.id, 'mark-result', {
        result,
        items: result === 'rejected' ? undefined : items,
      })
      toast(copy.regulatorio.resultSaved, { tone: 'success' })
      record.reload()
    })
  }

  async function correct(event: FormEvent) {
    event.preventDefault()
    setTab('correccion')
    if (selection.size === 0) {
      setBanner(copy.regulatorio.noAeatNumber)
      return
    }
    await run(async () => {
      const created = await postAction(submission!.id, 'correct', {
        reason: motive,
        entry_ids: picked ? [...selection] : undefined,
      })
      toast(copy.regulatorio.correctionReady, { tone: 'success' })
      navigate(`/regulatorio/envios/${created.id}`)
    })
  }

  function onPrimary() {
    if (action === 'validate') void validate()
    else if (action === 'request') void requestApproval()
    else if (action === 'approval' && approvalId) navigate(`/aprobaciones/${approvalId}`)
    else if (action === 'register') setTab('presentacion')
    else if (action === 'result') setTab('presentacion')
    else if (action === 'correct') setTab('correccion')
  }

  const cancellable = prepare && ['draft', 'validated', 'pending_approval'].includes(submission.status)

  async function cancelSend() {
    const reason = cancelReason.trim()
    if (reason.length < 3 || reason.length > 500) {
      setCancelError(copy.regulatorio.cancelHint)
      return
    }
    setCancelError(null)
    setBusy(true)
    try {
      await postAction(submission!.id, 'cancel', { reason })
      toast(copy.regulatorio.cancelled, { tone: 'success' })
      setCancelOpen(false)
      setCancelReason('')
      record.reload()
    } catch (error: unknown) {
      setCancelError(error instanceof ApiError ? (error.fields?.reason ?? error.message) : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  const primary =
    showAction && action ? (
      action === 'register' && tab === 'presentacion' && submission.status !== 'submitted' ? (
        <Button type="submit" form="regulatorio-presentar" variant="primary" size="sm" loading={busy}>
          {ACTION_LABEL[action]}
        </Button>
      ) : action === 'result' && tab === 'presentacion' ? (
        <Button type="submit" form="regulatorio-resultado" variant="primary" size="sm" loading={busy}>
          {ACTION_LABEL[action]}
        </Button>
      ) : action === 'correct' && tab === 'correccion' ? (
        <Button type="submit" form="regulatorio-correccion" variant="primary" size="sm" loading={busy}>
          {ACTION_LABEL[action]}
        </Button>
      ) : (
        <Button type="button" variant="primary" size="sm" loading={busy && (action === 'validate' || action === 'request')} onClick={onPrimary}>
          {ACTION_LABEL[action]}
        </Button>
      )
    ) : null

  return (
    <div data-screen="regulatorio-envio" data-tab={tab} data-status={submission.status} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <RecordBar
        actions={
          <>
            {cancellable ? (
              <GlassMenu
                open={more.open}
                onOpenChange={more.setOpen}
                placement="bottom-end"
                trigger={
                  <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.regulatorio.more} onClick={more.toggle}>
                    <MoreVertical strokeWidth={iconStroke} />
                  </Button>
                }
              >
                <MenuItem
                  tone="danger"
                  onClick={() => {
                    more.close()
                    setCancelError(null)
                    setCancelOpen(true)
                  }}
                >
                  {copy.regulatorio.cancelSend}
                </MenuItem>
              </GlassMenu>
            ) : null}
            {primary}
          </>
        }
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{periodTitle(submission.period_start, submission.period_end)}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {flowLabel(submission.flow)} · {entityLabel(me.entities, submission.legal_entity_id)} · {warehouse}
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={submission.status} phase={submission.phase} />
            {submission.rectifies_submission_id ? (
              <Link to={`/regulatorio/envios/${submission.rectifies_submission_id}`} className="text-label text-ink-900 underline-offset-2 hover:underline">
                {copy.regulatorio.original}
              </Link>
            ) : null}
            {submission.successor_id ? (
              <Link to={`/regulatorio/envios/${submission.successor_id}`} className="text-label text-ink-900 underline-offset-2 hover:underline">
                {copy.regulatorio.successor}
              </Link>
            ) : null}
          </div>
          <Lifecycle status={submission.status} phase={submission.phase} />
          {banner ? <Alert tone="danger">{banner}</Alert> : null}
          <RecordTabs tabs={[...TABS]} value={tab} onChange={setTab} />

          <div role="tabpanel" id="panel-resumen" aria-labelledby="tab-resumen" hidden={tab !== 'resumen'}>
            <Summary submission={submission} />
          </div>
          <div role="tabpanel" id="panel-fichero" aria-labelledby="tab-fichero" hidden={tab !== 'fichero'}>
            <FilePanel
              submission={submission}
              onDownload={(file) => {
                void run(async () => {
                  try {
                    await downloadSubmissionFile(submission.id, file)
                  } catch (error: unknown) {
                    throw error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.regulatorio.downloadFail)
                  }
                })
              }}
            />
          </div>
          <div role="tabpanel" id="panel-aprobacion" aria-labelledby="tab-aprobacion" hidden={tab !== 'aprobacion'}>
            <ApprovalPanel submission={submission} approval={approval.data} prepare={prepare} busy={busy} onRequest={() => void requestApproval()} />
          </div>
          <div role="tabpanel" id="panel-presentacion" aria-labelledby="tab-presentacion" hidden={tab !== 'presentacion'}>
            <FilingPanel
              submission={submission}
              prepare={prepare}
              refValue={ref}
              refError={refError}
              receiptName={receipt?.name ?? ''}
              result={result}
              numbers={numbers}
              entryResults={entryResults}
              numberErrors={numberErrors}
              onRef={(value) => {
                setRef(value)
                setRefError(null)
              }}
              onPickReceipt={() => fileRef.current?.click()}
              onResult={setResult}
              onNumber={(entryId, value) => setNumbers((current) => ({ ...current, [entryId]: value }))}
              onEntryResult={(entryId, value) => setEntryResults((current) => ({ ...current, [entryId]: value }))}
              onRegister={(event) => void register(event)}
              onSaveResult={(event) => void saveResult(event)}
            />
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
            />
          </div>
          <div role="tabpanel" id="panel-correccion" aria-labelledby="tab-correccion" hidden={tab !== 'correccion'}>
            <CorrectionPanel
              submission={submission}
              prepare={prepare}
              motive={motive}
              selection={selection}
              onMotive={setMotive}
              onToggle={(entryId, checked) => {
                const next = new Set(selection)
                if (checked) next.add(entryId)
                else next.delete(entryId)
                setPicked(next)
              }}
              onSubmit={(event) => void correct(event)}
            />
          </div>
        </div>
      </div>
      <Dialog open={cancelOpen} onClose={() => { if (!busy) setCancelOpen(false) }} size="sm" labelledBy="cancelar-envio">
        <DialogHeader title={copy.regulatorio.cancelTitle} titleId="cancelar-envio" onClose={() => { if (!busy) setCancelOpen(false) }} />
        <DialogBody>
          <form
            id="cancelar-envio-form"
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void cancelSend()
            }}
          >
            <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="motivo-cancelar">
              {copy.regulatorio.cancelReason}
              <Textarea id="motivo-cancelar" value={cancelReason} invalid={Boolean(cancelError)} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            {cancelError ? <p role="alert" className="text-caption text-danger-600">{cancelError}</p> : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setCancelOpen(false)}>{copy.regulatorio.cancel}</Button>
          <Button type="submit" form="cancelar-envio-form" variant="danger" size="sm" loading={busy}>{copy.regulatorio.cancelSend}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function Summary({ submission }: { submission: Submission }) {
  const errors = submission.validation.errors
  const warnings = submission.validation.warnings
  return (
    <div className="grid gap-5">
      <FactCard title={copy.regulatorio.summary}>
        <Fact label={copy.regulatorio.period} value={periodRange(submission.period_start, submission.period_end)} />
        <Fact label={copy.regulatorio.entries} value={String(submission.summary.entry_count)} />
        <Fact label={copy.regulatorio.litres} value={litresLabel(submission.summary.litres)} />
      </FactCard>
      <div className="flex flex-wrap gap-1.5">
        {errors.length === 0 ? <Badge tone="success">{copy.regulatorio.noErrors}</Badge> : null}
        {warnings.length === 0 ? <Badge tone="neutral">{copy.regulatorio.noWarnings}</Badge> : null}
      </div>
      <Issues title={copy.regulatorio.errors} help={copy.regulatorio.errorsHelp} items={errors} />
      <Issues title={copy.regulatorio.warnings} items={warnings} />
      <section>
        <h2 className="text-label font-medium text-ink-900">{copy.regulatorio.entries}</h2>
        {submission.entries.length === 0 ? (
          <p className="mt-2 text-label text-text-secondary">{copy.regulatorio.noEntries}</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-2xl border border-border-subtle">
            {submission.entries.map((entry) => {
              const meta = entryStatusMeta(entry.status)
              return (
                <li key={entry.id} className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 last:border-b-0">
                  <span className="w-24 shrink-0 whitespace-nowrap text-caption text-text-tertiary">{formatDate(entry.movement_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-label text-ink-900">{entry.reference || entry.entry_kind}</span>
                  <span className="hidden font-mono text-caption text-text-tertiary sm:inline">{entry.entry_kind}</span>
                  <Badge tone={meta.tone} size="sm">
                    {meta.label}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Issues({ title, help, items }: { title: string; help?: string; items: Issue[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-1.5 text-label font-medium text-ink-900">
        {title}
        {help ? <InfoTip label={title}>{help}</InfoTip> : null}
      </h2>
      <ul className="mt-2 overflow-hidden rounded-2xl border border-border-subtle">
        {items.map((issue) => (
          <li key={`${issue.code}-${issue.item_id ?? ''}-${issue.message}`} className="border-b border-border-subtle px-4 py-2 last:border-b-0">
            <p className="text-label text-ink-900">{issue.message}</p>
            <p className="font-mono text-caption text-text-tertiary">{issue.code}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FilePanel({
  submission,
  onDownload,
}: {
  submission: Submission
  onDownload: (file: SubmissionFile) => void
}) {
  if (submission.files.length === 0) {
    return <EmptyState size="sm" title={copy.regulatorio.noFile} description={copy.regulatorio.noFileHint} />
  }
  return (
    <div className="grid gap-4">
      <h2 className="flex items-center gap-1.5 text-label font-medium text-ink-900">
        {copy.regulatorio.file}
        <InfoTip label={copy.regulatorio.file}>{copy.regulatorio.manualHelp}</InfoTip>
      </h2>
      <FactCard title={copy.regulatorio.hash} help={copy.regulatorio.hashHelp}>
        <div className="px-4 py-3">
          <p className="font-mono text-body font-medium tracking-wide text-ink-900">{shortHash(submission.content_sha256)}</p>
          <p className="mt-1 font-mono text-caption break-all text-text-tertiary">{submission.content_sha256}</p>
        </div>
      </FactCard>
      <ul className="overflow-hidden rounded-2xl border border-border-subtle">
        {submission.files.map((file) => (
          <li key={`${file.kind}-${file.exercise_year}`} className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-label text-ink-900">{fileLabel(file)}</p>
              <p className="truncate font-mono text-caption text-text-tertiary">{file.filename}</p>
              <p className="truncate font-mono text-caption text-text-tertiary">{shortHash(file.sha256)}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => onDownload(file)}>
              {copy.regulatorio.download}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ApprovalPanel({
  submission,
  approval,
  prepare,
  busy,
  onRequest,
}: {
  submission: Submission
  approval: ApprovalPeek | null
  prepare: boolean
  busy: boolean
  onRequest: () => void
}) {
  if (!submission.approval_request_id) {
    return (
      <EmptyState
        size="sm"
        title={copy.regulatorio.noApproval}
        description={submission.ready_for_approval ? copy.regulatorio.approvalReady : copy.regulatorio.noApprovalHint}
        action={
          prepare && submission.ready_for_approval ? (
            <Button type="button" variant="primary" size="sm" loading={busy} onClick={onRequest}>
              {copy.regulatorio.requestApproval}
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <div className="grid gap-4">
      <h2 className="flex items-center gap-1.5 text-label font-medium text-ink-900">
        {copy.regulatorio.approval}
        <InfoTip label={copy.regulatorio.approval}>{copy.regulatorio.selfApproval}</InfoTip>
      </h2>
      {approval?.reason_cannot_decide ? <Alert tone="warning">{approval.reason_cannot_decide}</Alert> : null}
      <FactCard title={copy.regulatorio.approval}>
        {approval?.requested_by?.display_name ? <Fact label={copy.regulatorio.requestedBy} value={approval.requested_by.display_name} /> : null}
        <div className="px-4 py-3">
          <Link to={`/aprobaciones/${submission.approval_request_id}`} className="text-label font-medium text-ink-900 underline-offset-2 hover:underline">
            {copy.regulatorio.openApproval}
          </Link>
        </div>
      </FactCard>
    </div>
  )
}

function FilingPanel({
  submission,
  prepare,
  refValue,
  refError,
  receiptName,
  result,
  numbers,
  entryResults,
  numberErrors,
  onRef,
  onPickReceipt,
  onResult,
  onNumber,
  onEntryResult,
  onRegister,
  onSaveResult,
}: {
  submission: Submission
  prepare: boolean
  refValue: string
  refError: string | null
  receiptName: string
  result: 'accepted' | 'rejected' | 'accepted_with_errors'
  numbers: Record<string, string>
  entryResults: Record<string, 'accepted' | 'rejected'>
  numberErrors: Record<string, string>
  onRef: (value: string) => void
  onPickReceipt: () => void
  onResult: (value: 'accepted' | 'rejected' | 'accepted_with_errors') => void
  onNumber: (entryId: string, value: string) => void
  onEntryResult: (entryId: string, value: 'accepted' | 'rejected') => void
  onRegister: (event: FormEvent) => void
  onSaveResult: (event: FormEvent) => void
}) {
  const filed = ['submitted', 'accepted', 'rejected', 'accepted_with_errors', 'rectified'].includes(submission.status) || submission.phase === 'corrected'
  const approved = submission.status === 'approved' || submission.status === 'submitting' || filed
  if (!approved) {
    return <EmptyState size="sm" title={copy.regulatorio.notApproved} description={copy.regulatorio.notApprovedHint} />
  }
  return (
    <div className="grid gap-5">
      <h2 className="flex items-center gap-1.5 text-label font-medium text-ink-900">
        {copy.regulatorio.filing}
        <InfoTip label={copy.regulatorio.filing}>{copy.regulatorio.manualHelp}</InfoTip>
      </h2>
      {submission.external_ref ? (
        <FactCard title={copy.regulatorio.filingRef}>
          <Fact label={copy.regulatorio.aeatRef} value={submission.external_ref} mono />
        </FactCard>
      ) : prepare ? (
        <form id="regulatorio-presentar" className="grid gap-3" onSubmit={onRegister}>
          <Field id="aeat-ref" label={copy.regulatorio.aeatRef} error={refError ?? undefined} hint={copy.regulatorio.aeatHint}>
            <Input id="aeat-ref" value={refValue} aria-invalid={Boolean(refError)} onChange={(event) => onRef(event.target.value)} />
          </Field>
          <Field id="justificante" label={copy.regulatorio.receipt} hint={copy.regulatorio.receiptHint}>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onPickReceipt}>
                {copy.regulatorio.attach}
              </Button>
              <span className="min-w-0 truncate text-caption text-text-tertiary">{receiptName}</span>
            </div>
          </Field>
        </form>
      ) : null}
      {submission.status === 'submitted' && prepare ? (
        <form id="regulatorio-resultado" className="grid gap-3" onSubmit={onSaveResult}>
          <Field id="resultado" label={copy.regulatorio.result}>
            <Select
              id="resultado"
              className="w-full"
              value={result}
              onChange={(event) => onResult(event.target.value as 'accepted' | 'rejected' | 'accepted_with_errors')}
            >
              <option value="accepted">{copy.regulatorio.statuses.accepted}</option>
              <option value="accepted_with_errors">{copy.regulatorio.statuses.accepted_with_errors}</option>
              <option value="rejected">{copy.regulatorio.statuses.rejected}</option>
            </Select>
          </Field>
          {result !== 'rejected'
            ? submission.entries.map((entry) => (
                <EntryResult
                  key={entry.id}
                  entry={entry}
                  result={result}
                  number={numbers[entry.id] ?? entry.aeat_entry_number ?? ''}
                  entryResult={entryResults[entry.id] ?? 'accepted'}
                  error={numberErrors[entry.id]}
                  onNumber={onNumber}
                  onEntryResult={onEntryResult}
                />
              ))
            : null}
        </form>
      ) : null}
    </div>
  )
}

function EntryResult({
  entry,
  result,
  number,
  entryResult,
  error,
  onNumber,
  onEntryResult,
}: {
  entry: SubmissionEntry
  result: 'accepted' | 'rejected' | 'accepted_with_errors'
  number: string
  entryResult: 'accepted' | 'rejected'
  error?: string
  onNumber: (entryId: string, value: string) => void
  onEntryResult: (entryId: string, value: 'accepted' | 'rejected') => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <Field id={`asiento-${entry.id}`} label={entry.reference || entry.entry_kind} error={error}>
        <Input
          id={`asiento-${entry.id}`}
          value={number}
          aria-label={copy.regulatorio.aeatNumber}
          aria-invalid={Boolean(error)}
          onChange={(event) => onNumber(entry.id, event.target.value)}
        />
      </Field>
      {result === 'accepted_with_errors' ? (
        <Field id={`estado-${entry.id}`} label={copy.regulatorio.status}>
          <Select
            id={`estado-${entry.id}`}
            className="w-full"
            value={entryResult}
            onChange={(event) => onEntryResult(entry.id, event.target.value === 'rejected' ? 'rejected' : 'accepted')}
          >
            <option value="accepted">{copy.regulatorio.statuses.accepted}</option>
            <option value="rejected">{copy.regulatorio.statuses.rejected}</option>
          </Select>
        </Field>
      ) : null}
    </div>
  )
}

function CorrectionPanel({
  submission,
  prepare,
  motive,
  selection,
  onMotive,
  onToggle,
  onSubmit,
}: {
  submission: Submission
  prepare: boolean
  motive: '1' | '2' | '3'
  selection: Set<string>
  onMotive: (value: '1' | '2' | '3') => void
  onToggle: (entryId: string, checked: boolean) => void
  onSubmit: (event: FormEvent) => void
}) {
  const correctable = ['accepted', 'rejected', 'accepted_with_errors'].includes(submission.status)
  const numbered = useMemo(
    () => submission.entries.filter((entry) => entry.aeat_entry_number),
    [submission.entries],
  )
  if (submission.phase === 'corrected' || submission.successor_id) {
    return (
      <EmptyState
        size="sm"
        title={copy.regulatorio.correctedDone}
        action={
          submission.successor_id ? (
            <Link to={`/regulatorio/envios/${submission.successor_id}`} className="text-label text-ink-900 underline-offset-2 hover:underline">
              {copy.regulatorio.successor}
            </Link>
          ) : undefined
        }
      />
    )
  }
  if (!correctable) {
    return <EmptyState size="sm" title={copy.regulatorio.noCorrection} description={copy.regulatorio.noCorrectionHint} />
  }
  if (!prepare) return <EmptyState size="sm" title={copy.regulatorio.noCorrection} />
  return (
    <form id="regulatorio-correccion" className="grid gap-3" onSubmit={onSubmit}>
      <Field id="motivo" label={copy.regulatorio.motive}>
        <Select
          id="motivo"
          className="w-full"
          value={motive}
          onChange={(event) => onMotive(event.target.value === '2' ? '2' : event.target.value === '3' ? '3' : '1')}
        >
          <option value="1">{copy.regulatorio.motive1}</option>
          <option value="2">{copy.regulatorio.motive2}</option>
          <option value="3">{copy.regulatorio.motive3}</option>
        </Select>
      </Field>
      {numbered.length === 0 ? <Alert tone="warning">{copy.regulatorio.noAeatNumber}</Alert> : null}
      <ul className="grid gap-2">
        {submission.entries.map((entry) => (
          <li key={entry.id}>
            <Checkbox
              size="sm"
              checked={selection.has(entry.id)}
              disabled={!entry.aeat_entry_number}
              label={entry.reference || entry.entry_kind}
              description={entry.aeat_entry_number ?? copy.regulatorio.noAeatNumber}
              onChange={(checked) => onToggle(entry.id, checked)}
            />
          </li>
        ))}
      </ul>
    </form>
  )
}

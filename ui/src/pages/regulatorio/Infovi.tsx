import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatLitres } from '@/lib/format'
import type { Me } from '@/lib/types'
import { Calendar, ChevronLeft, ChevronRight } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InfoTip,
  Input,
  Select,
  StatusChip,
  Table,
  useToast,
  type TableColumn,
} from '@/ui'
import {
  downloadInfovi,
  infoviPath,
  postInfovi,
  prepareInfovi,
  uploadInfoviReceipt,
  type InfoviFiling,
  type InfoviIssue,
  type InfoviLine,
  type InfoviMonth,
  type TaxWarehouse,
} from '@/pages/regulatorio/infovi-api'
import { ListFrame } from '@/pages/regulatorio/frame'
import { canPrepare, dayMonth, madridMonth, monthTitle, shiftMonth, statusMeta } from '@/pages/regulatorio/model'

const findings = copy.infovi.finding as Record<string, string>
const families = copy.infovi.families as Record<string, string>
const colors = copy.infovi.colors as Record<string, string>
const categories = copy.infovi.categories as Record<string, string>

export function InfoviPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { filter } = useEntity()
  const [params, setParams] = useSearchParams()
  const month = params.get('mes') ?? shiftMonth(madridMonth(), -1)
  const places = useApi<{ items: TaxWarehouse[] }>('/v1/tax-warehouses')
  const warehouses = (places.data?.items ?? []).filter((item) => filter === 'all' || item.entity.code === filter)
  const warehouse = warehouses.find((item) => item.id === params.get('establecimiento')) ?? warehouses[0]
  const entityId = warehouse?.entity.id
  const warehouseId = warehouse?.id ?? ''
  const query = useApi<InfoviMonth>(
    entityId && warehouseId ? infoviPath({ entityId, warehouseId, month }) : null,
  )
  const filing = query.data?.filing ?? null
  const prepare = canPrepare(me)
  const ready = Boolean(prepare && entityId && warehouseId)
  const [busy, setBusy] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [correctOpen, setCorrectOpen] = useState(false)

  function setMonth(next: string) {
    const value = new URLSearchParams(params)
    value.set('mes', next)
    setParams(value)
  }

  function setWarehouse(next: string) {
    const value = new URLSearchParams(params)
    value.set('establecimiento', next)
    setParams(value)
  }

  async function run(task: () => Promise<void>, ok: string) {
    setBusy(true)
    try {
      await task()
      toast(ok, { tone: 'success' })
      query.reload()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : copy.infovi.saveFail)
    } finally {
      setBusy(false)
    }
  }

  function prepareMonth() {
    if (!entityId || !warehouseId) return Promise.resolve()
    return run(() => prepareInfovi({ entityId, warehouseId, month }).then(() => undefined), copy.infovi.prepared)
  }

  const actions = ready ? (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void prepareMonth()}>
        {copy.infovi.prepare}
      </Button>
      {filing ? (
        <FilingActions
          filing={filing}
          busy={busy}
          onRun={run}
          onRegister={() => setRegisterOpen(true)}
          onCorrect={() => setCorrectOpen(true)}
          onOpenApproval={(id) => navigate(`/aprobaciones/${id}`)}
        />
      ) : null}
    </div>
  ) : null

  const columns: TableColumn<InfoviLine>[] = [
    { id: 'family', header: copy.infovi.family, cell: (row) => families[row.family] ?? row.family, minWidth: '88px' },
    { id: 'color', header: copy.infovi.color, cell: (row) => colors[row.color] ?? row.color, hideOnMobile: true },
    { id: 'category', header: copy.infovi.category, cell: (row) => categories[row.category] ?? row.category, hideOnMobile: true },
    { id: 'opening', header: copy.infovi.opening, align: 'right', cell: (row) => formatLitres(Number(row.opening_l)) },
    { id: 'entries', header: copy.infovi.entries, align: 'right', cell: (row) => formatLitres(Number(row.entries_l)) },
    { id: 'exits', header: copy.infovi.exits, align: 'right', cell: (row) => formatLitres(Number(row.exits_l)), hideOnMobile: true },
    { id: 'closing', header: copy.infovi.closing, align: 'right', cell: (row) => formatLitres(Number(row.closing_l)) },
    {
      id: 'balance',
      header: copy.infovi.balance,
      cell: (row) => (row.reconciles ? copy.infovi.yes : copy.infovi.no),
    },
  ]

  return (
    <ListFrame
      screen="infovi"
      view="infovi"
      toolbar={
        <>
          <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.infovi.monthPrev} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft strokeWidth={iconStroke} />
          </Button>
          <span className="shrink-0 text-label text-ink-900">{monthTitle(month)}</span>
          <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.infovi.monthNext} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight strokeWidth={iconStroke} />
          </Button>
          {query.data ? (
            <span className="shrink-0 text-caption text-text-tertiary">
              {copy.infovi.due} {dayMonth(query.data.due_date)}
            </span>
          ) : null}
          {warehouses.length > 1 ? (
            <Select
              id="infovi-establecimiento"
              size="sm"
              aria-label={copy.infovi.warehouse}
              value={warehouseId}
              onChange={(event) => setWarehouse(event.target.value)}
            >
              {warehouses.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          ) : null}
        </>
      }
      actions={actions}
      mobileActions={actions}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {query.error ? (
          <div className="p-4">
            <ErrorState title={query.error.message} onRetry={query.reload} />
          </div>
        ) : !entityId || (warehouses.length === 0 && !places.loading) ? (
          <EmptyState icon={<Calendar strokeWidth={iconStroke} />} title={copy.infovi.noWarehouse} />
        ) : query.loading && !filing ? (
          <p className="px-4 py-6 text-label text-text-tertiary">{copy.loading}</p>
        ) : !filing ? (
          <EmptyState
            icon={<Calendar strokeWidth={iconStroke} />}
            title={copy.infovi.empty}
            description={copy.infovi.emptyHint}
            action={
              ready ? (
                <Button type="button" loading={busy} onClick={() => void prepareMonth()}>
                  {copy.infovi.prepare}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <FilingBody filing={filing} columns={columns} />
        )}
      </div>
      {filing && entityId ? (
        <RegisterDialog
          open={registerOpen}
          filingId={filing.id}
          onClose={() => setRegisterOpen(false)}
          onSaved={() => {
            setRegisterOpen(false)
            query.reload()
          }}
        />
      ) : null}
      {filing ? (
        <CorrectDialog
          open={correctOpen}
          filingId={filing.id}
          onClose={() => setCorrectOpen(false)}
          onSaved={(id) => {
            setCorrectOpen(false)
            navigate(`/regulatorio/infovi?mes=${month}`)
            toast(copy.infovi.corrected, { tone: 'success' })
            if (id) query.reload()
          }}
        />
      ) : null}
    </ListFrame>
  )
}

function FilingActions({
  filing,
  busy,
  onRun,
  onRegister,
  onCorrect,
  onOpenApproval,
}: {
  filing: InfoviFiling
  busy: boolean
  onRun: (task: () => Promise<void>, ok: string) => void
  onRegister: () => void
  onCorrect: () => void
  onOpenApproval: (id: string) => void
}) {
  const file = filing.files[0]
  return (
    <>
      {file ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => downloadInfovi(filing.id, file.filename)}>
          {copy.infovi.download}
        </Button>
      ) : null}
      {filing.status === 'draft' ? (
        <Button type="button" size="sm" loading={busy} onClick={() => onRun(() => postInfovi(filing.id, 'validate').then(() => undefined), copy.infovi.validated)}>
          {copy.infovi.validate}
        </Button>
      ) : null}
      {filing.status === 'validated' && filing.ready_for_approval ? (
        <Button type="button" size="sm" loading={busy} onClick={() => onRun(() => postInfovi(filing.id, 'request-approval').then(() => undefined), copy.infovi.asked)}>
          {copy.infovi.request}
        </Button>
      ) : null}
      {filing.status === 'pending_approval' && filing.approval_request_id ? (
        <Button type="button" size="sm" onClick={() => onOpenApproval(filing.approval_request_id ?? '')}>
          {copy.infovi.openApproval}
        </Button>
      ) : null}
      {filing.status === 'approved' ? (
        <Button type="button" size="sm" onClick={onRegister}>{copy.infovi.register}</Button>
      ) : null}
      {filing.status === 'submitted' && filing.phase !== 'corrected' ? (
        <Button type="button" variant="secondary" size="sm" onClick={onCorrect}>{copy.infovi.correct}</Button>
      ) : null}
    </>
  )
}

function FilingBody({ filing, columns }: { filing: InfoviFiling; columns: TableColumn<InfoviLine>[] }) {
  const status = statusMeta(filing.status, filing.phase)
  const issues = [...filing.validation.errors, ...filing.validation.warnings]
  const grape = filing.grape[0]
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
        <StatusChip tone={filing.reconciliation.ok ? 'success' : 'danger'} detail={copy.infovi.balanceHelp}>
          {filing.reconciliation.ok ? copy.infovi.balanced : copy.infovi.unbalanced}
        </StatusChip>
        <StatusChip tone="warning" detail={filing.blocked_note}>{copy.infovi.blocked}</StatusChip>
        {filing.rectifies_filing_id ? <StatusChip tone="info">{copy.infovi.successor}</StatusChip> : null}
        <span className="ml-auto flex items-center gap-1 text-caption text-text-tertiary">
          {copy.infovi.campaign} {filing.production.campaign}
          <InfoTip label={copy.infovi.campaign}>
            {copy.infovi.must} {formatLitres(Number(filing.production.must_l))} · {copy.infovi.wine} {formatLitres(Number(filing.production.wine_l))}
            {filing.production.average_hl ? ` · ${copy.infovi.average} ${filing.production.average_hl} hl` : ''}
          </InfoTip>
        </span>
      </div>
      <Table variant="grid" columns={columns} rows={filing.lines} rowKey={(row) => `${row.family}-${row.color}-${row.category}`} />
      <div className="flex flex-wrap gap-1.5">
        <StatusChip tone="neutral">{copy.infovi.bottling} {formatLitres(Number(filing.bottling_l))}</StatusChip>
        <StatusChip tone="neutral">{copy.infovi.sales} {formatLitres(Number(filing.sales_l))}</StatusChip>
        {grape ? (
          <StatusChip tone="neutral" detail={grape.parcel_codes.join(', ') || undefined}>
            {copy.infovi.grape} {grape.variety ?? '—'} {grape.kg ? `${grape.kg} kg` : ''}
          </StatusChip>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={copy.infovi.findings}>
          {issues.map((issue, index) => (
            <Finding key={`${issue.code}-${issue.item_id ?? index}`} issue={issue} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Finding({ issue }: { issue: InfoviIssue }) {
  return (
    <StatusChip tone={issue.severity === 'error' ? 'danger' : 'warning'} detail={issue.message}>
      {findings[issue.code] ?? issue.code}
    </StatusChip>
  )
}

function RegisterDialog({
  open,
  filingId,
  onClose,
  onSaved,
}: {
  open: boolean
  filingId: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [refValue, setRefValue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!/^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/.test(refValue.trim())) {
      setError(copy.infovi.refHint)
      return
    }
    setBusy(true)
    setError(null)
    try {
      let receipt: string | undefined
      if (file) {
        const uploaded = await uploadInfoviReceipt(filingId, file)
        receipt = uploaded.id
      }
      await postInfovi(filingId, 'mark-submitted', {
        external_ref: refValue.trim(),
        receipt_attachment_id: receipt,
      })
      toast(copy.infovi.saved, { tone: 'success' })
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : copy.infovi.saveFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="infovi-registrar">
      <DialogHeader titleId="infovi-registrar" title={copy.infovi.register} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          <Field id="infovi-ref" label={copy.infovi.ref} error={error ?? undefined} hint={copy.infovi.refHint}>
            <Input id="infovi-ref" value={refValue} onChange={(event) => setRefValue(event.target.value)} />
          </Field>
          <Field id="infovi-justificante" label={copy.infovi.receipt}>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                {copy.infovi.attach}
              </Button>
              <span className="min-w-0 truncate text-caption text-text-tertiary">{file?.name ?? ''}</span>
              <input
                ref={fileRef}
                id="infovi-justificante"
                type="file"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>{copy.infovi.cancel}</Button>
        <Button type="button" loading={busy} onClick={() => void submit()}>{copy.infovi.save}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function CorrectDialog({
  open,
  filingId,
  onClose,
  onSaved,
}: {
  open: boolean
  filingId: string
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const text = reason.trim()
    if (text.length < 3 || text.length > 500) {
      setError(copy.infovi.reasonHint)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await postInfovi(filingId, 'correct', { reason: text })
      onSaved(created.id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : copy.infovi.saveFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="infovi-corregir">
      <DialogHeader titleId="infovi-corregir" title={copy.infovi.correct} onClose={onClose} />
      <DialogBody>
        <Field id="infovi-motivo" label={copy.infovi.reason} error={error ?? undefined} hint={copy.infovi.reasonHint}>
          <Input id="infovi-motivo" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>{copy.infovi.cancel}</Button>
        <Button type="button" loading={busy} onClick={() => void submit()}>{copy.infovi.save}</Button>
      </DialogFooter>
    </Dialog>
  )
}

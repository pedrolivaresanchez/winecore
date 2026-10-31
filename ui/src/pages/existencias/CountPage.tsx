import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { useEntity } from '@/app/entity-context'
import { toCount, type Catalog } from '@/pages/existencias/adapt'
import { useCatalog } from '@/pages/existencias/catalog'
import { CountSheet, type LineDraft } from '@/pages/existencias/components/CountSheet'
import { QrScanField } from '@/pages/existencias/components/QrScanField'
import { cachedCount, rememberCount } from '@/pages/existencias/count-cache'
import {
  closeCount,
  requestCountPosting,
  saveCountLines,
  type CountLine,
  type CountLineInput,
  type InventoryCount,
} from '@/pages/existencias/api'
import { explainStockError } from '@/pages/existencias/explain'
import { lineGap } from '@/pages/existencias/filters'
import { countKindLabel, countStatusLabel, countStatusTone, isPackaged, ownerLabel } from '@/pages/existencias/labels'
import { clearPending, readPending, writePending } from '@/pages/existencias/pending'
import { formatMl, formatSignedMl, formatSignedUnits } from '@/pages/existencias/volume'
import { ArrowLeft } from '@/ui/icons'
import { Alert, Badge, Button, Skeleton, useToast } from '@/ui'

const TABS = [
  { id: 'recuento', label: 'Recuento' },
  { id: 'resumen', label: 'Resumen' },
] as const

type TabId = (typeof TABS)[number]['id']

function draftsFrom(lines: CountLine[]): Record<string, LineDraft> {
  const drafts: Record<string, LineDraft> = {}
  for (const line of lines) {
    drafts[line.id] = {
      counted_volume_ml: line.counted_volume_ml,
      counted_qty_units: line.counted_qty_units,
      method: line.method,
      difference_reason: line.difference_reason ?? '',
      photoName: null,
    }
  }
  return drafts
}

function capacityErrors(lines: CountLine[], drafts: Record<string, LineDraft>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const line of lines) {
    const draft = drafts[line.id]
    if (!draft || isPackaged(line.product_state)) continue
    if (draft.counted_volume_ml != null && line.vessel_capacity_ml != null && draft.counted_volume_ml > line.vessel_capacity_ml) {
      errors[line.id] = fill(copy.stock.capacity, { litres: formatMl(line.vessel_capacity_ml) })
    }
  }
  return errors
}

function missingCounts(lines: CountLine[], drafts: Record<string, LineDraft>): boolean {
  return lines.some((line) => {
    const draft = drafts[line.id]
    if (!draft) return true
    return isPackaged(line.product_state) ? draft.counted_qty_units == null : draft.counted_volume_ml == null
  })
}

function missingReasons(lines: CountLine[], drafts: Record<string, LineDraft>): string[] {
  return lines.flatMap((line) => {
    const draft = drafts[line.id]
    if (!draft) return []
    const gap = lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units })
    if (gap == null || gap === 0 || draft.difference_reason.trim()) return []
    return [line.vessel_code ?? line.lot_code ?? 'una línea']
  })
}

function toInputs(lines: CountLine[], drafts: Record<string, LineDraft>): CountLineInput[] {
  return lines.map((line) => {
    const draft = drafts[line.id]
    const packaged = isPackaged(line.product_state)
    const units = draft?.counted_qty_units ?? null
    const volume = packaged ? (units == null || line.nominal_volume_ml == null ? null : units * line.nominal_volume_ml) : (draft?.counted_volume_ml ?? null)
    return {
      id: line.id,
      location_id: line.location_id,
      vessel_id: line.vessel_id,
      owner_entity_id: line.owner_entity_id,
      lot_id: line.lot_id,
      product_id: line.product_id,
      product_state: line.product_state,
      counted_qty_units: packaged ? units : volume == null ? null : 0,
      counted_volume_ml: volume,
      method: draft?.method ?? null,
      difference_reason: draft?.difference_reason.trim() ? draft.difference_reason.trim() : null,
    }
  })
}

function diffSummary(lines: CountLine[]): string[] {
  return lines.flatMap((line) => {
    const gap = lineGap(line)
    if (gap == null || gap === 0) return []
    const amount = isPackaged(line.product_state) ? `${formatSignedUnits(gap)} ud` : formatSignedMl(gap)
    return [`${line.vessel_code ?? line.lot_code ?? 'Línea'} ${amount}`]
  })
}

function screenOf(count: InventoryCount): string {
  const lines = count.lines ?? []
  const diffs = lines.some((line) => {
    const gap = lineGap(line)
    return gap != null && gap !== 0
  })
  if (count.kind === 'opening') return 'aforo-arranque'
  if (count.approval_request_id && count.status !== 'posted' && count.status !== 'approved') return 'aforo-aprobacion'
  if (diffs) return 'aforo-diferencias'
  return 'aforo'
}

export function CountPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const { entities } = useEntity()
  const { catalog } = useCatalog(entities)
  const remote = useApi<unknown>(id ? `/v1/inventory-counts/${id}` : null)
  const [override, setOverride] = useState<unknown>(null)
  const data = useMemo(() => {
    const raw = override ?? remote.data ?? (id ? cachedCount(id) : null)
    return raw ? toCount(raw, catalog) : null
  }, [catalog, id, override, remote.data])
  useChromeTitle(data?.number || copy.stock.counts)

  if (!allows(me, 'inventory.read')) return <NoPermission />

  if (!data && remote.loading) {
    return (
      <div data-screen="aforo-cargando" aria-busy="true" className="grid gap-3 p-6">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div data-screen="aforo-error" className="p-6">
        <ErrorState title={`${copy.error.load} (${remote.error?.code ?? 'WC_ERROR'})`} detail={remote.error?.message} onRetry={remote.reload} />
      </div>
    )
  }

  return <Loaded me={me} count={data} catalog={catalog} onCount={setOverride} reload={remote.reload} />
}

function Loaded({
  me,
  count,
  catalog,
  onCount,
  reload,
}: {
  me: Me
  count: InventoryCount
  catalog: Catalog
  onCount: (value: unknown) => void
  reload: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<TabId>('recuento')
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [syncPending, setSyncPending] = useState(false)
  const [scan, setScan] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'close' | 'post' | null>(null)
  const canCount = allows(me, 'inventory.count')
  const lines = useMemo(() => count.lines ?? [], [count.lines])

  const lineSignature = lines.map((line) => `${line.id}:${line.counted_volume_ml}:${line.counted_qty_units}:${line.method ?? ''}`).join('|')

  useEffect(() => {
    const pending = readPending<Record<string, LineDraft>>(count.id)
    if (pending) {
      setSyncPending(true)
      setDrafts(pending)
      return
    }
    setSyncPending(false)
    setDrafts(draftsFrom(lines))
    // The signature is the counted values, so a catalog refresh does not wipe the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count.id, lineSignature])

  useEffect(() => {
    const needle = scan.trim().toLocaleLowerCase('es')
    if (!needle || lines.length === 0) return
    const line = lines.find((item) => `${item.vessel_code ?? ''} ${item.qr_token ?? ''} ${item.lot_code ?? ''}`.toLocaleLowerCase('es').includes(needle))
    if (!line) return
    const nodes = document.querySelectorAll(`[data-line="${line.id}"]`)
    const visible = [...nodes].find((node) => node instanceof HTMLElement && node.offsetParent !== null)
    visible?.scrollIntoView({ block: 'center' })
  }, [lines, scan])

  const errors = useMemo(() => capacityErrors(lines, drafts), [drafts, lines])
  const pendingApproval = Boolean(count.approval_request_id && count.status !== 'posted' && count.status !== 'approved')
  const volumesEditable = Boolean(canCount && (count.status === 'draft' || count.status === 'counting') && !pendingApproval)
  const reasonsEditable = Boolean(canCount && (count.status === 'draft' || count.status === 'counting' || count.status === 'review') && !pendingApproval)
  const diffs = diffSummary(lines)

  function patchDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } as LineDraft }))
  }

  function keep(raw: unknown) {
    rememberCount(toCount(raw, catalog))
    onCount(raw)
    reload()
  }

  async function persist() {
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    setActionError(null)
    try {
      const saved = await saveCountLines(count.id, toInputs(lines, drafts))
      clearPending(count.id)
      setSyncPending(false)
      toast(copy.stock.saved)
      keep(saved)
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
      if (apiError.status === 0 || apiError.code === 'WC_NETWORK') {
        writePending(count.id, drafts)
        setSyncPending(true)
        toast(copy.stock.offline)
      } else {
        setActionError(explainStockError(apiError))
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmClose() {
    setDialog(null)
    if (missingCounts(lines, drafts)) {
      setActionError(copy.stock.missingCounts)
      return
    }
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    setActionError(null)
    try {
      await saveCountLines(count.id, toInputs(lines, drafts))
      const closed = await closeCount(count.id)
      clearPending(count.id)
      setSyncPending(false)
      toast(copy.stock.closedToast)
      keep(closed)
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
      setActionError(explainStockError(apiError))
    } finally {
      setBusy(false)
    }
  }

  async function confirmPost() {
    setDialog(null)
    const reasons = missingReasons(lines, drafts)
    if (reasons.length > 0) {
      setActionError(fill(copy.stock.missingReason, { where: reasons.join(', ') }))
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      if (reasonsEditable) await saveCountLines(count.id, toInputs(lines, drafts))
      const posted = await requestCountPosting(count.id, crypto.randomUUID())
      toast(copy.stock.requestSent)
      keep(posted)
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
      setActionError(explainStockError(apiError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-screen={screenOf(count)} data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.stock.counts} onClick={() => navigate('/stock/aforos')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="hidden min-w-0 truncate text-label text-text-tertiary sm:inline">{copy.stock.counts}</span>
        <span className="min-w-0 truncate text-label font-medium text-ink-900">{count.number ?? 'Aforo'}</span>
        {canCount ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {volumesEditable || (reasonsEditable && count.status === 'review') ? (
              <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void persist()}>
                {copy.stock.save}
              </Button>
            ) : null}
            {volumesEditable ? (
              <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => setDialog('close')}>
                {copy.stock.closeCount}
              </Button>
            ) : null}
            {reasonsEditable && count.status === 'review' && !count.approval_request_id ? (
              <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => setDialog('post')}>
                {copy.stock.requestPost}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-3 py-4 sm:px-4">
          <header>
            <h1 className="text-body font-medium text-ink-900">{count.number ?? 'Aforo sin número'}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {countKindLabel(count.kind)} · {formatDateTime(count.counted_at)} · {ownerLabel(count.legal_entity_code)}
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={pendingApproval ? 'warning' : countStatusTone(count.status)} size="sm">
              {pendingApproval ? copy.stock.pendingApproval : countStatusLabel(count.status)}
            </Badge>
            {count.location_codes.map((code) => (
              <Badge key={code} tone="neutral" size="sm">
                {code}
              </Badge>
            ))}
          </div>
          <div role="tablist" aria-label="Secciones" className="scrollbar-none -mx-3 flex gap-1 overflow-x-auto border-b border-border-subtle px-3">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn('h-8 shrink-0 border-b-2 px-2 text-label', tab === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary')}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {count.kind === 'opening' ? <Alert tone="info">{copy.stock.openingNotice}</Alert> : null}
          {pendingApproval && count.approval_request_id ? (
            <Alert tone="warning">
              <p>{copy.stock.pendingApprovalHint}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => navigate(`/aprobaciones/${count.approval_request_id}`)}>
                {copy.stock.seeRequest}
              </Button>
            </Alert>
          ) : null}
          {syncPending ? (
            <Alert tone="warning">
              <p className="font-medium">{copy.stock.pendingSync}</p>
              <p>{copy.stock.pendingSyncHint}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-2" loading={busy} onClick={() => void persist()}>
                {copy.stock.retry}
              </Button>
            </Alert>
          ) : null}
          {actionError ? <ErrorState title={actionError} framed /> : null}
          {tab === 'recuento' ? (
            <>
              <QrScanField value={scan} onChange={setScan} />
              <CountSheet lines={lines} drafts={drafts} errors={errors} scan={scan} volumesEditable={volumesEditable} reasonsEditable={reasonsEditable} onDraft={patchDraft} />
              <p className="text-caption text-text-tertiary">{copy.stock.gapHint}</p>
            </>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">Resumen</h2>
              <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2">
                <dt className="text-caption text-text-tertiary">Diferencias</dt>
                <dd className="text-label text-ink-900">{diffs.length > 0 ? diffs.join(' · ') : '—'}</dd>
              </div>
              <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2">
                <dt className="text-caption text-text-tertiary">Firma</dt>
                <dd className="text-label text-ink-900">
                  {count.signed_at
                    ? fill(copy.stock.signed, { name: count.signed_by_name ?? 'quien contó', when: formatDateTime(count.signed_at) })
                    : canCount && volumesEditable
                      ? fill(copy.stock.signHint, { name: me.display_name })
                      : '—'}
                </dd>
              </div>
              <div className="grid gap-0.5 px-4 py-2">
                <dt className="text-caption text-text-tertiary">{copy.stock.notes}</dt>
                <dd className="text-label text-ink-900">{count.notes || '—'}</dd>
              </div>
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={dialog === 'close'}
        title={copy.stock.closeTitle}
        body={fill(copy.stock.closeBody, { name: me.display_name })}
        confirmLabel={copy.stock.closeCount}
        busy={busy}
        onConfirm={() => void confirmClose()}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'post'}
        title={copy.stock.postTitle}
        body={copy.stock.postBody}
        confirmLabel={copy.stock.askApproval}
        busy={busy}
        onConfirm={() => void confirmPost()}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

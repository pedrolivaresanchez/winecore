import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { Alert, Badge, Button, InfoTip, useToast } from '@/ui'
import { ArrowLeft } from '@/ui/icons'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import {
  accountsPath,
  downloadRemittance,
  generateRemittance,
  markRemittanceSubmitted,
  receivablesPath,
  requestRemittanceApproval,
  type BankAccount,
  type Receivables,
  type Remittance,
} from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { entityCode, entityLabel, kindLabel, moneyOf, statusLabel } from '@/pages/cobros/money'

const TABS = [
  { id: 'resumen', label: copy.cobros.summary },
  { id: 'documentos', label: copy.cobros.documents },
] as const

type TabId = (typeof TABS)[number]['id']

export function RemesaPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const remittance = useApi<Remittance>(id ? `/v1/remittances/${id}` : null)
  useChromeTitle(remittance.data ? kindLabel(remittance.data.kind) : copy.cobros.remittance)
  if (!allows(me, 'finance.read')) return <NoPermission />
  if (remittance.loading && !remittance.data) {
    return <div aria-busy="true" className="p-6 text-label text-text-tertiary">{copy.loading}</div>
  }
  if (remittance.error || !remittance.data) {
    return (
      <div className="p-6">
        <ErrorState title={remittance.error?.message ?? copy.error.load} onRetry={remittance.reload} />
      </div>
    )
  }
  return <Loaded me={me} remittance={remittance.data} onReload={remittance.reload} />
}

function Loaded({ me, remittance, onReload }: { me: Me; remittance: Remittance; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<TabId>('resumen')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const canManage = allows(me, 'finance.manage')
  const code = entityCode(remittance.legal_entity_id, me.entities)
  const accounts = useApi<{ items: BankAccount[] }>(accountsPath(code))
  const docs = useApi<Receivables>(tab === 'documentos' ? receivablesPath(code, null) : null)
  const account = accounts.data?.items.find((item) => item.id === remittance.bank_account_id)
  const tone = remittance.status === 'pending_approval' ? 'warning' : remittance.status === 'file_generated' ? 'info' : remittance.status === 'uploaded_by_user' ? 'success' : 'neutral'

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      toast(done, { tone: 'success' })
      onReload()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-screen="cobros-remesa" data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.cobros.back} onClick={() => navigate('/cobros?vista=remesas')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">{copy.cobros.back}</span>
        {canManage ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {remittance.status === 'draft' ? (
              <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void run(() => requestRemittanceApproval(remittance.id), copy.cobros.approvalToast)}>
                {copy.cobros.requestApproval}
              </Button>
            ) : null}
            {remittance.status === 'pending_approval' ? (
              <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void run(() => generateRemittance(remittance.id), copy.cobros.fileToast)}>
                {copy.cobros.generateFile}
              </Button>
            ) : null}
            {remittance.file_attachment_id ? (
              <Button type="button" variant={remittance.status === 'uploaded_by_user' ? 'primary' : 'secondary'} size="sm" onClick={() => void downloadRemittance(remittance.id).catch((err: unknown) => setError(err instanceof ApiError ? err.message : copy.api.generic))}>
                {copy.cobros.downloadFile}
              </Button>
            ) : null}
            {remittance.status === 'file_generated' ? (
              <Button type="button" variant="primary" size="sm" onClick={() => setConfirm(true)}>
                {copy.cobros.markSubmitted}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="flex items-center gap-1.5 text-body font-medium text-ink-900">
              {kindLabel(remittance.kind)}
              <InfoTip label={copy.cobros.remittance}>{copy.cobros.bankNote}</InfoTip>
            </h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {remittance.execution_date ? formatDate(remittance.execution_date) : '—'} · {moneyOf(remittance.total)}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={tone}>{statusLabel(remittance.status)}</Badge>
            <Badge tone="neutral">{entityLabel(remittance.legal_entity_id, me.entities)}</Badge>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div role="tablist" aria-label={copy.cobros.remittance} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
                  tab === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === 'resumen' ? (
            <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <Fact label={copy.cobros.kind} value={kindLabel(remittance.kind)} />
              <Fact label={copy.cobros.executionDate} value={remittance.execution_date ? formatDate(remittance.execution_date) : '—'} />
              <Fact label={copy.cobros.account} value={account ? `${account.bank_name} ···· ${account.iban_last4}` : '—'} />
              <Fact label={copy.cobros.total} value={moneyOf(remittance.total)} />
              <Fact label={copy.cobros.documents} value={String(remittance.items.length)} />
              {remittance.file_sha256 ? <Fact label={copy.cobros.fingerprint} value={remittance.file_sha256} mono /> : null}
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.cobros.documents}</h2>
              {remittance.items.map((item) => {
                const doc = (docs.data?.groups ?? []).flatMap((group) => group.items.map((row) => ({ ...row, customer: group.customer_name }))).find((row) => row.target_id === item.target_id)
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-label text-ink-900">{doc?.document_number ?? item.end_to_end_id}</p>
                      <p className="truncate text-caption text-text-tertiary">
                        {doc?.customer ?? item.counterparty_id.slice(0, 8)}
                        {item.mandate_ref ? ` · ${item.mandate_ref}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-label">{moneyOf(item.amount)}</span>
                  </div>
                )
              })}
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title={copy.cobros.submittedTitle}
        body={copy.cobros.submittedBody}
        confirmLabel={copy.cobros.markSubmitted}
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void run(() => markRemittanceSubmitted(remittance.id), copy.cobros.submittedToast)
        }}
      />
    </div>
  )
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className={cn('text-label break-all text-ink-900', mono && 'font-mono text-caption')}>{value}</dd>
    </div>
  )
}

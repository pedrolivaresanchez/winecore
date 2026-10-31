import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
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
import { FileText, MoreVertical, Search } from '@/ui/icons'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import {
  accountsPath,
  confirmLine,
  ignoreLine,
  receivablesPath,
  uploadStatement,
  type BankAccount,
  type Receivables,
  type StatementFormat,
  type StatementLine,
  type StatementSuggestions,
  type TargetTable,
} from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { CuentasDialog } from '@/pages/cobros/CuentasDialog'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { centsOf, moneyOf, scoreLabel, statusLabel, textFromCents } from '@/pages/cobros/money'

const EXTRACT_KEY = 'winecore.cobros.extracto'

export function Conciliacion({ me }: { me: Me }) {
  const { entityCode } = useEntity()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const vista = vistaOf(params.get('vista'))
  const fileRef = useRef<HTMLInputElement>(null)
  const accounts = useApi<{ items: BankAccount[] }>(accountsPath(entityCode))
  const [accountId, setAccountId] = useState('')
  const [importId, setImportId] = useState<string | null>(() => params.get('extracto') || readStored())
  const [q, setQ] = useState('')
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [ignore, setIgnore] = useState<StatementLine | null>(null)
  const [pick, setPick] = useState<StatementLine | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const canWrite = allows(me, 'finance.write')
  const suggestions = useApi<StatementSuggestions>(importId ? `/v1/bank-statements/${importId}/suggestions` : null)
  const openDocs = useApi<Receivables>(receivablesPath(entityCode, null))
  const list = useMemo(() => accounts.data?.items ?? [], [accounts.data])

  useEffect(() => {
    if (accountId && list.some((account) => account.id === accountId)) return
    const preferred = list.find((account) => account.is_default) ?? list[0]
    if (preferred) setAccountId(preferred.id)
  }, [accountId, list])

  useEffect(() => {
    const fromUrl = params.get('extracto')
    if (fromUrl && fromUrl !== importId) setImportId(fromUrl)
  }, [importId, params])

  const lines = suggestions.data?.lines ?? []
  const query = q.trim().toLocaleLowerCase('es')
  const shown = lines.filter((line) => {
    if (!query) return true
    return `${line.description} ${line.reference ?? ''} ${line.counterparty_name ?? ''}`.toLocaleLowerCase('es').includes(query)
  })
  const matched = lines.filter((line) => line.status === 'matched').length
  const proposed = lines.filter((line) => line.status === 'suggested').length
  const screen = lines.length === 0 ? 'cobros-conciliacion-vacio' : 'cobros-conciliacion'

  function remember(id: string) {
    setImportId(id)
    try {
      sessionStorage.setItem(EXTRACT_KEY, id)
    } catch {
      /* La sesión puede estar bloqueada. La cola sigue en esta visita. */
    }
    const next = new URLSearchParams(params)
    next.set('vista', 'conciliacion')
    next.set('extracto', id)
    setParams(next, { replace: true })
  }

  async function send(file: File) {
    if (!canWrite) return
    if (!accountId) {
      setError(copy.cobros.pickAccount)
      if (list.length === 0) setAccountsOpen(true)
      return
    }
    setError(null)
    setUploading(true)
    try {
      const format: StatementFormat = /\.xml$/i.test(file.name) ? 'camt053' : 'n43'
      const imported = await uploadStatement({
        bank_account_id: accountId,
        format,
        filename: file.name.slice(0, 80) || (format === 'n43' ? 'extracto.n43' : 'extracto.xml'),
        content_base64: await encodeFile(file),
      })
      remember(imported.id)
      toast(copy.cobros.imported, { tone: 'success' })
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setUploading(false)
      setOver(false)
    }
  }

  async function confirm(line: StatementLine, targetTable: TargetTable, targetId: string, outstanding: string | null) {
    if (!importId) return
    const lineCents = Math.abs(centsOf(line.amount))
    const cap = outstanding == null ? lineCents : Math.min(lineCents, centsOf(outstanding))
    if (cap <= 0) {
      setError(copy.cobros.overOutstanding)
      return
    }
    setBusyId(line.id)
    setError(null)
    try {
      await confirmLine(importId, line.id, { target_table: targetTable, target_id: targetId, amount: textFromCents(cap) })
      toast(copy.cobros.confirmed, { tone: 'success' })
      setPick(null)
      suggestions.reload()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canWrite ? { label: copy.cobros.import, onClick: () => fileRef.current?.click() } : null}
      secondary={{ label: copy.cobros.accounts, onClick: () => setAccountsOpen(true) }}
      toolbar={
        <>
          <Input
            id="buscar-extracto"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.cobros.searchLines}
            aria-label={copy.cobros.searchLines}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <Select
            id="cuenta-extracto"
            size="sm"
            aria-label={copy.cobros.account}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {list.length === 0 ? <option value="">{copy.cobros.noAccounts}</option> : null}
            {list.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bank_name} · {account.iban_last4}
              </option>
            ))}
          </Select>
          <input
            ref={fileRef}
            type="file"
            accept=".n43,.txt,.xml,text/plain,application/xml"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void send(file)
            }}
          />
        </>
      }
    >
      <div
        className={cn('flex min-h-0 flex-1 flex-col', over && 'bg-surface-subtle')}
        onDragOver={(event) => {
          event.preventDefault()
          if (canWrite) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) void send(file)
          else setOver(false)
        }}
      >
        {error ? <div className="px-3 pt-3 sm:px-4"><Alert tone="danger">{error}</Alert></div> : null}
        {lines.length > 0 ? (
          <p className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-caption text-text-tertiary sm:px-4">
            <span>{fill(copy.cobros.lines, { count: String(lines.length) })}</span>
            <span>{fill(copy.cobros.matchedCount, { count: String(matched) })}</span>
            <span>{fill(copy.cobros.suggestedCount, { count: String(proposed) })}</span>
          </p>
        ) : null}
        {suggestions.error ? (
          <div className="p-4">
            <ErrorState title={suggestions.error.message} onRetry={suggestions.reload} />
          </div>
        ) : null}
        {over ? (
          <div className="flex flex-1 items-center justify-center text-label text-text-secondary">{copy.cobros.drop}</div>
        ) : shown.length === 0 && !suggestions.loading ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              size="sm"
              title={query ? copy.cobros.noMatch : copy.cobros.statementEmpty}
              description={query ? undefined : copy.cobros.statementEmptyHint}
              action={
                canWrite && !query ? (
                  <Button type="button" variant="primary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                    {copy.cobros.chooseFile}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                busy={busyId === line.id}
                canWrite={canWrite}
                onConfirm={(target, id) => void confirm(line, target, id, outstandingOf(openDocs.data, id))}
                onIgnore={() => setIgnore(line)}
                onPick={() => setPick(line)}
              />
            ))}
          </ul>
        )}
      </div>
      <CuentasDialog me={me} open={accountsOpen} onClose={() => setAccountsOpen(false)} onCreated={() => accounts.reload()} />
      <IgnoreDialog
        line={ignore}
        busy={Boolean(ignore && busyId === ignore.id)}
        onClose={() => setIgnore(null)}
        onIgnore={async (reason) => {
          if (!importId || !ignore) return
          setBusyId(ignore.id)
          try {
            await ignoreLine(importId, ignore.id, reason)
            toast(copy.cobros.ignored, { tone: 'success' })
            setIgnore(null)
            suggestions.reload()
          } catch (err: unknown) {
            setError(err instanceof ApiError ? err.message : copy.api.generic)
          } finally {
            setBusyId(null)
          }
        }}
      />
      <PickDialog
        line={pick}
        entity={entityCode}
        busy={Boolean(pick && busyId === pick.id)}
        onClose={() => setPick(null)}
        onPick={(target, id, outstanding) => {
          if (pick) void confirm(pick, target, id, outstanding)
        }}
      />
    </CobrosFrame>
  )
}

function LineRow({
  line,
  busy,
  canWrite,
  onConfirm,
  onIgnore,
  onPick,
}: {
  line: StatementLine
  busy: boolean
  canWrite: boolean
  onConfirm: (table: TargetTable, id: string) => void
  onIgnore: () => void
  onPick: () => void
}) {
  const more = useMenuOpen()
  const top = line.suggestions[0]
  const closed = line.status === 'matched' || line.status === 'ignored'
  const tone = line.status === 'matched' ? 'success' : line.status === 'suggested' ? 'info' : 'neutral'
  return (
    <li className="flex flex-col gap-2 border-b border-border-subtle px-3 py-3 sm:flex-row sm:items-center sm:px-4">
      <FileText className="hidden size-4 shrink-0 text-icon sm:block" strokeWidth={iconStroke} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-medium text-ink-900">{line.description}</p>
        <p className="truncate text-caption text-text-tertiary">
          {line.booking_date ? formatDate(line.booking_date) : '—'}
          {line.counterparty_name ? ` · ${line.counterparty_name}` : ''}
          {line.reference ? ` · ${line.reference}` : ''}
        </p>
        {top && !closed ? (
          <p className="mt-1 truncate text-caption text-text-secondary">
            {top.document_number} · {scoreLabel(top.score)} · {top.reason}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 tabular-nums text-label text-ink-900">{moneyOf(line.amount)}</span>
        <Badge size="sm" tone={tone}>{statusLabel(line.status)}</Badge>
        {canWrite && !closed && top ? (
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => onConfirm(top.target_table, top.target_id)}>
            {copy.cobros.confirm}
          </Button>
        ) : null}
        {canWrite && !closed ? (
          <Button type="button" variant="secondary" size="sm" onClick={onPick}>
            {copy.cobros.otherDocument}
          </Button>
        ) : null}
        {canWrite && !closed ? (
          <GlassMenu
            open={more.open}
            onOpenChange={more.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.cobros.ignore} onClick={more.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              onClick={() => {
                more.close()
                onIgnore()
              }}
            >
              {copy.cobros.ignore}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </div>
    </li>
  )
}

function IgnoreDialog({
  line,
  busy,
  onClose,
  onIgnore,
}: {
  line: StatementLine | null
  busy: boolean
  onClose: () => void
  onIgnore: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (line) setReason('')
  }, [line])
  return (
    <Dialog open={Boolean(line)} onClose={onClose} labelledBy="ignorar-title" size="sm">
      <DialogHeader titleId="ignorar-title" title={copy.cobros.ignoreTitle} onClose={onClose} />
      <DialogBody>
        <Textarea aria-label={copy.cobros.reason} value={reason} rows={3} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        <p className="mt-2 text-caption text-text-tertiary">{copy.cobros.reasonHint}</p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.cobros.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => {
            if (reason.trim().length >= 3) void onIgnore(reason.trim())
          }}
        >
          {copy.cobros.ignore}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function PickDialog({
  line,
  entity,
  busy,
  onClose,
  onPick,
}: {
  line: StatementLine | null
  entity: string | null
  busy: boolean
  onClose: () => void
  onPick: (table: TargetTable, id: string, outstanding: string) => void
}) {
  const incoming = line ? !line.amount.trim().startsWith('-') : true
  const data = useApi<Receivables>(line ? receivablesPath(entity, null) : null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (line) setQ('')
  }, [line])
  const documents = useMemo(() => {
    const items = (data.data?.groups ?? []).flatMap((group) => group.items.map((item) => ({ ...item, customer: group.customer_name })))
    const wanted = incoming ? items.filter((item) => item.target_table !== 'purchasing.supplier_invoice') : []
    const term = q.trim().toLocaleLowerCase('es')
    return wanted.filter((item) => !term || `${item.document_number} ${item.customer}`.toLocaleLowerCase('es').includes(term))
  }, [data.data, incoming, q])
  const suggestedIds = new Set((line?.suggestions ?? []).map((item) => item.target_id))
  return (
    <Dialog open={Boolean(line)} onClose={onClose} labelledBy="elegir-title" size="md">
      <DialogHeader titleId="elegir-title" title={copy.cobros.pickDocument} onClose={onClose} />
      <DialogBody>
        <div data-screen="cobros-elegir" className="grid gap-3 pb-2">
          {!incoming ? <p className="text-label text-text-secondary">{copy.cobros.noPayables}</p> : null}
          <Input size="sm" value={q} aria-label={copy.cobros.searchCustomers} placeholder={copy.cobros.searchCustomers} onChange={(event) => setQ(event.target.value)} />
          <ul className="divide-y divide-border-subtle">
            {documents.map((item) => (
              <li key={item.target_id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left outline-none hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
                  onClick={() => onPick(item.target_table, item.target_id, item.outstanding)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label text-ink-900">
                      {item.document_number}
                      {suggestedIds.has(item.target_id) ? ` · ${copy.cobros.suggested}` : ''}
                    </span>
                    <span className="block truncate text-caption text-text-tertiary">{item.customer}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-label">{moneyOf(item.outstanding)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function readStored(): string | null {
  try {
    return sessionStorage.getItem(EXTRACT_KEY)
  } catch {
    return null
  }
}

function outstandingOf(data: Receivables | null, targetId: string): string | null {
  for (const group of data?.groups ?? []) {
    const item = group.items.find((row) => row.target_id === targetId)
    if (item) return item.outstanding
  }
  return null
}

async function encodeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const size = 0x8000
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size))
  }
  return btoa(binary)
}

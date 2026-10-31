import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError, api, apiBlob } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { DownloadSimple, FileText } from '@/ui/icons'
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InfoTip,
  Input,
  SegmentedControl,
  Select,
  Table,
  useToast,
  type TableColumn,
} from '@/ui'
import { ListFrame } from '@/pages/regulatorio/frame'
import { canPrepare, madridToday, statusMeta } from '@/pages/regulatorio/model'

const MODELS = ['303', '390', '347', '349', '115', '130'] as const
type Model = (typeof MODELS)[number]
type Vista = 'libros' | 'borrador'
type BookName = 'issued' | 'received'

interface BookPayload {
  columns: string[]
  rows: { id: string; cells: string[] }[]
  checks: { name: string; ok: boolean; detail: string }[]
  export_blocked: boolean
  totals: { invoices: number; base: string; quota: string; total: string }
  missing: Note[]
  notes: string[]
}

interface Note {
  code: string
  label: string
  reason: string
}

interface DraftLine {
  clave: string
  tax_id: string
  name: string
  q1: string
  q2: string
  q3: string
  q4: string
  annual: string
  rate: string | null
  document_ids: string[]
}

interface SourceDoc {
  id: string
  kind: 'issued' | 'received' | 'payment'
  number: string
  date: string
  counterparty: string
  tax_id: string
  amount: string
  boxes: string[]
}

interface DraftPayload {
  model: Model
  period: string
  applies: boolean
  result: string | null
  content_sha256: string
  boxes: { code: string; casilla: string | null; label: string; amount: string }[]
  lines: DraftLine[]
  documents: SourceDoc[]
  excluded: { id: string; number: string; reason: string }[]
  reconciliation: { name: string; label: string; book: string; draft: string; ok: boolean }[]
  missing: Note[]
  notes: string[]
}

interface SavedSubmission {
  id: string
  status: string
  model: Model
  period: string
  content_sha256: string
  external_ref: string | null
  approval_request_id: string | null
  validation_errors: { message: string }[]
}

function euros(value: string | null | undefined): string {
  if (!value) return '—'
  const negative = value.startsWith('-')
  const [whole, frac = '00'] = value.replace('-', '').split('.')
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped},${(frac + '00').slice(0, 2)} €`
}

function isModel(value: string | null): value is Model {
  return MODELS.includes(value as Model)
}

function docHref(doc: SourceDoc): string | undefined {
  if (doc.kind === 'issued') return `/facturas/${doc.id}`
  if (doc.kind === 'received') return `/gastos/${doc.id}`
  if (doc.kind === 'payment') return '/cobros'
  return undefined
}

export function ModelosPage({ me }: { me: Me }) {
  if (!allows(me, 'regulatory.read')) return <NoPermission />
  return <ModelosScreen me={me} />
}

function ModelosScreen({ me }: { me: Me }) {
  const toast = useToast()
  const { filter, entities } = useEntity()
  const [params, setParams] = useSearchParams()
  const [focus, setFocus] = useState<string | null>(null)
  const [filing, setFiling] = useState(false)
  const [receipt, setReceipt] = useState('')
  const [busy, setBusy] = useState(false)
  const prepare = canPrepare(me)
  const today = madridToday()
  const defaultYear = today.slice(0, 4)
  const defaultQuarter = String(Math.ceil(Number(today.slice(5, 7)) / 3))
  const year = /^\d{4}$/.test(params.get('ejercicio') ?? '') ? (params.get('ejercicio') as string) : defaultYear
  const quarter = ['1', '2', '3', '4'].includes(params.get('trimestre') ?? '') ? (params.get('trimestre') as string) : defaultQuarter
  const model: Model = isModel(params.get('modelo')) ? (params.get('modelo') as Model) : '303'
  const annual = model === '390' || model === '347'
  const period = annual ? year : `${year}-Q${quarter}`
  const vista: Vista = params.get('vista') === 'borrador' ? 'borrador' : 'libros'
  const book: BookName = params.get('libro') === 'received' ? 'received' : 'issued'
  const entityCode = params.get('entidad')
    || (filter !== 'all' ? filter : entities[0]?.code)
    || ''
  const entity = entities.find((item) => item.code === entityCode) ?? entities[0]

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
    setFocus(null)
  }

  const bookPath = entity ? `/v1/aeat/books?entity=${entity.code}&period=${period}&book=${book}` : null
  const draftPath = entity && vista === 'borrador' ? `/v1/aeat/drafts?entity=${entity.code}&period=${period}&model=${model}` : null
  const savedPath = entity ? `/v1/aeat/submissions?entity=${entity.code}&period=${period}&model=${model}` : null
  const books = useApi<BookPayload>(vista === 'libros' ? bookPath : null)
  const draft = useApi<DraftPayload>(draftPath)
  const saved = useApi<{ items: SavedSubmission[] }>(vista === 'borrador' ? savedPath : null)
  const submission = saved.data?.items[0] ?? null

  const documents = useMemo(() => {
    const rows = draft.data?.documents ?? []
    if (!focus) return rows
    return rows.filter((row) => row.boxes.includes(focus) || row.id === focus)
  }, [draft.data, focus])

  async function download() {
    if (!entity) return
    setBusy(true)
    try {
      const file = await apiBlob(`/v1/aeat/books.csv?entity=${entity.code}&period=${period}&book=${book}`)
      const url = URL.createObjectURL(file.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename ?? `libro-${period}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : copy.aeat.loadFail)
    } finally {
      setBusy(false)
    }
  }

  async function run(path: string, body?: unknown, ok = copy.aeat.savedOk) {
    setBusy(true)
    try {
      await api(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) })
      toast(ok, { tone: 'success' })
      draft.reload()
      saved.reload()
      setFiling(false)
      setReceipt('')
    } catch (error) {
      toast(error instanceof ApiError ? error.message : copy.aeat.loadFail)
    } finally {
      setBusy(false)
    }
  }

  const years = [String(Number(defaultYear) - 1), defaultYear, String(Number(defaultYear) + 1)]
  if (!years.includes(year)) years.unshift(year)

  return (
    <div data-screen="modelos-aeat" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ListFrame
        screen="modelos-aeat-frame"
        view="modelos"
        toolbar={
          <>
            <SegmentedControl
              size="sm"
              aria-label={copy.aeat.title}
              value={vista}
              onChange={(value) => setParam('vista', value)}
              options={[
                { value: 'libros', content: copy.aeat.books },
                { value: 'borrador', content: copy.aeat.draft },
              ]}
            />
            {vista === 'libros' ? (
              <SegmentedControl
                size="sm"
                aria-label={copy.aeat.books}
                value={book}
                onChange={(value) => setParam('libro', value)}
                options={[
                  { value: 'issued', content: copy.aeat.issued },
                  { value: 'received', content: copy.aeat.received },
                ]}
              />
            ) : (
              <Select id="aeat-modelo" size="sm" className="w-20 shrink-0" aria-label={copy.aeat.model} value={model} onChange={(event) => setParam('modelo', event.target.value)}>
                {MODELS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            )}
          </>
        }
        filters={
          <>
            <Select id="aeat-entidad" size="sm" className="w-20 shrink-0" aria-label={copy.aeat.entity} value={entity?.code ?? ''} onChange={(event) => setParam('entidad', event.target.value)}>
              {entities.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}
            </Select>
            <Select id="aeat-ejercicio" size="sm" className="w-24 shrink-0" aria-label={copy.aeat.year} value={year} onChange={(event) => setParam('ejercicio', event.target.value)}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            {annual ? null : (
              <Select id="aeat-trimestre" size="sm" className="w-16 shrink-0" aria-label={copy.aeat.quarter} value={quarter} onChange={(event) => setParam('trimestre', event.target.value)}>
                <option value="1">{copy.aeat.q1}</option>
                <option value="2">{copy.aeat.q2}</option>
                <option value="3">{copy.aeat.q3}</option>
                <option value="4">{copy.aeat.q4}</option>
              </Select>
            )}
          </>
        }
        actions={vista === 'libros' ? (
          <Button type="button" size="sm" variant="primary" loading={busy} disabled={books.data?.export_blocked} onClick={() => void download()}>
            <DownloadSimple strokeWidth={iconStroke} />
            {copy.aeat.export}
          </Button>
        ) : (
          <DraftActions
            prepare={prepare}
            busy={busy}
            submission={submission}
            onGenerate={() => void run('/v1/aeat/submissions', { legal_entity_id: entity?.id, model, period })}
            onValidate={() => submission && void run(`/v1/aeat/submissions/${submission.id}/validate`)}
            onRequest={() => submission && void run(`/v1/aeat/submissions/${submission.id}/request-approval`)}
            onFile={() => setFiling(true)}
          />
        )}
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {!entity ? <EmptyState icon={<FileText />} title={copy.aeat.entity} description={copy.aeat.emptyBooksHint} /> : null}
          {entity && vista === 'libros' ? (
            <BooksView query={books} onRetry={books.reload} />
          ) : null}
          {entity && vista === 'borrador' ? (
            <DraftView
              query={draft}
              submission={submission}
              documents={documents}
              focus={focus}
              onFocus={setFocus}
              onRetry={draft.reload}
            />
          ) : null}
        </div>
      </ListFrame>
      <Dialog open={filing} onClose={() => setFiling(false)} labelledBy="marcar-presentado" size="sm">
        <DialogHeader titleId="marcar-presentado" title={copy.aeat.markFiled} onClose={() => setFiling(false)} />
        <DialogBody>
          <p className="mb-3 text-label text-text-secondary">{copy.aeat.receiptHint}</p>
          <Input id="referencia-justificante" aria-label={copy.aeat.receipt} value={receipt} onChange={(event) => setReceipt(event.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" size="sm" variant="secondary" onClick={() => setFiling(false)}>{copy.aeat.cancel}</Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={busy}
            disabled={receipt.trim().length < 4}
            onClick={() => submission && void run(`/v1/aeat/submissions/${submission.id}/mark-filed`, { external_ref: receipt.trim() }, copy.aeat.filed)}
          >
            {copy.aeat.confirmFiled}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function DraftActions({
  prepare,
  busy,
  submission,
  onGenerate,
  onValidate,
  onRequest,
  onFile,
}: {
  prepare: boolean
  busy: boolean
  submission: SavedSubmission | null
  onGenerate: () => void
  onValidate: () => void
  onRequest: () => void
  onFile: () => void
}) {
  if (!prepare) return null
  const status = submission?.status
  return (
    <div className="flex items-center gap-1.5">
      {!status || status === 'draft' || status === 'validated' ? (
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={onGenerate}>{copy.aeat.generate}</Button>
      ) : null}
      {status === 'draft' ? (
        <Button type="button" size="sm" variant="primary" loading={busy} onClick={onValidate}>{copy.aeat.validate}</Button>
      ) : null}
      {status === 'validated' ? (
        <Button type="button" size="sm" variant="primary" loading={busy} onClick={onRequest}>{copy.aeat.request}</Button>
      ) : null}
      {status === 'pending_approval' && submission?.approval_request_id ? (
        <Link to={`/aprobaciones/${submission.approval_request_id}`} className="text-label text-ink-900 underline-offset-2 hover:underline">{copy.aeat.openApproval}</Link>
      ) : null}
      {status === 'approved' ? (
        <Button type="button" size="sm" variant="primary" onClick={onFile}>{copy.aeat.markFiled}</Button>
      ) : null}
    </div>
  )
}

function BooksView({ query, onRetry }: { query: ReturnType<typeof useApi<BookPayload>>; onRetry: () => void }) {
  if (query.loading) return <p className="px-4 py-6 text-label text-text-tertiary">{copy.loading}</p>
  if (query.error) return <ErrorState title={query.error.message} onRetry={onRetry} />
  const data = query.data
  if (!data || data.rows.length === 0) {
    return <EmptyState icon={<FileText />} title={copy.aeat.emptyBooks} description={copy.aeat.emptyBooksHint} />
  }
  const columns: TableColumn<{ id: string; cells: string[] }>[] = data.columns.map((header, index) => ({
    id: header,
    header,
    align: index >= 10 ? 'right' : 'left',
    hideOnMobile: index > 4 && index < 10,
    cell: (row) => row.cells[index] || '—',
  }))
  return (
    <div className="flex flex-col gap-3 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {data.checks.map((check) => (
          <Badge key={check.name} tone={check.ok ? 'success' : 'danger'} dot size="sm">{check.ok ? copy.aeat.ok : copy.aeat.fail}</Badge>
        ))}
        {data.export_blocked ? <span className="text-caption text-danger-600">{copy.aeat.exportBlocked}</span> : null}
        <InfoTip label={copy.aeat.checks}>{data.checks.map((check) => check.detail).join(' ')} {data.notes.join(' ')}</InfoTip>
      </div>
      <Table variant="grid" columns={columns} rows={data.rows} rowKey={(row) => row.id} />
    </div>
  )
}

function DraftView({
  query,
  submission,
  documents,
  focus,
  onFocus,
  onRetry,
}: {
  query: ReturnType<typeof useApi<DraftPayload>>
  submission: SavedSubmission | null
  documents: SourceDoc[]
  focus: string | null
  onFocus: (code: string | null) => void
  onRetry: () => void
}) {
  if (query.loading) return <p className="px-4 py-6 text-label text-text-tertiary">{copy.loading}</p>
  if (query.error) return <ErrorState title={query.error.message} onRetry={onRetry} />
  const data = query.data
  if (!data) return null
  const stale = submission && submission.content_sha256 !== data.content_sha256
  const boxColumns: TableColumn<DraftPayload['boxes'][number]>[] = [
    { id: 'casilla', header: copy.aeat.casilla, width: '4rem', clip: false, cell: (row) => row.casilla ?? '—' },
    { id: 'label', header: copy.aeat.concept, cell: (row) => row.label },
    { id: 'amount', header: copy.aeat.amount, align: 'right', width: '8rem', cell: (row) => euros(row.amount) },
  ]
  const docColumns: TableColumn<SourceDoc>[] = [
    { id: 'date', header: copy.aeat.date, width: '6.5rem', cell: (row) => row.date.split('-').reverse().join('/') },
    { id: 'number', header: copy.aeat.number, cell: (row) => {
      const href = docHref(row)
      return href ? <Link to={href} className="underline-offset-2 hover:underline">{row.number}</Link> : row.number
    } },
    { id: 'who', header: copy.aeat.counterparty, hideOnMobile: true, cell: (row) => row.counterparty || '—' },
    { id: 'amount', header: copy.aeat.amount, align: 'right', width: '8rem', cell: (row) => euros(row.amount) },
  ]
  const lineColumns: TableColumn<DraftLine>[] = [
    { id: 'clave', header: copy.aeat.clave, width: '4rem', cell: (row) => row.clave },
    { id: 'who', header: copy.aeat.counterparty, cell: (row) => row.name },
    { id: 'nif', header: 'NIF', hideOnMobile: true, cell: (row) => row.tax_id },
    { id: 'q1', header: copy.aeat.q1, align: 'right', hideOnMobile: true, cell: (row) => euros(row.q1) },
    { id: 'annual', header: copy.aeat.annual, align: 'right', cell: (row) => euros(row.annual) },
  ]
  return (
    <div className="flex flex-col gap-4 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-heading text-ink-900">{data.model}</span>
        <InfoTip label={copy.aeat.title}>{copy.aeat.help}</InfoTip>
        {submission ? <Badge tone={statusMeta(submission.status, '').tone} dot size="sm">{submission.status === 'submitted' ? copy.aeat.filed : statusMeta(submission.status, '').label}</Badge> : <Badge tone="neutral" size="sm">{copy.aeat.live}</Badge>}
        {stale ? <Badge tone="warning" size="sm">{copy.aeat.stale}</Badge> : null}
        {data.result ? <span className="ml-auto text-label text-ink-900">{copy.aeat.result} {euros(data.result)}</span> : null}
        {submission?.external_ref ? <span className="text-caption text-text-tertiary">{submission.external_ref}</span> : null}
      </div>
      {!data.applies ? <EmptyState size="sm" icon={<FileText />} title={copy.aeat.appliesNo} description={data.missing[0]?.reason} /> : null}
      {data.applies && data.boxes.length > 0 ? (
        <section>
          <h2 className="mb-2 text-label text-ink-900">{copy.aeat.boxes}</h2>
          <Table
            variant="card"
            columns={boxColumns}
            rows={data.boxes}
            rowKey={(row) => row.code}
            onRowClick={(row) => onFocus(focus === row.code ? null : row.code)}
          />
        </section>
      ) : null}
      {data.lines.length > 0 ? (
        <section>
          <h2 className="mb-2 text-label text-ink-900">{copy.aeat.parties}</h2>
          <Table variant="card" columns={lineColumns} rows={data.lines} rowKey={(row) => `${row.clave}-${row.tax_id}-${row.annual}`} onRowClick={(row) => onFocus(row.document_ids[0] ?? null)} />
        </section>
      ) : null}
      {data.missing.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-label text-ink-900">{copy.aeat.missing}</h2>
          {data.missing.map((item) => (
            <div key={item.code} className="rounded-lg border border-border-subtle px-3 py-2">
              <div className="text-label text-ink-900">{item.label}</div>
              <p className="text-caption text-text-secondary">{item.reason}</p>
            </div>
          ))}
        </section>
      ) : null}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-label text-ink-900">{copy.aeat.documents}</h2>
          {focus ? <Button type="button" size="sm" variant="ghost" onClick={() => onFocus(null)}>{copy.aeat.allDocs}</Button> : null}
        </div>
        {documents.length === 0 ? <p className="text-label text-text-tertiary">{copy.aeat.emptyDraft}</p> : (
          <Table variant="card" columns={docColumns} rows={documents} rowKey={(row) => `${row.kind}-${row.id}`} />
        )}
      </section>
      {data.reconciliation.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-label text-ink-900">{copy.aeat.reconcile}</h2>
          {data.reconciliation.map((row) => (
            <div key={row.name} className="flex items-center gap-2 text-caption text-text-secondary">
              <Badge tone={row.ok ? 'success' : 'danger'} size="sm">{row.ok ? copy.aeat.ok : copy.aeat.fail}</Badge>
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="shrink-0 tabular-nums">{euros(row.draft)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {data.excluded.length > 0 ? (
        <section>
          <h2 className="mb-1 text-label text-ink-900">{copy.aeat.excluded}</h2>
          <ul className="flex flex-col gap-1">
            {data.excluded.slice(0, 8).map((row) => (
              <li key={`${row.id}-${row.reason}`} className="truncate text-caption text-text-secondary">{row.number}: {row.reason}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

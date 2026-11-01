import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { InvoiceActions, QuoteActions } from '@/pages/documents/DocumentActions'
import { PdfActions, PdfPreview } from '@/pages/documents/PdfPreview'
import { usePdf, type PdfHandle } from '@/pages/documents/pdf'
import { earlyPdfPath, partyIdOf, useDocument, viewOf, type DocRecord, type DocSource, type DocView } from '@/pages/documents/sources'
import { ChevronLeft, ChevronRight, FileText, X } from '@/ui/icons'
import { Badge, Button, Dialog, SegmentedControl, Skeleton, SkeletonText, StatusPill, Tooltip, textureSecondary, useUiLabels } from '@/ui'

export type { DocSource } from '@/pages/documents/sources'

export type DocumentModalProps = {
  me: Me
  source: DocSource
  /** The open document; `null` closes the modal. Usually `useDocParam().id`. */
  id: string | null
  /** The documents on screen, in order — enables previous/next and the arrow keys. */
  ids?: string[]
  onNavigate?: (id: string) => void
  onClose: () => void
  /** An action in the modal changed the document, so the list behind it is stale. */
  onChanged?: () => void
}

type Pane = 'pdf' | 'details'

const RECORD_LINK = cn(
  'inline-flex h-7 items-center justify-center whitespace-nowrap rounded-[7px] px-2.5 text-label font-medium text-ink-900 max-sm:h-11 max-sm:px-3.5',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  textureSecondary,
)

/** Arrow keys belong to the field, the radio group or the PDF viewer that has them. */
function arrowsTaken(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('input, textarea, select, iframe')) return true
  return Boolean(target.closest('[role="radiogroup"], [role="tablist"], [role="listbox"], [role="menu"], [role="slider"]'))
}

/**
 * A document beside its record, as Holded shows one: the PDF fills the left, number, party,
 * dates, totals, lines and the next step sit in the column on the right. On a phone the two
 * panes take turns under a switch.
 */
export function DocumentModal({ me, source, id, ids, onNavigate, onClose, onChanged }: DocumentModalProps) {
  const [shown, setShown] = useState(id)
  if (id && id !== shown) setShown(id)
  const titleId = useId()
  return (
    <Dialog open={id != null} onClose={onClose} size="screen" labelledBy={titleId}>
      {shown ? (
        <DocumentBody
          me={me}
          source={source}
          id={shown}
          ids={ids}
          titleId={titleId}
          onNavigate={onNavigate}
          onClose={onClose}
          onChanged={onChanged}
        />
      ) : null}
    </Dialog>
  )
}

function DocumentBody({
  me,
  source,
  id,
  ids,
  titleId,
  onNavigate,
  onClose,
  onChanged,
}: Omit<DocumentModalProps, 'id'> & { id: string; titleId: string }) {
  const labels = useUiLabels()
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [pane, setPane] = useState<Pane>('pdf')
  const [bump, setBump] = useState(0)
  const doc = useDocument(source, id)
  const reload = doc.reload
  const partyId = partyIdOf(doc.record)
  const party = useApi<{ legal_name: string }>(partyId && allows(me, 'contacts.read') ? `/v1/contacts/${partyId}` : null)
  const partyName = partyId && party.data ? party.data.legal_name : null
  const view = doc.record ? viewOf(doc.record, me, partyName) : null
  const earlyPdf = earlyPdfPath(source, id)
  const pdf = usePdf(view ? view.pdfPath : earlyPdf, view?.pdfName ?? 'documento.pdf', String(bump))

  const at = ids ? ids.indexOf(id) : -1
  const previous = at > 0 ? ids?.[at - 1] : undefined
  const next = at >= 0 && ids && at < ids.length - 1 ? ids[at + 1] : undefined

  const changed = useCallback(() => {
    setBump((value) => value + 1)
    reload()
    onChanged?.()
  }, [onChanged, reload])

  useEffect(() => {
    if (!onNavigate) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const panel = rootRef.current?.closest('[role="dialog"]')
      const active = document.activeElement
      if (!panel || (active && active !== document.body && !panel.contains(active))) return
      if (arrowsTaken(event.target)) return
      const target = event.key === 'ArrowLeft' ? previous : next
      if (!target) return
      event.preventDefault()
      onNavigate(target)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [next, onNavigate, previous])

  const failed = doc.record ? null : doc.error

  return (
    <div ref={rootRef} data-screen="documento" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle pl-4 pr-2">
        <FileText className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 id={titleId} className="truncate text-label font-medium text-ink-900">
            {view?.title ?? copy.documents.title}
          </h2>
          {view ? <span className="hidden truncate text-caption text-text-tertiary sm:inline">{view.kind}</span> : null}
        </div>
        {onNavigate && ids && at >= 0 && ids.length > 1 ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="mr-1 hidden text-caption tabular-nums text-text-tertiary sm:inline">
              {fill(copy.documents.position, { at: String(at + 1), total: String(ids.length) })}
            </span>
            <Tooltip label={copy.documents.previous}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={copy.documents.previous}
                aria-keyshortcuts="ArrowLeft"
                disabled={!previous}
                onClick={() => previous && onNavigate(previous)}
              >
                <ChevronLeft strokeWidth={iconStroke} />
              </Button>
            </Tooltip>
            <Tooltip label={copy.documents.next}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={copy.documents.next}
                aria-keyshortcuts="ArrowRight"
                disabled={!next}
                onClick={() => next && onNavigate(next)}
              >
                <ChevronRight strokeWidth={iconStroke} />
              </Button>
            </Tooltip>
          </div>
        ) : null}
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={labels.close} onClick={onClose}>
          <X strokeWidth={iconStroke} />
        </Button>
      </header>

      {failed ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <ErrorState
            title={failed.status === 404 ? copy.documents.missing : `${copy.documents.loadFailed} (${failed.code})`}
            detail={failed.message}
            onRetry={reload}
          />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border-subtle px-3 py-2 lg:hidden">
            <SegmentedControl
              size="sm"
              fill
              aria-label={view?.title ?? copy.documents.title}
              value={pane}
              onChange={setPane}
              options={[
                { value: 'pdf', content: copy.documents.pdf },
                { value: 'details', content: copy.documents.details },
              ]}
            />
          </div>
          <div className="flex min-h-0 flex-1">
            <section
              aria-label={copy.documents.pdf}
              className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-surface-subtle', pane !== 'pdf' && 'max-lg:hidden')}
            >
              {view || earlyPdf ? (
                <PdfPreview
                  pdf={pdf}
                  title={copy.documents.pdf}
                  note={view?.pdfNote}
                  frameRef={frameRef}
                  className="min-h-0 flex-1"
                />
              ) : (
                <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-6">
                  <Skeleton className="aspect-[1/1.414] w-full max-w-2xl rounded-md" />
                </div>
              )}
            </section>
            <aside
              aria-label={copy.documents.details}
              className={cn(
                'min-h-0 overflow-y-auto overscroll-contain lg:w-96 lg:shrink-0 lg:border-l lg:border-border-subtle',
                pane === 'details' ? 'max-lg:flex-1' : 'max-lg:hidden',
              )}
            >
              {view && doc.record ? (
                <Details me={me} view={view} record={doc.record} pdf={pdf} frameRef={frameRef} onChanged={changed} />
              ) : (
                <DetailsSkeleton />
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function Details({
  me,
  view,
  record,
  pdf,
  frameRef,
  onChanged,
}: {
  me: Me
  view: DocView
  record: DocRecord
  pdf: PdfHandle
  frameRef: RefObject<HTMLIFrameElement | null>
  onChanged: () => void
}) {
  const location = useLocation()
  const contactLink = view.party?.contactId && allows(me, 'contacts.read') ? `/contactos/${view.party.contactId}` : null
  const recordLink = view.record && view.record !== location.pathname ? view.record : null
  return (
    <div className="grid gap-5 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {view.status ? (
          <StatusPill tone={view.status.tone} size="md">
            {view.status.label}
          </StatusPill>
        ) : null}
        <Badge tone="neutral">{view.entity}</Badge>
        <Badge tone={view.holded ? 'neutral' : 'info'} variant="dot">{view.holded ? copy.documents.holded : copy.documents.winecore}</Badge>
      </div>

      {record.source === 'invoice' ? <InvoiceActions key={record.data.id} me={me} invoice={record.data} onChanged={onChanged} /> : null}
      {record.source === 'quote' ? <QuoteActions key={record.data.id} me={me} quote={record.data} onChanged={onChanged} /> : null}

      <div className="grid gap-1.5">
        <PdfActions pdf={pdf} frameRef={frameRef} />
        {recordLink ? (
          <div>
            <Link to={recordLink} className={RECORD_LINK}>
              {copy.documents.openRecord}
            </Link>
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {view.party ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-caption text-text-tertiary">{view.party.label}</dt>
            <dd className="truncate text-label text-ink-900">
              {contactLink ? (
                <Link to={contactLink} className="font-medium underline-offset-2 hover:underline">
                  {view.party.name}
                </Link>
              ) : (
                view.party.name
              )}
            </dd>
          </div>
        ) : null}
        {view.dates.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-caption text-text-tertiary">{item.label}</dt>
            <dd className="text-label tabular-nums text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>

      {view.totals.length > 0 ? (
        <dl className="overflow-hidden rounded-xl border border-border-subtle">
          {view.totals.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-1.5 last:border-b-0">
              <dt className={cn('text-label', row.strong ? 'font-medium text-ink-900' : 'text-text-secondary')}>{row.label}</dt>
              <dd className={cn('text-label tabular-nums text-ink-900', row.strong && 'font-medium')}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-label font-medium text-ink-900">{copy.documents.lines}</h3>
        {view.lines.length > 0 ? (
          <ul className="overflow-hidden rounded-xl border border-border-subtle">
            {view.lines.map((line) => (
              <li key={line.key} className="grid gap-0.5 border-b border-border-subtle px-3 py-2 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-label text-ink-900">{line.description}</p>
                  {line.base ? <p className="shrink-0 text-label tabular-nums text-ink-900">{line.base}</p> : null}
                </div>
                <p className="text-caption tabular-nums text-text-tertiary">
                  {line.price ? `${line.quantity} × ${line.price}` : line.quantity}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-text-tertiary">{copy.documents.noLines}</p>
        )}
      </section>
    </div>
  )
}

function DetailsSkeleton() {
  return (
    <div role="status" aria-label={copy.loading} className="grid gap-5 p-4">
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-40" />
      </div>
      <SkeletonText lines={4} />
      <Skeleton className="h-28 w-full rounded-xl" />
      <SkeletonText lines={3} />
    </div>
  )
}

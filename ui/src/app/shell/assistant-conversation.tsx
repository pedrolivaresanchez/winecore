import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowUp, ArrowUpRight, Check, ChevronRight, Copy, MessageCircleOff, RefreshCw, Square } from '@/ui/icons'
import { Button, EmptyState, Tooltip } from '@/ui'
import { texturePrimary, textureSecondary } from '@/ui/button'
import { useAssistant, type ChatEntry, type LiveStep } from '@/app/shell/assistant-context'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { AssistantLink, AssistantPending, AssistantStep } from '@/lib/assistant'
import type { Me } from '@/lib/types'

type Variant = 'dock' | 'page'

type Suggestion = { text: string; prefill?: boolean }

const SUGGESTIONS_SHOWN = 4
const COMPOSER_MAX_PX = 192

/** The tool each question needs, and the permission that stands in for it before the status arrives. */
const GENERAL: { key: keyof typeof copy.assistant.suggestions; tool: string; permission: string | null; prefill?: boolean }[] = [
  { key: 'approvals', tool: 'approvals_list_pending', permission: null },
  { key: 'deliveries', tool: 'billing_invoices_pending_delivery_list', permission: 'billing.read' },
  { key: 'stock', tool: 'inventory_stock_at', permission: 'inventory.read' },
  { key: 'vessels', tool: 'cellar_vessels_list', permission: 'cellar.read' },
  { key: 'expenses', tool: 'purchasing_expenses_list', permission: 'purchasing.read' },
  { key: 'contactSearch', tool: 'contacts_search', permission: 'contacts.read', prefill: true },
  { key: 'lotTrace', tool: 'cellar_lot_get', permission: 'cellar.read', prefill: true },
]

/** What is worth asking from here, limited to what the assistant can look up for this person. */
function suggestionsFor(me: Me, tools: string[] | null, path: string): Suggestion[] {
  const can = (tool: string, permission: string | null) =>
    tools ? tools.includes(tool) : permission == null || allows(me, permission)
  const s = copy.assistant.suggestions
  const list: Suggestion[] = []
  const lot = /^\/(?:bodega\/)?lotes\/([^/]+)$/.exec(path)
  if (lot?.[1] && can('cellar_lot_get', 'cellar.read')) list.push({ text: fill(s.lot, { code: decodeURIComponent(lot[1]) }) })
  if (/^\/contactos\/(?!nuevo$)[^/]+$/.test(path) && can('contacts_get', 'contacts.read')) list.push({ text: s.contact })
  for (const entry of GENERAL) {
    if (can(entry.tool, entry.permission)) list.push({ text: s[entry.key], prefill: entry.prefill })
  }
  return list.slice(0, SUGGESTIONS_SHOWN)
}

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g

/** Bold and links only. A link that leaves WineCore is shown as its label, never followed. */
function Inline({ text, onFollow }: { text: string; onFollow?: () => void }) {
  const source = text.replace(/`/g, '')
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of source.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > cursor) parts.push(source.slice(cursor, at))
    const [whole, bold, label, href] = match
    if (bold) {
      parts.push(
        <strong key={at} className="font-medium text-ink-900">
          {bold}
        </strong>,
      )
    } else if (label && href && isInternal(href)) {
      parts.push(
        <Link
          key={at}
          to={href}
          onClick={onFollow}
          className="font-medium text-ink-900 underline decoration-border-strong underline-offset-2 hover:decoration-ink-900"
        >
          {label}
        </Link>,
      )
    } else {
      parts.push(label ?? whole)
    }
    cursor = at + whole.length
  }
  if (cursor < source.length) parts.push(source.slice(cursor))
  return <>{parts}</>
}

type Block = { kind: 'p' | 'ul' | 'ol'; lines: string[] }

function blocksOf(text: string): Block[] {
  const blocks: Block[] = []
  let joining = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      joining = false
      continue
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line)
    const numbered = bullet ? null : /^\d{1,3}[.)]\s+(.+)$/.exec(line)
    const kind: Block['kind'] = bullet ? 'ul' : numbered ? 'ol' : 'p'
    const content = (bullet ?? numbered)?.[1] ?? line.replace(/^#{1,6}\s+/, '')
    const last = joining ? blocks.at(-1) : undefined
    if (last?.kind === kind) last.lines.push(content)
    else blocks.push({ kind, lines: [content] })
    joining = true
  }
  return blocks
}

function Prose({ text, onFollow }: { text: string; onFollow?: () => void }) {
  return (
    <div className="flex flex-col gap-2 text-body text-ink-800">
      {blocksOf(text).map((block, index) => {
        if (block.kind === 'p') {
          return (
            <p key={index} className="text-pretty">
              {block.lines.map((line, at) => (
                <span key={at}>
                  {at > 0 ? <br /> : null}
                  <Inline text={line} onFollow={onFollow} />
                </span>
              ))}
            </p>
          )
        }
        const List = block.kind === 'ul' ? 'ul' : 'ol'
        return (
          <List key={index} className={cn('flex flex-col gap-1 pl-5', block.kind === 'ul' ? 'list-disc' : 'list-decimal')}>
            {block.lines.map((line, at) => (
              <li key={at} className="pl-0.5 marker:text-text-tertiary">
                <Inline text={line} onFollow={onFollow} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}

function StepChip({ title, done, ok, summary }: { title: string; done: boolean; ok: boolean; summary: string }) {
  return (
    <span
      title={done && summary ? `${title} · ${summary}` : undefined}
      className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-fill-muted px-2 text-caption text-text-secondary"
    >
      {done ? (
        ok ? (
          <Check className="size-3 shrink-0 text-success-600" strokeWidth={iconStroke} />
        ) : (
          <AlertCircle className="size-3 shrink-0 text-danger-600" strokeWidth={iconStroke} />
        )
      ) : null}
      <span className={cn(done ? 'max-w-full shrink-0 truncate' : 'truncate text-shimmer motion-reduce:animate-none')}>
        {done ? title : fill(copy.assistant.stepRunning, { title })}
      </span>
      {done && summary ? <span className="min-w-0 truncate text-text-tertiary">· {summary}</span> : null}
    </span>
  )
}

function StepRow({ steps }: { steps: (AssistantStep | LiveStep)[] }) {
  if (steps.length === 0) return null
  return (
    <div
      role="group"
      aria-label={steps.length === 1 ? copy.assistant.oneStep : fill(copy.assistant.steps, { count: String(steps.length) })}
      className="flex flex-wrap gap-1"
    >
      {steps.map((step, index) => (
        <StepChip key={index} title={step.title} done={'done' in step ? step.done : true} ok={step.ok} summary={step.summary} />
      ))}
    </div>
  )
}

function LinkRow({ links, content, onFollow }: { links: AssistantLink[]; content: string; onFollow?: () => void }) {
  const shown = links.filter((link) => isInternal(link.path) && !content.includes(`](${link.path})`))
  if (shown.length === 0) return null
  return (
    <div role="group" aria-label={copy.assistant.sources} className="flex flex-wrap gap-1">
      {shown.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          onClick={onFollow}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-fill-selected px-2 text-caption text-ink-900 hover:bg-fill-hover"
        >
          <span className="truncate">{link.label}</span>
          <ArrowUpRight className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
        </Link>
      ))}
    </div>
  )
}

function expiryTime(iso: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function PendingCard({ pending, onAnswer }: { pending: AssistantPending; onAnswer: (text: string) => void }) {
  const time = expiryTime(pending.expires_at)
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-subtle p-3">
      <p className="text-caption font-medium text-text-secondary">{copy.assistant.pending.title}</p>
      <p className="mt-1 whitespace-pre-wrap text-label text-ink-900">{pending.summary_es}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onAnswer(copy.assistant.pending.confirmMessage)}>
          {copy.assistant.pending.confirm}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onAnswer(copy.assistant.pending.cancelMessage)}>
          {copy.assistant.pending.cancel}
        </Button>
        {time ? <span className="ml-auto text-caption text-text-tertiary">{fill(copy.assistant.pending.expires, { time })}</span> : null}
      </div>
    </div>
  )
}

function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const label = copied ? copy.assistant.copied : copy.assistant.copy
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)
        }}
        className="flex size-7 items-center justify-center rounded-md text-icon-muted opacity-0 transition-opacity duration-(--duration-quick) ease-(--ease-smooth-out) group-hover:opacity-100 hover:bg-fill-hover hover:text-ink-900 focus-visible:opacity-100 focus-visible:shadow-(--shadow-focus) focus-visible:outline-none pointer-coarse:opacity-100"
      >
        {copied ? <Check className="size-3.5" strokeWidth={iconStroke} /> : <Copy className="size-3.5" strokeWidth={iconStroke} />}
      </button>
    </Tooltip>
  )
}

function Entry({
  entry,
  last,
  running,
  onAnswer,
  onRetry,
  onFollow,
}: {
  entry: ChatEntry
  last: boolean
  running: boolean
  onAnswer: (text: string) => void
  onRetry: () => void
  onFollow?: () => void
}) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end pl-10">
        <p className="min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-fill-selected px-3 py-2 text-body text-ink-900">{entry.content}</p>
      </div>
    )
  }
  if (entry.failure) {
    return (
      <div className="flex items-center gap-2 text-label text-text-secondary" role="alert">
        <AlertCircle className="size-3.5 shrink-0 text-danger-600" strokeWidth={iconStroke} />
        <span className="min-w-0 flex-1">{entry.failure}</span>
        {last && !running ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw strokeWidth={iconStroke} />
            {copy.assistant.retry}
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="group flex flex-col gap-2">
      <StepRow steps={entry.steps ?? []} />
      <Prose text={entry.content} onFollow={onFollow} />
      <LinkRow links={entry.links ?? []} content={entry.content} onFollow={onFollow} />
      {entry.pending && last && !running ? <PendingCard pending={entry.pending} onAnswer={onAnswer} /> : null}
      <div className="-mt-1 -ml-1.5 flex h-7 items-center">
        <CopyReply text={entry.content} />
      </div>
    </div>
  )
}

function Thinking({ live }: { live: LiveStep[] }) {
  const busy = live.some((step) => !step.done)
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <StepRow steps={live} />
      {busy ? null : <span className="text-label text-shimmer motion-reduce:animate-none">{copy.assistant.thinking}</span>}
    </div>
  )
}

function Welcome({ me, variant }: { me: Me; variant: Variant }) {
  const { contextPath, tools, send, setDraft, focusComposer } = useAssistant()
  const suggestions = suggestionsFor(me, tools, contextPath)
  return (
    <div className={cn('flex flex-col gap-4', variant === 'page' ? 'py-10' : 'px-4 pt-6 pb-2')}>
      <div>
        <h3 className={cn('font-medium tracking-tight text-ink-900', variant === 'page' ? 'text-heading' : 'text-body')}>{copy.assistant.emptyTitle}</h3>
        <p className="mt-1 text-label text-text-secondary">{copy.assistant.emptyLead}</p>
      </div>
      <div role="group" aria-label={copy.assistant.suggestionsLabel} className="-mx-2 flex flex-col">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.text}
            type="button"
            onClick={() => {
              if (suggestion.prefill) {
                setDraft(suggestion.text)
                focusComposer()
              } else {
                send(suggestion.text)
              }
            }}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-left text-label text-control outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
          >
            <ChevronRight className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
            <span className="min-w-0 flex-1 truncate">{suggestion.text.trim()}{suggestion.prefill ? '…' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Composer({ variant }: { variant: Variant }) {
  const { draft, setDraft, send, stop, running, focusTick } = useAssistant()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus({ preventScroll: true })
    field.setSelectionRange(field.value.length, field.value.length)
  }, [focusTick])

  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_PX)}px`
  }, [draft])

  function submit() {
    if (running || !draft.trim()) return
    send(draft)
    setDraft('')
  }

  return (
    <form
      className={cn('shrink-0', variant === 'page' ? 'pb-4' : 'px-3 pb-3')}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface py-1.5 pr-1.5 pl-4 shadow-(--shadow-composer) transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) focus-within:border-border-strong">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          maxLength={4000}
          placeholder={copy.assistant.placeholder}
          aria-label={copy.assistant.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          className="max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body text-ink-900 outline-none placeholder:text-text-tertiary"
        />
        {running ? (
          <Tooltip label={copy.assistant.stop}>
            <button
              type="button"
              onClick={stop}
              aria-label={copy.assistant.stop}
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-ink-900', textureSecondary)}
            >
              <Square className="size-3 fill-current" strokeWidth={iconStroke} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={copy.assistant.send}>
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label={copy.assistant.send}
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-45', texturePrimary)}
            >
              <ArrowUp className="size-4" strokeWidth={iconStroke} />
            </button>
          </Tooltip>
        )}
      </div>
      <p className="mt-1.5 text-center text-caption text-text-tertiary">{copy.assistant.disclaimer}</p>
    </form>
  )
}

/**
 * The conversation itself, shared by the floating dock and the full page so moving between
 * them keeps the thread, the draft and the turn in flight.
 */
export function AssistantConversation({ me, variant, onFollow }: { me: Me; variant: Variant; onFollow?: () => void }) {
  const { messages, running, live, availability, send, retry } = useAssistant()
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const list = scrollRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, live, running])

  if (availability === 'unavailable') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          size="sm"
          icon={<MessageCircleOff strokeWidth={iconStroke} />}
          title={copy.assistant.unavailableTitle}
          description={copy.assistant.unavailableLead}
        />
      </div>
    )
  }

  const empty = messages.length === 0 && !running
  const column = variant === 'page' ? 'mx-auto w-full max-w-3xl px-4' : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={cn(
          'min-h-0 flex-1 overflow-x-hidden overflow-y-auto',
          empty && 'flex flex-col',
          empty && (variant === 'page' ? 'justify-center' : 'justify-end'),
        )}
      >
        {empty ? (
          <div className={column}>
            <Welcome me={me} variant={variant} />
          </div>
        ) : (
          <div className={cn('flex flex-col gap-4 py-4', variant === 'page' ? column : 'px-4')}>
            {messages.map((entry, index) => (
              <Entry
                key={entry.id}
                entry={entry}
                last={index === messages.length - 1}
                running={running}
                onAnswer={send}
                onRetry={retry}
                onFollow={onFollow}
              />
            ))}
            {running ? <Thinking live={live} /> : null}
          </div>
        )}
      </div>
      <div className={column}>
        <Composer variant={variant} />
      </div>
    </div>
  )
}

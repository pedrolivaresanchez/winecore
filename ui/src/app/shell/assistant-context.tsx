import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import {
  ASSISTANT_UNAVAILABLE,
  assistantStatus,
  sendAssistantTurn,
  type AssistantLink,
  type AssistantPending,
  type AssistantStep,
  type ChatTurnMessage,
  type StepEvent,
} from '@/lib/assistant'
import type { Me } from '@/lib/types'

export const ASSISTANT_PATH = '/asistente'

const OPEN_EVENT = 'winecore-assistant'
const DOCK_KEY = 'winecore.assistant.dock'
const KEPT_ENTRIES = 60
/* The API's own caps (`CHAT_LIMITS`). Older turns are dropped rather than refused. */
const TURN_MESSAGES = 40
const TURN_CHARS = 40_000
const CONTENT_CHARS = 4000
const PATH_CHARS = 200

export type ChatEntry = {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps?: AssistantStep[]
  links?: AssistantLink[]
  pending?: AssistantPending
  /** The turn did not finish; this says why. */
  failure?: string
}

export type LiveStep = { id: number; tool: string; title: string; done: boolean; ok: boolean; summary: string }

export type Availability = 'unknown' | 'available' | 'unavailable'

type AssistantValue = {
  open: boolean
  openDock: () => void
  closeDock: () => void
  toggleDock: () => void
  /** Bumped on every request to open, so a composer already on screen takes the caret. */
  focusTick: number
  focusComposer: () => void
  messages: ChatEntry[]
  running: boolean
  live: LiveStep[]
  availability: Availability
  /** Tools the assistant may call for this person; `null` until the status arrives. */
  tools: string[] | null
  /** Where the person is, or where they came from when the assistant has the whole page. */
  contextPath: string
  draft: string
  setDraft: (draft: string) => void
  send: (text: string) => void
  stop: () => void
  retry: () => void
  reset: () => void
}

const AssistantContext = createContext<AssistantValue | null>(null)

type OpenRequest = 'open' | 'toggle'

/** Opens the dock from anywhere, including surfaces that sit outside the provider's reach. */
export function openAssistant() {
  window.dispatchEvent(new CustomEvent<OpenRequest>(OPEN_EVENT, { detail: 'open' }))
}

/** Cmd/Ctrl-J: the same key that opens the dock puts it away. */
export function toggleAssistant() {
  window.dispatchEvent(new CustomEvent<OpenRequest>(OPEN_EVENT, { detail: 'toggle' }))
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* Storage blocked: the conversation lives as long as the tab. */
  }
}

function isEntry(value: unknown): value is ChatEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string'
}

function readConversation(key: string): ChatEntry[] {
  const raw = readSession(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

let sequence = 0
function entryId(): string {
  sequence += 1
  return `${Date.now().toString(36)}-${sequence}`
}

/** A prepared write only travels back on the message right before the person's answer. */
function turnMessages(entries: ChatEntry[]): ChatTurnMessage[] {
  const usable = entries.filter((entry) => !entry.failure && entry.content.trim() !== '')
  const messages = usable.map((entry, index): ChatTurnMessage => {
    const content = entry.content.slice(0, CONTENT_CHARS)
    return entry.pending && index === usable.length - 2
      ? { role: entry.role, content, pending: entry.pending }
      : { role: entry.role, content }
  })
  let start = Math.max(0, messages.length - TURN_MESSAGES)
  let total = messages.slice(start).reduce((sum, message) => sum + message.content.length, 0)
  while (total > TURN_CHARS && start < messages.length - 1) {
    total -= messages[start]?.content.length ?? 0
    start += 1
  }
  return messages.slice(start)
}

function advance(steps: LiveStep[], event: StepEvent): LiveStep[] {
  if (event.status === 'running') {
    return [...steps, { id: steps.length, tool: event.tool, title: event.title, done: false, ok: true, summary: '' }]
  }
  const index = steps.findLastIndex((step) => step.tool === event.tool && !step.done)
  const finished = { tool: event.tool, title: event.title, done: true, ok: event.ok, summary: event.summary }
  if (index < 0) return [...steps, { id: steps.length, ...finished }]
  return steps.map((step, at) => (at === index ? { ...step, ...finished } : step))
}

function failureText(error: unknown, stopped: boolean): string {
  if (stopped || isAbortError(error)) return copy.assistant.failure.stopped
  if (!(error instanceof ApiError)) return copy.assistant.failure.other
  if (error.status === 429) return copy.assistant.failure.busy
  if (error.code === 'WC_NETWORK') return copy.assistant.failure.cut
  return error.fields?.messages ?? (error.message || copy.assistant.failure.other)
}

function withoutTrailingFailure(entries: ChatEntry[]): ChatEntry[] {
  return entries.at(-1)?.failure ? entries.slice(0, -1) : entries
}

export function AssistantProvider({ me, children }: { me: Me; children: ReactNode }) {
  const storageKey = `winecore.assistant.${me.email}`
  const location = useLocation()
  const from = (location.state as { from?: unknown } | null)?.from
  const contextPath = location.pathname === ASSISTANT_PATH && typeof from === 'string' ? from : location.pathname
  const [open, setOpen] = useState(() => readSession(DOCK_KEY) === 'open')
  const [focusTick, setFocusTick] = useState(0)
  const [messages, setMessages] = useState(() => readConversation(storageKey))
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<LiveStep[]>([])
  const [availability, setAvailability] = useState<Availability>('unknown')
  const [tools, setTools] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const pathRef = useRef(contextPath)
  messagesRef.current = messages
  pathRef.current = contextPath

  const shown = open || location.pathname === ASSISTANT_PATH

  useEffect(() => {
    writeSession(storageKey, messages.length > 0 ? JSON.stringify(messages.slice(-KEPT_ENTRIES)) : null)
  }, [storageKey, messages])

  useEffect(() => {
    writeSession(DOCK_KEY, open ? 'open' : null)
  }, [open])

  useEffect(() => {
    if (!shown || tools !== null) return
    const controller = new AbortController()
    assistantStatus(controller.signal)
      .then((status) => {
        setAvailability(status.available ? 'available' : 'unavailable')
        setTools(Array.isArray(status.tools) ? status.tools : [])
      })
      .catch(() => {
        /* Unknown stays unknown: the first question will say what is wrong. */
      })
    return () => controller.abort()
  }, [shown, tools])

  const openDock = useCallback(() => {
    setOpen(true)
    setFocusTick((tick) => tick + 1)
  }, [])
  const closeDock = useCallback(() => setOpen(false), [])
  const focusComposer = useCallback(() => setFocusTick((tick) => tick + 1), [])
  const toggleDock = useCallback(() => {
    if (window.location.pathname !== ASSISTANT_PATH) setOpen((current) => !current)
    setFocusTick((tick) => tick + 1)
  }, [])

  useEffect(() => {
    function onRequest(event: Event) {
      if ((event as CustomEvent<OpenRequest>).detail === 'toggle') toggleDock()
      else if (window.location.pathname === ASSISTANT_PATH) focusComposer()
      else openDock()
    }
    window.addEventListener(OPEN_EVENT, onRequest)
    return () => window.removeEventListener(OPEN_EVENT, onRequest)
  }, [openDock, toggleDock, focusComposer])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(async (entries: ChatEntry[]) => {
    const controller = new AbortController()
    controllerRef.current = controller
    setMessages(entries)
    setRunning(true)
    setLive([])
    let next: ChatEntry[] | null = null
    try {
      const reply = await sendAssistantTurn(
        { messages: turnMessages(entries), context: { path: pathRef.current.slice(0, PATH_CHARS) } },
        { signal: controller.signal, onStep: (event) => setLive((steps) => advance(steps, event)) },
      )
      setAvailability('available')
      next = [
        ...entries,
        {
          id: entryId(),
          role: 'assistant',
          content: reply.reply,
          steps: reply.steps,
          links: reply.links,
          pending: reply.pending ?? undefined,
        },
      ]
    } catch (error) {
      if (error instanceof ApiError && error.code === ASSISTANT_UNAVAILABLE) {
        setAvailability('unavailable')
        next = entries
      } else {
        next = [...entries, { id: entryId(), role: 'assistant', content: '', failure: failureText(error, controller.signal.aborted) }]
      }
    } finally {
      /* A chat started over while this turn was in flight owns the state now. */
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (next) setMessages(next)
        setRunning(false)
        setLive([])
      }
    }
  }, [])

  const send = useCallback(
    (text: string) => {
      const content = text.trim()
      if (!content || controllerRef.current) return
      void run([...withoutTrailingFailure(messagesRef.current), { id: entryId(), role: 'user', content: content.slice(0, CONTENT_CHARS) }])
    },
    [run],
  )

  const stop = useCallback(() => controllerRef.current?.abort(), [])

  const retry = useCallback(() => {
    if (controllerRef.current) return
    const entries = withoutTrailingFailure(messagesRef.current)
    if (entries.at(-1)?.role !== 'user') return
    void run(entries)
  }, [run])

  const reset = useCallback(() => {
    const controller = controllerRef.current
    controllerRef.current = null
    controller?.abort()
    setMessages([])
    setRunning(false)
    setLive([])
    setDraft('')
    setFocusTick((tick) => tick + 1)
  }, [])

  const value: AssistantValue = {
    open,
    openDock,
    closeDock,
    toggleDock,
    focusTick,
    focusComposer,
    messages,
    running,
    live,
    availability,
    tools,
    contextPath,
    draft,
    setDraft,
    send,
    stop,
    retry,
    reset,
  }
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant() {
  const value = useContext(AssistantContext)
  if (!value) throw new Error('useAssistant debe usarse dentro del shell')
  return value
}

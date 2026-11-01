import {
  Component,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import type { ChatMessage, TimbalStreamApi } from '@timbal-ai/timbal-react/chat'
import { copy } from '@/i18n'
import {
  assistantStatus,
  createAssistantFetch,
  type ApprovalView,
  type AssistantRuns,
  type AssistantToolInfo,
  type ChatEntry,
} from '@/lib/assistant'
import {
  awaitsApproval,
  deserializeConversation,
  dismissApproval,
  emptyRuns,
  projectEntries,
  serializeConversation,
  type ThreadMessage,
} from '@/lib/assistant-stream'
import type { Me } from '@/lib/types'

export type { ChatEntry } from '@/lib/assistant'

export const ASSISTANT_PATH = '/asistente'

const OPEN_EVENT = 'winecore-assistant'
const DOCK_KEY = 'winecore.assistant.dock'
const CONTENT_CHARS = 4000
const PATH_CHARS = 200

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
  /** The chat runtime could not be loaded: the next question tries again. */
  loadFailed: boolean
  /** Tools the assistant may call for this person; `null` until the status arrives. */
  tools: string[] | null
  /** Spanish title of each tool, for the chips. */
  titles: Record<string, string>
  /** Where the person is, or where they came from when the assistant has the whole page. */
  contextPath: string
  draft: string
  setDraft: (draft: string) => void
  send: (text: string) => void
  stop: () => void
  retry: () => void
  reset: () => void
  /** The write the assistant is waiting on, if the person has neither confirmed nor dropped it. */
  approval: ApprovalView | null
  confirm: () => void
  decline: () => void
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

/** The runtime's chunk is a separate request: if it fails, the person can ask again instead of facing a blank shell. */
class RuntimeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function AssistantProvider({ me, children }: { me: Me; children: ReactNode }) {
  const storageKey = `winecore.assistant.${me.email}`
  const location = useLocation()
  const from = (location.state as { from?: unknown } | null)?.from
  const contextPath = location.pathname === ASSISTANT_PATH && typeof from === 'string' ? from : location.pathname
  const [open, setOpen] = useState(() => readSession(DOCK_KEY) === 'open')
  const [focusTick, setFocusTick] = useState(0)
  const [draft, setDraft] = useState('')
  const [tools, setTools] = useState<AssistantToolInfo[] | null>(null)
  const [wanted, setWanted] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [stream, setStream] = useState<TimbalStreamApi | null>(null)
  const [ready, setReady] = useState(false)

  const restored = useMemo(() => deserializeConversation(readSession(storageKey)), [storageKey])
  const [runs, setRuns] = useState<AssistantRuns>(() => restored?.store ?? emptyRuns)

  const runsRef = useRef(runs)
  const streamRef = useRef<TimbalStreamApi | null>(null)
  const pathRef = useRef(contextPath)
  const resumeRef = useRef<{ runId: string; approvalId: string } | null>(null)
  const seedRef = useRef<readonly ThreadMessage[]>(restored?.messages ?? [])
  const readyRef = useRef(false)
  const loadedRef = useRef(false)
  const loadFailedRef = useRef(false)
  const queuedRef = useRef<((stream: TimbalStreamApi) => void) | null>(null)
  pathRef.current = contextPath
  streamRef.current = stream
  readyRef.current = ready
  loadFailedRef.current = loadFailed

  const shown = open || location.pathname === ASSISTANT_PATH

  const store = useMemo(
    () => ({
      get: () => runsRef.current,
      set: (next: AssistantRuns) => {
        runsRef.current = next
        setRuns(next)
      },
    }),
    [],
  )

  const assistantFetch = useMemo(
    () =>
      createAssistantFetch({
        runs: store,
        screen: () => ({ path: pathRef.current.slice(0, PATH_CHARS) }),
        takeResume: () => {
          const resume = resumeRef.current
          resumeRef.current = null
          return resume
        },
      }),
    [store],
  )

  const Runtime = useMemo(() => lazy(() => import('@/app/shell/assistant-runtime')), [attempt])

  const onStream = useCallback((next: TimbalStreamApi | null) => setStream(next), [])
  const onRuntimeError = useCallback(() => {
    setLoadFailed(true)
    setWanted(false)
  }, [])

  const threadMessages: readonly ThreadMessage[] = stream && ready ? stream.messages : seedRef.current
  const entries = useMemo(
    () => projectEntries(threadMessages, runs, window.location.origin, { resuming }),
    [threadMessages, runs, resuming],
  )
  const running = stream?.isRunning ?? false
  const approval = useMemo(() => {
    const last = entries.at(-1)
    return last?.role === 'assistant' && last.approval && !running ? last.approval : null
  }, [entries, running])

  const runningRef = useRef(running)
  const approvalRef = useRef(approval)
  const entriesRef = useRef(entries)
  runningRef.current = running
  approvalRef.current = approval
  entriesRef.current = entries

  /* The runtime brings the saved thread back the first time it shows up. Questions that came in
     before that wait until the restored messages are in place, or they would be sent on an empty
     history and wipe it. */
  useEffect(() => {
    if (!stream) {
      setReady(false)
      loadedRef.current = false
      return
    }
    if (!loadedRef.current) {
      loadedRef.current = true
      const seed = seedRef.current
      if (seed.length > 0) {
        stream.loadMessages(seed as ChatMessage[])
        return
      }
    }
    setReady(true)
    const next = queuedRef.current
    if (next && !stream.isRunning) {
      queuedRef.current = null
      next(stream)
    }
  }, [stream])

  useEffect(() => {
    if (!stream || !ready || running) return
    const messages = stream.messages
    writeSession(storageKey, messages.length > 0 ? serializeConversation(messages, runs) : null)
  }, [stream, ready, running, runs, storageKey])

  useEffect(() => {
    writeSession(DOCK_KEY, open ? 'open' : null)
  }, [open])

  useEffect(() => {
    if (shown) setWanted(true)
  }, [shown])

  useEffect(() => {
    if (!shown || tools !== null) return
    const controller = new AbortController()
    assistantStatus(controller.signal)
      .then((status) => setTools(Array.isArray(status.tools) ? status.tools : []))
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

  /** Runs `action` on the runtime now, or as soon as it has loaded and picked the saved thread up. */
  const whenReady = useCallback((action: (stream: TimbalStreamApi) => void) => {
    const current = streamRef.current
    if (current && readyRef.current) {
      action(current)
      return
    }
    queuedRef.current = action
    if (loadFailedRef.current) {
      setLoadFailed(false)
      setAttempt((count) => count + 1)
    }
    setWanted(true)
  }, [])

  const send = useCallback(
    (text: string) => {
      const content = text.trim().slice(0, CONTENT_CHARS)
      if (!content || runningRef.current) return
      whenReady((current) => {
        const pending = approvalRef.current
        if (pending) store.set(dismissApproval(runsRef.current, pending.runId))
        void current.send(content)
      })
    },
    [whenReady, store],
  )

  const confirm = useCallback(() => {
    const pending = approvalRef.current
    if (!pending || runningRef.current) return
    whenReady((current) => {
      if (!awaitsApproval(runsRef.current, pending.runId)) return
      resumeRef.current = { runId: pending.runId, approvalId: pending.id }
      setResuming(true)
      void current.send(copy.assistant.pending.confirmMessage).finally(() => setResuming(false))
    })
  }, [whenReady])

  const decline = useCallback(() => {
    const pending = approvalRef.current
    if (!pending || runningRef.current) return
    store.set(dismissApproval(runsRef.current, pending.runId))
    setFocusTick((tick) => tick + 1)
  }, [store])

  const stop = useCallback(() => streamRef.current?.cancel(), [])

  const retry = useCallback(() => {
    const current = streamRef.current
    const last = entriesRef.current.at(-1)
    if (!current || runningRef.current || last?.role !== 'assistant' || !last.retryable) return
    void current.reload()
  }, [])

  const reset = useCallback(() => {
    queuedRef.current = null
    resumeRef.current = null
    seedRef.current = []
    streamRef.current?.clear()
    store.set(emptyRuns)
    writeSession(storageKey, null)
    setResuming(false)
    setDraft('')
    setFocusTick((tick) => tick + 1)
  }, [store, storageKey])

  const titles = useMemo(() => Object.fromEntries((tools ?? []).map((tool) => [tool.name, tool.title])), [tools])
  const toolNames = useMemo(() => (tools ? tools.map((tool) => tool.name) : null), [tools])

  const value: AssistantValue = {
    open,
    openDock,
    closeDock,
    toggleDock,
    focusTick,
    focusComposer,
    messages: entries,
    running,
    loadFailed,
    tools: toolNames,
    titles,
    contextPath,
    draft,
    setDraft,
    send,
    stop,
    retry,
    reset,
    approval,
    confirm,
    decline,
  }

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {wanted ? (
        <RuntimeBoundary key={attempt} onError={onRuntimeError}>
          <Suspense fallback={null}>
            <Runtime fetch={assistantFetch} onStream={onStream} />
          </Suspense>
        </RuntimeBoundary>
      ) : null}
    </AssistantContext.Provider>
  )
}

export function useAssistant() {
  const value = useContext(AssistantContext)
  if (!value) throw new Error('useAssistant debe usarse dentro del shell')
  return value
}

import { useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Enlarge, MessageCircle, MessageCirclePlus, X } from '@/ui/icons'
import { Tooltip, useDismissOnEscape } from '@/ui'
import { ASSISTANT_PATH, useAssistant } from '@/app/shell/assistant-context'
import { AssistantConversation } from '@/app/shell/assistant-conversation'
import { RailRow } from '@/app/shell/rail-row'
import { railMetrics } from '@/app/shell/rail-metrics'
import { useShell } from '@/app/shell/shell-context'
import { assistantChord } from '@/app/shell/shortcuts'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { dockMotion, iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'

export function AssistantHeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-icon-muted outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus) disabled:pointer-events-none disabled:opacity-45"
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * The assistant floating over whatever screen you are on, so a question never costs the
 * page you are looking at. It stands down on `/asistente`, where the same thread has the
 * whole sheet.
 */
export function AssistantDock({ me }: { me: Me }) {
  const { open, closeDock, messages, running, reset } = useAssistant()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLElement>(null)
  const shown = open && pathname !== ASSISTANT_PATH
  const tall = messages.length > 0 || running

  /* It shares the page with the workspace, so Escape is only its own from inside the panel
     or from nowhere in particular — never from a field elsewhere on the screen. */
  useDismissOnEscape(shown, closeDock, (event) => {
    const target = event.target
    return target instanceof Node && (target === document.body || panelRef.current?.contains(target) === true)
  })

  function expand() {
    closeDock()
    navigate(ASSISTANT_PATH, { state: { from: pathname } })
  }

  return (
    <AnimatePresence>
      {shown ? (
        <motion.section
          ref={panelRef}
          key="assistant-dock"
          data-screen="assistant-dock"
          aria-label={copy.assistant.title}
          {...dockMotion(reduce)}
          style={{ zIndex: 'var(--z-chat-dock)', transformOrigin: 'bottom right' }}
          className={cn(
            'fixed right-4 bottom-4 flex w-100 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-(--shadow-float)',
            'max-md:inset-x-0 max-md:bottom-0 max-md:w-auto max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:pb-[env(safe-area-inset-bottom)]',
            tall ? 'h-[min(640px,calc(100dvh-5rem))]' : 'max-h-[calc(100dvh-5rem)]',
          )}
        >
          <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border-subtle pr-2 pl-4">
            <MessageCircle className="mr-1 size-4 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
            <h2 className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">{copy.assistant.title}</h2>
            <AssistantHeaderButton label={copy.assistant.newChat} onClick={reset} disabled={!tall}>
              <MessageCirclePlus className="size-4" strokeWidth={iconStroke} />
            </AssistantHeaderButton>
            <AssistantHeaderButton label={copy.assistant.expand} onClick={expand}>
              <Enlarge className="size-4" strokeWidth={iconStroke} />
            </AssistantHeaderButton>
            <AssistantHeaderButton label={copy.assistant.close} onClick={closeDock}>
              <X className="size-4" strokeWidth={iconStroke} />
            </AssistantHeaderButton>
          </header>
          <AssistantConversation me={me} variant="dock" />
        </motion.section>
      ) : null}
    </AnimatePresence>
  )
}

/** The rail's way in, above the account menu. */
export function AssistantLauncher({ collapsed }: { collapsed: boolean }) {
  const { toggleDock } = useAssistant()
  const { mobile, setSidebarOpen } = useShell()
  const { pathname } = useLocation()
  const active = pathname === ASSISTANT_PATH
  return (
    <div className={cn('shrink-0 pb-1', railMetrics.pad, collapsed && 'flex justify-center')}>
      <RailRow
        active={active}
        label={copy.assistant.title}
        collapsed={collapsed}
        glyph={
          <span className="flex size-5 shrink-0 items-center justify-center">
            <MessageCircle className={cn(railMetrics.icon, active ? 'text-ink-900' : 'text-icon-muted')} strokeWidth={iconStroke} />
          </span>
        }
        trailing={<kbd className="shrink-0 text-caption text-text-tertiary pointer-coarse:hidden">{assistantChord()}</kbd>}
        onNavigate={() => {
          if (mobile) setSidebarOpen(false)
          toggleDock()
        }}
      />
    </div>
  )
}

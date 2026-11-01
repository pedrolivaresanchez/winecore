import { useLocation, useNavigate } from 'react-router-dom'
import { MessageCircle, MessageCirclePlus, Reduce } from '@/ui/icons'
import { FRAME_GUTTER } from '@/ui/frame'
import { useAssistant } from '@/app/shell/assistant-context'
import { AssistantConversation } from '@/app/shell/assistant-conversation'
import { AssistantHeaderButton } from '@/app/shell/assistant-dock'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'

/** The dock's thread with the whole sheet. Collapsing goes back to where you were. */
export function AsistentePage({ me }: { me: Me }) {
  useChromeTitle(copy.assistant.title)
  const { openDock, messages, running, reset } = useAssistant()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: unknown } | null)?.from
  const back = typeof from === 'string' ? from : '/'

  function collapse() {
    openDock()
    navigate(back)
  }

  return (
    <div data-screen="assistant" className="flex min-h-0 flex-1 flex-col">
      <header className={cn('flex h-12 shrink-0 items-center gap-1 border-b border-border-subtle', FRAME_GUTTER)}>
        <MessageCircle className="mr-1 hidden size-4 shrink-0 text-icon md:block" strokeWidth={iconStroke} />
        <h1 className="hidden min-w-0 flex-1 truncate text-label font-medium text-ink-900 md:block">{copy.assistant.title}</h1>
        <span className="flex-1 md:hidden" />
        <AssistantHeaderButton label={copy.assistant.newChat} onClick={reset} disabled={messages.length === 0 && !running}>
          <MessageCirclePlus className="size-4" strokeWidth={iconStroke} />
        </AssistantHeaderButton>
        <AssistantHeaderButton label={copy.assistant.collapse} onClick={collapse}>
          <Reduce className="size-4" strokeWidth={iconStroke} />
        </AssistantHeaderButton>
      </header>
      <AssistantConversation me={me} variant="page" onFollow={openDock} />
    </div>
  )
}

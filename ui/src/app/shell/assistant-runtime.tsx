import { useEffect } from 'react'
import { useTimbalStream, type TimbalStreamApi } from '@timbal-ai/timbal-react/chat'
import { ASSISTANT_WORKFORCE } from '@/lib/assistant'

/**
 * Timbal's chat runtime, kept in a chunk of its own: it brings the whole `timbal-react` package
 * with it, which no screen but the assistant needs. It draws nothing; the provider hands the
 * state to the shell's own conversation.
 */
export default function AssistantRuntime({
  fetch,
  onStream,
}: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  onStream: (stream: TimbalStreamApi | null) => void
}) {
  const stream = useTimbalStream({ workforceId: ASSISTANT_WORKFORCE, baseUrl: '', fetch })

  useEffect(() => {
    onStream(stream)
  }, [stream, onStream])

  useEffect(() => () => onStream(null), [onStream])

  return null
}

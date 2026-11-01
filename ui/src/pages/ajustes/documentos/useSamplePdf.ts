import { useCallback, useEffect, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import type { PdfHandle } from '@/pages/documents/pdf'
import { sampleBlob, type SampleKind, type SampleLang } from './api'

type Loaded = { key: string; url: string; filename: string | null }

/** Typing waits this long before asking for a new sample, so a PDF is not drawn per keystroke. */
const DEBOUNCE_MS = 450
/** A tab opened from the preview can still be reading the blob when the sample moves on. */
const REVOKE_AFTER_MS = 60_000

/**
 * The sample PDF of an entity's template, with the form's current values and no save. `profile`
 * is the JSON the form would send, or null while the form is not in a state the API accepts.
 */
export function useSamplePdf(
  code: string,
  kind: SampleKind,
  lang: SampleLang,
  profile: string | null,
  revision: string,
): PdfHandle {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: ApiError } | null>(null)
  const key = profile === null ? '' : `${code}\0${kind}\0${lang}\0${profile}\0${revision}\0${attempt}`

  useEffect(() => {
    if (!key || profile === null) return
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => {
      sampleBlob(code, { kind, lang, profile: JSON.parse(profile) as Record<string, unknown> }, controller.signal)
        .then(({ blob, filename }) => {
          if (!active) return
          const file = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
          setLoaded({ key, url: URL.createObjectURL(file), filename })
        })
        .catch((err: unknown) => {
          if (!active || isAbortError(err)) return
          setFailed({ key, error: err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.documents.pdfFailed) })
        })
    }, DEBOUNCE_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, code, kind, lang, profile])

  useEffect(() => {
    if (!loaded) return
    const { url } = loaded
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    }
  }, [loaded])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  /* While a new sample is on its way the previous one stays, so the preview does not flash empty. */
  const shown = loaded
  const error = failed && failed.key === key ? failed.error : null
  const status: PdfHandle['status'] = profile === null && !shown ? 'idle' : error ? 'error' : shown ? 'ready' : 'loading'
  return {
    status,
    url: error ? null : (shown?.url ?? null),
    filename: shown?.filename || `muestra-${kind}.pdf`,
    error,
    retry,
  }
}

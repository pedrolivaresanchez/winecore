import { useCallback, useEffect, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError, apiBlob, isAbortError } from '@/lib/api'

export type PdfStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PdfHandle = {
  status: PdfStatus
  url: string | null
  filename: string
  error: ApiError | null
  retry: () => void
}

type Loaded = { key: string; url: string; filename: string | null }

/** A tab opened from the link can still be reading the blob when the preview moves on. */
const REVOKE_AFTER_MS = 60_000

export function inlinePdfSupported(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
}

/**
 * The PDF through the session: a new tab or a bare `<iframe src="/api/...">` carries no
 * bearer, and the API answers with `X-Frame-Options: DENY` besides. A blob URL is this
 * origin's own, so the iframe, the download and the new tab all read it.
 */
export function usePdf(path: string | null, fallbackName: string, revision = ''): PdfHandle {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: ApiError } | null>(null)
  const key = path ? `${path}\0${revision}\0${attempt}` : ''

  useEffect(() => {
    if (!key || !path) return
    const controller = new AbortController()
    let active = true
    apiBlob(path, { headers: { Accept: 'application/pdf' }, signal: controller.signal })
      .then(({ blob, filename }) => {
        if (!active) return
        const file = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
        setLoaded({ key, url: URL.createObjectURL(file), filename })
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setFailed({ key, error: err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.documents.pdfFailed) })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [key, path])

  useEffect(() => {
    if (!loaded) return
    const { url } = loaded
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    }
  }, [loaded])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const current = loaded && loaded.key === key ? loaded : null
  const error = !current && failed && failed.key === key ? failed.error : null
  const status: PdfStatus = !path ? 'idle' : current ? 'ready' : error ? 'error' : 'loading'
  return {
    status,
    url: current?.url ?? null,
    filename: current?.filename || fallbackName,
    error,
    retry,
  }
}

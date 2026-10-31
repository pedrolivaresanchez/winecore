import { useEffect, useState } from 'react'
import { FileText } from '@/ui/icons'
import { Skeleton } from '@/ui'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { attachmentObjectUrl } from '@/pages/gastos/api'

export function DocumentView({ attachmentId }: { attachmentId: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [mime, setMime] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!attachmentId) return
    let active = true
    let objectUrl = ''
    setFailed(false)
    setUrl(null)
    attachmentObjectUrl(attachmentId)
      .then((file) => {
        if (!active) {
          URL.revokeObjectURL(file.url)
          return
        }
        objectUrl = file.url
        setUrl(file.url)
        setMime(file.mime)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId])

  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-subtle">
      <h2 className="border-b border-border-subtle bg-surface px-4 py-2 text-caption text-text-tertiary">
        {copy.gastos.document}
      </h2>
      <div className="flex min-h-72 items-center justify-center p-3">
        {!attachmentId || failed ? (
          <p className="flex items-center gap-2 text-label text-text-tertiary">
            <FileText className="size-4" strokeWidth={iconStroke} />
            {copy.gastos.noDocument}
          </p>
        ) : !url ? (
          <Skeleton className="h-64 w-full" />
        ) : mime.includes('pdf') ? (
          <iframe title={copy.gastos.document} src={url} className="h-[28rem] w-full rounded-lg bg-surface" />
        ) : (
          <img src={url} alt={copy.gastos.document} className="max-h-[28rem] w-full object-contain" />
        )}
      </div>
    </section>
  )
}

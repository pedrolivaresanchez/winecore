import type { ReactNode, RefObject } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { inlinePdfSupported, type PdfHandle } from '@/pages/documents/pdf'
import { DownloadSimple, ExternalLink, Printer } from '@/ui/icons'
import { Button, Skeleton, SkeletonText, textureSecondary } from '@/ui'

const LINK_BUTTON = cn(
  'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-label font-medium text-ink-900',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  '[&_svg]:size-3.5',
  textureSecondary,
)

function openInTab(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** The browser's own viewer prints the PDF, not the page around it. Without one, the tab does. */
function printPdf(frame: HTMLIFrameElement | null, url: string) {
  const view = frame?.contentWindow
  if (!view) {
    openInTab(url)
    return
  }
  try {
    view.focus()
    view.print()
  } catch {
    openInTab(url)
  }
}

export function PdfPreview({
  pdf,
  title,
  note,
  frameRef,
  className,
}: {
  pdf: PdfHandle
  /** Names the iframe for assistive tech and tests. */
  title: string
  /** Why there is no PDF to fetch, when the path is null. */
  note?: string
  frameRef?: RefObject<HTMLIFrameElement | null>
  className?: string
}) {
  if (pdf.status === 'idle') {
    return (
      <PdfMessage className={className}>
        <p className="text-label text-text-secondary">{note ?? copy.documents.pdfMissing}</p>
      </PdfMessage>
    )
  }
  if (pdf.status === 'loading') {
    return (
      <div role="status" aria-label={copy.documents.pdfLoading} className={cn('flex justify-center overflow-hidden p-6', className)}>
        <div className="flex aspect-[1/1.414] w-full max-w-2xl flex-col gap-6 rounded-md bg-surface p-8 shadow-(--shadow-card)">
          <Skeleton className="h-5 w-1/3" />
          <SkeletonText lines={3} className="w-1/2" />
          <Skeleton className="h-32 w-full" />
          <SkeletonText lines={4} />
        </div>
      </div>
    )
  }
  if (pdf.status === 'error' || !pdf.url) {
    const missing = pdf.error?.status === 404
    return (
      <PdfMessage className={className}>
        <ErrorState
          title={missing ? copy.documents.pdfMissing : `${copy.documents.pdfFailed} (${pdf.error?.code ?? 'WC_ERROR'})`}
          detail={pdf.error?.message}
          onRetry={pdf.retry}
        />
      </PdfMessage>
    )
  }
  if (!inlinePdfSupported()) {
    return (
      <PdfMessage className={className}>
        <div className="grid max-w-sm gap-3 text-left">
          <p className="text-body font-medium text-ink-900">{copy.documents.noInline}</p>
          <p className="text-label text-text-secondary">{copy.documents.noInlineHint}</p>
          <div className="flex flex-wrap gap-1.5">
            <a href={pdf.url} download={pdf.filename} className={LINK_BUTTON}>
              <DownloadSimple strokeWidth={iconStroke} />
              {copy.documents.download}
            </a>
            <a href={pdf.url} target="_blank" rel="noopener" className={LINK_BUTTON}>
              <ExternalLink strokeWidth={iconStroke} />
              {copy.documents.openTab}
            </a>
          </div>
        </div>
      </PdfMessage>
    )
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      src={pdf.url}
      className={cn('block size-full border-0 bg-surface', className)}
    />
  )
}

function PdfMessage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-center p-6', className)}>{children}</div>
}

/** Download, a tab of its own and print — the three ways out of the preview. */
export function PdfActions({
  pdf,
  frameRef,
  className,
}: {
  pdf: PdfHandle
  frameRef?: RefObject<HTMLIFrameElement | null>
  className?: string
}) {
  if (pdf.status === 'idle') return null
  if (pdf.status === 'error') {
    return (
      <div role="alert" className={cn('flex flex-wrap items-center gap-2', className)}>
        <p className="min-w-0 flex-1 text-label text-danger-600">
          {pdf.error?.status === 404 ? copy.documents.pdfMissing : copy.documents.pdfFailed}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={pdf.retry}>
          {copy.error.retry}
        </Button>
      </div>
    )
  }
  const url = pdf.url
  if (!url) {
    return (
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        <Button type="button" variant="secondary" size="sm" loading>
          <DownloadSimple strokeWidth={iconStroke} />
          {copy.documents.download}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled>
          <ExternalLink strokeWidth={iconStroke} />
          {copy.documents.openTab}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled>
          <Printer strokeWidth={iconStroke} />
          {copy.documents.print}
        </Button>
      </div>
    )
  }
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <a href={url} download={pdf.filename} className={LINK_BUTTON}>
        <DownloadSimple strokeWidth={iconStroke} />
        {copy.documents.download}
      </a>
      <a href={url} target="_blank" rel="noopener" className={LINK_BUTTON}>
        <ExternalLink strokeWidth={iconStroke} />
        {copy.documents.openTab}
      </a>
      <Button type="button" variant="secondary" size="sm" onClick={() => printPdf(frameRef?.current ?? null, url)}>
        <Printer strokeWidth={iconStroke} />
        {copy.documents.print}
      </Button>
    </div>
  )
}

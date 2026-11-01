import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ArrowLeft, Camera, FileText, RefreshCw, Upload } from '@/ui/icons'
import { Alert, Button, SegmentedControl } from '@/ui'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { compressImage } from '@/lib/compress-image'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { allows } from '@/lib/permissions'
import type { EntityCode, Me } from '@/lib/types'
import { NoPermission } from '@/components/NoPermission'
import { captureExpense } from '@/pages/gastos/api'

const MAX_BYTES = 10 * 1024 * 1024

type Phase = 'preparing' | 'uploading' | 'reading' | 'done' | 'error'

type UploadItem = {
  id: string
  file: File
  /** What is actually sent: the photo after compression, or the file as it came. */
  prepared?: File
  previewUrl?: string
  key: string
  entity: string
  progress: number
  phase: Phase
  error?: string
  invoiceId?: string
}

function accepted(file: File): boolean {
  if (file.type.startsWith('image/') || file.type === 'application/pdf') return true
  return /\.(png|jpe?g|heic|pdf)$/i.test(file.name)
}

const sizeFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${sizeFormat.format(bytes / (1024 * 1024))} MB`
    : `${sizeFormat.format(Math.max(1, Math.round(bytes / 1024)))} KB`
}

function Thumb({ item }: { item: UploadItem }) {
  const shell = 'flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100 text-icon-muted'
  if (item.previewUrl) {
    return (
      <span className={shell}>
        <img
          src={item.previewUrl}
          alt={fill(copy.gastos.previewOf, { name: item.file.name })}
          className="size-full object-contain"
        />
      </span>
    )
  }
  return (
    <span className={shell} aria-hidden>
      <FileText className="size-6" strokeWidth={iconStroke} />
    </span>
  )
}

export function ExpenseCapture({ me }: { me: Me }) {
  useChromeTitle(copy.gastos.add)
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previews = useRef(new Set<string>())
  const { entityCode, entities } = useEntity()
  const [entity, setEntity] = useState<EntityCode>(entityCode ?? entities[0]?.code ?? 'CVPO')
  const [items, setItems] = useState<UploadItem[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const canWrite = allows(me, 'purchasing.write')
  const busy = items.some(
    (item) => item.phase === 'preparing' || item.phase === 'uploading' || item.phase === 'reading',
  )

  useEffect(() => {
    const urls = previews.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  function patch(id: string, partial: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...partial } : item)))
  }

  async function upload(item: UploadItem, file: File) {
    patch(item.id, { phase: 'uploading', progress: 0, error: undefined })
    try {
      const invoice = await captureExpense(file, item.entity, item.key, (progress) => {
        patch(item.id, { progress, phase: progress >= 100 ? 'reading' : 'uploading' })
      })
      patch(item.id, { phase: 'done', progress: 100, invoiceId: invoice.id })
    } catch (error: unknown) {
      patch(item.id, {
        phase: 'error',
        error: error instanceof ApiError ? error.message : copy.gastos.failed,
      })
    }
  }

  async function prepare(item: UploadItem) {
    let file = item.prepared
    if (!file) {
      patch(item.id, { phase: 'preparing', progress: 0, error: undefined })
      file = await compressImage(item.file)
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      if (previewUrl) previews.current.add(previewUrl)
      if (file.size > MAX_BYTES) {
        patch(item.id, { phase: 'error', prepared: undefined, previewUrl, error: copy.gastos.tooBig })
        return
      }
      patch(item.id, { prepared: file, previewUrl })
    }
    await upload(item, file)
  }

  function enqueue(list: File[]) {
    if (!entity) {
      setNotice(copy.gastos.entityRequired)
      return
    }
    setNotice(null)
    const acceptedFiles: UploadItem[] = []
    let skipped = false
    for (const file of list) {
      if (!accepted(file) || file.size === 0 || (file.type === 'application/pdf' && file.size > MAX_BYTES)) {
        skipped = true
        continue
      }
      acceptedFiles.push({
        id: crypto.randomUUID(),
        file,
        key: `cap-${crypto.randomUUID()}`,
        entity,
        progress: 0,
        phase: 'preparing',
      })
    }
    if (skipped) setNotice(copy.gastos.skipped)
    if (acceptedFiles.length === 0) return
    setItems((current) => [...acceptedFiles, ...current])
    window.setTimeout(() => {
      for (const item of acceptedFiles) void prepare(item)
    }, 0)
  }

  function remove(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  function statusOf(item: UploadItem): string {
    switch (item.phase) {
      case 'preparing':
        return copy.gastos.preparing
      case 'reading':
        return copy.gastos.reading
      case 'done':
        return copy.gastos.uploaded
      case 'error':
        return copy.gastos.failed
      default:
        return `${copy.gastos.uploading} ${item.progress} %`
    }
  }

  if (!canWrite) return <NoPermission />

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    enqueue([...(event.target.files ?? [])])
    event.target.value = ''
  }

  return (
    <div data-screen={busy ? 'gastos-progreso' : 'gastos-captura'} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.gastos.title} onClick={() => navigate('/gastos')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">{copy.gastos.title}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-5">
          <header>
            <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.gastos.add}</h1>
            <p className="mt-0.5 text-label text-text-secondary">{copy.gastos.captureHint}</p>
          </header>
          {entities.length > 1 ? (
            <SegmentedControl
              aria-label={copy.gastos.entity}
              value={entity}
              onChange={setEntity}
              options={entities.map((item) => ({
                value: item.code,
                content: item.code === 'PO' ? copy.entity.po : copy.entity.cvpo,
              }))}
            />
          ) : null}
          {notice ? <Alert tone="warning">{notice}</Alert> : null}
          <div
            className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-surface-subtle p-4 sm:items-center sm:px-6 sm:py-10"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              enqueue([...event.dataTransfer.files])
            }}
          >
            <input
              ref={cameraRef}
              id="captura-gasto"
              className="sr-only"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              tabIndex={-1}
              onChange={onPick}
            />
            <input
              ref={fileRef}
              id="captura-gasto-archivo"
              className="sr-only"
              type="file"
              accept="image/*,application/pdf"
              multiple
              tabIndex={-1}
              onChange={onPick}
            />
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera strokeWidth={iconStroke} />
              {copy.gastos.takePhoto}
            </Button>
            <p className="text-center text-caption text-text-tertiary">{copy.gastos.captureOr}</p>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => fileRef.current?.click()}
            >
              <Upload strokeWidth={iconStroke} />
              {copy.gastos.uploadFile}
            </Button>
          </div>
          {items.length > 0 ? (
            <ul aria-live="polite" className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
                  <Thumb item={item} />
                  <div className="grid min-w-0 flex-1 content-start gap-1.5">
                    <span className="truncate text-label text-ink-900">{item.file.name}</span>
                    <span className="text-caption text-text-tertiary">
                      {statusOf(item)}
                      {item.prepared ? ` · ${sizeLabel(item.prepared.size)}` : ` · ${sizeLabel(item.file.size)}`}
                    </span>
                    {item.phase === 'preparing' || item.phase === 'uploading' || item.phase === 'reading' ? (
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={item.phase === 'uploading' ? item.progress : undefined}
                        aria-label={statusOf(item)}
                        className="h-1 overflow-hidden rounded-full bg-ink-100"
                      >
                        <div
                          className={cn(
                            'h-full bg-ink-900',
                            item.phase !== 'uploading' && 'w-full animate-pulse',
                          )}
                          style={item.phase === 'uploading' ? { width: `${item.progress}%` } : undefined}
                        />
                      </div>
                    ) : null}
                    {item.error ? <p className="text-caption text-danger-600">{item.error}</p> : null}
                    {item.phase === 'error' || item.invoiceId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {item.phase === 'error' ? (
                          <>
                            <Button type="button" variant="secondary" size="sm" onClick={() => void prepare(item)}>
                              <RefreshCw strokeWidth={iconStroke} />
                              {copy.gastos.retry}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => remove(item.id)}>
                              {copy.gastos.remove}
                            </Button>
                          </>
                        ) : null}
                        {item.invoiceId ? (
                          <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/gastos/${item.invoiceId}`)}>
                            {copy.gastos.review}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

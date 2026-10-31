import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ArrowLeft, Plus, RefreshCw } from '@/ui/icons'
import { Alert, Button, SegmentedControl } from '@/ui'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { allows } from '@/lib/permissions'
import type { EntityCode, Me } from '@/lib/types'
import { NoPermission } from '@/components/NoPermission'
import { captureExpense } from '@/pages/gastos/api'

const MAX_BYTES = 10 * 1024 * 1024

type Phase = 'uploading' | 'reading' | 'done' | 'error'

type UploadItem = {
  id: string
  file: File
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

export function ExpenseCapture({ me }: { me: Me }) {
  useChromeTitle(copy.gastos.add)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const { entityCode, entities } = useEntity()
  const [entity, setEntity] = useState<EntityCode>(entityCode ?? entities[0]?.code ?? 'CVPO')
  const [items, setItems] = useState<UploadItem[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const canWrite = allows(me, 'purchasing.write')
  const busy = items.some((item) => item.phase === 'uploading' || item.phase === 'reading')

  function patch(id: string, partial: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...partial } : item)))
  }

  async function upload(item: UploadItem) {
    patch(item.id, { phase: 'uploading', progress: 0, error: undefined })
    try {
      const invoice = await captureExpense(item.file, item.entity, item.key, (progress) => {
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

  function enqueue(list: File[]) {
    if (!entity) {
      setNotice(copy.gastos.entityRequired)
      return
    }
    setNotice(null)
    const acceptedFiles: UploadItem[] = []
    let skipped = false
    for (const file of list) {
      if (!accepted(file) || file.size === 0 || file.size > MAX_BYTES) {
        skipped = true
        continue
      }
      acceptedFiles.push({
        id: crypto.randomUUID(),
        file,
        key: `cap-${crypto.randomUUID()}`,
        entity,
        progress: 0,
        phase: 'uploading',
      })
    }
    if (skipped) setNotice(copy.gastos.skipped)
    if (acceptedFiles.length === 0) return
    setItems((current) => [...acceptedFiles, ...current])
    window.setTimeout(() => {
      for (const item of acceptedFiles) void upload(item)
    }, 0)
  }

  if (!canWrite) return <NoPermission />

  return (
    <div data-screen={busy ? 'gastos-progreso' : 'gastos-captura'} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.gastos.title} onClick={() => navigate('/gastos')}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">{copy.gastos.title}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-5">
          <header>
            <h1 className="text-body font-medium text-ink-900">{copy.gastos.add}</h1>
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
            className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-surface-subtle px-6 py-10"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              enqueue([...event.dataTransfer.files])
            }}
          >
            <input
              ref={inputRef}
              id="captura-gasto"
              className="sr-only"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              onChange={(event) => {
                enqueue([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <Button type="button" variant="primary" size="lg" onClick={() => inputRef.current?.click()}>
              <Plus strokeWidth={iconStroke} />
              {copy.gastos.add}
            </Button>
          </div>
          {items.length > 0 ? (
            <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              {items.map((item) => (
                <li key={item.id} className="grid gap-2 border-b border-border-subtle px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-label text-ink-900">{item.file.name}</span>
                    <span className="shrink-0 text-caption text-text-tertiary">
                      {item.phase === 'reading'
                        ? copy.gastos.reading
                        : item.phase === 'done'
                          ? copy.gastos.uploaded
                          : item.phase === 'error'
                            ? copy.gastos.failed
                            : `${item.progress} %`}
                    </span>
                  </div>
                  {item.phase === 'uploading' || item.phase === 'reading' ? (
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.phase === 'reading' ? 100 : item.progress}
                      aria-label={item.phase === 'reading' ? copy.gastos.reading : copy.gastos.uploading}
                      className="h-1 overflow-hidden rounded-full bg-ink-100"
                    >
                      <div
                        className={cn('h-full bg-ink-900', item.phase === 'reading' && 'w-full')}
                        style={item.phase === 'reading' ? undefined : { width: `${item.progress}%` }}
                      />
                    </div>
                  ) : null}
                  {item.error ? <p className="text-caption text-danger-600">{item.error}</p> : null}
                  <div className="flex items-center gap-2">
                    {item.phase === 'error' ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => void upload(item)}>
                        <RefreshCw strokeWidth={iconStroke} />
                        {copy.gastos.retry}
                      </Button>
                    ) : null}
                    {item.invoiceId ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/gastos/${item.invoiceId}`)}>
                        {copy.gastos.review}
                      </Button>
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

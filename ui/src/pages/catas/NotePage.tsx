import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Badge, Button, MenuItem, Skeleton, useToast } from '@/ui'
import { RecordBar } from '@/pages/bodega/chrome'
import { attachmentObjectUrl, getNote, messageOf, patchNote } from '@/pages/catas/api'
import { FactCard, MoreMenu, RecordColumn } from '@/pages/catas/frame'
import { descriptorName, formatScore, optionLabel, subjectLabel } from '@/pages/catas/labels'
import type { Note } from '@/pages/catas/types'
import { useCatalog } from '@/pages/catas/use-catalog'

export function NotePage({ me, noteId }: { me: Me; noteId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const catalog = useCatalog(true)
  const canWrite = allows(me, 'tasting.write')
  const [note, setNote] = useState<Note | null>(null)
  useChromeTitle(catalog.templateName(note?.template_code) || copy.catas.notes)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    getNote(noteId, controller.signal)
      .then((next) => {
        if (!active) return
        setNote(next)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(messageOf(err))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, noteId])

  async function clearDecision() {
    if (!note || clearing) return
    setClearing(true)
    try {
      const next = await patchNote(note.id, { decision: null })
      setNote(next)
      toast(copy.catas.decisionCleared)
    } catch (err: unknown) {
      toast(messageOf(err))
    } finally {
      setClearing(false)
    }
  }

  if (error) {
    return (
      <RecordColumn screen="catas-nota">
        <div className="p-4">
          <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      </RecordColumn>
    )
  }
  if (!note) {
    return (
      <RecordColumn screen="catas-nota">
        <div className="grid gap-3 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32" />
        </div>
      </RecordColumn>
    )
  }

  const template = catalog.templates.find((item) => item.id === note.template_id)
  const fields = (template?.fields ?? []).filter((field) => field.is_active).sort((a, b) => a.position - b.position)
  const where = catalog.lotCode(note.lot_id) || catalog.wineName(note.wine_id) || subjectLabel(note.subject)
  const answerRows = fields
    .map((field) => ({ label: field.label, value: showValue(note.values[field.field_key]) }))
    .filter((row) => row.value !== '')

  return (
    <RecordColumn screen="catas-nota">
      <RecordBar backTo="/bodega/catas" backLabel={copy.catas.backNotes}>
        {canWrite ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/bodega/catas/notas/${note.id}/editar`)}>
            {copy.catas.edit}
          </Button>
        ) : null}
        {canWrite && note.decision ? (
          <MoreMenu label={copy.catas.more}>
            {(close) => (
              <MenuItem
                tone="danger"
                onClick={() => {
                  close()
                  void clearDecision()
                }}
              >
                {copy.catas.clearDecision}
              </MenuItem>
            )}
          </MoreMenu>
        ) : null}
      </RecordBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{template?.name ?? note.template_code}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {[note.taster_name, formatDateTime(note.tasted_at), where].filter(Boolean).join(' · ')}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{subjectLabel(note.subject)}</Badge>
            {note.overall_score != null ? <Badge tone="info">{formatScore(note.overall_score)}</Badge> : null}
            {note.defects.map((code) => (
              <Badge key={code} tone="danger">
                {descriptorName(catalog.descriptors, code)}
              </Badge>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label={copy.catas.visual} value={formatScore(note.visual_score)} />
            <Metric label={copy.catas.nose} value={formatScore(note.nose_score)} />
            <Metric label={copy.catas.mouth} value={formatScore(note.mouth_score)} />
            <Metric label={copy.catas.overall} value={formatScore(note.overall_score)} />
          </div>
          <FactCard title={template?.name ?? copy.catas.sheet} rows={answerRows} />
          {note.descriptors.length > 0 ? (
            <section className="grid gap-2">
              <h2 className="text-caption text-text-tertiary">{copy.catas.descriptors}</h2>
              <div className="flex flex-wrap gap-1.5">
                {note.descriptors.map((code) => (
                  <Badge key={code} tone="neutral">
                    {descriptorName(catalog.descriptors, code)}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
          {note.decision ? (
            <section className="grid gap-1">
              <h2 className="text-caption text-text-tertiary">{copy.catas.decision}</h2>
              <p className="text-label text-ink-900">{note.decision}</p>
            </section>
          ) : null}
          {note.notes ? <p className="text-label text-text-secondary">{note.notes}</p> : null}
          {note.voice_transcript ? (
            <section className="grid gap-1">
              <h2 className="text-caption text-text-tertiary">{copy.catas.dictation}</h2>
              <p className="text-label text-ink-900">{note.voice_transcript}</p>
            </section>
          ) : null}
          {catalog.lotCode(note.lot_id) ? (
            <Link to={`/bodega/lotes/${encodeURIComponent(catalog.lotCode(note.lot_id))}`} className="text-label font-medium text-ink-900 underline">
              {catalog.lotCode(note.lot_id)}
            </Link>
          ) : null}
          {note.lot_id || note.wine_id ? (
            <Link
              to={note.lot_id ? `/bodega/catas/evolucion?lot_id=${encodeURIComponent(note.lot_id)}` : `/bodega/catas/evolucion?wine_id=${encodeURIComponent(note.wine_id ?? '')}`}
              className="text-label text-ink-900 underline"
            >
              {copy.catas.evolution}
            </Link>
          ) : null}
          <Attachments note={note} />
        </div>
      </div>
    </RecordColumn>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle px-3 py-2">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="text-label font-medium break-words text-ink-900">{value}</p>
    </div>
  )
}

function showValue(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? copy.catas.yes : copy.catas.no
  if (typeof value === 'number') return formatScore(value)
  if (typeof value === 'string') return optionLabel(value)
  return String(value)
}

function Attachments({ note }: { note: Note }) {
  const [files, setFiles] = useState<{ id: string; name: string; url: string; mime: string }[]>([])
  useEffect(() => {
    let active = true
    const created: string[] = []
    void Promise.all(
      note.attachments.map(async (item) => {
        const file = await attachmentObjectUrl(item.id)
        if (!file) return null
        created.push(file.url)
        return { id: item.id, name: item.filename, url: file.url, mime: file.mime }
      }),
    ).then((loaded) => {
      if (!active) {
        for (const url of created) URL.revokeObjectURL(url)
        return
      }
      setFiles(loaded.filter((item): item is { id: string; name: string; url: string; mime: string } => item != null))
    })
    return () => {
      active = false
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [note.attachments])
  if (note.attachments.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-caption text-text-tertiary">{copy.catas.attached}</h2>
      <ul className="grid gap-2">
        {note.attachments.map((item) => {
          const file = files.find((entry) => entry.id === item.id)
          const image = file?.mime.startsWith('image/')
          return (
            <li key={item.id} className="overflow-hidden rounded-2xl border border-border-subtle">
              {image && file ? <img src={file.url} alt="" className="max-h-48 w-full object-cover" /> : null}
              <p className="px-4 py-2 text-label text-ink-900">{item.filename}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

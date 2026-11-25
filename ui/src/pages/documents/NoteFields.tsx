import { useState } from 'react'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { Button, Textarea } from '@/ui'

export function DraftNotes({
  idPrefix,
  customer,
  internal,
  onCustomer,
  onInternal,
  labels = copy.sales,
}: {
  idPrefix: string
  customer: string
  internal: string
  onCustomer: (value: string) => void
  onInternal: (value: string) => void
  labels?: { customerNote: string; customerNoteHint: string; internalNote: string; internalNoteHint: string }
}) {
  return (
    <>
      <Field id={`${idPrefix}-cliente`} label={labels.customerNote} hint={labels.customerNoteHint}>
        <Textarea id={`${idPrefix}-cliente`} rows={3} value={customer} onChange={(event) => onCustomer(event.target.value)} />
      </Field>
      <Field id={`${idPrefix}-interna`} label={labels.internalNote} hint={labels.internalNoteHint}>
        <Textarea id={`${idPrefix}-interna`} rows={3} value={internal} onChange={(event) => onInternal(event.target.value)} />
      </Field>
    </>
  )
}

/** Nota interna de un documento ya emitido. No toca el contenido fiscal. */
export function IssuedInternalNote({
  idPrefix,
  value,
  busy,
  onSave,
  labels = copy.sales,
}: {
  idPrefix: string
  value: string
  busy: boolean
  onSave: (value: string) => Promise<void>
  labels?: { internalNote: string; internalNoteHint: string; editInternalNote: string; save: string; cancel: string }
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (!editing) {
    return (
      <div className="grid gap-2">
        <div className="grid gap-1">
          <span className="text-label text-text-secondary">{labels.internalNote}</span>
          <p className="whitespace-pre-wrap text-body text-text">{value || '—'}</p>
          <p className="text-caption text-text-tertiary">{labels.internalNoteHint}</p>
        </div>
        <div>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setDraft(value); setEditing(true) }}>
            {labels.editInternalNote}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <Field id={`${idPrefix}-interna`} label={labels.internalNote} hint={labels.internalNoteHint}>
        <Textarea id={`${idPrefix}-interna`} rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => {
            void onSave(draft).then(() => setEditing(false)).catch(() => undefined)
          }}
        >
          {labels.save}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(false)}>
          {labels.cancel}
        </Button>
      </div>
    </div>
  )
}

import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import type { Draft, Issue, WizardStep } from '@/lib/operation-draft'
import { WhenField } from '@/pages/elaboracion/WhenField'
import { Input, Textarea } from '@/ui'

export function ElaborationFields({
  draft,
  issues,
  step,
  onChange,
}: {
  draft: Draft
  issues: Issue[]
  step: WizardStep
  onChange: (recipe: (current: Draft) => Draft) => void
}) {
  const setpointError = issues.find((issue) => issue.key === 'setpoint' && (step === 'revision' || issue.step === step))?.message
  const windowError = issues.find((issue) => issue.key === 'window' && (step === 'revision' || issue.step === step))?.message
  const reasonError = issues.find((issue) => issue.key === 'reason' && (step === 'revision' || issue.step === step))?.message
  if (draft.op_type === 'temperature_control') {
    return (
      <div data-frame="elaboracion-temperatura" className="grid gap-3 rounded-2xl border border-border-subtle p-3">
        <div className="grid grid-cols-2 gap-3">
          <Field id="consigna-anterior" label={copy.elaboracion.previousSetpoint} error={setpointError}>
            <Input
              id="consigna-anterior"
              className="w-full"
              inputMode="decimal"
              autoComplete="off"
              value={draft.previous_setpoint}
              invalid={Boolean(setpointError)}
              onChange={(event) => onChange((current) => ({ ...current, previous_setpoint: event.target.value }))}
            />
          </Field>
          <Field id="consigna-nueva" label={copy.elaboracion.newSetpoint}>
            <Input
              id="consigna-nueva"
              className="w-full"
              inputMode="decimal"
              autoComplete="off"
              value={draft.new_setpoint}
              onChange={(event) => onChange((current) => ({ ...current, new_setpoint: event.target.value }))}
            />
          </Field>
        </div>
        <Field id="motivo-temperatura" label={copy.elaboracion.reason} error={reasonError}>
          <Textarea
            id="motivo-temperatura"
            value={draft.reason}
            invalid={Boolean(reasonError)}
            onChange={(event) => onChange((current) => ({ ...current, reason: event.target.value }))}
          />
        </Field>
      </div>
    )
  }
  if (draft.op_type !== 'delestage') return null
  return (
    <div data-frame="elaboracion-delestage" className="grid gap-3 rounded-2xl border border-border-subtle p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="delestage-inicio" label={copy.elaboracion.started} error={windowError}>
          <WhenField value={draft.started_at} onChange={(value) => onChange((current) => ({ ...current, started_at: value }))} />
        </Field>
        <Field id="delestage-fin" label={copy.elaboracion.ended}>
          <WhenField value={draft.ended_at} onChange={(value) => onChange((current) => ({ ...current, ended_at: value }))} />
        </Field>
      </div>
      <Field id="delestage-notas" label={copy.elaboracion.notes}>
        <Textarea id="delestage-notas" value={draft.process_notes} onChange={(event) => onChange((current) => ({ ...current, process_notes: event.target.value }))} />
      </Field>
    </div>
  )
}

export function ElaborationSummary({ draft }: { draft: Draft }) {
  if (draft.op_type === 'temperature_control') {
    return (
      <p className="text-label text-ink-900">
        {copy.elaboracion.previousSetpoint} {draft.previous_setpoint || '—'} °C · {copy.elaboracion.newSetpoint} {draft.new_setpoint || '—'} °C
        {draft.reason.trim() ? ` · ${draft.reason.trim()}` : ''}
      </p>
    )
  }
  if (draft.op_type !== 'delestage') return null
  return (
    <p className="text-label text-ink-900">
      {draft.started_at || '—'} · {draft.ended_at || '—'}
      {draft.process_notes.trim() ? ` · ${draft.process_notes.trim()}` : ''}
    </p>
  )
}

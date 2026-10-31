import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { Mic, Paperclip } from '@/ui/icons'
import {
  Alert,
  Button,
  Chip,
  DatePicker,
  InfoTip,
  Input,
  MenuItem,
  Select,
  Skeleton,
  Switch,
  Textarea,
  useToast,
} from '@/ui'
import { RecordBar } from '@/pages/bodega/chrome'
import { createNote, getNote, messageOf, patchNote, uploadNoteFile } from '@/pages/catas/api'
import { parseDictation } from '@/pages/catas/dictation'
import { MoreMenu, RecordColumn } from '@/pages/catas/frame'
import {
  FAMILIES,
  dayInstant,
  descriptorName,
  familyLabel,
  isUuid,
  optionLabel,
  scoreMax,
  todayMadrid,
  whereLabel,
} from '@/pages/catas/labels'
import type { NoteDraft, NotePatch, Template, TemplateField } from '@/pages/catas/types'
import { useCatalog } from '@/pages/catas/use-catalog'

type Answers = Record<string, string | boolean>

const DATE_LABELS = { clear: copy.catas.clearDate, today: copy.catas.today }

export function NoteForm({ me, noteId }: { me: Me; noteId?: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const toast = useToast()
  useChromeTitle(noteId ? copy.catas.edit : copy.catas.newNote)
  const catalog = useCatalog(true)
  const canWrite = allows(me, 'tasting.write')
  const [templateId, setTemplateId] = useState('')
  const [day, setDay] = useState(todayMadrid)
  const [taster, setTaster] = useState(me.display_name)
  const [parcel, setParcel] = useState('')
  const [lotId, setLotId] = useState(params.get('lot_id') ?? '')
  const [wineId, setWineId] = useState(params.get('wine_id') ?? '')
  const [vintage, setVintage] = useState('')
  const [visual, setVisual] = useState('')
  const [nose, setNose] = useState('')
  const [mouth, setMouth] = useState('')
  const [overall, setOverall] = useState('')
  const [descriptors, setDescriptors] = useState<string[]>([])
  const [defects, setDefects] = useState<string[]>([])
  const [decision, setDecision] = useState('')
  const [notes, setNotes] = useState('')
  const [transcript, setTranscript] = useState('')
  const [answers, setAnswers] = useState<Answers>({})
  const [photos, setPhotos] = useState<File[]>([])
  const [voice, setVoice] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(!noteId)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (noteId || templateId) return
    const code = params.get('ficha')
    if (!code) return
    const found = catalog.templates.find((item) => item.code === code)
    if (found) setTemplateId(found.id)
  }, [catalog.templates, noteId, params, templateId])

  useEffect(() => {
    if (!noteId) return
    const controller = new AbortController()
    let active = true
    getNote(noteId, controller.signal)
      .then((note) => {
        if (!active) return
        setTemplateId(note.template_id)
        setDay(note.tasted_at.slice(0, 10))
        setTaster(note.taster_name)
        setParcel(note.parcel_id ?? '')
        setLotId(note.lot_id ?? '')
        setWineId(note.wine_id ?? '')
        setVintage(note.vintage == null ? '' : String(note.vintage))
        setVisual(scoreText(note.visual_score))
        setNose(scoreText(note.nose_score))
        setMouth(scoreText(note.mouth_score))
        setOverall(scoreText(note.overall_score))
        setDescriptors(note.descriptors)
        setDefects(note.defects)
        setDecision(note.decision ?? '')
        setNotes(note.notes ?? '')
        setTranscript(note.voice_transcript ?? '')
        const next: Answers = {}
        for (const [key, value] of Object.entries(note.values)) {
          if (typeof value === 'boolean') next[key] = value
          else if (value != null) next[key] = String(value)
        }
        setAnswers(next)
        setReady(true)
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(messageOf(error))
        setReady(true)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [noteId])

  const template = catalog.templates.find((item) => item.id === templateId) ?? null
  const fields = useMemo(
    () => (template?.fields ?? []).filter((field) => field.is_active).sort((a, b) => a.position - b.position),
    [template],
  )
  const max = scoreMax(template?.score_scale ?? '0-10')
  const link = template ? whereLabel(template.subject) : null
  const preview = useObjectUrl(photos.find((file) => file.type.startsWith('image/')) ?? null)

  function setAnswer(key: string, value: string | boolean) {
    setAnswers((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[`values.${key}`]) return current
      const next = { ...current }
      delete next[`values.${key}`]
      return next
    })
  }

  function applyDictation() {
    const parsed = parseDictation(transcript)
    const inferred = parsed.template_code ? catalog.templates.find((item) => item.code === parsed.template_code) : undefined
    const nextTemplate = template ?? inferred ?? null
    if (!template && inferred) setTemplateId(inferred.id)
    if (!visual && parsed.visual_score != null) setVisual(String(parsed.visual_score))
    if (!nose && parsed.nose_score != null) setNose(String(parsed.nose_score))
    if (!mouth && parsed.mouth_score != null) setMouth(String(parsed.mouth_score))
    if (!overall && parsed.overall_score != null) setOverall(String(parsed.overall_score))
    if (parsed.defects.length > 0) setDefects((current) => [...new Set([...current, ...parsed.defects])])
    if (!decision && parsed.decision) setDecision(parsed.decision)
    if (parsed.lot_code) {
      const lot = catalog.lots.find((item) => item.code.toLowerCase() === parsed.lot_code?.toLowerCase())
      if (lot) setLotId(lot.id)
    }
    if (parsed.parcel_code && !parcel) setParcel(parsed.parcel_code)
    if (!nextTemplate) return
    setAnswers((current) => {
      const next = template ? { ...current } : {}
      for (const [key, value] of Object.entries(parsed.values)) {
        if (!nextTemplate.fields.some((field) => field.field_key === key)) continue
        if (next[key] === undefined || next[key] === '') next[key] = String(value)
      }
      return next
    })
  }

  async function onSubmit() {
    if (!canWrite || saving) return
    const nextErrors = validate(template, fields, {
      taster,
      parcel,
      lotId,
      wineId,
      vintage,
      visual,
      nose,
      mouth,
      overall,
      answers,
      max,
    })
    setErrors(nextErrors)
    setFormError(null)
    if (!template || Object.keys(nextErrors).length > 0) return
    const values = valuesOf(fields, answers)
    const scores = {
      visual_score: readScore(visual),
      nose_score: readScore(nose),
      mouth_score: readScore(mouth),
      overall_score: readScore(overall),
    }
    setSaving(true)
    try {
      const saved = noteId
        ? await patchNote(noteId, patchOf(scores, descriptors, defects, decision, notes, transcript, values))
        : await createNote(draftOf(template, day, taster, parcel, lotId, wineId, vintage, scores, descriptors, defects, decision, notes, transcript, values, Boolean(voice)))
      let uploadFailed = false
      for (const file of photos) {
        try {
          await uploadNoteFile(saved.id, file, 'photo')
        } catch {
          uploadFailed = true
        }
      }
      if (voice) {
        try {
          await uploadNoteFile(saved.id, voice, 'other')
        } catch {
          uploadFailed = true
        }
      }
      toast(uploadFailed ? copy.catas.uploadFail : copy.catas.saved)
      navigate(`/bodega/catas/notas/${saved.id}`)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) {
        setErrors(error.fields)
        setFormError(error.fields.subject ?? error.fields.taster_name ?? null)
      } else setFormError(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <RecordColumn screen="catas-formulario">
        <div className="p-4">
          <ErrorState title={loadError} onRetry={() => window.location.reload()} />
        </div>
      </RecordColumn>
    )
  }

  return (
    <RecordColumn screen="catas-formulario">
      <RecordBar backTo="/bodega/catas" backLabel={copy.catas.backNotes}>
        <MoreMenu label={copy.catas.more}>
          {(close) => (
            <MenuItem
              tone="danger"
              onClick={() => {
                close()
                navigate('/bodega/catas')
              }}
            >
              {copy.catas.discard}
            </MenuItem>
          )}
        </MoreMenu>
      </RecordBar>
      <form
        className="min-h-0 flex-1 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        <div className="mx-auto grid w-full max-w-[640px] gap-4 px-4 py-4 sm:px-8">
          {!ready || catalog.loading ? <Skeleton className="h-40" /> : null}
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          {catalog.error ? <Alert tone="warning">{catalog.error}</Alert> : null}
          <Field id="ficha" label={copy.catas.sheet} error={errors.template_id}>
            <Select
              id="ficha"
              value={templateId}
              disabled={Boolean(noteId) || !canWrite}
              className="w-full"
              onChange={(event) => {
                setTemplateId(event.target.value)
                setAnswers({})
                setErrors({})
              }}
            >
              <option value="">{copy.catas.choose}</option>
              {catalog.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="fecha" label={copy.catas.when}>
              {noteId ? (
                <p className="text-label text-ink-900">{day}</p>
              ) : (
                <DatePicker size="sm" value={day} onChange={(next) => setDay(next?.slice(0, 10) ?? day)} labels={DATE_LABELS} />
              )}
            </Field>
            <Field id="catador" label={copy.catas.taster} error={errors.taster_name}>
              <Input
                id="catador"
                value={taster}
                disabled={Boolean(noteId) || !canWrite}
                invalid={Boolean(errors.taster_name)}
                onChange={(event) => setTaster(event.target.value)}
              />
            </Field>
          </div>
          {link === 'parcel' ? (
            <div className="grid gap-1.5">
              <div className="flex items-center gap-1">
                <label htmlFor="parcela" className="text-label text-text-secondary">
                  {copy.catas.parcel}
                </label>
                <InfoTip label={copy.catas.parcel}>{copy.catas.parcelTip}</InfoTip>
              </div>
              <Input
                id="parcela"
                value={parcel}
                disabled={Boolean(noteId) || !canWrite}
                invalid={Boolean(errors.parcel_id)}
                autoCapitalize="off"
                onChange={(event) => setParcel(event.target.value)}
              />
              {errors.parcel_id ? <p className="text-caption text-danger-600">{errors.parcel_id}</p> : null}
            </div>
          ) : null}
          {link === 'lot' || link === 'bottle' ? (
            <Field id="lote" label={copy.catas.lot} error={errors.lot_id}>
              <Select
                id="lote"
                value={lotId}
                disabled={Boolean(noteId) || !canWrite}
                className="w-full"
                onChange={(event) => setLotId(event.target.value)}
              >
                <option value="">{copy.catas.choose}</option>
                {catalog.lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {link === 'bottle' ? (
            <Field id="vino" label={copy.catas.wine} error={errors.wine_id}>
              <Select
                id="vino"
                value={wineId}
                disabled={Boolean(noteId) || !canWrite}
                className="w-full"
                onChange={(event) => setWineId(event.target.value)}
              >
                <option value="">{copy.catas.choose}</option>
                {catalog.wines.map((wine) => (
                  <option key={wine.id} value={wine.id}>
                    {wine.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {fields.map((field) => (
            <TemplateControl
              key={field.id}
              field={field}
              value={answers[field.field_key]}
              error={errors[`values.${field.field_key}`]}
              disabled={!canWrite}
              onChange={(value) => setAnswer(field.field_key, value)}
            />
          ))}
          <section className="grid gap-3">
            <div className="flex items-center gap-1">
              <h2 className="text-label font-medium text-ink-900">{copy.catas.score}</h2>
              <InfoTip label={copy.catas.score}>{`${copy.catas.score} 0-${max}`}</InfoTip>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ScoreField id="vista" label={copy.catas.visual} value={visual} max={max} error={errors.visual_score} disabled={!canWrite} onChange={setVisual} />
              <ScoreField id="nariz" label={copy.catas.nose} value={nose} max={max} error={errors.nose_score} disabled={!canWrite} onChange={setNose} />
              <ScoreField id="boca" label={copy.catas.mouth} value={mouth} max={max} error={errors.mouth_score} disabled={!canWrite} onChange={setMouth} />
              <ScoreField id="conjunto" label={copy.catas.overall} value={overall} max={max} error={errors.overall_score} disabled={!canWrite} onChange={setOverall} />
            </div>
          </section>
          {FAMILIES.map((family) => {
            const group = catalog.descriptors.filter((item) => item.family === family)
            if (group.length === 0) return null
            return (
              <section key={family} className="grid gap-2">
                <h2 className="text-caption text-text-tertiary">{familyLabel(family)}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {group.map((item) => (
                    <Chip
                      key={item.code}
                      pressed={descriptors.includes(item.code)}
                      active={descriptors.includes(item.code)}
                      onClick={() => setDescriptors((current) => toggle(current, item.code))}
                    >
                      {item.name_es}
                    </Chip>
                  ))}
                </div>
              </section>
            )
          })}
          <section className="grid gap-2">
            <h2 className="text-caption text-text-tertiary">{copy.catas.defects}</h2>
            <div className="flex flex-wrap gap-1.5">
              {catalog.descriptors
                .filter((item) => item.family === 'defect')
                .map((item) => (
                  <Chip
                    key={item.code}
                    pressed={defects.includes(item.code)}
                    active={defects.includes(item.code)}
                    onClick={() => setDefects((current) => toggle(current, item.code))}
                  >
                    {descriptorName(catalog.descriptors, item.code)}
                  </Chip>
                ))}
            </div>
            {errors.defects ? <p className="text-caption text-danger-600">{errors.defects}</p> : null}
          </section>
          <Field id="decision" label={copy.catas.decision} error={errors.decision}>
            <Input id="decision" value={decision} disabled={!canWrite} onChange={(event) => setDecision(event.target.value)} />
          </Field>
          <Field id="notas" label={copy.catas.notesField} error={errors.notes}>
            <Textarea id="notas" value={notes} disabled={!canWrite} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field id="dictado" label={copy.catas.dictation} error={errors.voice_transcript}>
            <Textarea id="dictado" value={transcript} disabled={!canWrite} onChange={(event) => setTranscript(event.target.value)} />
            {canWrite ? (
              <div className="mt-2">
                <Button type="button" variant="secondary" size="sm" onClick={applyDictation}>
                  {copy.catas.applyDictation}
                </Button>
              </div>
            ) : null}
          </Field>
          {noteId ? null : (
            <div className="grid gap-3 sm:grid-cols-2">
              <FileSlot
                id="foto"
                label={copy.catas.photo}
                accept="image/png,image/jpeg,image/heic"
                capture
                multiple
                names={photos.map((file) => file.name)}
                onPick={(list) => setPhotos(list.slice(0, 3))}
              />
              <FileSlot
                id="voz"
                label={copy.catas.voice}
                tip={copy.catas.voiceTip}
                accept="audio/*,.txt,.csv,text/plain"
                names={voice ? [voice.name] : []}
                onPick={(list) => setVoice(list[0] ?? null)}
              />
            </div>
          )}
          {preview ? <img src={preview} alt="" className="max-h-40 w-full rounded-2xl object-cover" /> : null}
        </div>
      </form>
      {canWrite ? (
        <footer className="flex h-12 shrink-0 items-center justify-end border-t border-border-subtle px-4">
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void onSubmit()}>
            {copy.catas.save}
          </Button>
        </footer>
      ) : null}
    </RecordColumn>
  )
}

function TemplateControl({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: TemplateField
  value: string | boolean | undefined
  error?: string
  disabled?: boolean
  onChange: (value: string | boolean) => void
}) {
  const id = `campo-${field.field_key}`
  const label = (
    <span className="inline-flex items-center gap-1">
      {field.label}
      {field.unit ? <span className="text-text-tertiary">{field.unit}</span> : null}
      {field.help ? <InfoTip label={field.label}>{field.help}</InfoTip> : null}
    </span>
  )
  if (field.kind === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-label text-text-secondary">
          {label}
        </label>
        <Switch id={id} checked={value === true} disabled={disabled} onChange={onChange} />
      </div>
    )
  }
  if (field.kind === 'select') {
    return (
      <Field id={id} label={field.label} error={error}>
        <Select
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          className="w-full"
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{copy.catas.choose}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </Select>
      </Field>
    )
  }
  if (field.kind === 'date') {
    return (
      <Field id={id} label={field.label} error={error}>
        <DatePicker
          size="sm"
          value={typeof value === 'string' && value ? value : null}
          disabled={disabled}
          labels={DATE_LABELS}
          onChange={(next) => onChange(next?.slice(0, 10) ?? '')}
        />
      </Field>
    )
  }
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="inline-flex items-center gap-1 text-label text-text-secondary">
        {label}
      </label>
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        invalid={Boolean(error)}
        inputMode={field.kind === 'text' ? 'text' : 'decimal'}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-caption text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ScoreField({
  id,
  label,
  value,
  max,
  error,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  max: number
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field id={id} label={label} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        invalid={Boolean(error)}
        placeholder={`0-${max}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function FileSlot({
  id,
  label,
  tip,
  accept,
  capture,
  multiple,
  names,
  onPick,
}: {
  id: string
  label: string
  tip?: string
  accept: string
  capture?: boolean
  multiple?: boolean
  names: string[]
  onPick: (files: File[]) => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-label text-text-secondary">
          {label}
        </label>
        {tip ? <InfoTip label={label}>{tip}</InfoTip> : null}
      </div>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept={accept}
        capture={capture ? 'environment' : undefined}
        multiple={multiple}
        onChange={(event) => {
          onPick([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      <Button type="button" variant="secondary" size="sm" onClick={() => document.getElementById(id)?.click()}>
        {id === 'voz' ? <Mic strokeWidth={iconStroke} /> : <Paperclip strokeWidth={iconStroke} />}
        {label}
      </Button>
      {names.map((name) => (
        <p key={name} className="truncate text-caption text-text-tertiary">
          {name}
        </p>
      ))}
    </div>
  )
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

function toggle(list: string[], code: string): string[] {
  return list.includes(code) ? list.filter((item) => item !== code) : [...list, code]
}

function scoreText(value: number | null): string {
  return value == null ? '' : String(value)
}

function readScore(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return null
  return Number(trimmed)
}

function valuesOf(fields: TemplateField[], answers: Answers): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = answers[field.field_key]
    if (field.kind === 'boolean') {
      if (typeof raw === 'boolean') values[field.field_key] = raw
      continue
    }
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (!text) {
      values[field.field_key] = ''
      continue
    }
    if (field.kind === 'text' || field.kind === 'select' || field.kind === 'date') {
      values[field.field_key] = text
      continue
    }
    values[field.field_key] = Number(text.replace(',', '.'))
  }
  return values
}

function validate(
  template: Template | null,
  fields: TemplateField[],
  input: {
    taster: string
    parcel: string
    lotId: string
    wineId: string
    vintage: string
    visual: string
    nose: string
    mouth: string
    overall: string
    answers: Answers
    max: number
  },
): Record<string, string> {
  const problems: Record<string, string> = {}
  if (!template) problems.template_id = copy.catas.required
  if (!input.taster.trim()) problems.taster_name = copy.catas.required
  if (template) {
    const link = whereLabel(template.subject)
    if (link === 'parcel' && !isUuid(input.parcel)) problems.parcel_id = copy.catas.parcelId
    if (link === 'lot' && !input.lotId) problems.lot_id = copy.catas.needLot
    if (link === 'bottle' && !input.lotId && !input.wineId) problems.lot_id = copy.catas.needLink
  }
  if (input.vintage.trim()) {
    const year = Number(input.vintage)
    if (!Number.isInteger(year) || year < 1990 || year > 2100) problems.vintage = copy.catas.scoreRange
  }
  for (const [key, text] of [
    ['visual_score', input.visual],
    ['nose_score', input.nose],
    ['mouth_score', input.mouth],
    ['overall_score', input.overall],
  ] as const) {
    if (!validScore(text, input.max)) problems[key] = copy.catas.scoreRange
  }
  for (const field of fields) {
    const raw = input.answers[field.field_key]
    const empty = raw === undefined || raw === ''
    if (field.required && field.kind !== 'boolean' && empty) problems[`values.${field.field_key}`] = copy.catas.required
    if (field.kind === 'integer' && typeof raw === 'string' && raw.trim() && !Number.isInteger(Number(raw.replace(',', '.')))) {
      problems[`values.${field.field_key}`] = copy.catas.scoreRange
    }
  }
  return problems
}

function validScore(text: string, max: number): boolean {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return true
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return false
  return Number(trimmed) <= max
}

function draftOf(
  template: Template,
  day: string,
  taster: string,
  parcel: string,
  lotId: string,
  wineId: string,
  vintage: string,
  scores: { visual_score: number | null; nose_score: number | null; mouth_score: number | null; overall_score: number | null },
  descriptors: string[],
  defects: string[],
  decision: string,
  notes: string,
  transcript: string,
  values: Record<string, unknown>,
  voiced: boolean,
): NoteDraft {
  const year = vintage.trim() ? Number(vintage) : null
  return {
    template_id: template.id,
    tasted_at: dayInstant(day),
    taster_name: taster.trim(),
    parcel_id: parcel.trim() || null,
    lot_id: lotId || null,
    wine_id: wineId || null,
    vintage: year,
    ...scores,
    descriptors,
    defects,
    decision: decision.trim() || null,
    notes: notes.trim() || null,
    voice_transcript: transcript.trim() || null,
    values,
    source: transcript.trim() || voiced ? 'voice' : 'manual',
  }
}

function patchOf(
  scores: { visual_score: number | null; nose_score: number | null; mouth_score: number | null; overall_score: number | null },
  descriptors: string[],
  defects: string[],
  decision: string,
  notes: string,
  transcript: string,
  values: Record<string, unknown>,
): NotePatch {
  return {
    ...scores,
    descriptors,
    defects,
    decision: decision.trim() || null,
    notes: notes.trim() || null,
    voice_transcript: transcript.trim() || null,
    values,
  }
}

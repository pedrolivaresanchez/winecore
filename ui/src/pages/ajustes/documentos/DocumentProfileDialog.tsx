import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { ApiError, fieldError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { PdfActions, PdfPreview } from '@/pages/documents/PdfPreview'
import { entityLabel } from '@/pages/facturas/format'
import {
  Alert,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/ui'
import { Image, RefreshCw, Trash2, Upload } from '@/ui/icons'
import type { LegalEntity } from '../numeracion/api'
import {
  LOGO_TYPES,
  MAX_FOOTER_LINES,
  MAX_LOGO_BYTES,
  SAMPLE_KINDS,
  VARIANTS,
  draftOf,
  draftProblems,
  getProfile,
  logoBlob,
  profileBody,
  removeLogo,
  sameDraft,
  saveProfile,
  uploadLogo,
  type DocumentLogo,
  type DocumentVariant,
  type ProfileDraft,
  type SampleKind,
  type SampleLang,
} from './api'
import { useSamplePdf } from './useSamplePdf'

type Pane = 'data' | 'sample'

const KIND_LABELS = copy.docProfile.kinds as Record<SampleKind, string>

/**
 * Cómo salen los PDF de una sociedad: plantilla, logotipo, contacto y pie. A la derecha (en el móvil,
 * en la pestaña «Muestra») se ve un PDF de ejemplo con los valores del formulario sin guardarlos.
 */
export function DocumentProfileDialog({ entity, onClose }: { entity: LegalEntity; onClose: () => void }) {
  const code = entity.code
  const toast = useToast()
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [saved, setSaved] = useState<ProfileDraft | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [logo, setLogo] = useState<DocumentLogo | null>(null)
  const [pane, setPane] = useState<Pane>('data')
  const [kind, setKind] = useState<SampleKind>('invoice')
  const [lang, setLang] = useState<SampleLang>('es')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getProfile(code, controller.signal)
      .then((profile) => {
        const next = draftOf(profile)
        setSaved(next)
        setDraft(next)
        setLogo(profile.logo)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.docProfile.loadFailed))
      })
    return () => controller.abort()
  }, [code, attempt])

  const problems = useMemo(
    () => (draft ? draftProblems(draft, { email: copy.docProfile.emailInvalid, lines: copy.docProfile.footerLines, line: copy.docProfile.footerLine }) : {}),
    [draft],
  )
  const valid = draft !== null && Object.keys(problems).length === 0
  const payload = valid && draft ? JSON.stringify(profileBody(draft)) : null
  const sample = useSamplePdf(code, kind, lang, payload, logo?.attachment_id ?? '')
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const dirty = draft !== null && saved !== null && !sameDraft(draft, saved)

  function change(patch: Partial<ProfileDraft>) {
    setError(null)
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  async function save() {
    if (!draft || !valid) return
    if (!dirty) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveProfile(code, draft)
      toast(copy.docProfile.saved, { tone: 'success' })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.api.generic))
    } finally {
      setBusy(false)
    }
  }

  const body = (() => {
    if (loadError) {
      return (
        <div className="grid content-start gap-3 p-4 sm:px-6">
          <Alert tone="danger">{`${copy.docProfile.loadFailed} (${loadError.code})`}</Alert>
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => setAttempt((value) => value + 1)}>
            {copy.error.retry}
          </Button>
        </div>
      )
    }
    if (!draft) {
      return (
        <div aria-busy="true" className="grid content-start gap-3 p-4 sm:px-6">
          <p className="sr-only">{copy.loading}</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )
    }
    return (
      <>
        <div className="shrink-0 border-y border-border-subtle px-3 py-2 lg:hidden">
          <SegmentedControl
            size="sm"
            fill
            aria-label={fill(copy.docProfile.title, { entity: entityLabel(code) })}
            value={pane}
            onChange={setPane}
            options={[
              { value: 'data', content: copy.docProfile.tabData },
              { value: 'sample', content: copy.docProfile.tabSample },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 lg:border-t lg:border-border-subtle">
          <form
            id="documentos-form"
            data-screen="sociedad-documentos"
            className={cn(
              'grid min-h-0 content-start gap-6 overflow-y-auto overscroll-contain p-4 sm:px-6 lg:w-[26rem] lg:shrink-0 lg:border-r lg:border-border-subtle',
              pane === 'data' ? 'max-lg:flex-1' : 'max-lg:hidden',
            )}
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {error && !error.fields ? <Alert tone="danger">{error.message}</Alert> : null}
            <TemplateField value={draft.variant} onChange={(variant) => change({ variant })} />
            <LogoField code={code} entity={entity} logo={logo} onChange={setLogo} />
            <section className="grid gap-4">
              <h3 className="text-label font-medium text-ink-900">{copy.docProfile.contact}</h3>
              <Field id="documentos-correo" label={copy.docProfile.email} error={problems.email ?? fieldError(error, 'email')}>
                <Input
                  id="documentos-correo"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  maxLength={200}
                  value={draft.email}
                  invalid={Boolean(problems.email ?? fieldError(error, 'email'))}
                  onChange={(event) => change({ email: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Field id="documentos-telefono" label={copy.docProfile.phone} error={fieldError(error, 'phone')}>
                  <Input
                    id="documentos-telefono"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={60}
                    value={draft.phone}
                    invalid={Boolean(fieldError(error, 'phone'))}
                    onChange={(event) => change({ phone: event.target.value })}
                  />
                </Field>
                <Field id="documentos-web" label={copy.docProfile.website} error={fieldError(error, 'website')}>
                  <Input
                    id="documentos-web"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    maxLength={200}
                    value={draft.website}
                    invalid={Boolean(fieldError(error, 'website'))}
                    onChange={(event) => change({ website: event.target.value })}
                  />
                </Field>
              </div>
            </section>
            <Field
              id="documentos-pie"
              label={copy.docProfile.footer}
              hint={copy.docProfile.footerHint}
              error={problems.footer ?? fieldError(error, 'footer_lines')}
            >
              <Textarea
                id="documentos-pie"
                rows={5}
                autoCapitalize="none"
                spellCheck={false}
                placeholder={copy.docProfile.footerPlaceholder}
                value={draft.footer}
                invalid={Boolean(problems.footer ?? fieldError(error, 'footer_lines'))}
                aria-describedby="documentos-pie-contador"
                onChange={(event) => change({ footer: event.target.value })}
              />
              <p id="documentos-pie-contador" className="text-caption text-text-tertiary tabular-nums">
                {`${draft.footer === '' ? 0 : draft.footer.split(/\r?\n/u).length} / ${MAX_FOOTER_LINES}`}
              </p>
            </Field>
          </form>
          <section
            aria-label={copy.docProfile.tabSample}
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-surface-subtle', pane !== 'sample' && 'max-lg:hidden')}
          >
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2.5 sm:px-4">
              <Select
                aria-label={copy.docProfile.sampleKind}
                className="col-span-3 w-full sm:col-span-1"
                value={kind}
                onChange={(event) => setKind(event.target.value as SampleKind)}
              >
                {SAMPLE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
              <SegmentedControl
                size="md"
                className="col-span-2 justify-self-start sm:col-span-1"
                aria-label={copy.docProfile.sampleLang}
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'es', content: 'ES' },
                  { value: 'en', content: 'EN' },
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                iconOnly
                aria-label={copy.docProfile.refresh}
                onClick={sample.retry}
              >
                <RefreshCw strokeWidth={iconStroke} />
              </Button>
            </div>
            <PdfPreview pdf={sample} title={copy.docProfile.tabSample} frameRef={frameRef} className="min-h-[24rem] flex-1" />
            <div className="shrink-0 border-t border-border-subtle bg-surface px-3 py-2 sm:px-4">
              <p className="mb-1.5 text-caption text-text-tertiary">{copy.docProfile.sampleNote}</p>
              <PdfActions pdf={sample} frameRef={frameRef} />
            </div>
          </section>
        </div>
      </>
    )
  })()

  return (
    <Dialog open onClose={onClose} size="screen" labelledBy="documentos-titulo">
      <DialogHeader
        titleId="documentos-titulo"
        title={fill(copy.docProfile.title, { entity: entityLabel(code) })}
        description={copy.docProfile.description}
        onClose={onClose}
      />
      {body}
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          {copy.docProfile.cancel}
        </Button>
        <Button type="submit" form="documentos-form" variant="primary" size="sm" loading={busy} disabled={!valid}>
          {copy.docProfile.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-label font-medium text-ink-900">{title}</h3>
      {children}
    </section>
  )
}

function TemplateField({ value, onChange }: { value: DocumentVariant; onChange: (value: DocumentVariant) => void }) {
  const labels = copy.docProfile.variants as Record<DocumentVariant, string>
  const hints = copy.docProfile.variantHints as Record<DocumentVariant, string>
  return (
    <Section title={copy.docProfile.template}>
      <SegmentedControl
        fill
        aria-label={copy.docProfile.template}
        value={value}
        onChange={onChange}
        options={VARIANTS.map((variant) => ({ value: variant, content: labels[variant] }))}
      />
      <p className="text-caption text-text-tertiary">{hints[value]}</p>
    </Section>
  )
}

function LogoField({
  code,
  entity,
  logo,
  onChange,
}: {
  code: string
  entity: LegalEntity
  logo: DocumentLogo | null
  onChange: (logo: DocumentLogo | null) => void
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const logoId = logo?.attachment_id ?? null

  useEffect(() => {
    if (!logoId) {
      setUrl(null)
      return
    }
    const controller = new AbortController()
    let created: string | null = null
    logoBlob(code, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUrl(null)
      })
    return () => {
      controller.abort()
      if (created) URL.revokeObjectURL(created)
    }
  }, [code, logoId])

  async function choose(file: File | undefined) {
    if (!file) return
    setProblem(null)
    if (!LOGO_TYPES.includes(file.type)) {
      setProblem(copy.docProfile.logoType)
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setProblem(copy.docProfile.logoSize)
      return
    }
    setBusy(true)
    try {
      const profile = await uploadLogo(code, file)
      onChange(profile.logo)
      toast(copy.docProfile.logoSaved, { tone: 'success' })
    } catch (err: unknown) {
      setProblem(err instanceof ApiError ? (fieldError(err, 'file') ?? err.message) : copy.api.generic)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setProblem(null)
    try {
      const profile = await removeLogo(code)
      onChange(profile.logo)
      toast(copy.docProfile.logoRemoved, { tone: 'success' })
    } catch (err: unknown) {
      setProblem(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={copy.docProfile.logo}>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-surface-subtle p-1.5">
          {logo && url ? (
            <img src={url} alt={fill(copy.docProfile.logoAlt, { entity: entityLabel(entity.code) })} className="max-h-full max-w-full object-contain" />
          ) : (
            <Image className="size-5 text-text-tertiary" strokeWidth={iconStroke} aria-hidden="true" />
          )}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <input
            ref={input}
            id="documentos-logo"
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
            <Upload strokeWidth={iconStroke} />
            {logo ? copy.docProfile.logoReplace : copy.docProfile.logoChoose}
          </Button>
          {logo ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              <Trash2 strokeWidth={iconStroke} />
              {copy.docProfile.logoRemove}
            </Button>
          ) : null}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="text-caption text-danger-600">
          {problem}
        </p>
      ) : (
        <p className="text-caption text-text-tertiary">{logo ? copy.docProfile.logoHint : `${copy.docProfile.logoNone} ${copy.docProfile.logoHint}`}</p>
      )}
    </Section>
  )
}

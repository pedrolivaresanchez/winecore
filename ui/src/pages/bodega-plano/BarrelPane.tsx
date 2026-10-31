import { useEffect, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDate, formatInteger } from '@/lib/format'
import { useApi } from '@/hooks/use-api'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Badge, Button, InfoTip, Input, Select, Skeleton, Switch, useToast } from '@/ui'
import { createBarrel, patchBarrel, type BarrelBody } from '@/pages/bodega-plano/api'
import { useBarrelTick } from '@/pages/bodega-plano/refresh'
import { barrelStatusLabel, oakLabel, OAK_ORIGINS, toastLabel, TOAST_LEVELS } from '@/pages/bodega-plano/text'
import type { BarrelStatus, BarrelView, OakOrigin, ToastLevel } from '@/pages/bodega-plano/types'

type Draft = {
  oak_origin: OakOrigin
  forest: string
  toast: ToastLevel
  head_toast: boolean
  cooper: string
  year: string
  nominal: string
}

const BLANK: Draft = {
  oak_origin: 'frances',
  forest: '',
  toast: 'medio',
  head_toast: false,
  cooper: '',
  year: '',
  nominal: '',
}

function fromBarrel(barrel: BarrelView): Draft {
  const litres = barrel.nominal_volume_ml / 1000
  return {
    oak_origin: barrel.oak_origin,
    forest: barrel.forest ?? '',
    toast: barrel.toast,
    head_toast: barrel.head_toast,
    cooper: barrel.cooper,
    year: String(barrel.year_made),
    nominal: Number.isInteger(litres) ? String(litres) : String(Math.round(litres * 1000) / 1000),
  }
}

function parseDraft(draft: Draft): BarrelBody | null {
  const year = Number(draft.year)
  const litres = Number(draft.nominal.replace(',', '.'))
  const nominal = Math.round(litres * 1000)
  const cooper = draft.cooper.trim()
  if (!Number.isInteger(year) || year < 1950 || year > 2100) return null
  if (!Number.isFinite(litres) || nominal <= 0) return null
  if (cooper.length < 2) return null
  return {
    oak_origin: draft.oak_origin,
    forest: draft.forest.trim() || null,
    toast: draft.toast,
    head_toast: draft.head_toast,
    cooper,
    year_made: year,
    nominal_volume_ml: nominal,
  }
}

function tone(status: BarrelStatus): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'in_use') return 'success'
  if (status === 'resting') return 'info'
  if (status === 'to_retire') return 'warning'
  return 'danger'
}

export function BarrelPane({ me, code }: { me: Me; code: string }) {
  const data = useApi<BarrelView>(`/v1/vessels/${encodeURIComponent(code)}/barrel`)
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const missing = data.error?.status === 404 || data.error?.code === 'WC_NOT_FOUND'
  const form = draft ?? (data.data ? fromBarrel(data.data) : BLANK)
  const retired = data.data?.status === 'retired'
  const locked = !canOperate || retired
  const ready = parseDraft(form) !== null

  useBarrelTick(code, data.reload)

  useEffect(() => {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
  }, [code])

  if (data.loading && !data.data && !data.error) {
    return (
      <div aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36" />
      </div>
    )
  }
  if (data.error && !missing) {
    return <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
  }

  function edit(patch: Partial<Draft>) {
    setDraft({ ...form, ...patch })
    setFieldErrors({})
    setFormError(null)
  }

  async function save() {
    const body = parseDraft(form)
    if (!body) return
    setBusy(true)
    setFormError(null)
    try {
      if (missing) await createBarrel(code, body)
      else await patchBarrel(code, body)
      setDraft(null)
      data.reload()
      toast(copy.plano.barrelSaved)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setFieldErrors(error.fields)
      setFormError(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4" data-screen="bodega-barrica">
      {missing ? (
        <div>
          <h2 className="text-label font-medium text-ink-900">{copy.plano.noBarrel}</h2>
          <p className="text-caption text-text-tertiary">{copy.plano.noBarrelHint}</p>
        </div>
      ) : null}
      {data.data ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={tone(data.data.status)}>{barrelStatusLabel(data.data.status)}</Badge>
          {data.data.retired_on ? <Badge tone="neutral">{formatDate(data.data.retired_on)}</Badge> : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="barrica-roble" label={copy.plano.oak} error={fieldErrors.oak_origin}>
          <Select
            id="barrica-roble"
            className="w-full"
            value={form.oak_origin}
            disabled={locked}
            onChange={(event) => edit({ oak_origin: event.target.value as OakOrigin })}
          >
            {OAK_ORIGINS.map((origin) => (
              <option key={origin} value={origin}>
                {oakLabel(origin)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="barrica-bosque" label={copy.plano.forest} error={fieldErrors.forest}>
          <Input id="barrica-bosque" value={form.forest} disabled={locked} onChange={(event) => edit({ forest: event.target.value })} />
        </Field>
        <Field id="barrica-tostado" label={copy.plano.toast} error={fieldErrors.toast}>
          <Select
            id="barrica-tostado"
            className="w-full"
            value={form.toast}
            disabled={locked}
            onChange={(event) => edit({ toast: event.target.value as ToastLevel })}
          >
            {TOAST_LEVELS.map((level) => (
              <option key={level} value={level}>
                {toastLabel(level)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="barrica-toneleria" label={copy.plano.cooper} error={fieldErrors.cooper}>
          <Input id="barrica-toneleria" value={form.cooper} disabled={locked} onChange={(event) => edit({ cooper: event.target.value })} />
        </Field>
        <Field id="barrica-ano" label={copy.plano.year} error={fieldErrors.year_made}>
          <Input id="barrica-ano" inputMode="numeric" value={form.year} disabled={locked} onChange={(event) => edit({ year: event.target.value })} />
        </Field>
        <Field id="barrica-volumen" label={copy.plano.nominal} error={fieldErrors.nominal_volume_ml}>
          <Input
            id="barrica-volumen"
            inputMode="decimal"
            suffix={<span className="text-caption text-text-tertiary">L</span>}
            value={form.nominal}
            disabled={locked}
            onChange={(event) => edit({ nominal: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle px-4 py-3">
        <span className="text-label text-ink-900">{copy.plano.headToast}</span>
        <Switch
          id="barrica-fondos"
          checked={form.head_toast}
          disabled={locked}
          aria-label={copy.plano.headToast}
          onChange={(checked) => edit({ head_toast: checked })}
        />
      </div>
      {data.data ? (
        <div className="min-w-0 max-w-xs rounded-2xl border border-border-subtle px-3 py-2">
          <div className="flex items-center gap-1 text-caption text-text-tertiary">
            {copy.plano.uses}
            <InfoTip label={copy.plano.uses}>{copy.plano.usesHelp}</InfoTip>
          </div>
          <p className="text-label font-medium text-ink-900 tabular-nums">{formatInteger(data.data.use_count)}</p>
        </div>
      ) : null}
      {formError ? (
        <p role="alert" className="text-label text-danger-600">
          {formError}
        </p>
      ) : null}
      {canOperate && !retired ? (
        <div>
          <Button type="button" variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => void save()}>
            {copy.plano.save}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

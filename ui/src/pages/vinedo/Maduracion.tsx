import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Alert, Button, Input, Select, Textarea, textureSecondary, useToast } from '@/ui'
import { Fact, FactCard } from '@/pages/bodega/chrome'
import { createMaturity, uploadParcelPhoto, type MaturityCheck, type Parcel } from '@/pages/vinedo/api'
import { BlockTitle, FormStack, ScoreScale, VineyardShell } from '@/pages/vinedo/chrome'
import { civil, seedLabel } from '@/pages/vinedo/labels'

type List = { items: Parcel[] }
type Checks = { items: MaturityCheck[] }

export function Maduracion({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const [params] = useSearchParams()
  const preset = params.get('parcela') ?? ''
  const parcels = useApi<List>('/v1/parcels')
  const checks = useApi<Checks>('/v1/maturity-checks')
  const canWrite = allows(me, 'vineyard.write')
  const [parcel, setParcel] = useState(preset)
  const active = parcel || preset

  const history = useMemo(
    () => (checks.data?.items ?? []).filter((item) => !active || item.parcel_code === active),
    [active, checks.data],
  )

  return (
    <VineyardShell section="maduracion" screen="vinedo-maduracion">
      <div className="min-h-0 flex-1 overflow-auto">
        {parcels.error ? (
          <div className="p-4">
            <ErrorState title={parcels.error.message} onRetry={parcels.reload} />
          </div>
        ) : null}
        {canWrite ? (
          <CheckForm
            parcels={parcels.data?.items.filter((item) => item.is_active) ?? []}
            parcel={active}
            onParcel={setParcel}
            onSaved={() => checks.reload()}
          />
        ) : null}
        <div className="grid gap-2 px-4 pb-6">
          <BlockTitle>{copy.vinedo.history}</BlockTitle>
          {history.length === 0 ? <p className="text-label text-text-tertiary">{copy.vinedo.emptyMaturity}</p> : null}
          {history.map((item) => (
            <FactCard key={item.id} title={`${item.parcel_code} · ${civil(item.checked_at)}`}>
              <Fact label={copy.vinedo.days} value={item.estimated_days_to_harvest == null ? '—' : String(item.estimated_days_to_harvest)} />
              <Fact label={copy.vinedo.seed} value={seedLabel(item.seed_color)} />
              <Fact label={copy.vinedo.crunch} value={item.seed_crunch == null ? '—' : item.seed_crunch ? copy.vinedo.yes : copy.vinedo.no} />
              <Fact label={copy.vinedo.astringency} value={score(item.skin_astringency)} />
              <Fact label={copy.vinedo.colorRelease} value={score(item.skin_color_release)} />
              <Fact label={copy.vinedo.sweetness} value={score(item.pulp_sweetness)} />
              <Fact label={copy.vinedo.pulpAcidity} value={score(item.pulp_acidity)} />
              <Fact label={copy.vinedo.phenolic} value={score(item.phenolic_maturity)} />
              <Fact label={copy.vinedo.sugar} value={item.sugar_gl || '—'} />
              <Fact label={copy.vinedo.author} value={item.author} />
            </FactCard>
          ))}
        </div>
      </div>
    </VineyardShell>
  )
}

function score(value: number | null): string {
  return value == null ? '—' : String(value)
}

function CheckForm({
  parcels,
  parcel,
  onParcel,
  onSaved,
}: {
  parcels: Parcel[]
  parcel: string
  onParcel: (code: string) => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [sugar, setSugar] = useState('')
  const [abv, setAbv] = useState('')
  const [acidity, setAcidity] = useState('')
  const [ph, setPh] = useState('')
  const [sanitary, setSanitary] = useState('good')
  const [days, setDays] = useState('')
  const [seed, setSeed] = useState('')
  const [crunch, setCrunch] = useState<'' | 'yes' | 'no'>('')
  const [astringency, setAstringency] = useState('')
  const [release, setRelease] = useState('')
  const [sweet, setSweet] = useState('')
  const [pulp, setPulp] = useState('')
  const [phenolic, setPhenolic] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const chosen = parcels.find((item) => item.code === parcel)

  async function submit() {
    const next: Record<string, string> = {}
    if (!parcel) next.parcel_code = copy.vinedo.required
    if (!sugar.trim()) next.sugar_gl = copy.vinedo.required
    if (!abv.trim()) next.probable_abv = copy.vinedo.required
    if (!acidity.trim()) next.total_acidity = copy.vinedo.required
    if (!ph.trim()) next.ph = copy.vinedo.required
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    try {
      let photo: string | null = null
      if (file && chosen) {
        const uploaded = await uploadParcelPhoto(chosen.id, file)
        photo = uploaded.id
      }
      await createMaturity({
        parcel_code: parcel,
        checked_at: new Date().toISOString(),
        sugar_gl: sugar.trim().replace(',', '.'),
        probable_abv: abv.trim().replace(',', '.'),
        total_acidity: acidity.trim().replace(',', '.'),
        ph: ph.trim().replace(',', '.'),
        sanitary_status: sanitary || null,
        estimated_days_to_harvest: days.trim() === '' ? null : Number(days),
        seed_color: seed || null,
        seed_crunch: crunch === '' ? null : crunch === 'yes',
        skin_astringency: astringency === '' ? null : Number(astringency),
        skin_color_release: release === '' ? null : Number(release),
        pulp_sweetness: sweet === '' ? null : Number(sweet),
        pulp_acidity: pulp === '' ? null : Number(pulp),
        phenolic_maturity: phenolic === '' ? null : Number(phenolic),
        sensory_notes: notes.trim() || null,
        photo_attachment_id: photo,
      })
      toast(copy.vinedo.saved)
      onSaved()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else setErrors({ form: error instanceof ApiError ? error.message : copy.error.load })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormStack>
      <BlockTitle>{copy.vinedo.newCheck}</BlockTitle>
      {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
      <Field id="mad-parcela" label={copy.vinedo.parcel} error={errors.parcel_code}>
        <Select id="mad-parcela" className="w-full" value={parcel} onChange={(event) => onParcel(event.target.value)}>
          <option value="">{copy.vinedo.parcel}</option>
          {parcels.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} · {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="mad-pepita" label={copy.vinedo.seed}>
          <Select id="mad-pepita" className="w-full" value={seed} onChange={(event) => setSeed(event.target.value)}>
            <option value="">{copy.vinedo.unset}</option>
            <option value="green">{copy.vinedo.seeds.green}</option>
            <option value="mixed">{copy.vinedo.seeds.mixed}</option>
            <option value="brown">{copy.vinedo.seeds.brown}</option>
          </Select>
        </Field>
        <Field id="mad-cruje" label={copy.vinedo.crunch}>
          <Select id="mad-cruje" className="w-full" value={crunch} onChange={(event) => setCrunch(event.target.value as '' | 'yes' | 'no')}>
            <option value="">{copy.vinedo.unset}</option>
            <option value="yes">{copy.vinedo.yes}</option>
            <option value="no">{copy.vinedo.no}</option>
          </Select>
        </Field>
      </div>
      <ScoreScale label={copy.vinedo.astringency} value={astringency} onChange={setAstringency} />
      <ScoreScale label={copy.vinedo.colorRelease} value={release} onChange={setRelease} />
      <ScoreScale label={copy.vinedo.sweetness} value={sweet} onChange={setSweet} />
      <ScoreScale label={copy.vinedo.pulpAcidity} value={pulp} onChange={setPulp} />
      <ScoreScale label={copy.vinedo.phenolic} value={phenolic} onChange={setPhenolic} />
      <Field id="mad-dias" label={copy.vinedo.days}>
        <Input id="mad-dias" inputMode="numeric" className="w-full" value={days} onChange={(event) => setDays(event.target.value)} />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-label text-text-secondary">{copy.vinedo.photo}</span>
        <label className={cn(textureSecondary, 'inline-flex h-8 cursor-pointer items-center rounded-md px-2.5 text-label text-ink-900')}>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? file.name : copy.vinedo.choosePhoto}
        </label>
      </div>
      <BlockTitle>{copy.vinedo.lab}</BlockTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="mad-azucar" label={copy.vinedo.sugar} error={errors.sugar_gl}>
          <Input className="w-full" inputMode="decimal" {...fieldAria('mad-azucar', errors.sugar_gl)} value={sugar} onChange={(event) => setSugar(event.target.value)} />
        </Field>
        <Field id="mad-grado" label={copy.vinedo.abv} error={errors.probable_abv}>
          <Input className="w-full" inputMode="decimal" {...fieldAria('mad-grado', errors.probable_abv)} value={abv} onChange={(event) => setAbv(event.target.value)} />
        </Field>
        <Field id="mad-acidez" label={copy.vinedo.acidity} error={errors.total_acidity}>
          <Input className="w-full" inputMode="decimal" {...fieldAria('mad-acidez', errors.total_acidity)} value={acidity} onChange={(event) => setAcidity(event.target.value)} />
        </Field>
        <Field id="mad-ph" label={copy.vinedo.ph} error={errors.ph}>
          <Input className="w-full" inputMode="decimal" {...fieldAria('mad-ph', errors.ph)} value={ph} onChange={(event) => setPh(event.target.value)} />
        </Field>
      </div>
      <Field id="mad-sanidad" label={copy.vinedo.sanitaryLabel}>
        <Select id="mad-sanidad" className="w-full" value={sanitary} onChange={(event) => setSanitary(event.target.value)}>
          <option value="good">{copy.vinedo.sanitary.good}</option>
          <option value="fair">{copy.vinedo.sanitary.fair}</option>
          <option value="poor">{copy.vinedo.sanitary.poor}</option>
        </Select>
      </Field>
      <Field id="mad-notas" label={copy.vinedo.notes}>
        <Textarea id="mad-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <Button type="button" variant="primary" size="md" loading={saving} onClick={() => void submit()}>
        {copy.vinedo.save}
      </Button>
    </FormStack>
  )
}

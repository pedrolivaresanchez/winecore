import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Alert, Badge, Button, DataGrid, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Select, useToast, type GridColumn } from '@/ui'
import {
  createProduct,
  createTreatments,
  downloadNotebook,
  patchTreatment,
  type CueItem,
  type NotebookProduct,
  type Parcel,
  type Treatment,
} from '@/pages/vinedo/api'
import { BlockTitle, FormStack, VineyardShell } from '@/pages/vinedo/chrome'
import { GRID_LABELS, civil, cueLabel, ha, todayMadrid } from '@/pages/vinedo/labels'

const CUE_FROM = '2027-01-01'

type ParcelOption = { id: string; code: string; area_ha: string; is_organic: boolean; variety: string | null }

export function Cuaderno({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const [params, setParams] = useSearchParams()
  const alta = params.get('alta') === '1'
  const canWrite = allows(me, 'vineyard.write')
  const [year, setYear] = useState(todayMadrid().slice(0, 4))
  const treatments = useApi<{ items: Treatment[] }>(`/v1/treatments?campaign=${year}`)
  const cue = useApi<{ as_of: string; items: CueItem[] }>('/v1/vineyard-notebook/cue-pending')
  const products = useApi<{ items: NotebookProduct[] }>('/v1/vineyard-notebook/products')
  const parcels = useApi<{ items: Parcel[] }>('/v1/parcels')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ date: 120, parcel: 100, product: 180, dose: 120, cue: 140 })
  const [productOpen, setProductOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const toast = useToast()

  const options = useMemo(() => parcelOptions(parcels.data?.items ?? [], treatments.data?.items ?? []), [parcels.data, treatments.data])

  function setAlta(open: boolean) {
    const next = new URLSearchParams(params)
    next.set('seccion', 'cuaderno')
    if (open) next.set('alta', '1')
    else next.delete('alta')
    setParams(next)
  }

  const columns = useMemo<GridColumn<Treatment>[]>(
    () => [
      { id: 'date', header: copy.vinedo.date, cell: (row) => civil(row.applied_on) },
      { id: 'parcel', header: copy.vinedo.parcel, cell: (row) => row.parcel_code },
      { id: 'product', header: copy.vinedo.product, cell: (row) => row.product_name },
      { id: 'dose', header: copy.vinedo.dose, cell: (row) => `${row.dose} ${row.dose_unit}` },
      {
        id: 'cue',
        header: copy.vinedo.cue,
        cell: (row) => (
          <Badge tone={row.cue.status === 'overdue' || row.cue.status === 'warn' ? 'warning' : row.cue.status === 'recorded' ? 'success' : 'neutral'} size="sm">
            {cueLabel(row.cue.status)}
          </Badge>
        ),
      },
    ],
    [],
  )

  const rows = treatments.data?.items ?? []
  const pending = cue.data?.items ?? []

  async function exportCsv() {
    setExporting(true)
    try {
      await downloadNotebook(year)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.error.load)
    } finally {
      setExporting(false)
    }
  }

  if (alta) {
    return (
      <VineyardShell section="cuaderno" screen="vinedo-cuaderno">
        <TreatmentForm
          me={me}
          options={options}
          parcelsMissing={Boolean(parcels.error) && options.length === 0}
          products={products.data?.items.filter((item) => item.is_active) ?? []}
          onProduct={() => setProductOpen(true)}
          onBack={() => setAlta(false)}
          onSaved={() => {
            setAlta(false)
            treatments.reload()
            cue.reload()
          }}
        />
        {productOpen ? (
          <ProductDialog
            onClose={() => setProductOpen(false)}
            onCreated={() => {
              setProductOpen(false)
              products.reload()
            }}
          />
        ) : null}
      </VineyardShell>
    )
  }

  return (
    <VineyardShell
      section="cuaderno"
      screen="vinedo-cuaderno"
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
            {copy.vinedo.exportCsv}
          </Button>
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={() => setAlta(true)}>
              {copy.vinedo.newTreatment}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Select aria-label={copy.vinedo.campaign} size="sm" value={year} onChange={(event) => setYear(event.target.value)}>
          {['2025', '2026', '2027'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </div>
      {pending.length > 0 ? (
        <div className="grid gap-2 border-b border-border-subtle px-4 py-3">
          <h2 className="text-label font-medium text-ink-900">{copy.vinedo.cueTitle}</h2>
          {pending.map((item) => (
            <div key={item.treatment_id} className="flex flex-wrap items-center gap-2">
              <Badge tone={item.status === 'overdue' ? 'danger' : item.status === 'warn' ? 'warning' : 'info'} size="sm">
                {cueLabel(item.status)}
              </Badge>
              <span className="text-label text-ink-900">
                {item.parcel_code} · {civil(item.applied_on)}
              </span>
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void patchTreatment(item.treatment_id, { cue_recorded_at: new Date().toISOString() })
                      .then(() => {
                        cue.reload()
                        treatments.reload()
                      })
                      .catch((error: unknown) => toast(error instanceof ApiError ? error.message : copy.error.load))
                  }}
                >
                  {copy.vinedo.markCue}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <Warnings items={rows.flatMap((row) => row.warnings.map((warning) => ({ ...warning, id: row.id })))} />
      {treatments.error ? (
        <div className="p-4">
          <ErrorState title={treatments.error.message} onRetry={treatments.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={() => setAlta(true)}
          total={rows.length}
          loading={treatments.loading}
          scrollKey="vinedo-cuaderno"
          empty={<p className="p-4 text-label text-text-tertiary">{copy.vinedo.emptyTreatments}</p>}
        />
      )}
    </VineyardShell>
  )
}

function Warnings({ items }: { items: { id: string; message: string }[] }) {
  if (items.length === 0) return null
  return (
    <div className="grid gap-2 border-b border-border-subtle px-4 py-3">
      {items.map((item) => (
        <Alert key={`${item.id}-${item.message}`} tone="warning">
          {item.message}
        </Alert>
      ))}
    </div>
  )
}

function TreatmentForm({
  me,
  options,
  parcelsMissing,
  products,
  onProduct,
  onBack,
  onSaved,
}: {
  me: Me
  options: ParcelOption[]
  parcelsMissing: boolean
  products: NotebookProduct[]
  onProduct: () => void
  onBack: () => void
  onSaved: () => void
}) {
  const canWrite = allows(me, 'vineyard.write')
  const [parcelId, setParcelId] = useState(options[0]?.id ?? '')
  const [applied, setApplied] = useState(todayMadrid())
  const [crop, setCrop] = useState('Vid')
  const [variety, setVariety] = useState(options[0]?.variety ?? '')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [dose, setDose] = useState('')
  const [area, setArea] = useState(options[0]?.area_ha ?? '')
  const [target, setTarget] = useState('')
  const [operator, setOperator] = useState(me.display_name)
  const [ropo, setRopo] = useState('')
  const [advisor, setAdvisor] = useState('')
  const [roma, setRoma] = useState('')
  const [method, setMethod] = useState('Pulverización')
  const [kind, setKind] = useState('phytosanitary')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const parcel = options.find((item) => item.id === parcelId)
  const product = products.find((item) => item.id === productId)
  const safety = product && product.safety_interval_days > 0

  function chooseParcel(id: string) {
    setParcelId(id)
    const next = options.find((item) => item.id === id)
    if (next) {
      setArea(next.area_ha)
      if (next.variety) setVariety(next.variety)
    }
  }

  function chooseProduct(id: string) {
    setProductId(id)
    const next = products.find((item) => item.id === id)
    if (next) setKind(next.product_kind)
  }

  async function submit() {
    const next = validateTreatment({
      parcel,
      product,
      applied,
      crop,
      variety,
      dose,
      area,
      target,
      operator,
      ropo,
      roma,
      method,
      kind,
    })
    setErrors(next)
    if (Object.keys(next).length > 0 || !parcel || !product) return
    setSaving(true)
    try {
      await createTreatments({
        kind,
        parcel_ids: [parcel.id],
        treated_area_ha: area.trim().replace(',', '.'),
        applied_on: applied,
        product_id: product.id,
        dose: dose.trim().replace(',', '.'),
        dose_unit: product.max_dose_unit,
        target: kind === 'phytosanitary' ? target.trim() : null,
        operator_name: operator.trim(),
        applicator_ropo: kind === 'phytosanitary' ? ropo.trim() : null,
        advisor_name: advisor.trim() || null,
        equipment_roma: roma.trim() || null,
        method: method.trim(),
        crop: crop.trim(),
        variety: variety.trim(),
      })
      onSaved()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else setErrors({ form: error instanceof ApiError ? error.message : copy.error.load })
      setSaving(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex h-11 items-center px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {copy.vinedo.backList}
        </Button>
      </div>
      <FormStack>
        <BlockTitle>{copy.vinedo.newTreatment}</BlockTitle>
        {parcelsMissing ? <Alert tone="warning">{copy.vinedo.parcelsMissing}</Alert> : null}
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        {safety && product ? (
          <Alert tone="warning">{fill(copy.vinedo.safetyWarn, { days: String(product.safety_interval_days) })}</Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tr-fecha" label={copy.vinedo.date} error={errors.applied_on}>
            <Input type="date" className="w-full" {...fieldAria('tr-fecha', errors.applied_on)} value={applied} onChange={(event) => setApplied(event.target.value)} />
          </Field>
          <Field id="tr-parcela" label={copy.vinedo.parcel} error={errors.parcel_ids}>
            <Select id="tr-parcela" className="w-full" value={parcelId} onChange={(event) => chooseParcel(event.target.value)}>
              <option value="">{copy.vinedo.parcel}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="tr-cultivo" label={copy.vinedo.crop} error={errors.crop}>
            <Input className="w-full" {...fieldAria('tr-cultivo', errors.crop)} value={crop} onChange={(event) => setCrop(event.target.value)} />
          </Field>
          <Field id="tr-variedad" label={copy.vinedo.variety} error={errors.variety}>
            <Input className="w-full" {...fieldAria('tr-variedad', errors.variety)} value={variety} onChange={(event) => setVariety(event.target.value)} />
          </Field>
        </div>
        <Field id="tr-producto" label={copy.vinedo.product} error={errors.product_id}>
          <Select id="tr-producto" className="w-full" value={productId} onChange={(event) => chooseProduct(event.target.value)}>
            <option value="">{copy.vinedo.product}</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.commercial_name}
              </option>
            ))}
          </Select>
        </Field>
        {canWrite ? (
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onProduct}>
            {copy.vinedo.newProduct}
          </Button>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tr-dosis" label={copy.vinedo.dose} error={errors.dose}>
            <Input className="w-full" inputMode="decimal" {...fieldAria('tr-dosis', errors.dose)} value={dose} onChange={(event) => setDose(event.target.value)} />
          </Field>
          <Field id="tr-unidad" label={copy.vinedo.unit}>
            <Input id="tr-unidad" className="w-full" value={product?.max_dose_unit ?? ''} readOnly />
          </Field>
          <Field id="tr-superficie" label={copy.vinedo.treatedArea} error={errors.treated_area_ha}>
            <Input className="w-full" inputMode="decimal" {...fieldAria('tr-superficie', errors.treated_area_ha)} value={area} onChange={(event) => setArea(event.target.value)} />
          </Field>
          <Field id="tr-metodo" label={copy.vinedo.method} error={errors.method}>
            <Input className="w-full" {...fieldAria('tr-metodo', errors.method)} value={method} onChange={(event) => setMethod(event.target.value)} />
          </Field>
        </div>
        {kind === 'phytosanitary' ? (
          <Field id="tr-plaga" label={copy.vinedo.target} error={errors.target}>
            <Input className="w-full" {...fieldAria('tr-plaga', errors.target)} value={target} onChange={(event) => setTarget(event.target.value)} />
          </Field>
        ) : null}
        <Field id="tr-aplicador" label={copy.vinedo.operator} error={errors.operator_name}>
          <Input className="w-full" {...fieldAria('tr-aplicador', errors.operator_name)} value={operator} onChange={(event) => setOperator(event.target.value)} />
        </Field>
        {kind === 'phytosanitary' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="tr-ropo" label={copy.vinedo.ropo} error={errors.applicator_ropo}>
              <Input className="w-full" {...fieldAria('tr-ropo', errors.applicator_ropo)} value={ropo} onChange={(event) => setRopo(event.target.value)} />
            </Field>
            <Field id="tr-roma" label={copy.vinedo.roma} error={errors.equipment_roma}>
              <Input className="w-full" {...fieldAria('tr-roma', errors.equipment_roma)} value={roma} onChange={(event) => setRoma(event.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field id="tr-asesor" label={copy.vinedo.advisor}>
          <Input id="tr-asesor" className="w-full" value={advisor} onChange={(event) => setAdvisor(event.target.value)} />
        </Field>
        {parcel ? <p className="text-caption text-text-tertiary">{ha(parcel.area_ha)}</p> : null}
        {canWrite ? (
          <Button type="button" variant="primary" size="md" loading={saving} onClick={() => void submit()}>
            {copy.vinedo.save}
          </Button>
        ) : null}
      </FormStack>
    </div>
  )
}

function validateTreatment(input: {
  parcel: ParcelOption | undefined
  product: NotebookProduct | undefined
  applied: string
  crop: string
  variety: string
  dose: string
  area: string
  target: string
  operator: string
  ropo: string
  roma: string
  method: string
  kind: string
}): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!input.applied) errors.applied_on = copy.vinedo.required
  if (!input.parcel) errors.parcel_ids = copy.vinedo.required
  if (!input.crop.trim()) errors.crop = copy.vinedo.required
  if (!input.variety.trim()) errors.variety = copy.vinedo.required
  if (!input.product) errors.product_id = copy.vinedo.required
  if (!input.operator.trim()) errors.operator_name = copy.vinedo.required
  if (!input.method.trim()) errors.method = copy.vinedo.required
  const dose = Number(input.dose.replace(',', '.'))
  if (!Number.isFinite(dose) || dose <= 0) errors.dose = copy.vinedo.required
  const area = Number(input.area.replace(',', '.'))
  if (!Number.isFinite(area) || area <= 0) errors.treated_area_ha = copy.vinedo.required
  if (input.parcel && Number.isFinite(area) && area > Number(input.parcel.area_ha)) errors.treated_area_ha = copy.vinedo.areaBlock
  if (input.product && Number.isFinite(dose) && dose > Number(input.product.max_dose)) errors.dose = copy.vinedo.doseBlock
  if (input.parcel?.is_organic && input.product && !input.product.is_organic_approved) errors.product_id = copy.vinedo.organicBlock
  if (input.kind === 'phytosanitary') {
    if (!input.target.trim()) errors.target = copy.vinedo.required
    if (input.ropo.trim().length < 4) errors.applicator_ropo = copy.vinedo.required
    if (input.applied >= CUE_FROM && !input.roma.trim()) errors.equipment_roma = copy.vinedo.romaRequired
  }
  return errors
}

function parcelOptions(parcels: Parcel[], treatments: Treatment[]): ParcelOption[] {
  const map = new Map<string, ParcelOption>()
  for (const parcel of parcels) {
    map.set(parcel.id, {
      id: parcel.id,
      code: parcel.code,
      area_ha: parcel.area_ha,
      is_organic: parcel.is_organic,
      variety: parcel.varieties[0]?.variety ?? null,
    })
  }
  for (const treatment of treatments) {
    if (map.has(treatment.parcel_id)) continue
    map.set(treatment.parcel_id, {
      id: treatment.parcel_id,
      code: treatment.parcel_code,
      area_ha: treatment.parcel_area_ha,
      is_organic: treatment.parcel_is_organic,
      variety: treatment.variety,
    })
  }
  return [...map.values()]
}

function ProductDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [registration, setRegistration] = useState('')
  const [substances, setSubstances] = useState('')
  const [organic, setOrganic] = useState('true')
  const [days, setDays] = useState('0')
  const [maxDose, setMaxDose] = useState('')
  const [unit, setUnit] = useState('kg/ha')
  const [kind, setKind] = useState('phytosanitary')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await createProduct({
        commercial_name: name.trim(),
        registration_number: registration.trim() || null,
        active_substances: substances.trim(),
        is_organic_approved: organic === 'true',
        safety_interval_days: Number(days),
        max_dose: maxDose.trim().replace(',', '.'),
        max_dose_unit: unit,
        product_kind: kind,
      })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="producto-alta" size="md">
      <DialogHeader titleId="producto-alta" title={copy.vinedo.newProduct} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          <Field id="pr-nombre" label={copy.vinedo.product}>
            <Input id="pr-nombre" className="w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field id="pr-tipo" label={copy.vinedo.kind}>
            <Select id="pr-tipo" className="w-full" value={kind} onChange={(event) => setKind(event.target.value)}>
              {Object.entries(copy.vinedo.productKinds).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="pr-registro" label={copy.vinedo.registration}>
            <Input id="pr-registro" className="w-full" value={registration} onChange={(event) => setRegistration(event.target.value)} />
          </Field>
          <Field id="pr-materia" label={copy.vinedo.substances}>
            <Input id="pr-materia" className="w-full" value={substances} onChange={(event) => setSubstances(event.target.value)} />
          </Field>
          <Field id="pr-eco" label={copy.vinedo.organicApproved}>
            <Select id="pr-eco" className="w-full" value={organic} onChange={(event) => setOrganic(event.target.value)}>
              <option value="true">{copy.vinedo.yes}</option>
              <option value="false">{copy.vinedo.no}</option>
            </Select>
          </Field>
          <Field id="pr-plazo" label={copy.vinedo.safetyDays}>
            <Input id="pr-plazo" inputMode="numeric" className="w-full" value={days} onChange={(event) => setDays(event.target.value)} />
          </Field>
          <Field id="pr-max" label={copy.vinedo.maxDose}>
            <Input id="pr-max" inputMode="decimal" className="w-full" value={maxDose} onChange={(event) => setMaxDose(event.target.value)} />
          </Field>
          <Field id="pr-unidad" label={copy.vinedo.unit}>
            <Select id="pr-unidad" className="w-full" value={unit} onChange={(event) => setUnit(event.target.value)}>
              {['kg/ha', 'l/ha', 'g/hl', 'ml/hl'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.vinedo.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

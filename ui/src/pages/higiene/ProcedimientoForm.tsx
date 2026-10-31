import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import {
  CLASS_IDS,
  CODE_RE,
  DOSE_UNITS,
  PURPOSES,
  createProcedure,
  decimal3,
  errorFields,
  errorText,
  patchProcedure,
  showDecimal,
  wholeNumber,
  type DoseUnit,
  type Procedure,
  type Purpose,
} from '@/pages/higiene/api'
import { EffluentField } from '@/pages/higiene/fields'
import { MoreMenu, RecordPage } from '@/pages/higiene/frame'
import { EQUIPMENT_CLASSES, VESSEL_CLASSES, classLabel, isPurpose, purposeLabel } from '@/pages/higiene/labels'
import { useLookups } from '@/pages/higiene/use-lookups'
import { Alert, Badge, Button, Checkbox, Input, MenuItem, Select, Skeleton, useToast } from '@/ui'

type Draft = {
  code: string
  name: string
  purpose: Purpose
  productName: string
  productId: string
  substance: string
  doseMin: string
  doseMax: string
  doseUnit: DoseUnit
  concentration: string
  contact: string
  rinse: boolean
  classes: string[]
  active: boolean
}

function emptyDraft(): Draft {
  return {
    code: '',
    name: '',
    purpose: 'cleaning',
    productName: '',
    productId: '',
    substance: '',
    doseMin: '',
    doseMax: '',
    doseUnit: 'g/hl',
    concentration: '',
    contact: '15',
    rinse: true,
    classes: ['tank_storage'],
    active: true,
  }
}

function fromProcedure(row: Procedure): Draft {
  return {
    code: row.code,
    name: row.name,
    purpose: row.purpose,
    productName: row.product_name,
    productId: row.product_id ?? '',
    substance: row.active_substance,
    doseMin: showDecimal(row.dose_min),
    doseMax: showDecimal(row.dose_max),
    doseUnit: row.dose_unit,
    concentration: row.concentration ?? '',
    contact: String(row.contact_time_min),
    rinse: row.rinse_required,
    classes: row.applicable_classes,
    active: row.is_active,
  }
}

export function ProcedimientoForm({ me, procedureId }: { me: Me; procedureId: string | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const remote = useApi<Procedure>(procedureId ? `/v1/hygiene/procedures/${procedureId}` : null)
  const lookups = useLookups(isOwner(me))
  const [draft, setDraft] = useState<Draft | null>(procedureId ? null : emptyDraft())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  useChromeTitle(draft?.name || copy.higiene.newProcedure)

  useEffect(() => {
    if (remote.data) setDraft(fromProcedure(remote.data))
  }, [remote.data])

  if (!isOwner(me)) return <NoPermission />
  if (!allows(me, 'cellar.read')) return <NoPermission />

  function patch(partial: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...partial } : current))
  }

  function toggleClass(id: string) {
    setDraft((current) => {
      if (!current) return current
      const has = current.classes.includes(id)
      return { ...current, classes: has ? current.classes.filter((item) => item !== id) : [...current.classes, id] }
    })
  }

  async function save() {
    if (!draft) return
    const next = validate(draft, procedureId === null)
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length > 0) return
    const doseMin = decimal3(draft.doseMin)
    const doseMax = decimal3(draft.doseMax)
    const contact = wholeNumber(draft.contact, 10_080)
    if (!doseMin || !doseMax || contact === null) return
    const body = {
      name: draft.name.trim(),
      purpose: draft.purpose,
      product_name: draft.productName.trim(),
      product_id: draft.productId || null,
      active_substance: draft.substance.trim(),
      dose_min: doseMin,
      dose_max: doseMax,
      dose_unit: draft.doseUnit,
      concentration: draft.concentration.trim() || null,
      contact_time_min: contact,
      rinse_required: draft.rinse,
      applicable_classes: draft.classes.filter((id) => (CLASS_IDS as readonly string[]).includes(id)),
      effluent_destination: copy.higiene.effluentPending,
      is_active: draft.active,
    }
    setSaving(true)
    try {
      const saved = procedureId
        ? await patchProcedure(procedureId, body)
        : await createProcedure({ ...body, code: draft.code.trim().toUpperCase() })
      toast(copy.higiene.saved)
      navigate(`/bodega/higiene/procedimientos/${saved.id}`)
    } catch (error: unknown) {
      setErrors(errorFields(error))
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  async function setActive(active: boolean) {
    if (!procedureId) return
    setSaving(true)
    try {
      const saved = await patchProcedure(procedureId, { is_active: active })
      setDraft(fromProcedure(saved))
      toast(copy.higiene.saved)
    } catch (error: unknown) {
      toast(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <RecordPage
      screen="higiene-procedimiento"
      backTo="/bodega/higiene/procedimientos"
      backLabel={copy.higiene.backProcedures}
      actions={
        procedureId && draft ? (
          <MoreMenu label={copy.higiene.more}>
            {(close) => (
              <MenuItem
                tone={draft.active ? 'danger' : 'default'}
                onClick={() => {
                  close()
                  void setActive(!draft.active)
                }}
              >
                {draft.active ? copy.higiene.deactivate : copy.higiene.activate}
              </MenuItem>
            )}
          </MoreMenu>
        ) : null
      }
      footer={
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {copy.higiene.save}
        </Button>
      }
    >
      {procedureId && !draft ? (
        remote.error ? (
          <ErrorState title={`${copy.error.load} (${remote.error.code})`} detail={remote.error.message} onRetry={remote.reload} />
        ) : (
          <div aria-busy="true" className="grid gap-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : draft ? (
        <>
          <header className="grid gap-2">
            <h1 className="text-body font-medium text-ink-900">{draft.name || copy.higiene.newProcedure}</h1>
            <Badge tone={draft.active ? 'success' : 'neutral'}>{draft.active ? copy.higiene.active : copy.higiene.inactive}</Badge>
          </header>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <section className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="proc-codigo" label={copy.higiene.code} error={errors.code}>
                <Input
                  id="proc-codigo"
                  value={draft.code}
                  readOnly={procedureId !== null}
                  className="font-mono"
                  invalid={Boolean(errors.code)}
                  onChange={(event) => patch({ code: event.target.value.toUpperCase() })}
                />
              </Field>
              <Field id="proc-nombre" label={copy.higiene.name} error={errors.name}>
                <Input id="proc-nombre" value={draft.name} invalid={Boolean(errors.name)} onChange={(event) => patch({ name: event.target.value })} />
              </Field>
            </div>
            <Field id="proc-finalidad" label={copy.higiene.purpose}>
              <Select
                id="proc-finalidad"
                className="w-full"
                value={draft.purpose}
                onChange={(event) => {
                  if (isPurpose(event.target.value)) patch({ purpose: event.target.value })
                }}
              >
                {PURPOSES.map((item) => (
                  <option key={item} value={item}>
                    {purposeLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="proc-producto" label={copy.higiene.productName} error={errors.product_name}>
              <Input id="proc-producto" value={draft.productName} onChange={(event) => patch({ productName: event.target.value })} />
            </Field>
            <Field id="proc-catalogo" label={copy.higiene.catalogProduct}>
              <Select id="proc-catalogo" className="w-full" value={draft.productId} onChange={(event) => patch({ productId: event.target.value })}>
                <option value="">{copy.higiene.none}</option>
                {lookups.data.products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="proc-sustancia" label={copy.higiene.substance} error={errors.active_substance}>
              <Input id="proc-sustancia" value={draft.substance} onChange={(event) => patch({ substance: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="proc-min" label={copy.higiene.doseMin} error={errors.dose_min}>
                <Input id="proc-min" inputMode="decimal" value={draft.doseMin} invalid={Boolean(errors.dose_min)} onChange={(event) => patch({ doseMin: event.target.value })} />
              </Field>
              <Field id="proc-max" label={copy.higiene.doseMax} error={errors.dose_max}>
                <Input id="proc-max" inputMode="decimal" value={draft.doseMax} invalid={Boolean(errors.dose_max)} onChange={(event) => patch({ doseMax: event.target.value })} />
              </Field>
              <Field id="proc-unidad" label={copy.higiene.doseUnit}>
                <Select id="proc-unidad" className="w-full" value={draft.doseUnit} onChange={(event) => patch({ doseUnit: event.target.value as DoseUnit })}>
                  {DOSE_UNITS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="proc-concentracion" label={copy.higiene.concentration}>
                <Input id="proc-concentracion" value={draft.concentration} onChange={(event) => patch({ concentration: event.target.value })} />
              </Field>
              <Field id="proc-contacto" label={copy.higiene.minutes} error={errors.contact_time_min}>
                <Input id="proc-contacto" inputMode="numeric" value={draft.contact} invalid={Boolean(errors.contact_time_min)} onChange={(event) => patch({ contact: event.target.value })} />
              </Field>
            </div>
            <Checkbox checked={draft.rinse} label={copy.higiene.rinse} onChange={(value) => patch({ rinse: value })} />
            <EffluentField id="efluente-procedimiento" />
          </section>
          <section className="grid gap-3">
            <h2 className="text-label font-medium text-ink-900">{copy.higiene.classes}</h2>
            {errors.applicable_classes ? <p className="text-caption text-danger-600">{errors.applicable_classes}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <ClassGroup title={copy.higiene.vessels} ids={VESSEL_CLASSES} selected={draft.classes} onToggle={toggleClass} />
              <ClassGroup title={copy.higiene.equipmentClasses} ids={EQUIPMENT_CLASSES} selected={draft.classes} onToggle={toggleClass} />
            </div>
          </section>
        </>
      ) : null}
    </RecordPage>
  )
}

function ClassGroup({
  title,
  ids,
  selected,
  onToggle,
}: {
  title: string
  ids: string[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="grid gap-2 rounded-2xl border border-border-subtle p-4">
      <h3 className="text-caption text-text-tertiary">{title}</h3>
      {ids.map((id) => (
        <Checkbox key={id} checked={selected.includes(id)} label={classLabel(id)} onChange={() => onToggle(id)} />
      ))}
    </div>
  )
}

function validate(draft: Draft, creating: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (creating && !CODE_RE.test(draft.code.trim().toUpperCase())) errors.code = copy.higiene.code
  if (!draft.name.trim()) errors.name = copy.higiene.name
  if (!draft.productName.trim()) errors.product_name = copy.higiene.productName
  if (!draft.substance.trim()) errors.active_substance = copy.higiene.substance
  const min = decimal3(draft.doseMin)
  const max = decimal3(draft.doseMax)
  if (!min) errors.dose_min = copy.higiene.doseMin
  if (!max) errors.dose_max = copy.higiene.doseMax
  if (min && max && Number(max) < Number(min)) errors.dose_max = copy.higiene.doseMax
  const contact = wholeNumber(draft.contact, 10_080)
  if (contact === null || contact <= 0) errors.contact_time_min = copy.higiene.minutes
  if (draft.classes.length === 0) errors.applicable_classes = copy.higiene.needClass
  return errors
}

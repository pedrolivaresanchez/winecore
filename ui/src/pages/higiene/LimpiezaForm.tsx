import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { confirmOperation, createOperation } from '@/lib/cellar'
import { isoToMadridInput } from '@/pages/existencias/time'
import {
  createCleaningLog,
  decimal3,
  errorFields,
  errorText,
  pastInstant,
  todayMadrid,
  wholeNumber,
  type Procedure,
} from '@/pages/higiene/api'
import { EffluentField } from '@/pages/higiene/fields'
import { RecordPage } from '@/pages/higiene/frame'
import { classLabel, dateLabels, doseText } from '@/pages/higiene/labels'
import { useLookups } from '@/pages/higiene/use-lookups'
import { Alert, Button, DatePicker, Input, Select, Switch, Textarea, useToast } from '@/ui'

type Detail = {
  id: string
  status: string
  occurred_at: string
  legal_entity_id: string
  performed_by: string
  cleaning: { vessel_id?: string | null; product_id?: string | null } | null
}

const UNITS = ['l', 'ml', 'kg', 'g'] as const

export function LimpiezaForm({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const operationId = params.get('operation')
  const { entities } = useEntity()
  const lookups = useLookups(allows(me, 'cellar.operate'))
  const existing = useApi<Detail>(operationId ? `/v1/cellar-operations/${operationId}` : null)
  useChromeTitle(copy.higiene.newCleaning)
  const seeded = useRef(false)
  const [day, setDay] = useState<string | null>(todayMadrid())
  const [entityId, setEntityId] = useState(entities.find((item) => item.code === 'PO')?.id ?? entities[0]?.id ?? '')
  const [vesselId, setVesselId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [productId, setProductId] = useState('')
  const [substance, setSubstance] = useState('')
  const [quantity, setQuantity] = useState('1.000')
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('l')
  const [efficacy, setEfficacy] = useState('Aclarado')
  const [dose, setDose] = useState('')
  const [contact, setContact] = useState('')
  const [rinsed, setRinsed] = useState(true)
  const [operator, setOperator] = useState(me.display_name)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loggedId, setLoggedId] = useState<string | null>(null)

  useEffect(() => {
    if (!existing.data || seeded.current) return
    seeded.current = true
    const item = existing.data
    setEntityId(item.legal_entity_id)
    setOperator(item.performed_by || me.display_name)
    setDay(isoToMadridInput(item.occurred_at).slice(0, 10))
    setVesselId(item.cleaning?.vessel_id ?? '')
    if (item.cleaning?.product_id) setProductId(item.cleaning.product_id)
  }, [existing.data, me.display_name])

  const procedure = lookups.data.procedures.find((item) => item.id === procedureId) ?? null
  const products = useMemo(() => productOptions(lookups.data.consumables, lookups.data.products), [lookups.data])
  const equipment = lookups.data.equipment.filter((item) => item.status === 'in_service')

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (!allows(me, 'cellar.operate')) return <NoPermission />

  function chooseProcedure(id: string) {
    const next = lookups.data.procedures.find((item) => item.id === id) ?? null
    setProcedureId(id)
    if (!next) return
    setContact(String(next.contact_time_min))
    setRinsed(next.rinse_required)
    setSubstance(next.active_substance)
    if (next.product_id) setProductId(next.product_id)
  }

  async function save() {
    const next = validate(day, procedure, dose, contact, rinsed, vesselId, equipmentId, productId, substance, quantity, efficacy, operator, lookups.data.vessels, lookups.data.equipment)
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length > 0 || !procedure || !day) return
    const doseValue = decimal3(dose)
    const minutes = wholeNumber(contact, 10_080)
    if (!doseValue || minutes === null || minutes <= 0) return
    setSaving(true)
    try {
      const id = await ensureOperation()
      if (!loggedId) {
        try {
          await createCleaningLog({
            operation_id: id,
            procedure_id: procedure.id,
            actual_dose: doseValue,
            actual_dose_unit: procedure.dose_unit,
            actual_contact_time_min: minutes,
            rinsed,
            operator: operator.trim(),
            vessel_id: vesselId || null,
            equipment_id: equipmentId || null,
            notes: notes.trim() || null,
          })
          setLoggedId(id)
        } catch (error) {
          const fields = errorFields(error)
          if (!fields.operation_id) throw error
          setLoggedId(id)
        }
      }
      await confirmOperation(id)
      toast(copy.higiene.saved)
      navigate('/bodega/higiene')
    } catch (error: unknown) {
      const fields = errorFields(error)
      if (Object.keys(fields).length > 0) setErrors(fields)
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  async function ensureOperation(): Promise<string> {
    if (operationId) return operationId
    if (loggedId) return loggedId
    const created = await createOperation({
      op_type: 'cleaning',
      legal_entity_id: entityId,
      occurred_at: pastInstant(day ?? todayMadrid()),
      fiscal_date: day,
      performed_by: operator.trim(),
      cleaning: {
        vessel_id: vesselId || null,
        product_id: productId,
        active_substance: substance.trim(),
        quantity: quantity.trim(),
        quantity_unit: unit,
        efficacy_check: efficacy.trim(),
      },
    })
    return created.id
  }

  return (
    <RecordPage
      screen="higiene-limpieza"
      backTo="/bodega/higiene"
      backLabel={copy.higiene.backCleanings}
      footer={
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          {loggedId ? copy.higiene.confirm : copy.higiene.save}
        </Button>
      }
    >
      <header>
        <h1 className="text-body font-medium text-ink-900">{copy.higiene.newCleaning}</h1>
      </header>
      {lookups.error ? <ErrorState title={`${copy.error.load} (${lookups.error.code})`} detail={lookups.error.message} onRetry={lookups.reload} /> : null}
      {existing.error ? <ErrorState title={`${copy.error.load} (${existing.error.code})`} detail={existing.error.message} onRetry={existing.reload} /> : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <section className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="limpieza-fecha" label={copy.higiene.date} error={errors.occurred_on}>
            <DatePicker value={day} onChange={setDay} locale="es" labels={dateLabels()} className="w-full" />
          </Field>
          {entities.length > 1 ? (
            <Field id="limpieza-entidad" label={copy.higiene.entity}>
              <Select id="limpieza-entidad" className="w-full" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        <Field id="limpieza-recipiente" label={copy.higiene.vessel} error={errors.vessel_id}>
          <Select id="limpieza-recipiente" className="w-full" value={vesselId} onChange={(event) => setVesselId(event.target.value)}>
            <option value="">{copy.higiene.none}</option>
            {lookups.data.vessels.map((vessel) => (
              <option key={vessel.id} value={vessel.id}>
                {vessel.code} · {classLabel(vessel.kind)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="limpieza-equipo" label={copy.higiene.equipmentField} error={errors.equipment_id}>
          <Select id="limpieza-equipo" className="w-full" value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}>
            <option value="">{copy.higiene.none}</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </section>
      <section className="grid gap-3">
        <Field id="limpieza-procedimiento" label={copy.higiene.procedure} error={errors.procedure_id}>
          <Select id="limpieza-procedimiento" className="w-full" value={procedureId} onChange={(event) => chooseProcedure(event.target.value)}>
            <option value="">{copy.higiene.none}</option>
            {lookups.data.procedures.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </Select>
        </Field>
        {procedure ? <p className="text-caption text-text-tertiary">{doseText(procedure.dose_min, procedure.dose_max, procedure.dose_unit)}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="limpieza-dosis" label={copy.higiene.dose} error={errors.actual_dose} hint={procedure ? procedure.dose_unit : undefined}>
            <Input id="limpieza-dosis" inputMode="decimal" value={dose} invalid={Boolean(errors.actual_dose)} onChange={(event) => setDose(event.target.value)} />
          </Field>
          <Field id="limpieza-minutos" label={copy.higiene.minutes} error={errors.actual_contact_time_min} hint={procedure ? fill(copy.higiene.contactHint, { min: String(procedure.contact_time_min) }) : undefined}>
            <Input id="limpieza-minutos" inputMode="numeric" value={contact} invalid={Boolean(errors.actual_contact_time_min)} onChange={(event) => setContact(event.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="limpieza-aclarado" className="text-label text-text-secondary">
            {copy.higiene.rinse}
          </label>
          <Switch id="limpieza-aclarado" checked={rinsed} onChange={setRinsed} />
        </div>
        {errors.rinsed ? <p className="text-caption text-danger-600">{errors.rinsed}</p> : null}
        <EffluentField id="efluente-formulario" />
      </section>
      <section className="grid gap-3">
        <Field id="limpieza-producto" label={copy.higiene.product} error={errors.product_id}>
          <Select id="limpieza-producto" className="w-full" value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">{copy.higiene.none}</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} · {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="limpieza-cantidad" label={copy.higiene.quantity}>
            <Input id="limpieza-cantidad" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field id="limpieza-unidad" label={copy.higiene.unit}>
            <Select id="limpieza-unidad" className="w-full" value={unit} onChange={(event) => setUnit(event.target.value as (typeof UNITS)[number])}>
              {UNITS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="limpieza-sustancia" label={copy.higiene.substance}>
          <Input id="limpieza-sustancia" value={substance} onChange={(event) => setSubstance(event.target.value)} />
        </Field>
        <Field id="limpieza-comprobacion" label={copy.higiene.efficacy}>
          <Input id="limpieza-comprobacion" value={efficacy} onChange={(event) => setEfficacy(event.target.value)} />
        </Field>
        <Field id="limpieza-operario" label={copy.higiene.operator} error={errors.operator}>
          <Input id="limpieza-operario" value={operator} onChange={(event) => setOperator(event.target.value)} />
        </Field>
        <Field id="limpieza-notas" label={copy.higiene.notes}>
          <Textarea id="limpieza-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </section>
    </RecordPage>
  )
}

function productOptions(
  consumables: { product_id: string; sku: string; name: string }[],
  products: { id: string; sku: string; name: string }[],
) {
  const seen = new Set<string>()
  const out: { id: string; sku: string; name: string }[] = []
  for (const item of consumables) {
    seen.add(item.product_id)
    out.push({ id: item.product_id, sku: item.sku, name: item.name })
  }
  for (const item of products) {
    if (seen.has(item.id)) continue
    out.push(item)
  }
  return out
}

function validate(
  day: string | null,
  procedure: Procedure | null,
  dose: string,
  contact: string,
  rinsed: boolean,
  vesselId: string,
  equipmentId: string,
  productId: string,
  substance: string,
  quantity: string,
  efficacy: string,
  operator: string,
  vessels: { id: string; kind: string }[],
  equipment: { id: string; kind: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!day || day > todayMadrid()) errors.occurred_on = copy.higiene.future
  if (!procedure) errors.procedure_id = copy.higiene.procedure
  if (!productId) errors.product_id = copy.higiene.product
  if (!substance.trim()) errors.active_substance = copy.higiene.substance
  if (!quantity.trim()) errors.quantity = copy.higiene.quantity
  if (!efficacy.trim()) errors.efficacy_check = copy.higiene.efficacy
  if (!operator.trim()) errors.operator = copy.higiene.operator
  if (!vesselId && !equipmentId) errors.vessel_id = copy.higiene.needTarget
  const parsed = decimal3(dose)
  if (!parsed) errors.actual_dose = copy.higiene.dose
  const minutes = wholeNumber(contact, 10_080)
  if (minutes === null || minutes <= 0) errors.actual_contact_time_min = copy.higiene.minutes
  if (procedure && parsed) {
    const actual = Number(parsed)
    if (actual < Number(procedure.dose_min) || actual > Number(procedure.dose_max)) errors.actual_dose = copy.higiene.outOfRange
  }
  if (procedure && minutes !== null && minutes < procedure.contact_time_min) errors.actual_contact_time_min = copy.higiene.shortContact
  if (procedure?.rinse_required && !rinsed) errors.rinsed = copy.higiene.needRinse
  const vessel = vessels.find((item) => item.id === vesselId)
  const tool = equipment.find((item) => item.id === equipmentId)
  if (procedure && vessel && !procedure.applicable_classes.includes(vessel.kind)) errors.vessel_id = copy.higiene.scope
  if (procedure && tool && !procedure.applicable_classes.includes(tool.kind)) errors.equipment_id = copy.higiene.scope
  return errors
}

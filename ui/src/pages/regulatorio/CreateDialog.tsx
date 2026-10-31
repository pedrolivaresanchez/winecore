import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { entityName } from '@/lib/labels'
import type { Me } from '@/lib/types'
import { createSubmission } from '@/pages/regulatorio/api'
import { DATE_LABELS, warehouseOptionLabel, type WarehouseOption } from '@/pages/regulatorio/model'
import { Alert, Button, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, SegmentedControl, Select, useToast } from '@/ui'

export function CreateDialog({
  open,
  onClose,
  me,
  warehouses,
  initial,
}: {
  open: boolean
  onClose: () => void
  me: Me
  warehouses: WarehouseOption[]
  initial?: { entityId?: string; warehouseId?: string; periodStart?: string; periodEnd?: string }
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [entityId, setEntityId] = useState(initial?.entityId ?? me.entities[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState('')
  const [start, setStart] = useState<string | null>(initial?.periodStart ?? null)
  const [end, setEnd] = useState<string | null>(initial?.periodEnd ?? null)
  const [aggregation, setAggregation] = useState<'monthly' | 'none'>('monthly')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const housed = me.entities.find((entity) => warehouses.some((item) => item.entityId === entity.id))
    const preferred = initial?.entityId && me.entities.some((entity) => entity.id === initial.entityId) ? initial.entityId : null
    setEntityId(preferred ?? housed?.id ?? me.entities[0]?.id ?? '')
    setWarehouseId(initial?.warehouseId ?? '')
    setStart(initial?.periodStart ?? null)
    setEnd(initial?.periodEnd ?? null)
    setAggregation('monthly')
    setErrors({})
    setBanner(null)
  }, [initial?.entityId, initial?.periodEnd, initial?.periodStart, initial?.warehouseId, me.entities, open, warehouses])

  const options = useMemo(
    () => warehouses.filter((item) => item.entityId === entityId),
    [entityId, warehouses],
  )

  useEffect(() => {
    if (!open) return
    if (initial?.warehouseId && options.some((item) => item.id === initial.warehouseId)) {
      setWarehouseId(initial.warehouseId)
      return
    }
    if (options.length === 1 && options[0]) setWarehouseId(options[0].id)
  }, [initial?.warehouseId, open, options])

  async function submit() {
    const next: Record<string, string> = {}
    if (!entityId) next.legal_entity_id = copy.regulatorio.entity
    if (!warehouseId) next.tax_warehouse_id = copy.regulatorio.noWarehouse
    if (!start || !end || start > end) next.period = copy.regulatorio.period
    setErrors(next)
    if (Object.keys(next).length > 0 || !start || !end) return
    setBusy(true)
    setBanner(null)
    try {
      const created = await createSubmission({
        legalEntityId: entityId,
        taxWarehouseId: warehouseId,
        periodStart: start,
        periodEnd: end,
        aggregation,
      })
      toast(copy.regulatorio.created, { tone: 'success' })
      onClose()
      navigate(`/regulatorio/envios/${created.id}`)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      setBanner(error instanceof ApiError ? error.message : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="nueva-presentacion" size="sm">
      <DialogHeader titleId="nueva-presentacion" title={copy.regulatorio.new} onClose={onClose} />
      <DialogBody>
        <form
          id="nueva-presentacion-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {banner ? <Alert tone="danger">{banner}</Alert> : null}
          <Field id="presentacion-entidad" label={copy.regulatorio.entity} error={errors.legal_entity_id}>
            <Select
              id="presentacion-entidad"
              value={entityId}
              className="w-full"
              onChange={(event) => {
                setEntityId(event.target.value)
                setWarehouseId('')
              }}
            >
              {me.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entityName(entity.code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="presentacion-establecimiento" label={copy.regulatorio.warehouse} error={errors.tax_warehouse_id}>
            <Select
              id="presentacion-establecimiento"
              value={warehouseId}
              className="w-full"
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              <option value="">{copy.regulatorio.warehouse}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {warehouseOptionLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="presentacion-desde" label={copy.regulatorio.from} error={errors.period_start ?? errors.period}>
              <DatePicker
                value={start}
                locale="es"
                timeZone="Europe/Madrid"
                labels={DATE_LABELS}
                className="w-full"
                onChange={setStart}
              />
            </Field>
            <Field id="presentacion-hasta" label={copy.regulatorio.to} error={errors.period_end}>
              <DatePicker
                value={end}
                locale="es"
                timeZone="Europe/Madrid"
                labels={DATE_LABELS}
                className="w-full"
                onChange={setEnd}
              />
            </Field>
          </div>
          <Field id="presentacion-agregacion" label={copy.regulatorio.aggregation}>
            <SegmentedControl
              size="sm"
              aria-label={copy.regulatorio.aggregation}
              value={aggregation}
              onChange={setAggregation}
              options={[
                { value: 'monthly', content: copy.regulatorio.monthly },
                { value: 'none', content: copy.regulatorio.detail },
              ]}
            />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.regulatorio.cancel}
        </Button>
        <Button type="submit" form="nueva-presentacion-form" variant="primary" size="sm" loading={busy}>
          {copy.regulatorio.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

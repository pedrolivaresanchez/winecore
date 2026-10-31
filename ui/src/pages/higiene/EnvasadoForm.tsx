import { useEffect, useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError, isAbortError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { confirmOperation } from '@/lib/cellar'
import type { Me } from '@/lib/types'
import {
  errorFields,
  errorText,
  getBottlingCheck,
  linkOperationEquipment,
  putBottlingCheck,
  wholeNumber,
  type ClosureType,
  type SealType,
} from '@/pages/higiene/api'
import { MoreMenu, RecordPage } from '@/pages/higiene/frame'
import { closureLabel, isClosure, isSeal, sealLabel } from '@/pages/higiene/labels'
import { useLookups } from '@/pages/higiene/use-lookups'
import { Alert, Badge, Button, Input, MenuItem, SegmentedControl, Select, Skeleton, Switch, Textarea, useToast } from '@/ui'

type Op = {
  id: string
  number: string | null
  status: string
  op_type: string
  performed_by: string
}

export function EnvasadoForm({ me, operationId }: { me: Me; operationId: string }) {
  const toast = useToast()
  const operation = useApi<Op>(allows(me, 'cellar.read') ? `/v1/cellar-operations/${operationId}` : null)
  const lookups = useLookups(allows(me, 'cellar.read'))
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [bottles, setBottles] = useState(true)
  const [procedureId, setProcedureId] = useState('')
  const [fill, setFill] = useState('0')
  const [closureRejects, setClosureRejects] = useState('0')
  const [labelRejects, setLabelRejects] = useState('0')
  const [equipmentId, setEquipmentId] = useState('')
  const [closure, setClosure] = useState<ClosureType>('natural_cork')
  const [seal, setSeal] = useState<SealType>('capsule')
  const [operator, setOperator] = useState(me.display_name)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  useChromeTitle(operation.data?.number || copy.higiene.bottling)

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    getBottlingCheck(operationId, controller.signal)
      .then((row) => {
        if (!active) return
        if (row) {
          setBottles(row.bottles_disinfected)
          setProcedureId(row.disinfection_procedure_id ?? '')
          setFill(String(row.fill_rejects))
          setClosureRejects(String(row.closure_rejects))
          setLabelRejects(String(row.label_rejects))
          setEquipmentId(row.equipment_id)
          setClosure(row.closure_type)
          setSeal(row.seal_type)
          setOperator(row.operator)
          setNotes(row.notes ?? '')
        }
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setCheckError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoaded(true)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [me, operationId])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const draft = operation.data?.status === 'draft'
  const canEdit = draft && allows(me, 'cellar.operate')
  const procedures = lookups.data.procedures.filter((item) => item.purpose !== 'cleaning')
  const equipment = lookups.data.equipment.filter((item) => item.status === 'in_service' || item.id === equipmentId)

  function payload(): Record<string, unknown> | null {
    const next: Record<string, string> = {}
    const fillN = wholeNumber(fill)
    const closureN = wholeNumber(closureRejects)
    const labelN = wholeNumber(labelRejects)
    if (fillN === null) next.fill_rejects = copy.higiene.fillRejects
    if (closureN === null) next.closure_rejects = copy.higiene.closureRejects
    if (labelN === null) next.label_rejects = copy.higiene.labelRejects
    if (!equipmentId) next.equipment_id = copy.higiene.equipmentField
    if (!operator.trim()) next.operator = copy.higiene.operator
    if (bottles && !procedureId) next.disinfection_procedure_id = copy.higiene.procedure
    if (!bottles && procedureId) next.disinfection_procedure_id = copy.higiene.procedure
    setErrors(next)
    if (Object.keys(next).length > 0 || fillN === null || closureN === null || labelN === null) return null
    return {
      bottles_disinfected: bottles,
      disinfection_procedure_id: bottles ? procedureId : null,
      fill_rejects: fillN,
      closure_rejects: closureN,
      label_rejects: labelN,
      equipment_id: equipmentId,
      closure_type: closure,
      seal_type: seal,
      notes: notes.trim() || null,
      operator: operator.trim(),
    }
  }

  async function save() {
    const body = payload()
    setFormError('')
    if (!body) return false
    setSaving(true)
    try {
      await putBottlingCheck(operationId, body)
      try {
        await linkOperationEquipment(operationId, { equipment_id: equipmentId, role: 'used' })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 422) throw error
      }
      toast(copy.higiene.saved)
      return true
    } catch (error: unknown) {
      setErrors(errorFields(error))
      setFormError(errorText(error, copy.higiene.failed))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function confirm() {
    const ok = await save()
    if (!ok) return
    setSaving(true)
    try {
      await confirmOperation(operationId)
      toast(copy.higiene.confirmed)
      operation.reload()
    } catch (error: unknown) {
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <RecordPage
      screen="higiene-envasado-ficha"
      backTo="/bodega/higiene/envasado"
      backLabel={copy.higiene.backBottling}
      actions={
        canEdit ? (
          <MoreMenu label={copy.higiene.more}>
            {(close) => (
              <MenuItem
                onClick={() => {
                  close()
                  void confirm()
                }}
              >
                {copy.higiene.confirm}
              </MenuItem>
            )}
          </MoreMenu>
        ) : null
      }
      footer={
        canEdit ? (
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {copy.higiene.save}
          </Button>
        ) : null
      }
    >
      {operation.loading || !loaded ? (
        <div aria-busy="true" className="grid gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40" />
        </div>
      ) : operation.error || !operation.data ? (
        <ErrorState title={`${copy.error.load} (${operation.error?.code ?? 'WC_ERROR'})`} detail={operation.error?.message} onRetry={operation.reload} />
      ) : operation.data.op_type !== 'bottling' ? (
        <Alert tone="danger">{copy.higiene.failed}</Alert>
      ) : (
        <>
          <header className="grid gap-2">
            <h1 className="text-body font-medium text-ink-900">{operation.data.number || copy.higiene.draft}</h1>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={draft ? 'warning' : 'success'}>{draft ? copy.higiene.draft : copy.higiene.confirmed}</Badge>
              <Badge tone="neutral">{closureLabel(closure)}</Badge>
              <Badge tone="neutral">{sealLabel(seal)}</Badge>
            </div>
          </header>
          {checkError ? <ErrorState title={`${copy.error.load} (${checkError.code})`} detail={checkError.message} /> : null}
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <section className="grid gap-3 rounded-2xl border border-border-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="botellas" className="text-label text-ink-900">
                {copy.higiene.bottles}
              </label>
              <Switch
                id="botellas"
                checked={bottles}
                disabled={!canEdit}
                onChange={(value) => {
                  setBottles(value)
                  if (!value) setProcedureId('')
                }}
              />
            </div>
            {bottles ? (
              <Field id="envasado-procedimiento" label={copy.higiene.procedure} error={errors.disinfection_procedure_id}>
                <Select
                  id="envasado-procedimiento"
                  className="w-full"
                  value={procedureId}
                  disabled={!canEdit}
                  onChange={(event) => setProcedureId(event.target.value)}
                >
                  <option value="">{copy.higiene.none}</option>
                  {procedures.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </section>
          <section className="grid gap-3 rounded-2xl border border-border-subtle p-4">
            <h2 className="text-label font-medium text-ink-900">{copy.higiene.visual}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="rechazo-llenado" label={copy.higiene.fillRejects} error={errors.fill_rejects}>
                <Input id="rechazo-llenado" inputMode="numeric" disabled={!canEdit} value={fill} invalid={Boolean(errors.fill_rejects)} onChange={(event) => setFill(event.target.value)} />
              </Field>
              <Field id="rechazo-cierre" label={copy.higiene.closureRejects} error={errors.closure_rejects}>
                <Input id="rechazo-cierre" inputMode="numeric" disabled={!canEdit} value={closureRejects} invalid={Boolean(errors.closure_rejects)} onChange={(event) => setClosureRejects(event.target.value)} />
              </Field>
              <Field id="rechazo-etiqueta" label={copy.higiene.labelRejects} error={errors.label_rejects}>
                <Input id="rechazo-etiqueta" inputMode="numeric" disabled={!canEdit} value={labelRejects} invalid={Boolean(errors.label_rejects)} onChange={(event) => setLabelRejects(event.target.value)} />
              </Field>
            </div>
          </section>
          <section className="grid gap-4 rounded-2xl border border-border-subtle p-4">
            <div className="grid gap-1.5">
              <span className="text-label text-text-secondary">{copy.higiene.closure}</span>
              <SegmentedControl
                fill
                aria-label={copy.higiene.closure}
                value={closure}
                onChange={(value) => {
                  if (canEdit && isClosure(value)) setClosure(value)
                }}
                options={[
                  { value: 'natural_cork', content: copy.higiene.natural },
                  { value: 'agglomerated_cork', content: copy.higiene.agglomerated },
                ]}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-label text-text-secondary">{copy.higiene.seal}</span>
              <SegmentedControl
                fill
                aria-label={copy.higiene.seal}
                value={seal}
                onChange={(value) => {
                  if (canEdit && isSeal(value)) setSeal(value)
                }}
                options={[
                  { value: 'capsule', content: copy.higiene.capsule },
                  { value: 'wax_seal', content: copy.higiene.wax },
                ]}
              />
            </div>
          </section>
          <section className="grid gap-3 rounded-2xl border border-border-subtle p-4">
            <Field id="envasado-equipo" label={copy.higiene.equipmentField} error={errors.equipment_id}>
              <Select id="envasado-equipo" className="w-full" value={equipmentId} disabled={!canEdit} onChange={(event) => setEquipmentId(event.target.value)}>
                <option value="">{copy.higiene.none}</option>
                {equipment.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="envasado-operario" label={copy.higiene.operator} error={errors.operator}>
              <Input id="envasado-operario" value={operator} disabled={!canEdit} onChange={(event) => setOperator(event.target.value)} />
            </Field>
            <Field id="envasado-notas" label={copy.higiene.notes}>
              <Textarea id="envasado-notas" value={notes} disabled={!canEdit} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </section>
        </>
      )}
    </RecordPage>
  )
}

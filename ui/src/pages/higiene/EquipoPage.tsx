import { useEffect, useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { isoToMadridInput, madridInputToIso } from '@/pages/existencias/time'
import {
  addMaintenance,
  errorText,
  fetchAppcc,
  linkOperationEquipment,
  listOperations,
  patchEquipment,
  todayMadrid,
  yearStart,
  type AppccMaintenance,
  type Equipment,
  type EquipmentRole,
  type OperationHeader,
} from '@/pages/higiene/api'
import { FactList } from '@/pages/higiene/fields'
import { MoreMenu, RecordPage } from '@/pages/higiene/frame'
import { capacityText, dateLabels, equipmentKindLabel, equipmentStatusLabel, isRole, roleLabel } from '@/pages/higiene/labels'
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  MenuItem,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/ui'

export function EquipoPage({ me, equipmentId }: { me: Me; equipmentId: string }) {
  const toast = useToast()
  const equipment = useApi<Equipment>(allows(me, 'cellar.read') ? `/v1/hygiene/equipment/${equipmentId}` : null)
  const [tab, setTab] = useState<'resumen' | 'mantenimiento'>('resumen')
  const [rows, setRows] = useState<AppccMaintenance[]>([])
  const [attempt, setAttempt] = useState(0)
  const [maint, setMaint] = useState(false)
  const [link, setLink] = useState(false)
  useChromeTitle(equipment.data?.name || copy.higiene.equipment)
  const canOperate = allows(me, 'cellar.operate')
  const retired = equipment.data?.status === 'retired'

  useEffect(() => {
    if (!equipment.data) return
    const controller = new AbortController()
    let active = true
    const code = equipment.data.code
    fetchAppcc(yearStart(), todayMadrid(), controller.signal)
      .then((report) => {
        if (!active) return
        setRows(report.equipment_maintenance.filter((row) => row.equipment_code === code))
      })
      .catch(() => {
        if (active) setRows([])
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, equipment.data])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  async function setStatus(status: 'in_service' | 'out_of_service' | 'retired') {
    try {
      await patchEquipment(equipmentId, { status })
      toast(copy.higiene.saved)
      equipment.reload()
    } catch (error: unknown) {
      toast(errorText(error, copy.higiene.failed))
    }
  }

  return (
    <RecordPage
      screen="higiene-equipo"
      backTo="/bodega/higiene/equipos"
      backLabel={copy.higiene.backEquipment}
      actions={
        canOperate && equipment.data && !retired ? (
          <>
            <Button type="button" variant="primary" size="sm" onClick={() => setMaint(true)}>
              {copy.higiene.maintenance}
            </Button>
            <MoreMenu label={copy.higiene.more}>
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      close()
                      setLink(true)
                    }}
                  >
                    {copy.higiene.link}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close()
                      void setStatus(equipment.data?.status === 'out_of_service' ? 'in_service' : 'out_of_service')
                    }}
                  >
                    {equipment.data?.status === 'out_of_service' ? copy.higiene.inService : copy.higiene.outOfService}
                  </MenuItem>
                  <MenuItem
                    tone="danger"
                    onClick={() => {
                      close()
                      void setStatus('retired')
                    }}
                  >
                    {copy.higiene.retire}
                  </MenuItem>
                </>
              )}
            </MoreMenu>
          </>
        ) : null
      }
    >
      {equipment.loading && !equipment.data ? (
        <div aria-busy="true" className="grid gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32" />
        </div>
      ) : equipment.error || !equipment.data ? (
        <ErrorState title={`${copy.error.load} (${equipment.error?.code ?? 'WC_ERROR'})`} detail={equipment.error?.message} onRetry={equipment.reload} />
      ) : (
        <>
          <header className="grid gap-2">
            <h1 className="text-body font-medium text-ink-900">{equipment.data.name}</h1>
            <p className="text-label text-text-secondary">{equipment.data.code}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={equipment.data.status === 'in_service' ? 'success' : equipment.data.status === 'out_of_service' ? 'warning' : 'neutral'}>
                {equipmentStatusLabel(equipment.data.status)}
              </Badge>
              <Badge tone="neutral">{equipmentKindLabel(equipment.data.kind)}</Badge>
            </div>
          </header>
          <div role="tablist" aria-label={copy.higiene.equipment} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {(
              [
                ['resumen', copy.higiene.summary],
                ['mantenimiento', copy.higiene.history],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cn('h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3', tab === id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary')}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'resumen' ? (
            <FactList
              rows={[
                { label: copy.higiene.code, value: equipment.data.code },
                { label: copy.higiene.kind, value: equipmentKindLabel(equipment.data.kind) },
                { label: copy.higiene.capacity, value: capacityText(equipment.data.capacity, equipment.data.capacity_unit) },
                { label: copy.higiene.status, value: equipmentStatusLabel(equipment.data.status) },
                { label: copy.higiene.maintenanceNotes, value: equipment.data.maintenance_notes || '—' },
              ]}
            />
          ) : rows.length === 0 ? (
            <EmptyState size="sm" title={copy.higiene.emptyMaintenance} description={copy.higiene.emptyMaintenanceHint} />
          ) : (
            <FactList
              rows={rows.map((row) => ({
                label: formatDate(row.occurred_on),
                value: `${row.operator} · ${row.notes}${row.next_due_on ? ` · ${formatDate(row.next_due_on)}` : ''}`,
              }))}
            />
          )}
        </>
      )}
      {maint && equipment.data ? (
        <MaintenanceDialog
          equipmentId={equipmentId}
          operator={me.display_name}
          onClose={() => setMaint(false)}
          onSaved={() => {
            setMaint(false)
            setTab('mantenimiento')
            setAttempt((value) => value + 1)
            toast(copy.higiene.saved)
          }}
        />
      ) : null}
      {link ? (
        <LinkDialog
          equipmentId={equipmentId}
          onClose={() => setLink(false)}
          onSaved={() => {
            setLink(false)
            toast(copy.higiene.saved)
          }}
        />
      ) : null}
    </RecordPage>
  )
}

function MaintenanceDialog({
  equipmentId,
  operator,
  onClose,
  onSaved,
}: {
  equipmentId: string
  operator: string
  onClose: () => void
  onSaved: () => void
}) {
  const [performed, setPerformed] = useState(isoToMadridInput(new Date(Date.now() - 60_000).toISOString()))
  const [notes, setNotes] = useState('')
  const [who, setWho] = useState(operator)
  const [due, setDue] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!notes.trim() || !who.trim() || !performed) {
      setError(copy.higiene.failed)
      return
    }
    const instant = madridInputToIso(performed)
    if (new Date(instant).getTime() > Date.now()) {
      setError(copy.higiene.future)
      return
    }
    setSaving(true)
    setError('')
    try {
      await addMaintenance(equipmentId, {
        performed_at: instant,
        notes: notes.trim(),
        operator: who.trim(),
        next_due_on: due,
      })
      onSaved()
    } catch (err: unknown) {
      setError(errorText(err, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="mantenimiento-nuevo" size="md">
      <DialogHeader titleId="mantenimiento-nuevo" title={copy.higiene.maintenance} onClose={onClose} />
      <DialogBody>
        <form
          id="mantenimiento-nuevo-form"
          data-screen="higiene-dialogo-mantenimiento"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="mantenimiento-cuando" label={copy.higiene.date}>
            <DatePicker withTime value={performed} onChange={(value) => setPerformed(value ?? '')} locale="es" labels={dateLabels()} className="w-full" />
          </Field>
          <Field id="mantenimiento-notas" label={copy.higiene.notes}>
            <Textarea id="mantenimiento-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field id="mantenimiento-operario" label={copy.higiene.operator}>
            <Input id="mantenimiento-operario" value={who} onChange={(event) => setWho(event.target.value)} />
          </Field>
          <Field id="mantenimiento-proxima" label={copy.higiene.nextDue}>
            <DatePicker value={due} onChange={setDue} locale="es" labels={dateLabels()} className="w-full" />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="mantenimiento-nuevo-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function LinkDialog({ equipmentId, onClose, onSaved }: { equipmentId: string; onClose: () => void; onSaved: () => void }) {
  const [operations, setOperations] = useState<OperationHeader[]>([])
  const [operationId, setOperationId] = useState('')
  const [role, setRole] = useState<EquipmentRole>('used')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listOperations({ limit: 40 }, controller.signal)
      .then((page) => {
        setOperations(page.items)
        setOperationId(page.items[0]?.id ?? '')
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : copy.higiene.failed))
    return () => controller.abort()
  }, [])

  async function submit() {
    if (!operationId) return
    setSaving(true)
    setError('')
    try {
      await linkOperationEquipment(operationId, { equipment_id: equipmentId, role })
      onSaved()
    } catch (err: unknown) {
      setError(errorText(err, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="vincular-equipo" size="md">
      <DialogHeader titleId="vincular-equipo" title={copy.higiene.link} onClose={onClose} />
      <DialogBody>
        <form
          id="vincular-equipo-form"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="vincular-operacion" label={copy.higiene.operation}>
            <Select id="vincular-operacion" className="w-full" value={operationId} onChange={(event) => setOperationId(event.target.value)}>
              {operations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number || copy.higiene.draft} · {item.op_type}
                </option>
              ))}
            </Select>
          </Field>
          <SegmentedControl
            fill
            aria-label={copy.higiene.role}
            value={role}
            onChange={(value) => {
              if (isRole(value)) setRole(value)
            }}
            options={[
              { value: 'used', content: roleLabel('used') },
              { value: 'cleaned', content: roleLabel('cleaned') },
            ]}
          />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="vincular-equipo-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

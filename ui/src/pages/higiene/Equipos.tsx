import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import {
  CAPACITY_UNITS,
  CODE_RE,
  EQUIPMENT_KINDS,
  createEquipment,
  decimal3,
  errorFields,
  errorText,
  listEquipment,
  type Equipment,
} from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, capacityText, equipmentKindLabel, equipmentStatusLabel, isEquipmentKind, matches } from '@/pages/higiene/labels'
import { Search } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Chip,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  Select,
  Textarea,
  useToast,
  type BadgeTone,
  type GridColumn,
} from '@/ui'

const COLUMN_IDS = ['name', 'code', 'kind', 'status', 'capacity'] as const

export function Equipos({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [widths, setWidths] = useState<Record<string, number>>({ name: 260, code: 140, kind: 140, status: 140, capacity: 140 })
  const columnsState = useColumns('winecore.columns.hygiene.equipos', COLUMN_IDS, [])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    listEquipment(controller.signal)
      .then((body) => {
        if (!active) return
        setRows(body.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, me])

  const visible = useMemo(
    () => rows.filter((row) => (status ? row.status === status : true) && matches(query, [row.name, row.code, equipmentKindLabel(row.kind)])),
    [query, rows, status],
  )

  const columns = useMemo<GridColumn<Equipment>[]>(() => {
    const all: GridColumn<Equipment>[] = [
      { id: 'name', header: copy.higiene.name, cell: (row) => row.name },
      { id: 'code', header: copy.higiene.code, cell: (row) => row.code },
      { id: 'kind', header: copy.higiene.kind, cell: (row) => equipmentKindLabel(row.kind) },
      {
        id: 'status',
        header: copy.higiene.status,
        cell: (row) => <Badge tone={statusTone(row.status)} size="sm">{equipmentStatusLabel(row.status)}</Badge>,
      },
      {
        id: 'capacity',
        header: copy.higiene.capacity,
        cell: (row) => capacityText(row.capacity, row.capacity_unit),
      },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || status)
  const screen = loading ? 'higiene-equipos-cargando' : visible.length === 0 && !filtersActive ? 'higiene-equipos-vacio' : 'higiene-equipos'

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
            {copy.higiene.newEquipment}
          </Button>
        ) : null
      }
      toolbar={
        <>
          <Input
            size="sm"
            type="search"
            value={query}
            placeholder={copy.higiene.search}
            aria-label={copy.higiene.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ColumnPicker
            columns={[
              { id: 'name', header: copy.higiene.name },
              { id: 'code', header: copy.higiene.code },
              { id: 'kind', header: copy.higiene.kind },
              { id: 'status', header: copy.higiene.status },
              { id: 'capacity', header: copy.higiene.capacity },
            ]}
            hidden={columnsState.hidden}
            locked="name"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={status === ''} active={status === ''} onClick={() => setStatus('')}>
            {copy.higiene.all}
          </Chip>
          <Chip pressed={status === 'in_service'} active={status === 'in_service'} onClick={() => setStatus(status === 'in_service' ? '' : 'in_service')}>
            {copy.higiene.inService}
          </Chip>
          <Chip pressed={status === 'out_of_service'} active={status === 'out_of_service'} onClick={() => setStatus(status === 'out_of_service' ? '' : 'out_of_service')}>
            {copy.higiene.outOfService}
          </Chip>
        </>
      }
    >
      {error && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/higiene/equipos/${row.id}`)}
          rowHref={(row) => `/bodega/higiene/equipos/${row.id}`}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyEquipment}
              description={filtersActive ? undefined : copy.higiene.emptyEquipmentHint}
              action={
                canOperate && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                    {copy.higiene.newEquipment}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {creating ? (
        <EquipmentDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            toast(copy.higiene.saved)
            navigate(`/bodega/higiene/equipos/${id}`)
          }}
        />
      ) : null}
    </HygieneFrame>
  )
}

function statusTone(status: string): BadgeTone {
  if (status === 'in_service') return 'success'
  if (status === 'out_of_service') return 'warning'
  return 'neutral'
}

function EquipmentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState('bottler')
  const [capacity, setCapacity] = useState('')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const next: Record<string, string> = {}
    const normalized = code.trim().toUpperCase()
    if (!CODE_RE.test(normalized)) next.code = copy.higiene.code
    if (!name.trim()) next.name = copy.higiene.name
    if (!isEquipmentKind(kind)) next.kind = copy.higiene.kind
    const hasCapacity = capacity.trim() !== ''
    const hasUnit = unit !== ''
    if (hasCapacity !== hasUnit) next.capacity = copy.higiene.capacity
    const parsed = hasCapacity ? decimal3(capacity) : null
    if (hasCapacity && !parsed) next.capacity = copy.higiene.capacity
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length > 0) return
    setSaving(true)
    try {
      const created = await createEquipment({
        code: normalized,
        name: name.trim(),
        kind,
        capacity: parsed,
        capacity_unit: hasUnit ? unit : null,
        maintenance_notes: notes.trim() || null,
      })
      onSaved(created.id)
    } catch (error: unknown) {
      setErrors(errorFields(error))
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="equipo-nuevo" size="md">
      <DialogHeader titleId="equipo-nuevo" title={copy.higiene.newEquipment} onClose={onClose} />
      <DialogBody>
        <form
          id="equipo-nuevo-form"
          data-screen="higiene-dialogo-equipo"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="equipo-codigo" label={copy.higiene.code} error={errors.code}>
            <Input id="equipo-codigo" value={code} className="font-mono" onChange={(event) => setCode(event.target.value.toUpperCase())} />
          </Field>
          <Field id="equipo-nombre" label={copy.higiene.name} error={errors.name}>
            <Input id="equipo-nombre" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field id="equipo-tipo" label={copy.higiene.kind}>
            <Select id="equipo-tipo" className="w-full" value={kind} onChange={(event) => setKind(event.target.value)}>
              {EQUIPMENT_KINDS.map((item) => (
                <option key={item} value={item}>
                  {equipmentKindLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="equipo-capacidad" label={copy.higiene.capacity} error={errors.capacity}>
              <Input id="equipo-capacidad" inputMode="decimal" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
            </Field>
            <Field id="equipo-unidad" label={copy.higiene.unit}>
              <Select id="equipo-unidad" className="w-full" value={unit} onChange={(event) => setUnit(event.target.value)}>
                <option value="">{copy.higiene.none}</option>
                {CAPACITY_UNITS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="equipo-notas" label={copy.higiene.maintenanceNotes}>
            <Textarea id="equipo-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="equipo-nuevo-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

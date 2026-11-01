import { useEffect, useMemo, useState } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate, formatInteger } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { useEntity } from '@/app/entity-context'
import {
  PLATE_GRADES,
  createFiltration,
  errorFields,
  errorText,
  fetchAppcc,
  pastInstant,
  todayMadrid,
  wholeNumber,
  yearStart,
  type AppccFiltration,
  type PlateGrade,
} from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { FactList } from '@/pages/higiene/fields'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, isPlate, matches, plateLabel } from '@/pages/higiene/labels'
import { useLookups } from '@/pages/higiene/use-lookups'
import { dateLabels } from '@/pages/higiene/labels'
import { Search } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Chip,
  DataGrid,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
  type GridColumn,
} from '@/ui'

type Row = AppccFiltration & { id: string }

const COLUMN_IDS = ['grade', 'date', 'format', 'plates', 'operator', 'equipment'] as const

export function Filtraciones({ me }: { me: Me }) {
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)
  const [widths, setWidths] = useState<Record<string, number>>({ grade: 260, date: 120, format: 120, plates: 100, operator: 180, equipment: 140 })
  const columnsState = useColumns('winecore.columns.hygiene.filtraciones', COLUMN_IDS, [])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    fetchAppcc(yearStart(), todayMadrid(), controller.signal)
      .then((report) => {
        if (!active) return
        setRows(report.filtrations.map((row, index) => ({ ...row, id: `${row.occurred_on}-${row.plate_grade}-${index}` })))
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
    () =>
      rows.filter(
        (row) =>
          (grade ? row.plate_grade === grade : true) &&
          matches(query, [row.plate_grade_label, row.plate_format, row.operator, row.equipment_code, row.supplier_name]),
      ),
    [grade, query, rows],
  )

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const all: GridColumn<Row>[] = [
      { id: 'grade', header: copy.higiene.grade, cell: (row) => row.plate_grade_label },
      { id: 'date', header: copy.higiene.date, cell: (row) => formatDate(row.occurred_on) },
      { id: 'format', header: copy.higiene.format, cell: (row) => row.plate_format },
      { id: 'plates', header: copy.higiene.plates, align: 'right', cell: (row) => formatInteger(row.plate_count) },
      { id: 'operator', header: copy.higiene.operator, cell: (row) => row.operator },
      { id: 'equipment', header: copy.higiene.equipmentField, cell: (row) => row.equipment_code || '—' },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || grade)
  const screen = loading ? 'higiene-filtraciones-cargando' : visible.length === 0 && !filtersActive ? 'higiene-filtraciones-vacio' : 'higiene-filtraciones'

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
            {copy.higiene.newFiltration}
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
              { id: 'grade', header: copy.higiene.grade },
              { id: 'date', header: copy.higiene.date },
              { id: 'format', header: copy.higiene.format },
              { id: 'plates', header: copy.higiene.plates },
              { id: 'operator', header: copy.higiene.operator },
              { id: 'equipment', header: copy.higiene.equipmentField },
            ]}
            hidden={columnsState.hidden}
            locked="grade"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={grade === ''} active={grade === ''} onClick={() => setGrade('')}>
            {copy.higiene.all}
          </Chip>
          {PLATE_GRADES.map((item) => (
            <Chip key={item} pressed={grade === item} active={grade === item} onClick={() => setGrade(grade === item ? '' : item)}>
              {item}
            </Chip>
          ))}
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
          onOpenRow={setOpen}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyFiltrations}
              description={filtersActive ? undefined : copy.higiene.emptyFiltrationsHint}
              action={
                canOperate && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                    {copy.higiene.newFiltration}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <Dialog open={open !== null} onClose={() => setOpen(null)} labelledBy="filtracion-detalle" size="md">
        <DialogHeader titleId="filtracion-detalle" title={open?.plate_grade_label ?? copy.higiene.filtrations} onClose={() => setOpen(null)} />
        <DialogBody>
          {open ? (
            <div className="grid gap-3 pb-2">
              <Badge tone="neutral">{open.plate_grade}</Badge>
              <FactList
                rows={[
                  { label: copy.higiene.date, value: formatDate(open.occurred_on) },
                  { label: copy.higiene.format, value: open.plate_format },
                  { label: copy.higiene.plates, value: formatInteger(open.plate_count) },
                  { label: copy.higiene.operator, value: open.operator },
                  { label: copy.higiene.equipmentField, value: open.equipment_code || '—' },
                  { label: copy.higiene.supplier, value: open.supplier_name || '—' },
                  { label: copy.higiene.notes, value: open.notes || '—' },
                ]}
              />
            </div>
          ) : null}
        </DialogBody>
      </Dialog>
      {creating ? (
        <FiltrationDialog
          me={me}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            toast(copy.higiene.saved)
            setAttempt((value) => value + 1)
          }}
        />
      ) : null}
    </HygieneFrame>
  )
}

function FiltrationDialog({ me, onClose, onSaved }: { me: Me; onClose: () => void; onSaved: () => void }) {
  const { entities } = useEntity()
  const lookups = useLookups(true)
  const plates = lookups.data.consumables.filter((item) => item.consumable_kind === 'filter_plate')
  const [day, setDay] = useState<string | null>(todayMadrid())
  const [grade, setGrade] = useState<PlateGrade>('V13')
  const [format, setFormat] = useState('40x40')
  const [supplierId, setSupplierId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [operator, setOperator] = useState(me.display_name)
  const [locationId, setLocationId] = useState('')
  const [entityId, setEntityId] = useState(entities.find((item) => item.code === 'PO')?.id ?? entities[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ key: string; productId: string; quantity: string }[]>([{ key: '1', productId: '', quantity: '' }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const place = lookups.data.places.find((item) => item.code === 'BOD') ?? lookups.data.places[0]
    if (!locationId && place) setLocationId(place.id)
    if (!supplierId && lookups.data.suppliers[0]) setSupplierId(lookups.data.suppliers[0].id)
  }, [locationId, lookups.data.places, lookups.data.suppliers, supplierId])

  useEffect(() => {
    const match = plates.find((item) => item.sku.includes(grade)) ?? plates[0]
    if (!match) return
    setLines((current) => {
      const first = current[0]
      if (!first || current.length !== 1 || first.quantity || first.productId === match.product_id) return current
      return [{ ...first, productId: match.product_id }]
    })
  }, [grade, plates])

  const total = lines.reduce((sum, line) => sum + (wholeNumber(line.quantity) ?? 0), 0)

  async function submit() {
    const next: Record<string, string> = {}
    if (!day || day > todayMadrid()) next.occurred_at = copy.higiene.future
    if (!format.trim()) next.plate_format = copy.higiene.format
    if (!supplierId) next.supplier_contact_id = copy.higiene.supplier
    if (!locationId) next.location_id = copy.higiene.location
    if (!entityId) next.owner_entity_id = copy.higiene.entity
    if (!operator.trim()) next.operator = copy.higiene.operator
    if (lines.some((line) => !line.productId || wholeNumber(line.quantity) === null || (wholeNumber(line.quantity) ?? 0) <= 0)) {
      next.consumptions = copy.higiene.plates
    }
    if (total <= 0) next.plate_count = copy.higiene.plates
    setErrors(next)
    setFormError('')
    if (Object.keys(next).length > 0 || !day) return
    setSaving(true)
    try {
      await createFiltration({
        occurred_at: pastInstant(day),
        plate_grade: grade,
        plate_format: format.trim(),
        supplier_contact_id: supplierId,
        plate_count: total,
        equipment_id: equipmentId || null,
        operator: operator.trim(),
        location_id: locationId,
        owner_entity_id: entityId,
        notes: notes.trim() || null,
        consumptions: lines.map((line) => ({ product_id: line.productId, quantity: wholeNumber(line.quantity) })),
      })
      onSaved()
    } catch (error: unknown) {
      setErrors(errorFields(error))
      setFormError(errorText(error, copy.higiene.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="filtracion-nueva" size="lg">
      <DialogHeader titleId="filtracion-nueva" title={copy.higiene.newFiltration} onClose={onClose} />
      <DialogBody>
        <form
          id="filtracion-nueva-form"
          data-screen="higiene-dialogo-filtracion"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="filtracion-fecha" label={copy.higiene.date} error={errors.occurred_at}>
            <DatePicker value={day} onChange={setDay} locale="es" labels={dateLabels()} className="w-full" />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-label text-text-secondary">{copy.higiene.grade}</span>
            <SegmentedControl
              fill
              aria-label={copy.higiene.grade}
              value={grade}
              onChange={(value) => {
                if (isPlate(value)) setGrade(value)
              }}
              options={PLATE_GRADES.map((item) => ({ value: item, content: item }))}
            />
            <p className="text-caption text-text-tertiary">{plateLabel(grade)}</p>
          </div>
          <Field id="filtracion-formato" label={copy.higiene.format} error={errors.plate_format}>
            <Input id="filtracion-formato" value={format} onChange={(event) => setFormat(event.target.value)} />
          </Field>
          <Field id="filtracion-proveedor" label={copy.higiene.supplier} error={errors.supplier_contact_id}>
            <Select id="filtracion-proveedor" className="w-full" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">{copy.higiene.none}</option>
              {lookups.data.suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          {lines.map((line, index) => (
            <div key={line.key} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <Field id={`placa-${line.key}`} label={copy.higiene.product} error={index === 0 ? errors.consumptions : undefined}>
                <Select
                  id={`placa-${line.key}`}
                  className="w-full"
                  value={line.productId}
                  onChange={(event) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, productId: event.target.value } : item)))}
                >
                  <option value="">{copy.higiene.none}</option>
                  {plates.map((item) => (
                    <option key={item.product_id} value={item.product_id}>
                      {item.sku} · {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`placas-${line.key}`} label={copy.higiene.plates}>
                <Input
                  id={`placas-${line.key}`}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, quantity: event.target.value } : item)))}
                />
              </Field>
              {lines.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>
                  {copy.higiene.removeLine}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), productId: plates[0]?.product_id ?? '', quantity: '' }])}
            >
              {copy.higiene.addLine}
            </Button>
            <p className="text-label tabular-nums text-text-secondary">
              {copy.higiene.plates} {formatInteger(total)}
            </p>
          </div>
          <Field id="filtracion-equipo" label={copy.higiene.equipmentField}>
            <Select id="filtracion-equipo" className="w-full" value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}>
              <option value="">{copy.higiene.none}</option>
              {lookups.data.equipment
                .filter((item) => item.status === 'in_service')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="filtracion-ubicacion" label={copy.higiene.location} error={errors.location_id}>
              <Select id="filtracion-ubicacion" className="w-full" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {lookups.data.places.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="filtracion-entidad" label={copy.higiene.entity}>
              <Select id="filtracion-entidad" className="w-full" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                {entities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="filtracion-operario" label={copy.higiene.operator} error={errors.operator}>
            <Input id="filtracion-operario" value={operator} onChange={(event) => setOperator(event.target.value)} />
          </Field>
          <Field id="filtracion-notas" label={copy.higiene.notes}>
            <Textarea id="filtracion-notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="filtracion-nueva-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

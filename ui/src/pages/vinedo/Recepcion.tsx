import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER } from '@/ui/frame'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  GlassMenu,
  Input,
  MenuItem,
  Select,
  Textarea,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'
import { MoreVertical } from '@/ui/icons'
import {
  confirmReception,
  createReception,
  previewReception,
  rectifyReception,
  updateReception,
  type Parcel,
  type Reception,
  type ReceptionPreview,
  type SilicieEntry,
} from '@/pages/vinedo/api'
import { BlockTitle, FormStack, VineyardShell } from '@/pages/vinedo/chrome'
import { Fact, FactCard } from '@/pages/bodega/chrome'
import { ExerciseAction } from '@/pages/regulatorio/exercise'
import { exerciseBlocked } from '@/pages/regulatorio/model'
import { GRID_LABELS, civil, decisionLabel, kilos, receptionStatusLabel } from '@/pages/vinedo/labels'

type VesselRow = { id: string; code: string; status: string; volume_ml: number }

export function Recepcion({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const [params, setParams] = useSearchParams()
  const ticket = params.get('ticket')
  const canWrite = allows(me, 'vineyard.write')
  const list = useApi<{ items: Reception[] }>('/v1/grape-receptions')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ lot: 140, date: 120, net: 120, decision: 130, status: 120 })

  function open(id: string | null) {
    const next = new URLSearchParams(params)
    next.set('seccion', 'recepcion')
    if (id) next.set('ticket', id)
    else next.delete('ticket')
    setParams(next)
  }

  const columns = useMemo<GridColumn<Reception>[]>(
    () => [
      { id: 'lot', header: copy.vinedo.lot, cell: (row) => row.ticket?.lot_code || row.number || '—' },
      { id: 'date', header: copy.vinedo.date, cell: (row) => civil(row.ticket?.fiscal_date) },
      { id: 'net', header: copy.vinedo.net, align: 'right', cell: (row) => kilos(row.ticket?.net_kg) },
      {
        id: 'decision',
        header: copy.vinedo.decision,
        cell: (row) => decisionLabel(row.ticket?.intake.decision ?? ''),
      },
      {
        id: 'status',
        header: copy.vinedo.status,
        cell: (row) => (
          <Badge tone={row.status === 'confirmed' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'} size="sm">
            {receptionStatusLabel(row.status)}
          </Badge>
        ),
      },
    ],
    [],
  )

  if (ticket) {
    return (
      <VineyardShell section="recepcion" screen="vinedo-recepcion">
        <Ticket
          me={me}
          id={ticket === 'nuevo' ? null : ticket}
          canWrite={canWrite}
          onBack={() => {
            open(null)
            list.reload()
          }}
          onCreated={(id) => open(id)}
        />
      </VineyardShell>
    )
  }

  const rows = list.data?.items ?? []

  return (
    <VineyardShell
      section="recepcion"
      screen="vinedo-recepcion"
      actions={
        canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => open('nuevo')}>
            {copy.vinedo.newTicket}
          </Button>
        ) : null
      }
    >
      {list.error ? (
        <div className="p-4">
          <ErrorState title={list.error.message} onRetry={list.reload} />
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
          onOpenRow={(row) => open(row.id)}
          total={rows.length}
          loading={list.loading}
          scrollKey="vinedo-recepcion"
          empty={<p className={cn('text-label text-text-tertiary', FRAME_GUTTER, 'py-4')}>{copy.vinedo.emptyReceptions}</p>}
        />
      )}
    </VineyardShell>
  )
}

function Ticket({
  me,
  id,
  canWrite,
  onBack,
  onCreated,
}: {
  me: Me
  id: string | null
  canWrite: boolean
  onBack: () => void
  onCreated: (id: string) => void
}) {
  const existing = useApi<Reception>(id ? `/v1/grape-receptions/${id}` : null)
  const parcels = useApi<{ items: Parcel[] }>('/v1/parcels')
  const vessels = useApi<{ items: VesselRow[] }>('/v1/vessels?limit=100')
  const toast = useToast()
  const more = useMenuOpen()
  const [preview, setPreview] = useState<ReceptionPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [exerciseBlock, setExerciseBlock] = useState(false)
  const [rectify, setRectify] = useState(false)
  const [busy, setBusy] = useState<'save' | 'preview' | 'confirm' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const entity = me.entities.find((item) => item.code === 'PO') ?? me.entities[0]

  const [when, setWhen] = useState('2026-10-28T10:00')
  const [variety, setVariety] = useState('BOBAL')
  const [gross, setGross] = useState('400')
  const [tare, setTare] = useState('0')
  const [net, setNet] = useState('400')
  const [abv, setAbv] = useState('12.4')
  const [sanitary, setSanitary] = useState('good')
  const [organic, setOrganic] = useState(true)
  const [labelChecked, setLabelChecked] = useState(true)
  const [hasDo, setHasDo] = useState(false)
  const [appellation, setAppellation] = useState('')
  const [vessel, setVessel] = useState('')
  const [lot, setLot] = useState('')
  const [vintage, setVintage] = useState('2026')
  const [parcel, setParcel] = useState('P-07')
  const [parcelKg, setParcelKg] = useState('400')
  const [container, setContainer] = useState('box')
  const [count, setCount] = useState('20')
  const [nominal, setNominal] = useState('20')
  const [weighing, setWeighing] = useState('weighed')
  const [state, setState] = useState('healthy')
  const [botrytis, setBotrytis] = useState('')
  const [storm, setStorm] = useState(false)
  const [overripe, setOverripe] = useState(false)
  const [raisined, setRaisined] = useState(false)
  const [microbial, setMicrobial] = useState('')
  const [decision, setDecision] = useState('accepted')
  const [temperature, setTemperature] = useState('')
  const [who, setWho] = useState(me.display_name)

  useEffect(() => {
    const ticket = existing.data?.ticket
    if (!ticket || !existing.data) return
    setWhen(localStamp(existing.data.occurred_at))
    setVariety(ticket.variety_code)
    setGross(ticket.gross_kg)
    setTare(ticket.tare_kg)
    setNet(ticket.net_kg)
    setAbv(ticket.probable_abv)
    setSanitary(ticket.sanitary_status)
    setOrganic(ticket.is_organic)
    setLabelChecked(ticket.organic_label_checked)
    setHasDo(ticket.has_do)
    setAppellation(ticket.appellation ?? '')
    setVessel(ticket.destination_vessel_id)
    setLot(ticket.lot_code)
    setVintage(String(ticket.vintage))
    if (ticket.source.kind === 'parcels') {
      setParcel(ticket.source.lines[0]?.parcel_code ?? '')
      setParcelKg(ticket.source.lines[0]?.kg ?? ticket.net_kg)
    }
    setContainer(ticket.intake.container)
    setCount(ticket.intake.container_count == null ? '' : String(ticket.intake.container_count))
    setNominal(ticket.intake.container_nominal_kg ?? '')
    setWeighing(ticket.intake.weighing)
    setState(ticket.intake.sanitary_state)
    setBotrytis(ticket.intake.botrytis_pct ?? '')
    setStorm(ticket.intake.storm_damage)
    setOverripe(ticket.intake.overripe)
    setRaisined(ticket.intake.raisined)
    setMicrobial(ticket.intake.microbial_notes ?? '')
    setDecision(ticket.intake.decision)
    setTemperature(ticket.intake.grape_temperature_c ?? '')
    setWho(existing.data.performed_by)
  }, [existing.data])

  useEffect(() => {
    if (vessel || !vessels.data) return
    const empty = vessels.data.items.find((item) => item.status === 'in_service' && item.volume_ml === 0)
    if (empty) setVessel(empty.id)
  }, [vessel, vessels.data])

  const draft = existing.data?.status === 'draft' || id === null
  const locked = Boolean(existing.data && existing.data.status !== 'draft')

  function body(): Record<string, unknown> | null {
    const next: Record<string, string> = {}
    if (!entity) next.legal_entity_id = copy.vinedo.required
    if (!who.trim()) next.performed_by = copy.vinedo.required
    if (!lot.trim()) next.lot_code = copy.vinedo.required
    if (!vessel) next.destination_vessel_id = copy.vinedo.required
    if (organic && !labelChecked) next.organic_label_checked = copy.vinedo.labelRequired
    if (hasDo && !appellation.trim()) next.appellation = copy.vinedo.required
    if (container === 'box' && !count.trim()) next.container_count = copy.vinedo.required
    const grossG = grams(gross)
    const tareG = grams(tare)
    const netG = grams(net)
    if (grossG == null || tareG == null || netG == null || grossG - tareG !== netG) next.net_kg = copy.vinedo.netInvalid
    const lineG = grams(parcelKg)
    if (lineG == null || lineG !== netG) next.parcels = copy.vinedo.parcelKg
    setErrors(next)
    if (Object.keys(next).length > 0 || !entity) return null
    return {
      legal_entity_id: entity.id,
      performed_by: who.trim(),
      occurred_at: new Date(when).toISOString(),
      variety_code: variety,
      gross_kg: dot3(gross),
      tare_kg: dot3(tare),
      net_kg: dot3(net),
      probable_abv: dot2(abv),
      sanitary_status: sanitary,
      is_organic: organic,
      organic_label_checked: labelChecked,
      has_do: hasDo,
      appellation: hasDo ? appellation.trim() : null,
      destination_vessel_id: vessel,
      lot_code: lot.trim().toUpperCase(),
      vintage: Number(vintage),
      parcels: [{ parcel_code: parcel, kg: dot3(parcelKg) }],
      intake: {
        container,
        container_count: count.trim() ? Number(count) : null,
        container_nominal_kg: nominal.trim() ? dot2(nominal) : null,
        weighing,
        sanitary_state: state,
        botrytis_pct: botrytis.trim() ? dot2(botrytis) : null,
        storm_damage: storm,
        overripe,
        raisined,
        microbial_notes: microbial.trim() || null,
        decision,
        grape_temperature_c: temperature.trim() ? dot1(temperature) : null,
      },
    }
  }

  async function save() {
    const payload = body()
    if (!payload) return
    setBusy('save')
    try {
      const saved = id ? await updateReception(id, payload) : await createReception(payload)
      toast(copy.vinedo.saved)
      if (!id) onCreated(saved.id)
      else existing.reload()
    } catch (error: unknown) {
      applyError(error, setErrors)
    } finally {
      setBusy(null)
    }
  }

  async function previewNow() {
    if (!id) {
      await save()
      return
    }
    setBusy('preview')
    setPreviewError('')
    setExerciseBlock(false)
    try {
      const payload = body()
      if (payload && existing.data?.status === 'draft') await updateReception(id, payload)
      setPreview(await previewReception(id))
    } catch (error: unknown) {
      setPreview(null)
      setExerciseBlock(exerciseBlocked(error))
      setPreviewError(error instanceof ApiError ? (error.fields?.fiscal_date ?? error.message) : copy.error.load)
    } finally {
      setBusy(null)
    }
  }

  async function confirmNow() {
    if (!id) return
    setBusy('confirm')
    setExerciseBlock(false)
    try {
      await confirmReception(id)
      toast(copy.vinedo.saved)
      setPreview(null)
      setPreviewError('')
      existing.reload()
    } catch (error: unknown) {
      setExerciseBlock(exerciseBlocked(error))
      setPreviewError(error instanceof ApiError ? (error.fields?.fiscal_date ?? error.message) : copy.error.load)
    } finally {
      setBusy(null)
    }
  }

  const activeParcels = (parcels.data?.items ?? []).filter((item) => item.is_active)
  const vesselRows = (vessels.data?.items ?? []).filter((item) => item.status === 'in_service')

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={cn('flex h-11 items-center gap-2 border-b border-border-subtle', FRAME_GUTTER)}>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {copy.vinedo.backList}
        </Button>
        {existing.data ? (
          <Badge tone={existing.data.status === 'confirmed' ? 'success' : 'warning'} size="sm">
            {receptionStatusLabel(existing.data.status)}
          </Badge>
        ) : null}
        {canWrite && existing.data?.status === 'confirmed' ? (
          <GlassMenu
            open={more.open}
            onOpenChange={more.setOpen}
            placement="bottom-end"
            className="ml-auto"
            trigger={
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.vinedo.more} onClick={more.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              tone="danger"
              onClick={() => {
                more.close()
                setRectify(true)
              }}
            >
              {copy.vinedo.rectify}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </div>
      {existing.error ? <div className="p-4"><ErrorState title={existing.error.message} onRetry={existing.reload} /></div> : null}
      <FormStack>
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <BlockTitle>{copy.vinedo.weighingBlock}</BlockTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="uv-cuando" label={copy.vinedo.weighedAt}>
            <Input id="uv-cuando" type="datetime-local" className="w-full" value={when} disabled={locked} onChange={(event) => setWhen(event.target.value)} />
          </Field>
          <Field id="uv-quien" label={copy.vinedo.operator} error={errors.performed_by}>
            <Input className="w-full" {...fieldAria('uv-quien', errors.performed_by)} value={who} disabled={locked} onChange={(event) => setWho(event.target.value)} />
          </Field>
          <Field id="uv-variedad" label={copy.vinedo.variety}>
            <Select id="uv-variedad" className="w-full" value={variety} disabled={locked} onChange={(event) => setVariety(event.target.value)}>
              {(activeParcels.find((item) => item.code === parcel)?.varieties ?? [{ variety: variety }]).map((item) => (
                <option key={item.variety} value={item.variety}>
                  {item.variety}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="uv-lote" label={copy.vinedo.lot} error={errors.lot_code}>
            <Input className="w-full" {...fieldAria('uv-lote', errors.lot_code)} value={lot} disabled={locked} onChange={(event) => setLot(event.target.value)} />
          </Field>
          <Field id="uv-bruto" label={copy.vinedo.gross}>
            <Input id="uv-bruto" inputMode="decimal" className="w-full" value={gross} disabled={locked} onChange={(event) => setGross(event.target.value)} />
          </Field>
          <Field id="uv-tara" label={copy.vinedo.tare}>
            <Input id="uv-tara" inputMode="decimal" className="w-full" value={tare} disabled={locked} onChange={(event) => setTare(event.target.value)} />
          </Field>
          <Field id="uv-neto" label={copy.vinedo.net} error={errors.net_kg}>
            <Input className="w-full" inputMode="decimal" {...fieldAria('uv-neto', errors.net_kg)} value={net} disabled={locked} onChange={(event) => setNet(event.target.value)} />
          </Field>
          <Field id="uv-grado" label={copy.vinedo.abv}>
            <Input id="uv-grado" inputMode="decimal" className="w-full" value={abv} disabled={locked} onChange={(event) => setAbv(event.target.value)} />
          </Field>
        </div>
        <BlockTitle>{copy.vinedo.intake}</BlockTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="uv-envase" label={copy.vinedo.container}>
            <Select id="uv-envase" className="w-full" value={container} disabled={locked} onChange={(event) => setContainer(event.target.value)}>
              {Object.entries(copy.vinedo.containers).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="uv-cuenta" label={copy.vinedo.count} error={errors.container_count}>
            <Input className="w-full" inputMode="numeric" {...fieldAria('uv-cuenta', errors.container_count)} value={count} disabled={locked} onChange={(event) => setCount(event.target.value)} />
          </Field>
          <Field id="uv-nominal" label={copy.vinedo.nominal}>
            <Input id="uv-nominal" inputMode="decimal" className="w-full" value={nominal} disabled={locked} onChange={(event) => setNominal(event.target.value)} />
          </Field>
          <Field id="uv-peso" label={copy.vinedo.weighingMode}>
            <Select id="uv-peso" className="w-full" value={weighing} disabled={locked} onChange={(event) => setWeighing(event.target.value)}>
              <option value="weighed">{copy.vinedo.weighed}</option>
              <option value="estimated">{copy.vinedo.estimated}</option>
            </Select>
          </Field>
          <Field id="uv-estado" label={copy.vinedo.grapeStateLabel}>
            <Select id="uv-estado" className="w-full" value={state} disabled={locked} onChange={(event) => setState(event.target.value)}>
              {Object.entries(copy.vinedo.grapeState).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="uv-botrytis" label={copy.vinedo.botrytis}>
            <Input id="uv-botrytis" inputMode="decimal" className="w-full" value={botrytis} disabled={locked} onChange={(event) => setBotrytis(event.target.value)} />
          </Field>
          <Field id="uv-temp" label={copy.vinedo.temperature}>
            <Input id="uv-temp" inputMode="decimal" className="w-full" value={temperature} disabled={locked} onChange={(event) => setTemperature(event.target.value)} />
          </Field>
          <Field id="uv-decision" label={copy.vinedo.decision}>
            <Select id="uv-decision" className="w-full" value={decision} disabled={locked} onChange={(event) => setDecision(event.target.value)}>
              {Object.entries(copy.vinedo.decisions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-2">
          <Checkbox checked={storm} disabled={locked} label={copy.vinedo.storm} onChange={setStorm} />
          <Checkbox checked={overripe} disabled={locked} label={copy.vinedo.overripe} onChange={setOverripe} />
          <Checkbox checked={raisined} disabled={locked} label={copy.vinedo.raisined} onChange={setRaisined} />
          <Checkbox checked={organic} disabled={locked} label={copy.vinedo.organicGrape} onChange={setOrganic} />
          <Checkbox checked={labelChecked} disabled={locked} label={copy.vinedo.labelChecked} onChange={setLabelChecked} />
          {errors.organic_label_checked ? <p className="text-caption text-danger-600">{errors.organic_label_checked}</p> : null}
          <Checkbox checked={hasDo} disabled={locked} label={copy.vinedo.hasDo} onChange={setHasDo} />
        </div>
        {hasDo ? (
          <Field id="uv-do" label={copy.vinedo.appellation} error={errors.appellation}>
            <Input className="w-full" {...fieldAria('uv-do', errors.appellation)} value={appellation} disabled={locked} onChange={(event) => setAppellation(event.target.value)} />
          </Field>
        ) : null}
        <Field id="uv-micro" label={copy.vinedo.microbial}>
          <Textarea id="uv-micro" value={microbial} disabled={locked} onChange={(event) => setMicrobial(event.target.value)} />
        </Field>
        <BlockTitle>{copy.vinedo.origin}</BlockTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="uv-parcela" label={copy.vinedo.parcel} error={errors.parcels}>
            <Select id="uv-parcela" className="w-full" value={parcel} disabled={locked} onChange={(event) => setParcel(event.target.value)}>
              {activeParcels.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="uv-pkg" label={copy.vinedo.parcelKgLabel}>
            <Input id="uv-pkg" inputMode="decimal" className="w-full" value={parcelKg} disabled={locked} onChange={(event) => setParcelKg(event.target.value)} />
          </Field>
          <Field id="uv-deposito" label={copy.vinedo.vessel} error={errors.destination_vessel_id}>
            <Select id="uv-deposito" className="w-full" value={vessel} disabled={locked} onChange={(event) => setVessel(event.target.value)}>
              <option value="">{copy.vinedo.vessel}</option>
              {vesselRows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="uv-anada" label={copy.vinedo.vintage}>
            <Input id="uv-anada" inputMode="numeric" className="w-full" value={vintage} disabled={locked} onChange={(event) => setVintage(event.target.value)} />
          </Field>
        </div>
        <Field id="uv-sanidad" label={copy.vinedo.sanitaryLabel}>
          <Select id="uv-sanidad" className="w-full" value={sanitary} disabled={locked} onChange={(event) => setSanitary(event.target.value)}>
            <option value="good">{copy.vinedo.sanitary.good}</option>
            <option value="fair">{copy.vinedo.sanitary.fair}</option>
            <option value="poor">{copy.vinedo.sanitary.poor}</option>
          </Select>
        </Field>
        {canWrite && draft ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" loading={busy === 'save'} onClick={() => void save()}>
              {copy.vinedo.save}
            </Button>
            <Button type="button" variant="secondary" size="sm" loading={busy === 'preview'} onClick={() => void previewNow()}>
              {copy.vinedo.preview}
            </Button>
            {id ? (
              <Button type="button" variant="primary" size="sm" loading={busy === 'confirm'} onClick={() => void confirmNow()}>
                {copy.vinedo.confirmTicket}
              </Button>
            ) : null}
          </div>
        ) : null}
        {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
        {exerciseBlock && entity ? (
          <ExerciseAction me={me} entityId={entity.id} year={Number((existing.data?.ticket?.fiscal_date ?? when).slice(0, 4))} />
        ) : null}
        {preview ? <SilicieNote entry={preview.silicie} rejected={decision === 'rejected'} /> : null}
        {existing.data?.silicie ? <SilicieNote entry={existing.data.silicie} rejected={false} /> : null}
      </FormStack>
      {rectify && id ? (
        <RectifyDialog
          onClose={() => setRectify(false)}
          onDone={async (reason) => {
            await rectifyReception(id, reason)
            setRectify(false)
            toast(copy.vinedo.saved)
            existing.reload()
          }}
        />
      ) : null}
    </div>
  )
}

function SilicieNote({ entry, rejected }: { entry: SilicieEntry | null; rejected: boolean }) {
  if (!entry) {
    return <Alert tone={rejected ? 'warning' : 'info'}>{rejected ? copy.vinedo.a02Rejected : copy.vinedo.a02Missing}</Alert>
  }
  return (
    <FactCard title={copy.vinedo.a02}>
      <Fact label={copy.vinedo.entry} value={entry.entry_kind} />
      <Fact label={copy.vinedo.mass} value={`${entry.mass_g} ${entry.unidad}`} />
      <Fact label={copy.vinedo.reference} value={entry.referencia || '—'} />
      <Fact label={copy.vinedo.date} value={civil(entry.movement_date)} />
      <Fact label={copy.vinedo.status} value={entry.status ?? copy.vinedo.preview} />
    </FactCard>
  )
}

function RectifyDialog({ onClose, onDone }: { onClose: () => void; onDone: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  return (
    <Dialog open onClose={onClose} labelledBy="uv-rectificar" size="sm">
      <DialogHeader titleId="uv-rectificar" title={copy.vinedo.rectify} onClose={onClose} />
      <DialogBody>
        <Field id="uv-motivo" label={copy.vinedo.reason} error={error}>
          <Textarea id="uv-motivo" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={saving}
          onClick={() => {
            if (!reason.trim()) {
              setError(copy.vinedo.required)
              return
            }
            setSaving(true)
            void onDone(reason.trim()).catch((err: unknown) => {
              setError(err instanceof ApiError ? err.message : copy.error.load)
              setSaving(false)
            })
          }}
        >
          {copy.vinedo.rectify}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function applyError(error: unknown, setErrors: (next: Record<string, string>) => void) {
  if (error instanceof ApiError && error.fields) setErrors(error.fields)
  else setErrors({ form: error instanceof ApiError ? error.message : copy.error.load })
}

function grams(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  return Number(whole) * 1000 + Number(frac.padEnd(3, '0'))
}

function dot3(value: string): string {
  const text = value.trim().replace(',', '.')
  const [whole, frac = ''] = text.split('.')
  return `${whole}.${frac.padEnd(3, '0').slice(0, 3)}`
}

function dot2(value: string): string {
  const text = value.trim().replace(',', '.')
  const [whole, frac = ''] = text.split('.')
  return frac ? `${whole}.${frac.slice(0, 2)}` : whole ?? text
}

function dot1(value: string): string {
  const text = value.trim().replace(',', '.')
  const [whole, frac = ''] = text.split('.')
  return frac ? `${whole}.${frac.slice(0, 1)}` : whole ?? text
}

function localStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

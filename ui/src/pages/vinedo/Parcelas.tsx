import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Plus, Search } from '@/ui/icons'
import {
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
  StatusChip,
  useToast,
  type GridColumn,
} from '@/ui'
import { createParcel, type GrapeVariety, type Parcel, type ParcelSummary } from '@/pages/vinedo/api'
import { VineyardShell } from '@/pages/vinedo/chrome'
import { GRID_LABELS, ha, organicLabel } from '@/pages/vinedo/labels'

type List = { items: Parcel[]; total: number }
type Varieties = { items: GrapeVariety[] }

type VarietyRow = { variety: string; area_ha: string }

const EMPTY: VarietyRow = { variety: '', area_ha: '' }

export function Parcelas({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const navigate = useNavigate()
  const toast = useToast()
  const parcels = useApi<List>('/v1/parcels')
  const summary = useApi<ParcelSummary>('/v1/parcels/summary')
  const varieties = useApi<Varieties>('/v1/grape-varieties')
  const canWrite = allows(me, 'vineyard.write')
  const [q, setQ] = useState('')
  const [organic, setOrganic] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    code: 120,
    name: 180,
    sigpac: 180,
    area: 110,
    varieties: 160,
    organic: 140,
  })
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => {
    const items = parcels.data?.items ?? []
    const term = q.trim().toLowerCase()
    return items.filter((item) => {
      if (organic && item.organic_status !== 'organic') return false
      if (!term) return true
      return (
        item.code.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        item.sigpac.includes(term)
      )
    })
  }, [organic, parcels.data, q])

  const columns = useMemo<GridColumn<Parcel>[]>(
    () => [
      { id: 'code', header: copy.vinedo.code, cell: (row) => row.code },
      { id: 'name', header: copy.vinedo.name, cell: (row) => row.name },
      { id: 'sigpac', header: copy.vinedo.sigpac, cell: (row) => row.sigpac },
      { id: 'area', header: copy.vinedo.area, align: 'right', cell: (row) => ha(row.area_ha) },
      {
        id: 'varieties',
        header: copy.vinedo.varieties,
        cell: (row) => row.varieties.map((item) => item.variety).join(' · ') || '—',
      },
      {
        id: 'organic',
        header: copy.vinedo.organicStatus,
        cell: (row) => (
          <Badge tone={row.organic_status === 'organic' ? 'success' : row.organic_status === 'in_conversion' ? 'warning' : 'neutral'} size="sm">
            {organicLabel(row.organic_status)}
          </Badge>
        ),
      },
    ],
    [],
  )

  const filters = Boolean(q.trim() || organic)
  const screen = parcels.loading ? 'vinedo-parcelas-cargando' : rows.length === 0 && !filters ? 'vinedo-parcelas-vacio' : 'vinedo-parcelas'

  return (
    <VineyardShell
      section="parcelas"
      screen={screen}
      actions={
        canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" strokeWidth={iconStroke} />
            {copy.vinedo.newParcel}
          </Button>
        ) : null
      }
    >
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            size="sm"
            type="search"
            value={q}
            placeholder={copy.vinedo.searchParcels}
            aria-label={copy.vinedo.searchParcels}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <Chip pressed={organic} active={organic} onClick={() => setOrganic((value) => !value)}>
            {copy.vinedo.organic}
          </Chip>
          {summary.data ? (
            <span className="inline-flex items-center gap-1 text-caption text-text-tertiary">
              {fill(copy.vinedo.notebookOf, {
                area: ha(summary.data.total_area_ha).replace(' ha', ''),
                max: String(summary.data.simplified_notebook_max_ha).replace('.', ','),
              })}
              <StatusChip tone={summary.data.simplified_notebook_confirmed ? 'success' : 'warning'} detail={copy.vinedo.notebookWhy}>
                {summary.data.simplified_notebook_confirmed ? copy.vinedo.confirmedSetting : copy.vinedo.pendingConfirm}
              </StatusChip>
            </span>
          ) : null}
        </div>
      </div>
      {parcels.error && !parcels.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${parcels.error.code})`} detail={parcels.error.message} onRetry={parcels.reload} />
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
          onOpenRow={(row) => navigate(`/vinedo/${encodeURIComponent(row.code)}`)}
          rowHref={(row) => `/vinedo/${encodeURIComponent(row.code)}`}
          total={filters ? rows.length : parcels.data?.total}
          loading={parcels.loading}
          scrollKey="vinedo-parcelas"
          empty={
            <EmptyState
              icon={<Plus strokeWidth={iconStroke} />}
              title={filters ? copy.vinedo.noMatch : copy.vinedo.emptyParcels}
              description={filters ? copy.vinedo.noMatchHint : copy.vinedo.emptyParcelsHint}
              action={
                canWrite && !filters ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
                    {copy.vinedo.newParcel}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {open ? (
        <ParcelDialog
          varieties={varieties.data?.items.filter((item) => item.is_active) ?? []}
          onClose={() => setOpen(false)}
          onCreated={(parcel) => {
            setOpen(false)
            toast(copy.vinedo.saved)
            parcels.reload()
            summary.reload()
            navigate(`/vinedo/${encodeURIComponent(parcel.code)}`)
          }}
        />
      ) : null}
    </VineyardShell>
  )
}

function ParcelDialog({
  varieties,
  onClose,
  onCreated,
}: {
  varieties: GrapeVariety[]
  onClose: () => void
  onCreated: (parcel: Parcel) => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [sigpac, setSigpac] = useState('')
  const [area, setArea] = useState('')
  const [ownership, setOwnership] = useState('own')
  const [organic, setOrganic] = useState('organic')
  const [since, setSince] = useState('2019-01-01')
  const [rows, setRows] = useState<VarietyRow[]>([{ ...EMPTY }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  async function submit() {
    const next: Record<string, string> = {}
    if (!/^[A-Za-z0-9-]{2,20}$/.test(code.trim())) next.code = copy.vinedo.codeInvalid
    if (!name.trim()) next.name = copy.vinedo.required
    if (sigpac.trim().split(':').length !== 7) next.sigpac = copy.vinedo.sigpacInvalid
    if (!area.trim()) next.area_ha = copy.vinedo.required
    if (organic === 'organic' && !since) next.organic_since = copy.vinedo.required
    if (rows.some((row) => !row.variety || !row.area_ha.trim())) next.varieties = copy.vinedo.varietyRequired
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    try {
      const created = await createParcel({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ownership,
        sigpac: sigpac.trim(),
        area_ha: area.trim().replace(',', '.'),
        organic_status: organic,
        organic_since: organic === 'organic' ? since : null,
        varieties: rows.map((row) => ({
          variety: row.variety,
          area_ha: row.area_ha.trim().replace(',', '.'),
        })),
      })
      onCreated(created)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else setErrors({ form: error instanceof ApiError ? error.message : copy.error.load })
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="parcela-alta" size="lg">
      <DialogHeader titleId="parcela-alta" title={copy.vinedo.newParcel} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          {errors.form ? <p className="text-caption text-danger-600">{errors.form}</p> : null}
          <Field id="parcela-codigo" label={copy.vinedo.code} error={errors.code}>
            <Input className="w-full" {...fieldAria('parcela-codigo', errors.code)} value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Field id="parcela-nombre" label={copy.vinedo.name} error={errors.name}>
            <Input className="w-full" {...fieldAria('parcela-nombre', errors.name)} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field id="parcela-sigpac" label={copy.vinedo.sigpac} error={errors.sigpac}>
            <Input className="w-full" {...fieldAria('parcela-sigpac', errors.sigpac)} value={sigpac} placeholder="23:50:0:0:7:7:1" onChange={(event) => setSigpac(event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="parcela-area" label={copy.vinedo.area} error={errors.area_ha}>
              <Input className="w-full" inputMode="decimal" {...fieldAria('parcela-area', errors.area_ha)} value={area} onChange={(event) => setArea(event.target.value)} />
            </Field>
            <Field id="parcela-tenencia" label={copy.vinedo.ownership}>
              <Select id="parcela-tenencia" className="w-full" value={ownership} onChange={(event) => setOwnership(event.target.value)}>
                <option value="own">{copy.vinedo.own}</option>
                <option value="leased">{copy.vinedo.leased}</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="parcela-eco" label={copy.vinedo.organicStatus}>
              <Select id="parcela-eco" className="w-full" value={organic} onChange={(event) => setOrganic(event.target.value)}>
                <option value="organic">{copy.vinedo.organic}</option>
                <option value="in_conversion">{copy.vinedo.converting}</option>
                <option value="conventional">{copy.vinedo.conventional}</option>
              </Select>
            </Field>
            {organic === 'organic' ? (
              <Field id="parcela-desde" label={copy.vinedo.organicSince} error={errors.organic_since}>
                <Input type="date" className="w-full" {...fieldAria('parcela-desde', errors.organic_since)} value={since} onChange={(event) => setSince(event.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="grid gap-2">
            <span className="text-label text-text-secondary">{copy.vinedo.varieties}</span>
            {rows.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <Select
                  aria-label={copy.vinedo.variety}
                  className="w-full"
                  value={row.variety}
                  onChange={(event) => {
                    const next = [...rows]
                    next[index] = { ...row, variety: event.target.value }
                    setRows(next)
                  }}
                >
                  <option value="">{copy.vinedo.variety}</option>
                  {varieties.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={copy.vinedo.area}
                  inputMode="decimal"
                  value={row.area_ha}
                  onChange={(event) => {
                    const next = [...rows]
                    next[index] = { ...row, area_ha: event.target.value }
                    setRows(next)
                  }}
                />
              </div>
            ))}
            {errors.varieties ? <p className="text-caption text-danger-600">{errors.varieties}</p> : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((current) => [...current, { ...EMPTY }])}>
              {copy.vinedo.addVariety}
            </Button>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.vinedo.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
          {copy.vinedo.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

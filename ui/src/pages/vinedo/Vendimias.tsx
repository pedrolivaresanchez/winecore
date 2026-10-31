import { useMemo, useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER } from '@/ui/frame'
import { Badge, Button, DataGrid, Dialog, DialogBody, DialogFooter, DialogHeader, GlassMenu, Input, MenuItem, Select, useMenuOpen, type GridColumn } from '@/ui'
import { MoreVertical } from '@/ui/icons'
import {
  closeHarvest,
  createHarvest,
  type Harvest,
  type HarvestSummary,
  type Parcel,
  type Reception,
} from '@/pages/vinedo/api'
import { VineyardShell } from '@/pages/vinedo/chrome'
import { GRID_LABELS, civil, ha, kilos, todayMadrid } from '@/pages/vinedo/labels'

export function Vendimias({ me }: { me: Me }) {
  useChromeTitle(copy.nav.vineyard)
  const canWrite = allows(me, 'vineyard.write')
  const [year, setYear] = useState(todayMadrid().slice(0, 4))
  const harvests = useApi<{ items: Harvest[] }>(`/v1/harvests?campaign=${year}`)
  const summary = useApi<HarvestSummary>(`/v1/harvests/summary?campaign=${year}`)
  const parcels = useApi<{ items: Parcel[] }>('/v1/parcels')
  const receptions = useApi<{ items: Reception[] }>('/v1/grape-receptions')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ parcel: 120, variety: 140, date: 120, kg: 120, closed: 120 })
  const [creating, setCreating] = useState(false)
  const [closing, setClosing] = useState<Harvest | null>(null)

  const columns = useMemo<GridColumn<Harvest>[]>(
    () => [
      { id: 'parcel', header: copy.vinedo.parcel, cell: (row) => row.parcel_code },
      { id: 'variety', header: copy.vinedo.variety, cell: (row) => row.variety },
      { id: 'date', header: copy.vinedo.date, cell: (row) => civil(row.harvested_on) },
      { id: 'kg', header: copy.vinedo.estimatedKg, align: 'right', cell: (row) => kilos(row.estimated_kg) },
      {
        id: 'closed',
        header: copy.vinedo.closed,
        cell: (row) => (
          <span className="inline-flex items-center gap-1">
            <Badge tone={row.closed ? 'success' : 'neutral'} size="sm">
              {row.closed ? copy.vinedo.yes : copy.vinedo.no}
            </Badge>
            {canWrite && !row.closed ? (
              <RowMenu label={copy.vinedo.closeHarvest} onClick={() => setClosing(row)} />
            ) : null}
          </span>
        ),
      },
    ],
    [canWrite],
  )

  const rows = harvests.data?.items ?? []

  return (
    <VineyardShell
      section="vendimias"
      screen="vinedo-vendimias"
      actions={
        canWrite ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
            {copy.vinedo.newHarvest}
          </Button>
        ) : null
      }
    >
      <div className={cn('flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle', FRAME_GUTTER)}>
        <Select aria-label={copy.vinedo.campaign} size="sm" value={year} onChange={(event) => setYear(event.target.value)}>
          {['2025', '2026', '2027'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        {summary.data ? (
          <span className="truncate text-caption text-text-tertiary">
            {kilos(summary.data.totals.net_kg)} · {copy.vinedo.organic} {kilos(summary.data.totals.organic_kg)}
          </span>
        ) : null}
      </div>
      {summary.data && summary.data.rows.length > 0 ? (
        <div className="grid gap-2 border-b border-border-subtle px-4 py-3">
          {summary.data.rows.map((row) => (
            <p key={`${row.parcel_code}-${row.variety_code}`} className="text-label text-ink-900">
              {row.parcel_code ?? copy.vinedo.grower} · {row.variety_code} · {kilos(row.net_kg)}
              {row.yield_kg_ha ? ` · ${row.yield_kg_ha} kg/ha` : ''}
              {row.area_ha ? ` · ${ha(row.area_ha)}` : ''}
            </p>
          ))}
        </div>
      ) : null}
      {harvests.error ? (
        <div className="p-4">
          <ErrorState title={harvests.error.message} onRetry={harvests.reload} />
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
          onOpenRow={(row) => {
            if (canWrite && !row.closed) setClosing(row)
          }}
          total={rows.length}
          loading={harvests.loading}
          scrollKey="vinedo-vendimias"
          empty={<p className="p-4 text-label text-text-tertiary">{copy.vinedo.emptyHarvests}</p>}
        />
      )}
      {creating ? (
        <HarvestDialog
          parcels={parcels.data?.items.filter((item) => item.is_active) ?? []}
          year={year}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            harvests.reload()
          }}
        />
      ) : null}
      {closing ? (
        <CloseDialog
          harvest={closing}
          receptions={(receptions.data?.items ?? []).filter((item) => item.status === 'confirmed' && item.ticket)}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null)
            harvests.reload()
            summary.reload()
          }}
        />
      ) : null}
    </VineyardShell>
  )
}

function RowMenu({ label, onClick }: { label: string; onClick: () => void }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.vinedo.more} onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
      <MenuItem
        onClick={() => {
          menu.close()
          onClick()
        }}
      >
        {label}
      </MenuItem>
    </GlassMenu>
  )
}

function HarvestDialog({
  parcels,
  year,
  onClose,
  onCreated,
}: {
  parcels: Parcel[]
  year: string
  onClose: () => void
  onCreated: () => void
}) {
  const parcel = parcels[0]
  const [code, setCode] = useState(parcel?.code ?? '')
  const chosen = parcels.find((item) => item.code === code)
  const [variety, setVariety] = useState(chosen?.varieties[0]?.variety ?? '')
  const [date, setDate] = useState(todayMadrid())
  const [kg, setKg] = useState('')
  const [crew, setCrew] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await createHarvest({
        parcel_code: code,
        vintage: Number(year),
        harvested_on: date,
        variety,
        estimated_kg: kg.trim() ? kg.trim().replace(',', '.') : null,
        crew_size: crew.trim() ? Number(crew) : null,
      })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="vendimia-alta" size="md">
      <DialogHeader titleId="vendimia-alta" title={copy.vinedo.newHarvest} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          <Field id="ven-parcela" label={copy.vinedo.parcel}>
            <Select
              id="ven-parcela"
              className="w-full"
              value={code}
              onChange={(event) => {
                const next = event.target.value
                setCode(next)
                const found = parcels.find((item) => item.code === next)
                setVariety(found?.varieties[0]?.variety ?? '')
              }}
            >
              {parcels.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ven-variedad" label={copy.vinedo.variety}>
            <Select id="ven-variedad" className="w-full" value={variety} onChange={(event) => setVariety(event.target.value)}>
              {(chosen?.varieties ?? []).map((item) => (
                <option key={item.variety} value={item.variety}>
                  {item.variety}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ven-fecha" label={copy.vinedo.date}>
            <Input id="ven-fecha" type="date" className="w-full" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field id="ven-kg" label={copy.vinedo.estimatedKg}>
            <Input id="ven-kg" inputMode="decimal" className="w-full" value={kg} onChange={(event) => setKg(event.target.value)} />
          </Field>
          <Field id="ven-gente" label={copy.vinedo.people}>
            <Input id="ven-gente" inputMode="numeric" className="w-full" value={crew} onChange={(event) => setCrew(event.target.value)} />
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

function CloseDialog({
  harvest,
  receptions,
  onClose,
  onClosed,
}: {
  harvest: Harvest
  receptions: Reception[]
  onClose: () => void
  onClosed: () => void
}) {
  const [id, setId] = useState(receptions[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await closeHarvest(harvest.id, id)
      onClosed()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="vendimia-cierre" size="sm">
      <DialogHeader titleId="vendimia-cierre" title={copy.vinedo.closeHarvest} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          <Field id="ven-recepcion" label={copy.vinedo.reception}>
            <Select id="ven-recepcion" className="w-full" value={id} onChange={(event) => setId(event.target.value)}>
              {receptions.length === 0 ? <option value="">{copy.vinedo.noReception}</option> : null}
              {receptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number || item.ticket?.lot_code || item.id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="primary" size="sm" loading={saving} disabled={!id} onClick={() => void save()}>
          {copy.vinedo.closeHarvest}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

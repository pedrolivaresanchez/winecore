import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { kindLabel } from '@/lib/cellar'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { EntityChoice, Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { LayoutGrid, Search } from '@/ui/icons'
import { Button, Chip, DataGrid, EmptyState, Input, Select, Skeleton, useToast, type GridColumn } from '@/ui'
import { GRID_LABELS } from '@/pages/bodega/labels'
import { createPosition, patchPosition } from '@/pages/bodega-plano/api'
import { PlanBoard } from '@/pages/bodega-plano/board'
import { boardSize, nextSlot, pctOf, sameGeom } from '@/pages/bodega-plano/geom'
import { holderKindLabel, isZoneKind, ZONE_ORDER, zoneLabel } from '@/pages/bodega-plano/text'
import type { CellarLocation, CellarMap, Geom, HolderKind, HolderView, MapZone, Page, PlanMarker, ZoneKind } from '@/pages/bodega-plano/types'

type ZonePick = ZoneKind | 'unplaced'

type Row = {
  id: string
  code: string
  kind: string
  lot: string
  fill: string
  href: string
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function cellarLocations(items: CellarLocation[], entities: Me['entities'], filter: EntityChoice): CellarLocation[] {
  return items.filter((item) => {
    if (item.kind !== 'cellar' || item.is_active === false) return false
    if (filter === 'all') return true
    const entity = entities.find((entry) => entry.code === filter)
    return entity ? sameId(item.controlling_entity_id, entity.id) : true
  })
}

function markerGeom(drafts: Record<string, Geom>, positionId: string, geom: Geom): Geom {
  return drafts[positionId] ?? geom
}

function markersOf(zone: MapZone, drafts: Record<string, Geom>): PlanMarker[] {
  const vessels: PlanMarker[] = []
  for (const vessel of zone.vessels) {
    if (vessel.position_id == null || vessel.x == null || vessel.y == null || vessel.width == null || vessel.height == null) continue
    vessels.push({
      key: vessel.id,
      positionId: vessel.position_id,
      zoneCode: zone.code,
      code: vessel.code,
      name: vessel.name,
      subject: 'vessel',
      vesselKind: vessel.kind,
      holderKind: null,
      lot: vessel.lot_code,
      fill: pctOf(vessel.fill_pct),
      href: `/bodega/depositos/${encodeURIComponent(vessel.code)}`,
      outdoor: vessel.outdoor_aging,
      geom: markerGeom(drafts, vessel.position_id, {
        x: vessel.x,
        y: vessel.y,
        width: vessel.width,
        height: vessel.height,
        rotation: vessel.rotation ?? 0,
      }),
    })
  }
  const holders: PlanMarker[] = zone.holders.map((holder) => ({
    key: holder.id,
    positionId: holder.position_id,
    zoneCode: zone.code,
    code: holder.code,
    name: holder.name,
    subject: 'holder' as const,
    vesselKind: null,
    holderKind: holder.kind === 'jaulon' || holder.kind === 'nicho' ? holder.kind : null,
    lot: holder.lot_code,
    fill: pctOf(holder.fill_pct),
    href: `/bodega/contenedores/${encodeURIComponent(holder.code)}`,
    outdoor: false,
    geom: markerGeom(drafts, holder.position_id, {
      x: holder.x,
      y: holder.y,
      width: holder.width,
      height: holder.height,
      rotation: holder.rotation,
    }),
  }))
  return [...vessels, ...holders]
}

function pickZone(map: CellarMap, focus: string | null, wanted: string | null): ZonePick {
  if (focus) {
    for (const zone of map.zones) {
      if (zone.vessels.some((vessel) => vessel.code === focus) || zone.holders.some((holder) => holder.code === focus)) return zone.kind
    }
    if (map.unplaced_vessels.some((vessel) => vessel.code === focus)) return 'unplaced'
  }
  if (wanted && (wanted === 'unplaced' || isZoneKind(wanted))) return wanted
  for (const kind of ZONE_ORDER) {
    const zone = map.zones.find((item) => item.kind === kind)
    if (zone && (zone.vessels.length > 0 || zone.holders.length > 0)) return kind
  }
  return map.zones[0]?.kind ?? 'elaboration'
}

function dirtyPositions(map: CellarMap, drafts: Record<string, Geom>) {
  const rows: { zoneCode: string; positionId: string; geom: Geom }[] = []
  for (const zone of map.zones) {
    for (const vessel of zone.vessels) {
      if (!vessel.position_id || vessel.x == null || vessel.y == null || vessel.width == null || vessel.height == null) continue
      const draft = drafts[vessel.position_id]
      if (!draft) continue
      const server = { x: vessel.x, y: vessel.y, width: vessel.width, height: vessel.height, rotation: vessel.rotation ?? 0 }
      if (!sameGeom(draft, server)) rows.push({ zoneCode: zone.code, positionId: vessel.position_id, geom: draft })
    }
    for (const holder of zone.holders) {
      const draft = drafts[holder.position_id]
      if (!draft) continue
      const server = { x: holder.x, y: holder.y, width: holder.width, height: holder.height, rotation: holder.rotation }
      if (!sameGeom(draft, server)) rows.push({ zoneCode: zone.code, positionId: holder.position_id, geom: draft })
    }
  }
  return rows
}

function rowOfMarker(marker: PlanMarker): Row {
  const kind =
    marker.subject === 'holder'
      ? holderKindLabel(marker.holderKind ?? '')
      : kindLabel((marker.vesselKind ?? 'other') as 'other')
  return {
    id: marker.key,
    code: marker.code,
    kind,
    lot: marker.lot || '—',
    fill: `${Math.round(marker.fill)} %`,
    href: marker.href,
  }
}

export function PlanoPage({ me }: { me: Me }) {
  useChromeTitle(copy.plano.title)
  const navigate = useNavigate()
  const toast = useToast()
  const wide = useMinWidth(768)
  const { filter, entities } = useEntity()
  const [params] = useSearchParams()
  const focus = params.get('recipiente')
  const wanted = params.get('zona')
  const locations = useApi<Page<CellarLocation>>(allows(me, 'cellar.read') ? '/v1/locations?limit=100' : null)
  const cellars = useMemo(
    () => cellarLocations(locations.data?.items ?? [], entities, filter),
    [locations.data, entities, filter],
  )
  const [locationOverride, setLocationOverride] = useState<string | null>(null)
  const locationId =
    (locationOverride && cellars.some((item) => item.id === locationOverride) ? locationOverride : null) ??
    cellars.find((item) => item.code === 'BOD')?.id ??
    cellars[0]?.id ??
    null
  const map = useApi<CellarMap>(locationId ? `/v1/cellar-map?location_id=${encodeURIComponent(locationId)}` : null)
  const holders = useApi<Page<HolderView>>(locationId ? `/v1/holders?location_id=${encodeURIComponent(locationId)}&limit=100` : null)
  const [override, setOverride] = useState<ZonePick | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Geom>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ code: 140, kind: 140, lot: 180, fill: 110 })
  const canOperate = allows(me, 'cellar.operate')

  const kind = override ?? (map.data ? pickZone(map.data, focus, wanted) : 'elaboration')
  const zone = map.data?.zones.find((item) => item.kind === kind) ?? null
  const markers = useMemo(() => (zone ? markersOf(zone, drafts) : []), [zone, drafts])
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? markers.filter((marker) => `${marker.code} ${marker.name} ${marker.lot ?? ''}`.toLowerCase().includes(needle))
    : markers
  const placedHolderIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of map.data?.zones ?? []) {
      for (const holder of item.holders) ids.add(holder.id)
    }
    return ids
  }, [map.data])
  const looseHolders = useMemo(
    () => (holders.data?.items ?? []).filter((holder) => holder.is_active && !placedHolderIds.has(holder.id)),
    [holders.data, placedHolderIds],
  )
  const looseVessels = useMemo(() => map.data?.unplaced_vessels ?? [], [map.data])
  const looseCount = looseVessels.length + looseHolders.length
  const board = boardSize(markers.map((marker) => marker.geom))
  const dirty = map.data ? dirtyPositions(map.data, drafts) : []
  const showPlan = wide && kind !== 'unplaced' && Boolean(zone)

  const columns = useMemo<GridColumn<Row>[]>(
    () => [
      { id: 'code', header: copy.plano.code, cell: (row) => row.code },
      { id: 'kind', header: copy.plano.kind, cell: (row) => row.kind },
      { id: 'lot', header: copy.plano.lot, cell: (row) => row.lot },
      { id: 'fill', header: copy.plano.fill, align: 'right', cell: (row) => row.fill },
    ],
    [],
  )

  const listRows = useMemo<Row[]>(() => {
    if (kind === 'unplaced') {
      return [
        ...looseVessels.map((vessel) => ({
          id: vessel.id,
          code: vessel.code,
          kind: kindLabel(vessel.kind as 'other'),
          lot: vessel.lot_code || '—',
          fill: `${Math.round(pctOf(vessel.fill_pct))} %`,
          href: `/bodega/depositos/${encodeURIComponent(vessel.code)}`,
        })),
        ...looseHolders.map((holder) => ({
          id: holder.id,
          code: holder.code,
          kind: holderKindLabel(holder.kind),
          lot: holder.lot_code || '—',
          fill: holder.fill_pct == null ? '—' : `${Math.round(pctOf(holder.fill_pct))} %`,
          href: `/bodega/contenedores/${encodeURIComponent(holder.code)}`,
        })),
      ].filter((row) => !needle || `${row.code} ${row.kind} ${row.lot}`.toLowerCase().includes(needle))
    }
    return visible.map(rowOfMarker)
  }, [kind, looseHolders, looseVessels, needle, visible])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const loading = locations.loading || (locationId !== null && map.loading && !map.data)
  const screen = editing ? 'bodega-plano-editar' : showPlan ? 'bodega-plano' : 'bodega-plano-lista'

  async function save() {
    if (!map.data) return
    setSaving(true)
    try {
      for (const row of dirtyPositions(map.data, drafts)) {
        await patchPosition(row.zoneCode, row.positionId, row.geom)
      }
      setDrafts({})
      setEditing(false)
      setSelected(null)
      map.reload()
      toast(copy.plano.saved)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function place(subject: { vessel_code?: string; holder_code?: string }, holderKind?: HolderKind | null) {
    if (!zone || placing) return
    const width = holderKind === 'nicho' ? 72 : subject.holder_code ? 120 : 110
    const height = holderKind === 'nicho' ? 56 : 78
    const slot = nextSlot(markers.map((marker) => marker.geom))
    setPlacing(true)
    try {
      await createPosition(zone.code, subject, { ...slot, width, height })
      map.reload()
      holders.reload()
      toast(copy.plano.placed)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    } finally {
      setPlacing(false)
    }
  }

  const selectedMarker = markers.find((marker) => marker.key === selected) ?? null

  return (
    <div data-screen={screen} data-zone={kind} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <LayoutGrid className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.plano.title}</h1>
        {cellars.length > 1 ? (
          <Select
            size="sm"
            aria-label={copy.plano.location}
            value={locationId ?? ''}
            onChange={(event) => {
              setLocationOverride(event.target.value)
              setOverride(null)
              setDrafts({})
              setEditing(false)
            }}
          >
            {cellars.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setDrafts({})
                  setSelected(null)
                }}
              >
                {copy.plano.cancel}
              </Button>
              <Button type="button" variant="primary" size="sm" loading={saving} disabled={dirty.length === 0} onClick={() => void save()}>
                {copy.plano.save}
              </Button>
            </>
          ) : canOperate && wide && zone ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {copy.plano.edit}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="plano-buscar"
            size="sm"
            type="search"
            value={query}
            placeholder={copy.plano.search}
            aria-label={copy.plano.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')} role="tablist" aria-label={copy.plano.zones}>
          {ZONE_ORDER.map((item) => (
            <Chip
              key={item}
              pressed={kind === item}
              active={kind === item}
              onClick={() => {
                setOverride(item)
                setSelected(null)
              }}
            >
              {zoneLabel(item)}
            </Chip>
          ))}
          {looseCount > 0 ? (
            <Chip pressed={kind === 'unplaced'} active={kind === 'unplaced'} onClick={() => setOverride('unplaced')}>
              {copy.plano.unplaced}
            </Chip>
          ) : null}
        </div>
      </div>

      {locations.error && cellars.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${locations.error.code})`} detail={locations.error.message} onRetry={locations.reload} />
        </div>
      ) : map.error && !map.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${map.error.code})`} detail={map.error.message} onRetry={map.reload} />
        </div>
      ) : loading ? (
        <div aria-busy="true" className="grid gap-3 p-4">
          <Skeleton className="h-64" />
        </div>
      ) : !locationId ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState size="sm" title={copy.plano.noCellar} description={copy.plano.noCellarHint} />
        </div>
      ) : showPlan && zone ? (
        <div className={cn('flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4', editing ? 'overflow-hidden' : 'overflow-auto')}>
          {visible.length === 0 && needle ? (
            <EmptyState size="sm" title={copy.plano.noMatch} />
          ) : (
            <div className={editing ? 'min-h-0 flex-1' : undefined}>
              <PlanBoard
                imageId={zone.plan_attachment_id}
                markers={visible}
                board={board}
                editing={editing}
                selected={selected}
                highlight={focus}
                onSelect={setSelected}
                onChange={(positionId, geom) => setDrafts((current) => ({ ...current, [positionId]: geom }))}
                fit={editing}
              />
            </div>
          )}
          {editing && selectedMarker ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-label font-medium text-ink-900">{selectedMarker.code}</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate(selectedMarker.href)}>
                {copy.plano.open}
              </Button>
            </div>
          ) : null}
          {editing ? (
            <div className="shrink-0">
              <p className="mb-1.5 text-caption text-text-tertiary">{copy.plano.unplaced}</p>
              {looseVessels.length + looseHolders.length === 0 ? (
                <p className="text-label text-text-secondary">{copy.plano.emptyZone}</p>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {looseVessels.map((vessel) => (
                    <Button
                      key={vessel.id}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={placing}
                      aria-label={`${copy.plano.place} ${vessel.code}`}
                      onClick={() => void place({ vessel_code: vessel.code })}
                    >
                      {vessel.code}
                    </Button>
                  ))}
                  {looseHolders.map((holder) => (
                    <Button
                      key={holder.id}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={placing}
                      aria-label={`${copy.plano.place} ${holder.code}`}
                      onClick={() => void place({ holder_code: holder.code }, holder.kind)}
                    >
                      {holder.code}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : kind !== 'unplaced' && !zone ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState size="sm" title={copy.plano.noZone} description={copy.plano.noZoneHint} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={listRows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(row.href)}
          rowHref={(row) => row.href}
          total={listRows.length}
          loading={map.loading}
          empty={
            <EmptyState
              size="sm"
              title={needle ? copy.plano.noMatch : copy.plano.emptyZone}
              description={needle ? undefined : copy.plano.emptyZoneHint}
            />
          }
        />
      )}
    </div>
  )
}

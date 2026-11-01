import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { kindLabel } from '@/lib/cellar'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { EntityChoice, Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Layers, Search } from '@/ui/icons'
import { Button, Chip, EmptyState, Input, SegmentedControl, Select, Skeleton, useToast } from '@/ui'
import { createPosition, deletePosition, patchPosition } from '@/pages/bodega-plano/api'
import { PlanBoard } from '@/pages/bodega-plano/board'
import { swatchClass, type ColourMode, type FillBand, type StateBand } from '@/pages/bodega-plano/colours'
import { boardSize, clampGeom, markerSize, nextSlot, NUDGE_STEP, pctOf, sameGeom } from '@/pages/bodega-plano/geom'
import { PlanPanel } from '@/pages/bodega-plano/panel'
import { holderKindLabel, isZoneKind, ZONE_ORDER, zoneLabel } from '@/pages/bodega-plano/text'
import { UnplacedTray, type TrayFilter } from '@/pages/bodega-plano/tray'
import type {
  CardTarget,
  CellarLocation,
  CellarMap,
  Geom,
  HolderView,
  LooseItem,
  MapHolder,
  MapZone,
  Page,
  PlanMarker,
  ZoneKind,
} from '@/pages/bodega-plano/types'
import { ZoneForm } from '@/pages/bodega-plano/zone-form'

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

function litresText(ml: number): string {
  const tenths = Math.round(ml / 100)
  const abs = Math.abs(tenths)
  return `${tenths < 0 ? '-' : ''}${Math.trunc(abs / 10)}.${abs % 10}`
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
      status: vessel.status,
      state: vessel.state,
      litres: vessel.litres,
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
    status: 'in_service',
    state: holder.state,
    litres: holder.litres ?? '0.0',
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

function pickZone(map: CellarMap, focus: string | null, wanted: string | null): ZoneKind {
  if (focus) {
    for (const zone of map.zones) {
      if (zone.vessels.some((vessel) => vessel.code === focus) || zone.holders.some((holder) => holder.code === focus)) return zone.kind
    }
  }
  if (wanted && isZoneKind(wanted)) return wanted
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

function holderAsMap(view: HolderView): MapHolder {
  const nominal = view.nominal_volume_ml
  return {
    position_id: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    id: view.id,
    code: view.code,
    name: view.name,
    kind: view.kind,
    kind_label: view.kind_label,
    number: view.number,
    capacity_bottles: view.capacity_bottles,
    nominal_volume_ml: nominal,
    format: view.format,
    count: view.count,
    litres: nominal == null ? null : litresText(view.count * nominal),
    fill_pct: view.fill_pct,
    lot_id: view.lot_id,
    lot_code: view.lot_code,
    product_state: view.product_state,
    state: view.state,
  }
}

const FILL_LEGEND: { band: FillBand; label: string }[] = [
  { band: 'empty', label: copy.plano.empty },
  { band: 'low', label: copy.plano.fillLow },
  { band: 'mid', label: copy.plano.fillMid },
  { band: 'high', label: copy.plano.fillHigh },
  { band: 'full', label: copy.plano.fillFull },
]

const STATE_LEGEND: { band: StateBand; label: string }[] = [
  { band: 'empty', label: copy.plano.empty },
  { band: 'wine', label: copy.plano.holding },
  { band: 'fermenting', label: copy.plano.stateFermenting },
  { band: 'aging', label: copy.plano.stateAging },
  { band: 'offline', label: copy.plano.outOfService },
]

function Legend({ mode }: { mode: ColourMode }) {
  const items = mode === 'fill' ? FILL_LEGEND : STATE_LEGEND
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={mode === 'fill' ? copy.plano.colourFill : copy.plano.colourState}>
      {items.map((item) => (
        <li key={item.band} className="flex items-center gap-1.5 text-caption text-text-secondary">
          <span className={cn('size-3 shrink-0 rounded-full border', swatchClass(mode, item.band))} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function PlanoPage({ me, views }: { me: Me; views?: ReactNode }) {
  useChromeTitle(copy.cellar.vessels)
  const toast = useToast()
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
  const [override, setOverride] = useState<ZoneKind | null>(null)
  const [query, setQuery] = useState('')
  const [trayQuery, setTrayQuery] = useState('')
  const [trayFilter, setTrayFilter] = useState<TrayFilter>('all')
  const [showUnplaced, setShowUnplaced] = useState(false)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Geom>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [colour, setColour] = useState<ColourMode>('fill')
  const [card, setCard] = useState<CardTarget | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; code: string } | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<(() => void) | null>(null)
  const openedFocus = useRef<string | null>(null)
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
  const looseItems = useMemo<LooseItem[]>(() => {
    return [
      ...looseVessels.map((vessel) => ({
        id: vessel.id,
        code: vessel.code,
        name: vessel.name,
        subject: 'vessel' as const,
        kind: vessel.kind,
        label: kindLabel(vessel.kind as 'other'),
      })),
      ...looseHolders.map((holder) => ({
        id: holder.id,
        code: holder.code,
        name: holder.name,
        subject: 'holder' as const,
        kind: holder.kind,
        label: holderKindLabel(holder.kind),
      })),
    ]
  }, [looseHolders, looseVessels])
  const looseCount = looseItems.length
  const board = boardSize(markers.map((marker) => marker.geom))
  const dirty = map.data ? dirtyPositions(map.data, drafts) : []
  const trayOpen = editing || showUnplaced
  const zoneTabs = useMemo(() => {
    const tabs: ZoneKind[] = [...ZONE_ORDER]
    if (map.data?.zones.some((item) => item.kind === 'other')) tabs.push('other')
    return tabs
  }, [map.data])
  const selectedMarker = markers.find((marker) => marker.key === selected) ?? null
  const cardHolder = useMemo(() => {
    if (!card || card.subject !== 'holder') return null
    for (const item of map.data?.zones ?? []) {
      const found = item.holders.find((holder) => holder.code === card.code)
      if (found) return found
    }
    const loose = looseHolders.find((holder) => holder.code === card.code)
    return loose ? holderAsMap(loose) : null
  }, [card, looseHolders, map.data])

  useEffect(() => () => gesture.current?.(), [])

  useEffect(() => {
    if (!focus || !map.data || openedFocus.current === focus) return
    openedFocus.current = focus
    for (const item of map.data.zones) {
      const vessel = item.vessels.find((row) => row.code === focus)
      if (vessel?.position_id) {
        setOverride(item.kind)
        setCard({ subject: 'vessel', code: vessel.code, name: vessel.name, zoneCode: item.code, positionId: vessel.position_id })
        return
      }
      const holder = item.holders.find((row) => row.code === focus)
      if (holder) {
        setOverride(item.kind)
        setCard({ subject: 'holder', code: holder.code, name: holder.name, zoneCode: item.code, positionId: holder.position_id })
        return
      }
    }
    const loose = map.data.unplaced_vessels.find((row) => row.code === focus)
    if (loose) {
      setShowUnplaced(true)
      setCard({ subject: 'vessel', code: loose.code, name: loose.name, zoneCode: '', positionId: '' })
    }
  }, [focus, map.data])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const loading = locations.loading || (locationId !== null && map.loading && !map.data)
  const screen = editing ? 'bodega-plano-editar' : zone ? 'bodega-plano' : 'bodega-plano-vacio'

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

  async function placeGeom(item: LooseItem, geom: Geom) {
    if (!zone || placing) return
    const subject = item.subject === 'vessel' ? { vessel_code: item.code } : { holder_code: item.code }
    setPlacing(true)
    try {
      await createPosition(zone.code, subject, geom)
      map.reload()
      holders.reload()
      toast(copy.plano.placed)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    } finally {
      setPlacing(false)
    }
  }

  function place(item: LooseItem) {
    const size = markerSize(item.subject, item.kind)
    const slot = nextSlot(markers.map((marker) => marker.geom), size.width, size.height)
    void placeGeom(item, slot)
  }

  function placeAt(item: LooseItem, clientX: number, clientY: number) {
    const el = boardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const size = markerSize(item.subject, item.kind)
    const x = ((clientX - rect.left) / rect.width) * board.w - size.width / 2
    const y = ((clientY - rect.top) / rect.height) * board.h - size.height / 2
    void placeGeom(item, clampGeom({ x, y, width: size.width, height: size.height, rotation: 0 }, board.w, board.h))
  }

  function beginPlace(item: LooseItem, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editing || event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    function move(ev: PointerEvent) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
        moved = true
        setGhost({ x: ev.clientX, y: ev.clientY, code: item.code })
      }
    }
    function up(ev: PointerEvent) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      gesture.current = null
      setGhost(null)
      if (!moved) {
        place(item)
        return
      }
      const el = boardRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom
      if (inside) placeAt(item, ev.clientX, ev.clientY)
    }
    gesture.current?.()
    gesture.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  async function remove(zoneCode: string, positionId: string) {
    try {
      await deletePosition(zoneCode, positionId)
      setDrafts((current) => {
        const next = { ...current }
        delete next[positionId]
        return next
      })
      setCard(null)
      setSelected(null)
      map.reload()
      holders.reload()
      toast(copy.plano.removed)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    }
  }

  function moveSelected(dx: number, dy: number) {
    if (!selectedMarker) return
    const next = clampGeom(
      { ...selectedMarker.geom, x: selectedMarker.geom.x + dx, y: selectedMarker.geom.y + dy },
      board.w,
      board.h,
    )
    setDrafts((current) => ({ ...current, [selectedMarker.positionId]: next }))
  }

  function openMarker(marker: PlanMarker) {
    setSelected(marker.key)
    setCard({
      subject: marker.subject,
      code: marker.code,
      name: marker.name,
      zoneCode: marker.zoneCode,
      positionId: marker.positionId,
    })
  }

  function openLoose(item: LooseItem) {
    setCard({ subject: item.subject, code: item.code, name: item.name, zoneCode: '', positionId: '' })
  }

  return (
    <div data-screen={screen} data-zone={kind} data-colour={colour} data-panel={card ? 'open' : 'closed'} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle', FRAME_GUTTER)}>
        <Layers className="hidden size-4 shrink-0 text-icon md:block" strokeWidth={iconStroke} />
        <h1 className="hidden min-w-0 truncate text-label font-medium text-ink-900 md:block">{copy.cellar.vessels}</h1>
        {views}
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
              setCard(null)
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
          <SegmentedControl
            size="sm"
            aria-label={copy.plano.colour}
            value={colour}
            onChange={setColour}
            options={[
              { value: 'fill', content: copy.plano.colourFill },
              { value: 'state', content: copy.plano.colourState },
            ]}
          />
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
                  setGhost(null)
                }}
              >
                {copy.plano.discard}
              </Button>
              <Button type="button" variant="primary" size="sm" loading={saving} disabled={dirty.length === 0} onClick={() => void save()}>
                {copy.plano.save}
              </Button>
            </>
          ) : canOperate && zone ? (
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
            className="w-44 shrink-0 sm:w-56"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')} role="tablist" aria-label={copy.plano.zones}>
          {zoneTabs.map((item) => (
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
            <Chip pressed={trayOpen} active={trayOpen} onClick={() => setShowUnplaced((current) => (editing ? true : !current))}>
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
      ) : !zone ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-6">
          <EmptyState size="sm" title={copy.plano.noZone} description={copy.plano.noZoneHint} />
          {canOperate ? (
            <ZoneForm
              key={kind}
              locationId={locationId}
              preset={kind}
              onCreated={(created) => {
                setOverride(created)
                map.reload()
              }}
            />
          ) : null}
        </div>
      ) : (
        <>
          <div className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-1.5', FRAME_GUTTER)}>
            <Legend mode={colour} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            {visible.length === 0 && needle ? (
              <div className="p-4">
                <EmptyState size="sm" title={copy.plano.noMatch} />
              </div>
            ) : (
              <div className="p-3 sm:p-4">
                <PlanBoard
                  imageId={zone.plan_attachment_id}
                  markers={visible}
                  board={board}
                  editing={editing}
                  selected={selected}
                  highlight={focus}
                  colourMode={colour}
                  boardRef={boardRef}
                  onSelect={setSelected}
                  onOpen={openMarker}
                  onChange={(positionId, geom) => setDrafts((current) => ({ ...current, [positionId]: geom }))}
                />
              </div>
            )}
          </div>
          {editing && selectedMarker ? (
            <div className={cn('flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border-subtle py-2', FRAME_GUTTER)}>
              <span className="mr-1 text-label font-medium text-ink-900">{selectedMarker.code}</span>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.plano.nudgeUp} onClick={() => moveSelected(0, -NUDGE_STEP)}>
                <ChevronUp />
              </Button>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.plano.nudgeDown} onClick={() => moveSelected(0, NUDGE_STEP)}>
                <ChevronDown />
              </Button>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.plano.nudgeLeft} onClick={() => moveSelected(-NUDGE_STEP, 0)}>
                <ChevronLeft />
              </Button>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.plano.nudgeRight} onClick={() => moveSelected(NUDGE_STEP, 0)}>
                <ChevronRight />
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => openMarker(selectedMarker)}>
                {copy.plano.openCard}
              </Button>
              <Button type="button" variant="dangerSoft" size="sm" onClick={() => void remove(selectedMarker.zoneCode, selectedMarker.positionId)}>
                {copy.plano.remove}
              </Button>
            </div>
          ) : null}
          {trayOpen ? (
            <UnplacedTray
              items={looseItems}
              query={trayQuery}
              filter={trayFilter}
              editing={editing}
              placing={placing}
              onQuery={setTrayQuery}
              onFilter={setTrayFilter}
              onOpen={openLoose}
              onPointerDown={beginPlace}
            />
          ) : null}
        </>
      )}
      <PlanPanel
        target={card}
        holder={cardHolder}
        canOperate={canOperate}
        onClose={() => setCard(null)}
        onRemove={(zoneCode, positionId) => void remove(zoneCode, positionId)}
      />
      {ghost ? (
        <div
          className="pointer-events-none fixed rounded-lg border-2 border-ink-900 bg-surface px-2 py-1 text-label font-medium text-ink-900 shadow-(--shadow-float)"
          style={{ left: ghost.x, top: ghost.y, transform: 'translate(-50%, -140%)', zIndex: 'var(--z-tooltip)' }}
        >
          {ghost.code}
        </div>
      ) : null}
    </div>
  )
}

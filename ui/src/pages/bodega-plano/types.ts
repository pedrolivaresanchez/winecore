export type ZoneKind = 'elaboration' | 'barrel_room' | 'outdoor' | 'bottle_store' | 'other'

export type MapVessel = {
  position_id: string | null
  x: number | null
  y: number | null
  width: number | null
  height: number | null
  rotation: number | null
  id: string
  code: string
  name: string
  kind: string
  material: string
  status: string
  state: string
  has_cooling_jacket: boolean
  capacity_ml: number
  volume_ml: number
  litres: string
  fill_pct: string
  lot_id: string | null
  lot_code: string | null
  product_state: string | null
  outdoor_aging: boolean
  aging_label: string | null
  barrel_status: string | null
  barrel_status_label: string | null
  barrel_use_count: number | null
}

export type MapHolder = {
  position_id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  id: string
  code: string
  name: string
  kind: string
  kind_label: string
  number: number | null
  capacity_bottles: number | null
  nominal_volume_ml: number | null
  format: string | null
  count: number
  litres: string | null
  fill_pct: string | null
  lot_id: string | null
  lot_code: string | null
  product_state: string | null
  state: string
}

export type MapZone = {
  id: string
  code: string
  name: string
  kind: ZoneKind
  kind_label: string
  plan_attachment_id: string | null
  vessels: MapVessel[]
  holders: MapHolder[]
}

export type CellarMap = {
  location_id: string
  location_code: string
  location_name: string
  zones: MapZone[]
  unplaced_vessels: MapVessel[]
}

export type Geom = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type OakOrigin = 'frances' | 'americano' | 'centroeuropeo' | 'otro'
export type ToastLevel = 'ligero' | 'medio' | 'medio_plus' | 'fuerte'
export type BarrelStatus = 'in_use' | 'resting' | 'to_retire' | 'retired'

export type BarrelView = {
  vessel_id: string
  vessel_code: string
  oak_origin: OakOrigin
  oak_origin_label: string
  forest: string | null
  toast: ToastLevel
  toast_label: string
  head_toast: boolean
  cooper: string
  year_made: number
  nominal_volume_ml: number
  purchase_date: string | null
  purchase_price: string | null
  use_count: number
  status: BarrelStatus
  status_label: string
  retired_on: string | null
}

export type DemijohnView = {
  vessel_id: string
  vessel_code: string
  outdoor_aging: boolean
  aging_label: string | null
}

export type HolderKind = 'nicho' | 'jaulon'
export type PackagedState = 'packaged_unlabeled' | 'packaged_labeled'

export type HolderBalance = {
  holder_id: string
  holder_code: string
  holder_kind: HolderKind
  owner_entity_id: string
  lot_id: string
  lot_code: string
  product_id: string
  product_state: PackagedState
  qty_units: number
}

export type HolderView = {
  id: string
  location_id: string
  zone_id: string | null
  code: string
  name: string
  kind: HolderKind
  kind_label: string
  number: number | null
  capacity_bottles: number | null
  nominal_volume_ml: number | null
  format: string | null
  notes: string | null
  is_active: boolean
  count: number
  fill_pct: string | null
  lot_id: string | null
  lot_code: string | null
  product_id: string | null
  product_state: PackagedState | null
  owner_entity_id: string | null
  state: string
  balances: HolderBalance[]
}

export type Page<T> = { items: T[]; next_cursor: string | null; total: number }

export type CellarLocation = {
  id: string
  code: string
  name: string
  kind: string
  controlling_entity_id: string
  is_active: boolean
}

export type AuditChange = { field: string; before: unknown; after: unknown }

export type AuditItem = {
  id: number
  occurred_at: string
  action: string
  changes: AuditChange[]
}

export type PlanCardMetric = {
  parameter_code: string
  name: string
  value: string
  unit: string
}

export type PlanCard = {
  code: string
  name: string
  kind: string
  kind_label: string
  capacity_ml: number
  capacity_litres: string
  volume_ml: number
  litres: string
  fill_pct: string
  status: string
  status_label: string
  state: string
  state_label: string
  lot_code: string | null
  wine_name: string | null
  last_operation: { op_type: string; op_type_label: string; occurred_at: string; status: string } | null
  last_analysis: { sampled_at: string; kind: string; results: PlanCardMetric[] } | null
}

export type CardTarget = {
  subject: 'vessel' | 'holder'
  code: string
  name: string
  zoneCode: string
  positionId: string
}

export type LooseItem = {
  id: string
  code: string
  name: string
  subject: 'vessel' | 'holder'
  kind: string
  label: string
}

export type PlanMarker = {
  key: string
  positionId: string
  zoneCode: string
  code: string
  name: string
  subject: 'vessel' | 'holder'
  vesselKind: string | null
  holderKind: HolderKind | null
  lot: string | null
  fill: number
  status: string
  state: string
  litres: string
  href: string
  outdoor: boolean
  geom: Geom
}

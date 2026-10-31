import type { EntityCode, MeEntity } from '@/lib/types'
import type {
  CountKind,
  CountLine,
  CountStatus,
  FiscalBalance,
  FiscalMove,
  InventoryCount,
  PhysicalMove,
  ProductClass,
  ProductState,
  StockBalance,
} from '@/pages/existencias/api'
import { lineGap } from '@/pages/existencias/filters'

export type MaterialRow = {
  id: string
  sku: string
  name: string
  location: string
  units: number
}

type Place = {
  id: string
  code: string
  name: string
  taxWarehouseId: string | null
  controllingEntityId: string
}

type VesselInfo = { code: string; capacityMl: number | null; qr: string | null }
type LotInfo = { code: string; vintage: number | null; wineId: string | null }
type ProductInfo = { name: string; sku: string; wineId: string | null; vintage: number | null; formatId: string | null; kind: string }
type WineInfo = { name: string }
type EntityInfo = { code: EntityCode; name: string }

export type Catalog = {
  locations: Map<string, Place>
  vessels: Map<string, VesselInfo>
  lots: Map<string, LotInfo>
  products: Map<string, ProductInfo>
  wines: Map<string, WineInfo>
  formats: Map<string, number>
  entities: Map<string, EntityInfo>
  warehouses: Map<string, { name: string; entityId: string }>
}

const STATES = new Set<ProductState>(['grape', 'must', 'wine', 'packaged_unlabeled', 'packaged_labeled', 'goods'])
const CLASSES = new Set<ProductClass>(['bulk', 'bulk_wood', 'packaged'])
const KINDS = new Set<CountKind>(['opening', 'periodic', 'inspection', 'spot'])
const STATUSES = new Set<CountStatus>(['draft', 'counting', 'review', 'approved', 'posted', 'cancelled'])

export function emptyCatalog(entities: MeEntity[]): Catalog {
  const catalog: Catalog = {
    locations: new Map(),
    vessels: new Map(),
    lots: new Map(),
    products: new Map(),
    wines: new Map(),
    formats: new Map(),
    entities: new Map(),
    warehouses: new Map(),
  }
  for (const entity of entities) {
    catalog.entities.set(entity.id.toLowerCase(), { code: entity.code, name: entity.legal_name })
  }
  return catalog
}

export function absorbCatalog(
  catalog: Catalog,
  lists: {
    locations?: unknown[]
    vessels?: unknown[]
    lots?: unknown[]
    products?: unknown[]
    wines?: unknown[]
    formats?: unknown[]
  },
): Catalog {
  for (const item of lists.locations ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    if (!id) continue
    const place: Place = {
      id,
      code: text(row, 'code') ?? id.slice(0, 8),
      name: text(row, 'name') ?? text(row, 'code') ?? 'Ubicación',
      taxWarehouseId: idOf(row, 'tax_warehouse_id'),
      controllingEntityId: idOf(row, 'controlling_entity_id') ?? '',
    }
    catalog.locations.set(id, place)
    if (place.taxWarehouseId && !catalog.warehouses.has(place.taxWarehouseId)) {
      catalog.warehouses.set(place.taxWarehouseId, { name: place.name, entityId: place.controllingEntityId })
    }
  }
  for (const item of lists.vessels ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    if (!id) continue
    catalog.vessels.set(id, {
      code: text(row, 'code') ?? id.slice(0, 8),
      capacityMl: intOrNull(row, 'capacity_ml'),
      qr: text(row, 'qr_token'),
    })
  }
  for (const item of lists.lots ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    if (!id) continue
    catalog.lots.set(id, {
      code: text(row, 'code') ?? id.slice(0, 8),
      vintage: intOrNull(row, 'vintage'),
      wineId: idOf(row, 'wine_id'),
    })
  }
  for (const item of lists.products ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    if (!id) continue
    catalog.products.set(id, {
      name: text(row, 'name') ?? text(row, 'sku') ?? 'Producto',
      sku: text(row, 'sku') ?? '',
      wineId: idOf(row, 'wine_id'),
      vintage: intOrNull(row, 'vintage'),
      formatId: idOf(row, 'format_id'),
      kind: text(row, 'kind') ?? '',
    })
  }
  for (const item of lists.wines ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    if (!id) continue
    catalog.wines.set(id, { name: text(row, 'name') ?? text(row, 'code') ?? 'Vino' })
  }
  for (const item of lists.formats ?? []) {
    const row = asRecord(item)
    const id = idOf(row, 'id')
    const nominal = intOrNull(row, 'nominal_volume_ml')
    if (id && nominal) catalog.formats.set(id, nominal)
  }
  return catalog
}

export function toBalance(raw: unknown, catalog: Catalog): StockBalance {
  const row = asRecord(raw)
  const locationId = idOf(row, 'location_id') ?? ''
  const vesselId = idOf(row, 'vessel_id')
  const ownerId = idOf(row, 'owner_entity_id') ?? ''
  const lotId = idOf(row, 'lot_id')
  const productId = idOf(row, 'product_id')
  const location = catalog.locations.get(locationId)
  const vessel = vesselId ? catalog.vessels.get(vesselId) : undefined
  const lot = lotId ? catalog.lots.get(lotId) : undefined
  const product = productId ? catalog.products.get(productId) : undefined
  const wineId = product?.wineId ?? lot?.wineId ?? null
  const wine = wineId ? catalog.wines.get(wineId) : undefined
  const nominal = product?.formatId ? catalog.formats.get(product.formatId) ?? null : null
  return {
    location_id: locationId,
    location_code: prefer(text(row, 'location_code'), location?.code) ?? '—',
    location_name: prefer(text(row, 'location_name'), location?.name) ?? '—',
    vessel_id: vesselId,
    vessel_code: prefer(text(row, 'vessel_code'), vessel?.code),
    vessel_capacity_ml: intOrNull(row, 'vessel_capacity_ml') ?? vessel?.capacityMl ?? null,
    owner_entity_id: ownerId,
    owner_code: entityCode(text(row, 'owner_code'), ownerId, catalog),
    lot_id: lotId,
    lot_code: prefer(text(row, 'lot_code'), lot?.code),
    vintage: intOrNull(row, 'vintage') ?? lot?.vintage ?? product?.vintage ?? null,
    product_id: productId,
    product_name: prefer(text(row, 'product_name'), product?.name),
    wine_name: prefer(text(row, 'wine_name'), wine?.name),
    product_state: stateOf(row.product_state),
    qty_units: num(row, 'qty_units'),
    volume_ml: num(row, 'volume_ml'),
    mass_g: num(row, 'mass_g'),
    nominal_volume_ml: intOrNull(row, 'nominal_volume_ml') ?? nominal,
  }
}

export function toFiscal(raw: unknown, catalog: Catalog): FiscalBalance {
  const row = asRecord(raw)
  const warehouseId = idOf(row, 'tax_warehouse_id') ?? ''
  const warehouse = catalog.warehouses.get(warehouseId)
  const lotId = idOf(row, 'lot_id')
  const productId = idOf(row, 'product_id')
  const lot = lotId ? catalog.lots.get(lotId) : undefined
  const product = productId ? catalog.products.get(productId) : undefined
  const wineId = product?.wineId ?? lot?.wineId ?? null
  const wine = wineId ? catalog.wines.get(wineId) : undefined
  return {
    tax_warehouse_id: warehouseId,
    tax_warehouse_name: text(row, 'tax_warehouse_name') ?? warehouse?.name ?? 'Establecimiento',
    legal_entity_id: idOf(row, 'legal_entity_id') ?? warehouse?.entityId ?? '',
    product_class: classOf(row.product_class),
    excise_product_key: text(row, 'excise_product_key'),
    lot_id: lotId,
    lot_code: prefer(text(row, 'lot_code'), lot?.code),
    vintage: intOrNull(row, 'vintage') ?? lot?.vintage ?? product?.vintage ?? null,
    product_id: productId,
    product_name: prefer(text(row, 'product_name'), product?.name),
    wine_name: prefer(text(row, 'wine_name'), wine?.name),
    volume_ml: num(row, 'volume_ml'),
    units: num(row, 'units'),
  }
}

export function toPhysicalMove(raw: unknown, catalog: Catalog): PhysicalMove {
  const row = asRecord(raw)
  const balance = toBalance(raw, catalog)
  const table = text(row, 'source_table') ?? ''
  const sourceId = idOf(row, 'source_id') ?? text(row, 'source_id') ?? ''
  return {
    ...balance,
    id: idOf(row, 'id') ?? sourceId,
    occurred_at: text(row, 'occurred_at') ?? '',
    move_type: text(row, 'move_type') ?? '',
    source_table: table,
    source_id: sourceId,
    document_ref: text(row, 'document_ref') ?? documentLabel(table, balance.lot_code),
    justification_ref: text(row, 'justification_ref'),
    silicie_entry_id: idOf(row, 'silicie_entry_id'),
    silicie_ref: text(row, 'silicie_ref'),
    created_by: text(row, 'created_by') ?? '—',
    period_locked: bool(row, 'period_locked') || bool(row, 'period_closed'),
    locked_until: text(row, 'locked_until'),
  }
}

export function toFiscalMove(raw: unknown, catalog: Catalog): FiscalMove {
  const row = asRecord(raw)
  const fiscal = toFiscal(raw, catalog)
  const table = text(row, 'source_table') ?? ''
  const sourceId = idOf(row, 'source_id') ?? text(row, 'source_id') ?? ''
  const silicie = text(row, 'silicie_ref') ?? idOf(row, 'silicie_entry_id')
  return {
    id: idOf(row, 'id') ?? sourceId,
    tax_warehouse_id: fiscal.tax_warehouse_id,
    tax_warehouse_name: fiscal.tax_warehouse_name,
    legal_entity_id: fiscal.legal_entity_id,
    fiscal_date: text(row, 'fiscal_date') ?? '',
    physical_date: text(row, 'physical_date'),
    move_type: text(row, 'move_type') ?? '',
    product_class: fiscal.product_class,
    lot_id: fiscal.lot_id,
    lot_code: fiscal.lot_code,
    vintage: fiscal.vintage,
    product_id: fiscal.product_id,
    product_name: fiscal.product_name,
    wine_name: fiscal.wine_name,
    volume_ml: fiscal.volume_ml,
    units: fiscal.units,
    excise_product_key: fiscal.excise_product_key,
    justification_type: text(row, 'justification_type') ?? '',
    justification_ref: text(row, 'justification_ref') ?? '—',
    fiscal_trigger: text(row, 'fiscal_trigger') ?? '',
    source_table: table,
    source_id: sourceId,
    silicie_entry_id: idOf(row, 'silicie_entry_id'),
    silicie_ref: silicie,
    reason: text(row, 'reason'),
    created_by: text(row, 'created_by') ?? '—',
    period_locked: bool(row, 'period_locked') || bool(row, 'period_closed'),
    locked_until: text(row, 'locked_until'),
  }
}

export function toMaterial(raw: unknown, catalog: Catalog): MaterialRow {
  const row = asRecord(raw)
  const productId = idOf(row, 'product_id') ?? ''
  const locationId = idOf(row, 'location_id')
  const location = locationId ? catalog.locations.get(locationId) : undefined
  const product = productId ? catalog.products.get(productId) : undefined
  return {
    id: `${productId}:${locationId ?? ''}:${idOf(row, 'owner_entity_id') ?? ''}`,
    sku: text(row, 'sku') ?? product?.sku ?? '—',
    name: text(row, 'name') ?? product?.name ?? 'Material',
    location: location?.name ?? '—',
    units: num(row, 'qty_units'),
  }
}

export function toCount(raw: unknown, catalog: Catalog): InventoryCount {
  const row = asRecord(raw)
  const lines = linesOf(row).map((line) => toLine(line, catalog))
  const locationIds = stringList(row.location_ids, true)
  const codes = stringList(row.location_codes)
  const resolvedCodes = (codes.length > 0 ? codes : locationIds.map((id) => catalog.locations.get(id)?.code ?? id.slice(0, 8))).map((code) =>
    /^[0-9a-f-]{36}$/i.test(code) ? code : code.toUpperCase(),
  )
  const entityId = idOf(row, 'legal_entity_id') ?? ''
  const kind = text(row, 'kind')
  const status = text(row, 'status')
  const provided = intOrNull(row, 'difference_count')
  return {
    id: idOf(row, 'id') ?? '',
    legal_entity_id: entityId,
    legal_entity_code: entityCode(text(row, 'legal_entity_code'), entityId, catalog),
    number: text(row, 'number'),
    kind: KINDS.has(kind as CountKind) ? (kind as CountKind) : 'periodic',
    counted_at: text(row, 'counted_at') ?? '',
    location_ids: locationIds,
    location_codes: resolvedCodes,
    status: STATUSES.has(status as CountStatus) ? (status as CountStatus) : 'counting',
    approval_request_id: idOf(row, 'approval_request_id'),
    signed_by: idOf(row, 'signed_by'),
    signed_by_name: text(row, 'signed_by_name'),
    signed_at: text(row, 'signed_at'),
    notes: text(row, 'notes'),
    created_by: text(row, 'created_by') ?? '',
    created_at: text(row, 'created_at') ?? '',
    difference_count: provided ?? lines.filter((line) => {
      const gap = lineGap(line)
      return gap != null && gap !== 0
    }).length,
    lines,
  }
}

function toLine(raw: unknown, catalog: Catalog): CountLine {
  const row = asRecord(raw)
  const locationId = idOf(row, 'location_id') ?? ''
  const vesselId = idOf(row, 'vessel_id')
  const ownerId = idOf(row, 'owner_entity_id') ?? ''
  const lotId = idOf(row, 'lot_id')
  const productId = idOf(row, 'product_id')
  const location = catalog.locations.get(locationId)
  const vessel = vesselId ? catalog.vessels.get(vesselId) : undefined
  const lot = lotId ? catalog.lots.get(lotId) : undefined
  const product = productId ? catalog.products.get(productId) : undefined
  const wineId = product?.wineId ?? lot?.wineId ?? null
  const wine = wineId ? catalog.wines.get(wineId) : undefined
  const nominal = product?.formatId ? catalog.formats.get(product.formatId) ?? null : null
  return {
    id: idOf(row, 'id') ?? '',
    count_id: idOf(row, 'count_id') ?? '',
    location_id: locationId,
    location_code: prefer(text(row, 'location_code'), location?.code) ?? '—',
    location_name: prefer(text(row, 'location_name'), location?.name) ?? '—',
    vessel_id: vesselId,
    vessel_code: prefer(text(row, 'vessel_code'), vessel?.code),
    vessel_capacity_ml: intOrNull(row, 'vessel_capacity_ml') ?? vessel?.capacityMl ?? null,
    qr_token: text(row, 'qr_token') ?? vessel?.qr ?? null,
    owner_entity_id: ownerId,
    owner_code: entityCode(text(row, 'owner_code'), ownerId, catalog),
    lot_id: lotId,
    lot_code: text(row, 'lot_code') ?? lot?.code ?? null,
    product_id: productId,
    product_name: text(row, 'product_name') ?? product?.name ?? null,
    wine_name: text(row, 'wine_name') ?? wine?.name ?? null,
    vintage: intOrNull(row, 'vintage') ?? lot?.vintage ?? product?.vintage ?? null,
    product_state: stateOf(row.product_state),
    nominal_volume_ml: intOrNull(row, 'nominal_volume_ml') ?? nominal,
    expected_qty_units: num(row, 'expected_qty_units'),
    expected_volume_ml: num(row, 'expected_volume_ml'),
    counted_qty_units: intOrNull(row, 'counted_qty_units'),
    counted_volume_ml: intOrNull(row, 'counted_volume_ml'),
    method: methodOf(row.method),
    difference_reason: text(row, 'difference_reason'),
    photo_attachment_id: idOf(row, 'photo_attachment_id'),
  }
}

function documentLabel(table: string, lotCode: string | null): string {
  if (table === 'sales.delivery_note') return 'Albarán'
  if (table === 'billing.invoice') return 'Factura'
  if (table === 'cellar.operation') return 'Operación'
  if (table === 'inventory.inventory_count') return 'Aforo'
  if (table === 'inventory.lot') return lotCode ? `Lote ${lotCode}` : 'Lote'
  if (table === 'catalog.product') return 'Entrada de material'
  const tail = table.split('.').pop()
  return tail && tail.length > 0 ? tail : 'Documento'
}

function linesOf(row: Record<string, unknown>): unknown[] {
  const lines = row.lines
  if (Array.isArray(lines)) return lines
  if (lines && typeof lines === 'object' && Array.isArray((lines as { items?: unknown[] }).items)) {
    return (lines as { items: unknown[] }).items
  }
  return []
}

function entityCode(explicit: string | null, id: string, catalog: Catalog): EntityCode {
  if (explicit === 'PO' || explicit === 'CVPO') return explicit
  return catalog.entities.get(id)?.code ?? 'PO'
}

function stateOf(value: unknown): ProductState {
  return typeof value === 'string' && STATES.has(value as ProductState) ? (value as ProductState) : 'wine'
}

function classOf(value: unknown): ProductClass {
  return typeof value === 'string' && CLASSES.has(value as ProductClass) ? (value as ProductClass) : 'bulk'
}

function methodOf(value: unknown): CountLine['method'] {
  if (typeof value !== 'string' || value.length === 0) return null
  const methods = ['dipstick', 'flowmeter', 'level_gauge', 'unit_count', 'weight', 'estimate'] as const
  return methods.includes(value as (typeof methods)[number]) ? (value as CountLine['method']) : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function prefer(explicit: string | null, fallback: string | null | undefined): string | null {
  if (explicit && explicit !== '—') return explicit
  return fallback ?? null
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function idOf(row: Record<string, unknown>, key: string): string | null {
  const value = text(row, key)
  return value ? value.toLowerCase() : null
}

function num(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : 0
}

function intOrNull(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true
}

function stringList(value: unknown, lower = false): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => (lower ? item.toLowerCase() : item))
}

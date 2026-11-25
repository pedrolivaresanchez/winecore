import { describe, expect, it } from 'bun:test'
import type { CatalogLot } from '../../lib/sales-catalog'
import { defaultWarehouseId, unitsAt, warehouseLabel, warehouseOptions } from './warehouse'

const bod = { id: 'bod', code: 'BOD', name: 'Bodega Pedro Olivares' }
const tfrp = { id: 'tfrp', code: 'TFRP', name: 'Almacén TFRP' }
const vlc = { id: 'vlc', code: 'VLC', name: 'Valencia' }

const lots: CatalogLot[] = [
  { id: 'l1', code: 'L1', productId: 'p1', locationId: 'bod', qty: 120 },
  { id: 'l2', code: 'L2', productId: 'p1', locationId: 'tfrp', qty: 40 },
  { id: 'l3', code: 'L3', productId: 'p2', locationId: 'bod', qty: 8 },
]

describe('almacén de salida', () => {
  it('pone Bodega y TFRP delante y enseña el nombre con el código', () => {
    expect(warehouseOptions([vlc, tfrp, bod]).map((item) => item.code)).toEqual(['BOD', 'TFRP', 'VLC'])
    expect(defaultWarehouseId([tfrp, vlc, bod])).toBe('bod')
    expect(defaultWarehouseId([vlc, tfrp])).toBe('tfrp')
    expect(warehouseLabel(bod)).toBe('Bodega Pedro Olivares · BOD')
    expect(warehouseLabel(tfrp)).toBe('Almacén TFRP · TFRP')
    expect(warehouseLabel({ id: 'x', code: 'BOD', name: 'BOD' })).toBe('BOD')
  })

  it('cuenta el stock del almacén elegido, no el del otro', () => {
    expect(unitsAt(lots, 'bod')).toBe(128)
    expect(unitsAt(lots, 'tfrp')).toBe(40)
    expect(unitsAt(lots, 'bod', 'p1')).toBe(120)
    expect(unitsAt(lots, 'tfrp', 'p2')).toBe(0)
    expect(unitsAt(lots, 'vlc')).toBe(0)
  })
})

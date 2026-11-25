import { describe, expect, it } from 'bun:test'
import { cellarQuarters, prefersSimplified, quarterBounds } from './simplified'

describe('venta bodega', () => {
  it('propone simplificada solo a una persona de CVPO sin NIF', () => {
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'person', taxId: null, channel: 'cellar_shop' })).toBe(true)
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'person', taxId: '', channel: 'web' })).toBe(true)
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'person', taxId: null })).toBe(true)
    expect(prefersSimplified({ entityCode: 'PO', kind: 'person', taxId: null, channel: 'web' })).toBe(false)
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'company', taxId: null, channel: 'web' })).toBe(false)
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'person', taxId: '12345678Z', channel: 'web' })).toBe(false)
    expect(prefersSimplified({ entityCode: 'CVPO', kind: 'person', taxId: null, channel: 'horeca' })).toBe(false)
  })

  it('acota la venta bodega a un trimestre', () => {
    expect(quarterBounds('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(quarterBounds('2027-Q1')).toEqual({ from: '2027-01-01', to: '2027-03-31' })
    expect(quarterBounds('2024-Q2')).toEqual({ from: '2024-04-01', to: '2024-06-30' })
    expect(quarterBounds('2026-13')).toBeNull()
    const quarters = cellarQuarters(new Date('2026-11-25T12:00:00Z'))
    expect(quarters[0]).toEqual({ value: '2026-Q4', label: '2026 T4' })
    expect(quarters).toHaveLength(8)
    expect(quarters.map((item) => item.value)).toContain('2025-Q1')
  })
})

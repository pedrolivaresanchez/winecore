import { describe, expect, it } from 'bun:test'
import {
  canCollectInvoice,
  cobroAmountText,
  methodNeedsAccount,
  outstandingCents,
  parseCobroCents,
} from './cobro'
import { collectionFace } from './format'

const issued = {
  status: 'issued',
  customer_id: 'cliente',
  total: '180.00',
  amount_paid: '0.00',
}

describe('cobro de una factura', () => {
  it('deja el pendiente y el texto con dos decimales en español', () => {
    expect(outstandingCents('180.00', '0.00')).toBe(18000)
    expect(outstandingCents('180.00', '100.00')).toBe(8000)
    expect(outstandingCents('180.00', '180.00')).toBe(0)
    expect(outstandingCents('-60.00', '0.00')).toBe(0)
    expect(cobroAmountText(18000)).toBe('180,00')
    expect(cobroAmountText(8000)).toBe('80,00')
    expect(cobroAmountText(123456)).toBe('1.234,56')
  })

  it('acepta el importe con coma, punto o miles y rechaza más de dos decimales', () => {
    expect(parseCobroCents('180,00')).toBe(18000)
    expect(parseCobroCents('180.00')).toBe(18000)
    expect(parseCobroCents('180')).toBe(18000)
    expect(parseCobroCents('12,5')).toBe(1250)
    expect(parseCobroCents('1.234,56')).toBe(123456)
    expect(parseCobroCents('1.234')).toBe(123400)
    expect(parseCobroCents(' 180,00 € ')).toBe(18000)
    expect(parseCobroCents('0,00')).toBe(0)
    expect(parseCobroCents('')).toBeNull()
    expect(parseCobroCents('180,001')).toBeNull()
    expect(parseCobroCents('-1')).toBeNull()
  })

  it('pide cuenta en transferencia, tarjeta, Bizum y domiciliación', () => {
    expect(methodNeedsAccount('transfer')).toBe(true)
    expect(methodNeedsAccount('card')).toBe(true)
    expect(methodNeedsAccount('bizum')).toBe(true)
    expect(methodNeedsAccount('direct_debit')).toBe(true)
    expect(methodNeedsAccount('cash')).toBe(false)
    expect(methodNeedsAccount('other')).toBe(false)
  })

  it('solo ofrece el cobro si la factura emitida tiene cliente y pendiente', () => {
    expect(canCollectInvoice(issued, true)).toBe(true)
    expect(canCollectInvoice(issued, false)).toBe(false)
    expect(canCollectInvoice({ ...issued, status: 'draft' }, true)).toBe(false)
    expect(canCollectInvoice({ ...issued, customer_id: null }, true)).toBe(false)
    expect(canCollectInvoice({ ...issued, amount_paid: '180.00' }, true)).toBe(false)
  })

  it('la ficha emitida y saldada se lee como Cobrada', () => {
    expect(collectionFace('issued', 'paid')).toEqual({ label: 'Cobrada', tone: 'success' })
    expect(collectionFace('issued', 'partially_paid')).toEqual({ label: 'Cobro parcial', tone: 'warning' })
    expect(collectionFace('issued', 'unpaid')).toBeNull()
    expect(collectionFace('draft', 'paid')).toBeNull()
    expect(collectionFace('voided', 'paid')).toBeNull()
  })
})

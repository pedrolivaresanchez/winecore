import { copy } from '@/i18n'
import type { PaymentMethod } from '@/lib/finance'
import { centsOf } from '@/pages/cobros/money'
import type { Invoice } from '@/pages/facturas/types'

/** Formas del cobro de una factura. Bizum se guarda como alias; el resto ya existía. */
export const INVOICE_METHODS = ['transfer', 'cash', 'card', 'bizum', 'direct_debit', 'other'] as const
export type InvoiceMethod = (typeof INVOICE_METHODS)[number]

const ACCOUNT_METHODS = new Set<InvoiceMethod>(['transfer', 'card', 'bizum', 'direct_debit'])

export function invoiceMethodLabel(method: string): string {
  if (method === 'direct_debit') return copy.facturas.payDebit
  if (method === 'bizum') return copy.cobros.methods.bizum
  if (method in copy.cobros.methods) return copy.cobros.methods[method as keyof typeof copy.cobros.methods]
  return method
}

export function methodNeedsAccount(method: string): boolean {
  return ACCOUNT_METHODS.has(method as InvoiceMethod)
}

export function outstandingCents(total: string | null | undefined, paid: string | null | undefined): number {
  return Math.max(0, centsOf(total) - centsOf(paid))
}

export function canCollectInvoice(
  invoice: Pick<Invoice, 'status' | 'customer_id' | 'total' | 'amount_paid'>,
  allowsWrite: boolean,
): boolean {
  return invoice.status === 'issued' && Boolean(invoice.customer_id) && allowsWrite && outstandingCents(invoice.total, invoice.amount_paid) > 0
}

/** `180,00` y `1.234,56`. El punto solo es decimal cuando van uno o dos dígitos detrás. */
export function parseCobroCents(value: string): number | null {
  let text = value.trim().replace(/[\s€]/g, '')
  if (!text || text.startsWith('-')) return null
  const comma = text.lastIndexOf(',')
  const dot = text.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    text = text.split(thousands).join('')
    if (decimal === ',') text = text.replace(',', '.')
  } else if (comma >= 0) {
    if ((text.match(/,/g) ?? []).length > 1) return null
    text = text.replace(',', '.')
  } else if (dot >= 0) {
    const parts = text.split('.')
    if (parts.length > 2) {
      if (parts.slice(1).some((part) => part.length !== 3)) return null
      text = parts.join('')
    } else if ((parts[1] ?? '').length === 3) {
      text = parts.join('')
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  if ((whole ?? '').length > 12) return null
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2))
}

export function cobroAmountText(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(Math.trunc(cents))
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${whole},${frac}`
}

export function isInvoiceMethod(value: string): value is InvoiceMethod {
  return (INVOICE_METHODS as readonly string[]).includes(value)
}

export function asPaymentMethod(method: InvoiceMethod): PaymentMethod {
  return method
}

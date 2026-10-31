/** Pantalla con coma. La API solo acepta punto. */
export function esQty(value: string | null | undefined): string {
  if (value == null || value.trim() === '') return ''
  const negative = value.trim().startsWith('-')
  const raw = value.trim().replace(/^-/, '')
  const [whole, frac] = raw.split('.')
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const body = frac != null && frac !== '' ? `${grouped},${frac}` : grouped
  return negative ? `-${body}` : body
}

export function toApiDecimal(text: string): string | null {
  const trimmed = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  return trimmed
}

export function stripZeros(value: string): string {
  const negative = value.startsWith('-')
  const raw = negative ? value.slice(1) : value
  const [wholeRaw, fracRaw = ''] = raw.split('.')
  const whole = (wholeRaw ?? '0').replace(/^0+(?=\d)/, '') || '0'
  const frac = fracRaw.replace(/0+$/, '')
  const body = frac ? `${whole}.${frac}` : whole
  return negative ? `-${body}` : body
}

/** null = vacío. undefined = el texto no es un número. */
export function canonicalQty(text: string): string | null | undefined {
  if (text.trim() === '') return null
  const parsed = toApiDecimal(text)
  if (parsed == null) return undefined
  return stripZeros(parsed)
}

export function sameQty(form: string, server: string | null): boolean {
  const left = canonicalQty(form)
  if (left === undefined) return false
  const right = server == null || server.trim() === '' ? null : stripZeros(server)
  return left === right
}

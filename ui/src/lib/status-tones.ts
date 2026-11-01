/**
 * One colour per meaning, across every list.
 *
 * A status reads the same in Gastos, Facturas and Aforos: a draft is grey everywhere, money
 * that arrived is green everywhere, and a due date that passed is red everywhere. The ladder
 * is SDR's — idle greys, working blues, engaged teals, goal greens, stalled ambers, dead reds
 * — so the two products agree on what a colour says. `StatusPill` (`@/ui`) draws a tone;
 * this module only decides which tone a value gets.
 */

export type StatusTone =
  | 'neutral'
  | 'slate'
  | 'info'
  | 'sky'
  | 'cyan'
  | 'mint'
  | 'success'
  | 'warning'
  | 'flame'
  | 'danger'
  | 'pink'
  | 'purple'
  | 'violet'

export const STATUS_TONES: readonly StatusTone[] = [
  'neutral',
  'slate',
  'info',
  'sky',
  'cyan',
  'mint',
  'success',
  'warning',
  'flame',
  'danger',
  'pink',
  'purple',
  'violet',
]

/** `Pagado`, `en revisión`, `Accepted-With-Errors` → `pagado`, `en_revision`, `accepted_with_errors`. */
export function statusKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

const STATUS: Record<string, StatusTone> = {
  draft: 'neutral',
  borrador: 'neutral',
  depleted: 'neutral',
  agotado: 'neutral',

  void: 'slate',
  voided: 'slate',
  anulado: 'slate',
  anulada: 'slate',
  cancelled: 'slate',
  canceled: 'slate',
  cancelado: 'slate',
  cancelada: 'slate',
  discarded: 'slate',
  descartado: 'slate',
  descartada: 'slate',
  expired: 'slate',
  caducado: 'slate',
  caducada: 'slate',
  superseded: 'slate',
  sustituido: 'slate',
  sustituida: 'slate',
  archived: 'slate',
  archivado: 'slate',
  archivada: 'slate',
  inactive: 'slate',
  inactivo: 'slate',
  inactiva: 'slate',
  closed: 'slate',
  cerrado: 'slate',
  cerrada: 'slate',

  issued: 'info',
  emitido: 'info',
  emitida: 'info',
  open: 'info',
  abierto: 'info',
  abierta: 'info',
  captured: 'info',
  capturado: 'info',
  capturada: 'info',
  counting: 'info',
  contando: 'info',
  in_progress: 'info',
  en_curso: 'info',

  sent: 'sky',
  enviado: 'sky',
  enviada: 'sky',
  submitted: 'sky',
  submitting: 'sky',
  presentado: 'sky',
  presentada: 'sky',

  validated: 'cyan',
  validado: 'cyan',
  validada: 'cyan',

  accepted: 'mint',
  aceptado: 'mint',
  aceptada: 'mint',
  consumed: 'mint',
  consumido: 'mint',
  consumida: 'mint',

  paid: 'success',
  pagado: 'success',
  pagada: 'success',
  cobrado: 'success',
  cobrada: 'success',
  collected: 'success',
  settled: 'success',
  liquidado: 'success',
  liquidada: 'success',
  approved: 'success',
  aprobado: 'success',
  aprobada: 'success',
  confirmed: 'success',
  confirmado: 'success',
  confirmada: 'success',
  posted: 'success',
  contabilizado: 'success',
  contabilizada: 'success',
  active: 'success',
  activo: 'success',
  activa: 'success',

  pending: 'warning',
  pendiente: 'warning',
  pending_approval: 'warning',
  review: 'warning',
  en_revision: 'warning',

  partial: 'flame',
  partially_paid: 'flame',
  parcial: 'flame',
  duplicate: 'flame',
  duplicado: 'flame',
  duplicada: 'flame',
  accepted_with_errors: 'flame',
  aceptado_con_errores: 'flame',
  aceptada_con_errores: 'flame',

  overdue: 'danger',
  vencido: 'danger',
  vencida: 'danger',
  failed: 'danger',
  error: 'danger',

  rejected: 'pink',
  rechazado: 'pink',
  rechazada: 'pink',

  rectified: 'violet',
  rectificado: 'violet',
  rectificada: 'violet',
  corrected: 'violet',
  corregido: 'violet',
  corregida: 'violet',
}

/**
 * The tone of a document, payment or workflow state, in Spanish or as the API spells it.
 * An unknown value is `fallback` rather than a guess: a colour that means nothing is noise.
 */
export function statusTone(status: string | null | undefined, fallback: StatusTone = 'neutral'): StatusTone {
  return STATUS[statusKey(status)] ?? fallback
}

const ROLE: Record<string, StatusTone> = {
  customer: 'info',
  cliente: 'info',
  supplier: 'purple',
  proveedor: 'purple',
  carrier: 'flame',
  transportista: 'flame',
  logistics_operator: 'cyan',
  operador_logistico: 'cyan',
}

/** A contact's role: cliente, proveedor, transportista, operador logístico. */
export function contactRoleTone(role: string | null | undefined): StatusTone {
  return ROLE[statusKey(role)] ?? 'neutral'
}

/** The legal entity a record belongs to: the cellar (P.O) or the trading company (CVPO). */
export function entityTone(entity: string | null | undefined): StatusTone {
  const key = statusKey(entity).replace(/[._]/g, '')
  if (key === 'po') return 'violet'
  if (key === 'cvpo') return 'sky'
  return 'neutral'
}

/** Where a record was made: imported from Holded, or written in WineCore. */
export function originTone(origin: string | null | undefined): StatusTone {
  const key = statusKey(origin)
  if (key === 'holded' || key === 'imported' || key === 'importado') return 'pink'
  if (key === 'winecore' || key === 'native') return 'mint'
  return 'neutral'
}

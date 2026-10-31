const CATALOG = {
  WC001: [409, 'Borrado prohibido'],
  WC002: [500, 'Falta el contexto del actor'],
  WC003: [409, 'El registro de auditoría es inmutable'],
  WC010: [409, 'Serie inexistente o inactiva'],
  WC011: [409, 'La serie ha agotado su rango'],
  WC020: [422, 'Conservación de volumen o unidades incumplida'],
  WC021: [409, 'Periodo cerrado'],
  WC022: [409, 'Movimiento inmutable'],
  WC023: [422, 'Unidades y volumen incoherentes'],
  WC024: [422, 'Saldo negativo'],
  WC025: [422, 'Capacidad superada'],
  WC026: [422, 'Varios lotes en el mismo recipiente'],
  WC027: [422, 'Saldo fiscal negativo'],
  WC028: [422, 'El cambio de mayor fiscal no cuadra'],
  WC030: [422, 'Ciclo en la genealogía'],
  WC031: [409, 'Operación de bodega no editable'],
  WC032: [409, 'Operación de bodega no editable'],
  WC040: [409, 'La aprobación no coincide con el contenido'],
  WC041: [409, 'La decisión de aprobación es inmutable'],
  WC042: [409, 'La aprobación no está pendiente'],
  WC043: [409, 'La aprobación ha caducado'],
  WC050: [409, 'Versión de tarifa no editable'],
  WC060: [409, 'Albarán no editable'],
  WC070: [409, 'Reglas de facturación no editables'],
  WC080: [409, 'Factura emitida no editable; crea una rectificativa'],
  WC090: [409, 'Factura recibida aprobada no editable'],
  WC100: [422, 'Exceso de cobro'],
  WC101: [422, 'Documento no cobrable'],
  WC110: [422, 'Asiento descuadrado'],
  WC111: [409, 'Asiento inmutable'],
  WC120: [409, 'Envío congelado'],
  WC121: [409, 'Envío cerrado'],
  WC122: [409, 'La identificación de un mayor de SILICIE no se modifica'],
  WC130: [409, 'Encadenamiento Verifactu incorrecto o registro inmutable'],
  WC131: [409, 'La hora del registro Verifactu es anterior a la del registro anterior'],
  WC_MODULE_DISABLED: [404, 'Módulo desactivado'],
  WC_FORBIDDEN: [403, 'No tienes permiso para esta operación'],
  WC_STEP_UP_REQUIRED: [401, 'Falta una verificación reforzada reciente'],
  WC_VALIDATION: [422, 'Los datos no son válidos'],
  WC_IDEMPOTENCY_MISMATCH: [409, 'La clave de idempotencia ya se usó con otra petición'],
  WC_NOT_FOUND: [404, 'No encontrado'],
  WC_STALE_VERSION: [409, 'El registro ha cambiado; vuelve a cargarlo'],
  WC_UNAUTHENTICATED: [401, 'No autenticado'],
  WC_NO_ACCESS: [403, 'No tienes acceso a WineCore'],
  // Contactos (TASK-CONT-001)
  WC_CONTACT_DUPLICATE_TAX_ID: [409, 'Ya existe un contacto con este NIF'],
  // Facturación (TASK-FACT-002, 003, 005, 006, 008, 011). Verifactu no genera registros: módulo apagado.
  WC_INV_TAX_ID_REQUIRED: [422, 'El cliente necesita NIF para una factura completa'],
  WC_INV_LOT_REQUIRED: [422, 'Indica el lote de la línea'],
  WC_INV_VAT_ID_REQUIRED: [422, 'Valida el NIF-IVA en VIES'],
  WC_INV_DATE_ORDER: [422, 'La fecha de emisión no puede ser anterior a la última factura de la serie'],
  WC_INV_DATE_FUTURE: [422, 'La fecha de expedición no puede ser futura'],
  WC_INV_DATE_RANGE: [422, 'La fecha de expedición no puede ser anterior al 28-10-2024'],
  WC_INV_OPERATION_DATE: [422, 'La fecha de operación no puede ser posterior a la de expedición'],
  WC_INV_TOTAL_ZERO: [422, 'El total de la factura no puede ser cero'],
  WC_INV_MACRO: [422, 'La factura supera 1.000.000 € y queda bloqueada para revisión'],
  WC_INV_LINES_REQUIRED: [422, 'La factura necesita al menos una línea'],
  WC_INV_RECTIFICATION_REF: [422, 'La rectificativa debe referenciar la factura rectificada y el motivo'],
  WC_INV_NEGATIVE_BALANCE: [422, 'La rectificativa por diferencias dejaría la factura original en negativo'],
  WC_INV_ALREADY_INVOICED: [409, 'El albarán ya está facturado'],
  WC_INV_NOT_DRAFT: [409, 'Solo se edita un borrador'],
  WC_INV_PAYMENTS: [409, 'Una factura con cobros no se puede anular; rectifícala'],
  WC_INV_SERIES: [422, 'No hay una serie activa para el año de la factura'],
  WC_INV_PRICE: [422, 'No hay precio para el producto'],
  WC_INV_HASH: [409, 'El borrador cambió después de pedir la aprobación'],
  WC_INV_APPROVAL_REQUIRED: [409, 'La operación requiere una aprobación'],
  WC_INV_BOOK: [422, 'El libro no cuadra; no se exporta'],
  WC_INV_ENTITY: [422, 'No hay una regla que indique la entidad facturadora'],
  WC_INV_REASON: [422, 'El motivo de anulación no es válido'],
} as const;

export type ErrorCode = keyof typeof CATALOG;

const CODE_PATTERN = /\b(WC\d{3}|WC_[A-Z][A-Z0-9_]*)\b/;

export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    httpStatus: number,
    message: string,
    fields?: Record<string, string>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.fields = fields;
    this.details = details;
  }
}

export function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(CATALOG, code);
}

export function domainError(
  code: ErrorCode,
  fields?: Record<string, string>,
  details?: Record<string, unknown>,
): DomainError {
  const entry = CATALOG[code];
  return new DomainError(code, entry[0], entry[1], fields, details);
}

export function errorBody(error: DomainError): {
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
} {
  const body: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  } = { code: error.code, message: error.message };
  if (error.fields && Object.keys(error.fields).length > 0) body.fields = error.fields;
  if (error.details && Object.keys(error.details).length > 0) body.details = error.details;
  return body;
}

export function asDomainError(error: unknown): DomainError | null {
  if (error instanceof DomainError) return error;
  if (error && typeof error === 'object' && 'cause' in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof DomainError) return cause;
  }
  return null;
}

/** Maps `error('WCxxx: …')` from DuckDB to a domain error. Other failures pass through. */
export function mapDatabaseError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('WRITER_LEASE_LOST')) {
    return new DomainError('WRITER_LEASE_LOST', 503, 'Otro proceso tiene la escritura');
  }
  const match = CODE_PATTERN.exec(message);
  const code = match?.[1];
  if (!code) {
    return error instanceof Error ? error : new Error('Error de base de datos');
  }
  if (isErrorCode(code)) return domainError(code);
  const detail = message.split(`${code}:`)[1]?.trim().split('\n')[0];
  return new DomainError(code, 409, detail && detail.length < 180 ? detail : 'Error de dominio');
}

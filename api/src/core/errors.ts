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
  WC_ALREADY_CONSUMED: [409, 'La aprobación ya se ha ejecutado'],
  WC_NOT_APPROVED: [409, 'La aprobación no está aprobada'],
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
  WC_REG_SILICIE_UNSPECIFIED: [422, 'Caso de SILICIE no especificado en la norma'],
  WC130: [409, 'Encadenamiento Verifactu incorrecto o registro inmutable'],
  WC131: [409, 'La hora del registro Verifactu es anterior a la del registro anterior'],
  WC_MODULE_DISABLED: [404, 'Módulo desactivado'],
  WC_FORBIDDEN: [403, 'No tienes permiso para esta operación'],
  WC_STEP_UP_REQUIRED: [401, 'Falta una verificación reforzada reciente'],
  WC_VERIFY_FAILED: [401, 'La verificación no es válida'],
  WC_RATE_LIMITED: [429, 'Demasiados intentos. Espera unos minutos'],
  WC_VALIDATION: [422, 'Los datos no son válidos'],
  WC_IDEMPOTENCY_MISMATCH: [409, 'La clave de idempotencia ya se usó con otra petición'],
  WC_MCP_CONFIRMATION_INVALID: [409, 'La confirmación no es válida'],
  WC_NOT_FOUND: [404, 'No encontrado'],
  WC_STALE_VERSION: [409, 'El registro ha cambiado; vuelve a cargarlo'],
  WC_UNAUTHENTICATED: [401, 'No autenticado'],
  WC_NO_ACCESS: [403, 'No tienes acceso a WineCore'],
  WC_CONTACT_DUPLICATE_TAX_ID: [409, 'Ya existe un contacto con este NIF'],
  WC_QR_FOREIGN: [422, 'El código QR no pertenece a WineCore'],
  WC_VESSEL_NOT_IN_SERVICE: [409, 'El recipiente no está en servicio'],
  WC_ILLEGAL_TRANSITION: [409, 'La transición de estado no está permitida'],
  WC_ECO_MIX: [422, 'No se puede ensamblar un lote ecológico con uno que no lo es'],
  // Exportación (TASK-FACT-013)
  WC_INV_ENTITY_EORI_REQUIRED: [422, 'La factura de exportación no se emite: falta el EORI de la entidad.'],
  WC_EXPORT_NOT_READY: [422, 'La factura de exportación no está lista'],
  WC_REG_EAD_REQUIRED: [409, 'Hace falta el ARC (e-DA) antes de expedir'],
  WC_IC_NO_TARIFF: [422, 'No hay tarifa intercompañía vigente'],
  // Intercompañía (TASK-CAT-003, TASK-FACT-009)
  WC_IC_TARIFF_MISSING: [422, 'Falta tarifa intercompañía'],
  WC_IC_TARIFF_OVERLAP: [409, 'La vigencia se solapa con otra tarifa intercompañía activa'],
  WC_IC_TARIFF_LOCKED: [409, 'La tarifa activa no se edita'],
  WC_IC_ADVISOR_REQUIRED: [422, 'Falta la referencia de validación del asesor'],
  WC_IC_BELOW_COST: [422, 'El precio queda por debajo del coste estándar'],
  WC_IC_CUSTOMER_MISSING: [422, 'Falta el contacto de la entidad compradora'],
  WC_IC_PERIOD: [422, 'El periodo no es un mes válido'],
  WC_IC_PERIOD_OVERLAP: [409, 'El periodo se solapa con otra liquidación'],
  WC_INV_LOT_REQUIRED: [422, 'Indica el lote de la línea'],
  WC_OCR_UNAVAILABLE: [503, 'La extracción de la factura no está disponible'],
  // Facturación (TASK-FACT-002, 003, 005, 006, 008, 011). Verifactu no genera registros: módulo apagado.
  WC_INV_TAX_ID_REQUIRED: [422, 'El cliente necesita NIF para una factura completa'],
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
  readonly details?: unknown;

  constructor(
    code: string,
    httpStatus: number,
    message: string,
    fields?: Record<string, string>,
    details?: unknown,
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
  messageOrDetails?: string | Record<string, unknown>,
): DomainError {
  const entry = CATALOG[code];
  if (typeof messageOrDetails === 'string') {
    return new DomainError(code, entry[0], messageOrDetails, fields);
  }
  return new DomainError(code, entry[0], entry[1], fields, messageOrDetails);
}

export function errorBody(error: DomainError): {
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
} {
  const body: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: unknown;
  } = { code: error.code, message: error.message };
  if (error.fields && Object.keys(error.fields).length > 0) body.fields = error.fields;
  if (hasDetails(error.details)) body.details = error.details;
  return body;
}

function hasDetails(details: unknown): boolean {
  if (details === undefined || details === null) return false;
  if (Array.isArray(details)) return details.length > 0;
  if (typeof details === 'object') return Object.keys(details).length > 0;
  return true;
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

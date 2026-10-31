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
  WC080: [409, 'Factura emitida no editable'],
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
  if (details === undefined) return false;
  if (Array.isArray(details)) return details.length > 0;
  if (details && typeof details === 'object') return Object.keys(details).length > 0;
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

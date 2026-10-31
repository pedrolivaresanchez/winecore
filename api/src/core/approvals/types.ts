/**
 * Approvals domain types. Column names follow `ops.approval_policy`,
 * `ops.approval_request` and `ops.approval_decision` (docs/02-ddl/0002_ops.sql).
 * `allowSelfApproval` is not a SQL column yet: UI-39 and the state machine
 * require the rule, so a stored policy may set it. Omitted means "not allowed".
 */

export const APPROVAL_KINDS = [
  'invoice_batch_issue',
  'intercompany_invoice_issue',
  'regulatory_submission',
  'emcs_submission',
  'edi_submission',
  'organic_report',
  'cellar_loss',
  'inventory_adjustment',
  'billing_rules_activation',
  'tariff_activation',
  'module_toggle',
  'third_party_message',
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'consumed',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type DecisionValue = 'approve' | 'reject';

export type StepUpMethod = 'passkey' | 'totp';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ApprovalPolicy {
  id: string;
  kind: ApprovalKind;
  legalEntityId: string | null;
  minApprovals: number;
  allowedRoles: readonly string[];
  allowedUserIds: readonly string[];
  requiresStepUp: boolean;
  validityMinutes: number;
  updatedAt: string;
  updatedBy: string;
  /** When omitted, the requester cannot decide their own request. */
  allowSelfApproval?: boolean;
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  legalEntityId: string | null;
  subjectTable: string;
  subjectId: string;
  payloadSha256: string;
  summary: string;
  details: JsonValue;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  workflowRunRef: string | null;
}

export interface ApprovalDecision {
  id: string;
  requestId: string;
  decidedBy: string;
  decision: DecisionValue;
  decidedAt: string;
  note: string | null;
  stepUpMethod: StepUpMethod | null;
  stepUpAt: string | null;
  payloadSha256: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RoleAssignment {
  role: string;
  legalEntityId: string | null;
}

/** Person, agent or machine client trying to decide. Only `user` may succeed. */
export interface ApproverContext {
  userId: string;
  roles: readonly RoleAssignment[];
  kind: 'user' | 'agent' | 'machine';
  stepUpAt: string | null;
}

export interface Clock {
  now(): Date;
}

export type ApprovalErrorCode =
  | 'WC002'
  | 'WC040'
  | 'WC041'
  | 'WC042'
  | 'WC043'
  | 'WC_FORBIDDEN'
  | 'WC_STEP_UP_REQUIRED'
  | 'WC_VALIDATION'
  | 'WC_NOT_FOUND'
  | 'WC_NOT_APPROVED'
  | 'WC_ALREADY_CONSUMED';

export const APPROVAL_MESSAGES = {
  WC002: 'Falta contexto de actor',
  WC040: 'El contenido ha cambiado; vuelve a pedir la aprobación',
  WC041: 'Una decisión de aprobación no se modifica',
  WC042: 'La solicitud no está pendiente',
  WC043: 'La solicitud ha caducado',
  forbiddenHuman: 'Solo una persona puede decidir una aprobación',
  forbiddenRole: 'No tiene permiso para decidir esta aprobación',
  forbiddenSelf: 'El solicitante no puede decidir su propia solicitud',
  stepUp: 'Falta una verificación reforzada reciente',
  stepUpMethod: 'El método de verificación no es válido',
  notFound: 'La solicitud no existe',
  notApproved: 'La solicitud no está aprobada',
  alreadyConsumed: 'La solicitud ya se ha ejecutado',
  canonical: 'El contenido no se puede representar de forma canónica',
  policy: 'La política de aprobación no es válida',
  policyAmbiguous: 'Hay más de una política para este tipo y entidad',
  policyNoApprover: 'Ningún tipo puede quedar sin aprobador',
  policyMachine: 'Un cliente de máquina no puede ser aprobador',
  summary: 'El resumen debe tener entre 5 y 300 caracteres',
  subjectTable: 'La tabla del asunto no es válida',
  subjectId: 'El identificador del asunto no es válido',
  requestedBy: 'Falta quien solicita la aprobación',
  rejectNote: 'El motivo del rechazo debe tener entre 10 y 500 caracteres',
  noteLength: 'La nota no puede superar 500 caracteres',
  hash: 'El hash del contenido no es válido',
  kind: 'El tipo de aprobación no es válido',
  userId: 'El identificador de usuario no es válido',
  entityId: 'El identificador de entidad no es válido',
  decision: 'La decisión no es válida',
} as const;

const HTTP_STATUS: Record<ApprovalErrorCode, number> = {
  WC002: 500,
  WC040: 409,
  WC041: 409,
  WC042: 409,
  WC043: 409,
  WC_FORBIDDEN: 403,
  WC_STEP_UP_REQUIRED: 401,
  WC_VALIDATION: 422,
  WC_NOT_FOUND: 404,
  WC_NOT_APPROVED: 409,
  WC_ALREADY_CONSUMED: 409,
};

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  readonly httpStatus: number;

  constructor(code: ApprovalErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function approvalError(code: ApprovalErrorCode, message: string): ApprovalError {
  return new ApprovalError(code, message, HTTP_STATUS[code]);
}

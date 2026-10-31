import type { StatusTone } from "@/components/StatusPill";
import { ApiError } from "@/lib/api";
import { entityName, roleLabel } from "@/lib/labels";
import type { EntityCode } from "@/lib/types";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed"
  | "superseded";

export type ApprovalPerson = {
  id: string;
  display_name: string;
};

export type ApprovalSummary = {
  id: string;
  kind: string;
  legal_entity_code: EntityCode | null;
  title: string;
  summary: string;
  requested_by: ApprovalPerson;
  requested_at: string;
  expires_at: string;
  status: ApprovalStatus | string;
  min_approvals: number;
  approvals_count: number;
  payload_sha256: string;
  can_decide: boolean;
  reason_cannot_decide: string | null;
};

export type PayloadRow = {
  label: string;
  value: string;
};

export type ApprovalDecision = {
  id: string;
  decision: "approve" | "reject";
  decided_by: ApprovalPerson;
  decided_at: string;
  note: string | null;
  step_up_method: "passkey" | "totp" | null;
};

export type ApprovalDetail = ApprovalSummary & {
  payload_display: PayloadRow[];
  decisions: ApprovalDecision[];
};

export type ApprovalPage = {
  items: ApprovalSummary[];
  next_cursor: string | null;
  total: number;
};

export type UserCredential = {
  id: string;
  kind: "passkey" | "totp";
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export type ApprovalPolicy = {
  kind: string;
  legal_entity_code?: EntityCode | null;
  allowed_roles: string[];
  min_approvals: number;
  requires_step_up: boolean;
  validity_hours: number;
  allow_self_approval: boolean;
};

export type PolicyInput = {
  allowed_roles: string[];
  min_approvals: number;
  requires_step_up: boolean;
  validity_hours: number;
  allow_self_approval: boolean;
};

export const HUMAN_ROLES = ["owner", "approver", "admin", "cellar", "field", "advisor"] as const;

export const APPROVAL_KINDS = [
  "invoice_batch_issue",
  "intercompany_invoice_issue",
  "regulatory_submission",
  "emcs_submission",
  "edi_submission",
  "organic_report",
  "cellar_loss",
  "inventory_adjustment",
  "billing_rules_activation",
  "tariff_activation",
  "module_toggle",
  "third_party_message",
] as const;

const KIND_LABELS: Record<string, string> = {
  invoice_batch_issue: "Facturas en lote",
  intercompany_invoice_issue: "Factura intercompañía",
  regulatory_submission: "Envío regulatorio",
  emcs_submission: "e-DA",
  edi_submission: "Factura EDI",
  organic_report: "Informe ecológico",
  cellar_loss: "Mermas y destrucciones",
  inventory_adjustment: "Regularización de aforo",
  billing_rules_activation: "Reglas de facturación",
  tariff_activation: "Tarifas",
  module_toggle: "Módulos",
  third_party_message: "Mensaje a terceros",
};

const SENSITIVE_KINDS = new Set(["regulatory_submission", "emcs_submission", "edi_submission", "organic_report"]);

const DECISION_ERRORS: Record<string, string> = {
  WC040: "El contenido ha cambiado desde que se pidió la aprobación. Vuelve a pedirla desde el origen. (WC040)",
  WC041: "Esta decisión no se puede cambiar. (WC041)",
  WC042: "Esta solicitud ya no está pendiente. (WC042)",
  WC043: "Esta solicitud ha caducado. Pide una nueva desde el origen. (WC043)",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

export function isSensitiveKind(kind: string): boolean {
  return SENSITIVE_KINDS.has(kind);
}

export function entityLabel(code: EntityCode | null | undefined): string {
  if (!code) return "Todas";
  return entityName(code);
}

export function rolesLabel(roles: string[]): string {
  if (roles.length === 0) return "Sin aprobadores";
  return roles.map((role) => roleLabel(role)).join(", ");
}

export function shortHash(hex: string): string {
  const clean = hex.trim();
  if (clean.length <= 12) return clean.toUpperCase();
  return `${clean.slice(0, 4).toUpperCase()}…${clean.slice(-4).toUpperCase()}`;
}

export function statusMeta(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "pending":
      return { label: "Pendiente", tone: "warning" };
    case "approved":
      return { label: "Aprobada", tone: "success" };
    case "rejected":
      return { label: "Rechazada", tone: "danger" };
    case "expired":
      return { label: "Caducada", tone: "neutral" };
    case "cancelled":
      return { label: "Retirada", tone: "neutral" };
    case "consumed":
      return { label: "Ejecutada", tone: "success" };
    case "superseded":
      return { label: "Sustituida", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function expiryLabel(expiresAt: string, status: string, now: number): { text: string; urgent: boolean } {
  if (status === "expired") return { text: "Caducada", urgent: false };
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return { text: "Sin fecha", urgent: false };
  const delta = end - now;
  if (delta <= 0) return { text: "Caducada", urgent: true };
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return { text: "Caduca en menos de 1 min", urgent: true };
  if (minutes < 60) return { text: `Caduca en ${minutes} min`, urgent: true };
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 48) return { text: `Caduca en ${hours} h`, urgent: hours < 6 };
  const days = Math.floor(delta / 86_400_000);
  return { text: `Caduca en ${days} d`, urgent: false };
}

export function validityLabel(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? "1 día" : `${days} días`;
  }
  return hours === 1 ? "1 hora" : `${hours} h`;
}

export function closedNote(status: string): string | null {
  switch (status) {
    case "expired":
      return "Caducada. Se puede pedir de nuevo desde el origen.";
    case "rejected":
      return "Rechazada. Quien la pidió ha recibido el aviso.";
    case "approved":
      return "Aprobada. Se ejecutará en unos minutos.";
    case "consumed":
      return "Ya se ha ejecutado.";
    case "cancelled":
      return "La retiró quien la pidió.";
    case "superseded":
      return "El origen cambió y esta solicitud ya no vale. Pide otra.";
    default:
      return null;
  }
}

export function explainError(error: ApiError): string {
  const known = DECISION_ERRORS[error.code];
  if (known) return known;
  if (error.code && error.code !== "WC_ERROR" && !error.message.includes(error.code)) {
    return `${error.message} (${error.code})`;
  }
  return error.message;
}

export function quorumLabel(count: number, min: number): string {
  const safeMin = Math.max(1, min);
  return `${count} de ${safeMin}`;
}

export function totpSecret(otpauthUrl: string): string {
  try {
    const secret = new URL(otpauthUrl).searchParams.get("secret") ?? "";
    return secret.replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}

export function noteProblem(note: string): string | null {
  const length = note.trim().length;
  if (length < 10 || length > 500) return "Escribe entre 10 y 500 caracteres.";
  return null;
}

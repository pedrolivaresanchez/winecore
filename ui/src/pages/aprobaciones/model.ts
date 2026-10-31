import { copy, fill } from "@/i18n";
import { ApiError } from "@/lib/api";
import { entityName, roleLabel } from "@/lib/labels";
import type { EntityCode, Me } from "@/lib/types";

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
  id?: string;
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

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

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

const SENSITIVE_KINDS = new Set(["regulatory_submission", "emcs_submission", "edi_submission", "organic_report"]);

const kinds = copy.approvals.kinds as Record<string, string>;
const statuses = copy.approvals.status as Record<string, string>;
const closed = copy.approvals.closed as Record<string, string>;
const decisionErrors = copy.approvals.errors as Record<string, string>;

export function kindLabel(kind: string): string {
  return kinds[kind] ?? kind.replaceAll("_", " ");
}

export function isSensitiveKind(kind: string): boolean {
  return SENSITIVE_KINDS.has(kind);
}

export function entityLabel(code: EntityCode | null | undefined): string {
  if (!code) return copy.approvals.allEntities;
  return entityName(code);
}

export function rolesLabel(roles: string[]): string {
  const human = roles.filter((role) => role !== "agent" && role !== "mcp_client");
  if (human.length === 0) return copy.approvals.noApprovers;
  return human.map((role) => roleLabel(role)).join(", ");
}

export function shortHash(hex: string): string {
  const clean = hex.trim();
  if (clean.length <= 12) return clean.toUpperCase();
  return `${clean.slice(0, 4).toUpperCase()}…${clean.slice(-4).toUpperCase()}`;
}

export function statusMeta(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "pending":
      return { label: statuses.pending ?? status, tone: "warning" };
    case "approved":
      return { label: statuses.approved ?? status, tone: "success" };
    case "rejected":
      return { label: statuses.rejected ?? status, tone: "danger" };
    case "expired":
      return { label: statuses.expired ?? status, tone: "neutral" };
    case "cancelled":
      return { label: statuses.cancelled ?? status, tone: "neutral" };
    case "consumed":
      return { label: statuses.consumed ?? status, tone: "success" };
    case "superseded":
      return { label: statuses.superseded ?? status, tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function expiryLabel(expiresAt: string, status: string, now: number): { text: string; urgent: boolean } {
  if (status === "expired") return { text: copy.approvals.expired, urgent: false };
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return { text: copy.approvals.noDate, urgent: false };
  const delta = end - now;
  if (delta <= 0) return { text: copy.approvals.expired, urgent: true };
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return { text: copy.approvals.expiresSoon, urgent: true };
  if (minutes < 60) return { text: fill(copy.approvals.expiresMinutes, { n: String(minutes) }), urgent: true };
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 48) return { text: fill(copy.approvals.expiresHours, { n: String(hours) }), urgent: hours < 6 };
  const days = Math.floor(delta / 86_400_000);
  return { text: fill(copy.approvals.expiresDays, { n: String(days) }), urgent: false };
}

export function validityLabel(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? copy.approvals.oneDay : fill(copy.approvals.days, { n: String(days) });
  }
  return hours === 1 ? copy.approvals.oneHour : fill(copy.approvals.hours, { n: String(hours) });
}

export function closedNote(status: string): string | null {
  return closed[status] ?? null;
}

export function explainError(error: ApiError): string {
  const known = decisionErrors[error.code];
  if (known) return known;
  if (error.code && error.code !== "WC_ERROR" && !error.message.includes(error.code)) {
    return `${error.message} (${error.code})`;
  }
  return error.message;
}

export function quorumLabel(count: number, min: number): string {
  const safeMin = Math.max(1, min);
  return fill(copy.approvals.of, { count: String(count), min: String(safeMin) });
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
  if (length < 10 || length > 500) return copy.approvals.reasonError;
  return null;
}

/** The session user has no id on `/v1/me`. The display name is the match the API gives back. */
export function requestedByMe(item: ApprovalSummary, me: Me): boolean {
  const name = item.requested_by.display_name.trim().toLocaleLowerCase("es");
  const mine = me.display_name.trim().toLocaleLowerCase("es");
  if (name !== "" && name === mine) return true;
  const local = me.email.split("@")[0]?.toLocaleLowerCase("es") ?? "";
  return local !== "" && name === local;
}

export function isOwner(me: Me): boolean {
  return me.roles.some((role) => role.role === "owner");
}

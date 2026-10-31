import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { copy } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import type { ApprovalDetail, ApprovalPage, ApprovalPolicy, PolicyInput, UserCredential } from "@/pages/aprobaciones/model";

export type StepUpOptions = {
  passkey: PublicKeyCredentialRequestOptionsJSON | null;
  totp: boolean;
};

export function approvalsPath(query: {
  status: "pending" | "decided" | "all";
  kind?: string;
  entity?: string;
  cursor?: string;
}): string {
  const params = new URLSearchParams();
  params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  if (query.entity) params.set("entity", query.entity);
  if (query.cursor) params.set("cursor", query.cursor);
  return `/v1/approvals?${params.toString()}`;
}

export function listApprovals(
  query: { status: "pending" | "decided" | "all"; kind?: string; entity?: string; cursor?: string },
  signal?: AbortSignal,
) {
  return api<ApprovalPage>(approvalsPath(query), { signal });
}

export function getApproval(id: string, signal?: AbortSignal) {
  return api<ApprovalDetail>(`/v1/approvals/${encodeURIComponent(id)}`, { signal });
}

export function decideApproval(
  id: string,
  body: { decision: "approve" | "reject"; payload_sha256: string; note?: string },
) {
  return api<ApprovalDetail>(`/v1/approvals/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listCredentials(signal?: AbortSignal) {
  return api<{ items: UserCredential[] }>("/v1/auth/credentials", { signal });
}

export function renameCredential(id: string, label: string) {
  return api<UserCredential>(`/v1/auth/credentials/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
}

export function revokeCredential(id: string) {
  return api<void>(`/v1/auth/credentials/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

export function enrollTotp() {
  return api<{ otpauth_url: string }>("/v1/auth/totp/enroll", { method: "POST" });
}

export function confirmTotp(code: string) {
  return api<UserCredential>("/v1/auth/totp/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function listPolicies(signal?: AbortSignal) {
  return api<{ items: ApprovalPolicy[] }>("/v1/approval-policies", { signal });
}

export function savePolicy(kind: string, body: PolicyInput) {
  return api<ApprovalPolicy>(`/v1/approval-policies/${encodeURIComponent(kind)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function registerPasskey(label: string): Promise<UserCredential> {
  const options = await api<PublicKeyCredentialCreationOptionsJSON>("/v1/auth/passkeys/registration/options", {
    method: "POST",
  });
  const response: RegistrationResponseJSON = await startRegistration({ optionsJSON: options });
  return api<UserCredential>("/v1/auth/passkeys/registration/verify", {
    method: "POST",
    body: JSON.stringify({ response, label }),
  });
}

export async function loadStepUpOptions(): Promise<StepUpOptions> {
  const raw = await api<Partial<StepUpOptions>>("/v1/auth/step-up/options", { method: "POST" });
  return { passkey: raw.passkey ?? null, totp: Boolean(raw.totp) };
}

export async function verifyPasskey(options: PublicKeyCredentialRequestOptionsJSON) {
  const passkey_response: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: options });
  return api<{ stepped_up_at: string }>("/v1/auth/step-up/verify", {
    method: "POST",
    body: JSON.stringify({ passkey_response }),
  });
}

export function verifyTotp(code: string) {
  return api<{ stepped_up_at: string }>("/v1/auth/step-up/verify", {
    method: "POST",
    body: JSON.stringify({ totp_code: code }),
  });
}

export function passkeyFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && error.code !== "WC_ERROR" && !error.message.includes(error.code)) {
      return `${error.message} (${error.code})`;
    }
    return error.message;
  }
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return copy.approvals.passkeyRegistered;
    if (error.code === "ERROR_INVALID_DOMAIN" || error.code === "ERROR_INVALID_RP_ID") {
      return copy.approvals.passkeyDomain;
    }
    if (error.code === "ERROR_CEREMONY_ABORTED" || error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") {
      return copy.approvals.passkeyAborted;
    }
  }
  return copy.approvals.passkeyFail;
}

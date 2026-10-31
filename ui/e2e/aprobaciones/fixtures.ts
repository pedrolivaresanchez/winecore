import type { Page, Route } from "playwright";

const HASH = {
  silicie: "9f3a1c80b7e24d6fa091c33e8b54d217e0f9a44c21b77d05e8a3c91b6d40c21b",
  lote: "11aa90c4e2b718d05f6a33c91e047b2d8a55c0e19f3b76d24a18e5c09b7722bb",
  tarifa: "77e04b19c8d23a06f15e90b74c38d12a6e59f0b83c27d14a5f90e61b8c4290aa",
  merma: "ab103d7e92c14b68f05a29d83e16c47b9a20f58d31c6e74b8a19d50f2e7744cd",
  inter: "c0de61a84f27b905e3c14d78a26b09f5e41c83d7a20b69f4e15d83a7c06e7788",
  ok: "aaaa47c19e28b6d05f3a81c47e29b0d6a15f83c42e70b9d18a36f5c24e11bbbb",
  no: "bbbb58d20f39c7e16a4b92d58f30c1e7b26a94d53f81c0e29b47a6d35f22cccc",
  expired: "cccc69e31a40d8f27b5c03e69a41d2f8c37b05e64a92d1f30c58b7e46a33dddd",
} as const;

export const meOwner = {
  email: "ana@winecore.test",
  display_name: "Ana Rivas",
  roles: [
    { role: "owner", legal_entity_code: "PO" },
    { role: "approver", legal_entity_code: "CVPO" },
  ],
  entities: [
    { id: "po", code: "PO", legal_name: "Entidad de prueba P.O" },
    { id: "cvpo", code: "CVPO", legal_name: "Entidad de prueba CVPO" },
  ],
  permissions: ["contacts.read"],
};

export const meApprover = {
  ...meOwner,
  roles: [{ role: "approver", legal_entity_code: "PO" }],
};

export const healthOk = {
  status: "ok",
  sha: "abc1234def56789",
  schema_version: "0008",
  db: "local",
  writer: "leader",
};

type Person = { id: string; display_name: string };
type Decision = {
  id: string;
  decision: "approve" | "reject";
  decided_by: Person;
  decided_at: string;
  note: string | null;
  step_up_method: "passkey" | "totp" | null;
};
type Approval = {
  id: string;
  kind: string;
  legal_entity_code: "PO" | "CVPO";
  title: string;
  summary: string;
  requested_by: Person;
  requested_at: string;
  expires_at: string;
  status: string;
  min_approvals: number;
  approvals_count: number;
  payload_sha256: string;
  can_decide: boolean;
  reason_cannot_decide: string | null;
  payload_display: { label: string; value: string }[];
  decisions: Decision[];
};
type Credential = {
  id: string;
  kind: "passkey" | "totp";
  label: string;
  created_at: string;
  last_used_at: string | null;
};
type Policy = {
  kind: string;
  legal_entity_code: "PO" | "CVPO" | null;
  allowed_roles: string[];
  min_approvals: number;
  requires_step_up: boolean;
  validity_hours: number;
  allow_self_approval: boolean;
};

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

const hour = 3_600_000;

function approvals(): Approval[] {
  const pedro = { id: "u-pedro", display_name: "Pedro Soler" };
  const ana = { id: "u-ana", display_name: "Ana Rivas" };
  return [
    {
      id: "apr-silicie",
      kind: "regulatory_submission",
      legal_entity_code: "PO",
      title: "SILICIE dic 2026 – jul 2027",
      summary: "412 asientos · 18.340,000 L salidas · cuadre SISV: OK",
      requested_by: pedro,
      requested_at: iso(-2 * hour),
      expires_at: iso(49 * hour),
      status: "pending",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.silicie,
      can_decide: true,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Periodo", value: "dic 2026 – jul 2027" },
        { label: "Asientos", value: "412" },
        { label: "Salidas", value: "18.340,000 L" },
        { label: "Cuadre SISV", value: "OK" },
        { label: "Destino", value: "AEAT · SILICIE" },
        { label: "Fichero", value: "IESA1-V2-PO-2026H2.csv" },
      ],
      decisions: [],
    },
    {
      id: "apr-lote",
      kind: "invoice_batch_issue",
      legal_entity_code: "PO",
      title: "Lote de facturas de marzo",
      summary: "10 facturas · 3.240,00 € · serie CF26",
      requested_by: pedro,
      requested_at: iso(-30 * 60_000),
      expires_at: iso(12.4 * 60_000),
      status: "pending",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.lote,
      can_decide: true,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Facturas", value: "10" },
        { label: "Importe", value: "3.240,00 €" },
        { label: "Serie", value: "CF26" },
        { label: "Entidad", value: "P.O" },
      ],
      decisions: [],
    },
    {
      id: "apr-wc040",
      kind: "tariff_activation",
      legal_entity_code: "PO",
      title: "Tarifa de hostelería 2027",
      summary: "12 precios · vigencia 01/01/2027",
      requested_by: pedro,
      requested_at: iso(-5 * hour),
      expires_at: iso(30 * hour),
      status: "pending",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.tarifa,
      can_decide: true,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Tarifa", value: "Hostelería 2027" },
        { label: "Precios", value: "12" },
        { label: "Vigencia", value: "01/01/2027" },
      ],
      decisions: [],
    },
    {
      id: "apr-merma",
      kind: "cellar_loss",
      legal_entity_code: "CVPO",
      title: "Destrucción de barricas",
      summary: "3 barricas · 680,000 L · partida 26-CV-14",
      requested_by: pedro,
      requested_at: iso(-8 * hour),
      expires_at: iso(5 * 24 * hour),
      status: "pending",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.merma,
      can_decide: false,
      reason_cannot_decide: "Solo puede decidir: Propietario",
      payload_display: [
        { label: "Partida", value: "26-CV-14" },
        { label: "Barricas", value: "3" },
        { label: "Volumen", value: "680,000 L" },
        { label: "Motivo", value: "Rotura en el traslado" },
      ],
      decisions: [],
    },
    {
      id: "apr-inter",
      kind: "intercompany_invoice_issue",
      legal_entity_code: "CVPO",
      title: "Factura intercompañía de octubre",
      summary: "P.O factura a CVPO · 4.180,00 €",
      requested_by: pedro,
      requested_at: iso(-26 * hour),
      expires_at: iso(6 * 24 * hour),
      status: "pending",
      min_approvals: 2,
      approvals_count: 1,
      payload_sha256: HASH.inter,
      can_decide: true,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Emisor", value: "P.O" },
        { label: "Receptor", value: "CVPO" },
        { label: "Importe", value: "4.180,00 €" },
        { label: "Periodo", value: "octubre 2026" },
      ],
      decisions: [
        {
          id: "dec-inter",
          decision: "approve",
          decided_by: ana,
          decided_at: iso(-2 * hour),
          note: null,
          step_up_method: "passkey",
        },
      ],
    },
    {
      id: "apr-ok",
      kind: "invoice_batch_issue",
      legal_entity_code: "PO",
      title: "Lote de facturas de febrero",
      summary: "4 facturas · 980,00 €",
      requested_by: pedro,
      requested_at: iso(-72 * hour),
      expires_at: iso(-20 * hour),
      status: "approved",
      min_approvals: 1,
      approvals_count: 1,
      payload_sha256: HASH.ok,
      can_decide: false,
      reason_cannot_decide: null,
      payload_display: [{ label: "Facturas", value: "4" }, { label: "Importe", value: "980,00 €" }],
      decisions: [
        {
          id: "dec-ok",
          decision: "approve",
          decided_by: ana,
          decided_at: iso(-48 * hour),
          note: null,
          step_up_method: "passkey",
        },
      ],
    },
    {
      id: "apr-no",
      kind: "third_party_message",
      legal_entity_code: "CVPO",
      title: "Recordatorio a Vinoteca La Encina",
      summary: "Correo de la factura CF26-0041",
      requested_by: pedro,
      requested_at: iso(-50 * hour),
      expires_at: iso(10 * hour),
      status: "rejected",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.no,
      can_decide: false,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Destinatario", value: "pedidos@example.com" },
        { label: "Factura", value: "CF26-0041" },
      ],
      decisions: [
        {
          id: "dec-no",
          decision: "reject",
          decided_by: ana,
          decided_at: iso(-40 * hour),
          note: "El texto menciona un importe que no es el de la factura.",
          step_up_method: "totp",
        },
      ],
    },
    {
      id: "apr-expired",
      kind: "regulatory_submission",
      legal_entity_code: "PO",
      title: "Modelo 561 de septiembre",
      summary: "Borrador mensual · ya fuera de plazo",
      requested_by: pedro,
      requested_at: iso(-10 * 24 * hour),
      expires_at: iso(-2 * hour),
      status: "expired",
      min_approvals: 1,
      approvals_count: 0,
      payload_sha256: HASH.expired,
      can_decide: false,
      reason_cannot_decide: null,
      payload_display: [
        { label: "Modelo", value: "561" },
        { label: "Periodo", value: "septiembre 2026" },
      ],
      decisions: [],
    },
  ];
}

function policies(): Policy[] {
  return [
    {
      kind: "regulatory_submission",
      legal_entity_code: "PO",
      allowed_roles: ["owner", "approver"],
      min_approvals: 1,
      requires_step_up: true,
      validity_hours: 24,
      allow_self_approval: false,
    },
    {
      kind: "invoice_batch_issue",
      legal_entity_code: "PO",
      allowed_roles: ["owner", "approver"],
      min_approvals: 1,
      requires_step_up: true,
      validity_hours: 24,
      allow_self_approval: false,
    },
    {
      kind: "cellar_loss",
      legal_entity_code: "CVPO",
      allowed_roles: ["owner", "approver"],
      min_approvals: 1,
      requires_step_up: true,
      validity_hours: 168,
      allow_self_approval: false,
    },
    {
      kind: "tariff_activation",
      legal_entity_code: null,
      allowed_roles: ["owner"],
      min_approvals: 1,
      requires_step_up: true,
      validity_hours: 168,
      allow_self_approval: false,
    },
    {
      kind: "third_party_message",
      legal_entity_code: null,
      allowed_roles: ["owner", "approver", "admin"],
      min_approvals: 1,
      requires_step_up: false,
      validity_hours: 24,
      allow_self_approval: true,
    },
  ];
}

export type ApiMode = "full" | "empty" | "nocreds" | "approver";

function fulfill(route: Route, body: unknown, status = 200) {
  if (status === 204) return route.fulfill({ status: 204 });
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function b64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export async function installApprovalsApi(page: Page, mode: ApiMode) {
  const credentials: Credential[] =
    mode === "nocreds"
      ? []
      : [
          {
            id: "cred-phone",
            kind: "passkey",
            label: "iPhone de Pedro",
            created_at: "2026-09-02T10:00:00.000Z",
            last_used_at: "2026-10-30T18:04:00.000Z",
          },
          {
            id: "cred-totp",
            kind: "totp",
            label: "App de códigos",
            created_at: "2026-09-02T10:05:00.000Z",
            last_used_at: null,
          },
        ];
  const state = {
    steppedUp: false,
    approvals: mode === "empty" ? [] : approvals(),
    credentials,
    policies: policies(),
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const host = url.hostname;

    if (pathname === "/health") return fulfill(route, healthOk);
    if (pathname === "/v1/me") return fulfill(route, mode === "approver" ? meApprover : meOwner);

    if (pathname === "/v1/approvals" && method === "GET") {
      const status = url.searchParams.get("status") ?? "pending";
      const kind = url.searchParams.get("kind") ?? "";
      const entity = url.searchParams.get("entity") ?? "";
      const items = state.approvals.filter((item) => {
        if (status === "pending" && item.status !== "pending") return false;
        if (status === "decided" && item.status === "pending") return false;
        if (kind && item.kind !== kind) return false;
        if (entity && item.legal_entity_code !== entity) return false;
        return true;
      });
      return fulfill(route, {
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          legal_entity_code: item.legal_entity_code,
          title: item.title,
          summary: item.summary,
          requested_by: item.requested_by,
          requested_at: item.requested_at,
          expires_at: item.expires_at,
          status: item.status,
          min_approvals: item.min_approvals,
          approvals_count: item.approvals_count,
          payload_sha256: item.payload_sha256,
          can_decide: item.can_decide,
          reason_cannot_decide: item.reason_cannot_decide,
        })),
        next_cursor: null,
        total: items.length,
      });
    }

    const approvalMatch = pathname.match(/^\/v1\/approvals\/([^/]+)$/);
    if (approvalMatch && method === "GET") {
      const item = state.approvals.find((row) => row.id === approvalMatch[1]);
      if (!item) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      return fulfill(route, item);
    }

    const decideMatch = pathname.match(/^\/v1\/approvals\/([^/]+)\/decide$/);
    if (decideMatch && method === "POST") {
      const item = state.approvals.find((row) => row.id === decideMatch[1]);
      if (!item) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      if (item.id === "apr-wc040") {
        return fulfill(
          route,
          { code: "WC040", message: "El contenido ha cambiado desde que se pidió la aprobación" },
          409,
        );
      }
      if (item.status === "expired" || new Date(item.expires_at).getTime() < Date.now()) {
        return fulfill(route, { code: "WC043", message: "La solicitud ha caducado" }, 409);
      }
      if (item.status !== "pending") {
        return fulfill(route, { code: "WC042", message: "La solicitud no está pendiente" }, 409);
      }
      if (!item.can_decide) {
        return fulfill(route, { code: "WC_FORBIDDEN", message: item.reason_cannot_decide ?? "No puedes decidir" }, 403);
      }
      if (!state.steppedUp) {
        return fulfill(route, { code: "WC_STEP_UP_REQUIRED", message: "Hace falta verificar de nuevo" }, 401);
      }
      const body = route.request().postDataJSON() as { decision?: "approve" | "reject"; note?: string };
      const decision = body.decision === "reject" ? "reject" : "approve";
      if (decision === "reject") {
        item.status = "rejected";
        item.can_decide = false;
      } else {
        item.approvals_count += 1;
        if (item.approvals_count >= item.min_approvals) {
          item.status = "approved";
          item.can_decide = false;
        }
      }
      item.decisions.push({
        id: `dec-${item.decisions.length + 1}`,
        decision,
        decided_by: { id: "u-ana", display_name: "Ana Rivas" },
        decided_at: new Date().toISOString(),
        note: body.note ?? null,
        step_up_method: "totp",
      });
      return fulfill(route, item);
    }

    if (pathname === "/v1/auth/credentials" && method === "GET") {
      return fulfill(route, { items: state.credentials });
    }
    const renameMatch = pathname.match(/^\/v1\/auth\/credentials\/([^/]+)$/);
    if (renameMatch && method === "PATCH") {
      const body = route.request().postDataJSON() as { label?: string };
      const item = state.credentials.find((row) => row.id === renameMatch[1]);
      if (!item) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      item.label = body.label ?? item.label;
      return fulfill(route, item);
    }
    const revokeMatch = pathname.match(/^\/v1\/auth\/credentials\/([^/]+)\/revoke$/);
    if (revokeMatch && method === "POST") {
      state.credentials = state.credentials.filter((row) => row.id !== revokeMatch[1]);
      return fulfill(route, undefined, 204);
    }
    if (pathname === "/v1/auth/passkeys/registration/options" && method === "POST") {
      return fulfill(route, {
        rp: { name: "WineCore", id: host },
        user: { id: b64url("ana-rivas"), name: "ana@winecore.test", displayName: "Ana Rivas" },
        challenge: b64url("winecore-register-challenge!!"),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60_000,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
          authenticatorAttachment: "platform",
        },
        attestation: "none",
      });
    }
    if (pathname === "/v1/auth/passkeys/registration/verify" && method === "POST") {
      const body = route.request().postDataJSON() as { label?: string; response?: { id?: string } };
      const created: Credential = {
        id: `cred-${state.credentials.length + 1}`,
        kind: "passkey",
        label: body.label || "Passkey",
        created_at: new Date().toISOString(),
        last_used_at: null,
      };
      state.credentials.push(created);
      return fulfill(route, created, 201);
    }
    if (pathname === "/v1/auth/totp/enroll" && method === "POST") {
      return fulfill(route, {
        otpauth_url: "otpauth://totp/WineCore:ana@winecore.test?secret=JBSWY3DPEHPK3PXP&issuer=WineCore&algorithm=SHA1&digits=6&period=30",
      });
    }
    if (pathname === "/v1/auth/totp/confirm" && method === "POST") {
      const body = route.request().postDataJSON() as { code?: string };
      if (body.code !== "123456") {
        return fulfill(route, { code: "WC_TOTP_INVALID", message: "El código no es válido. Mira la app e inténtalo otra vez." }, 400);
      }
      const created: Credential = {
        id: "cred-totp",
        kind: "totp",
        label: "App de códigos",
        created_at: new Date().toISOString(),
        last_used_at: null,
      };
      state.credentials.push(created);
      return fulfill(route, created);
    }
    if (pathname === "/v1/auth/step-up/options" && method === "POST") {
      const passkey = state.credentials.some((item) => item.kind === "passkey");
      const totp = state.credentials.some((item) => item.kind === "totp");
      return fulfill(route, {
        passkey: passkey
          ? {
              challenge: b64url("winecore-stepup-challenge!!!"),
              timeout: 60_000,
              rpId: host,
              userVerification: "required",
              allowCredentials: [],
            }
          : null,
        totp,
      });
    }
    if (pathname === "/v1/auth/step-up/verify" && method === "POST") {
      const body = route.request().postDataJSON() as { totp_code?: string; passkey_response?: unknown };
      if (body.totp_code) {
        if (body.totp_code !== "123456") {
          return fulfill(route, { code: "WC_TOTP_INVALID", message: "El código no es válido. Mira la app e inténtalo otra vez." }, 400);
        }
      } else if (!body.passkey_response) {
        return fulfill(route, { code: "WC_STEP_UP_REQUIRED", message: "Falta la verificación" }, 401);
      }
      state.steppedUp = true;
      return fulfill(route, { stepped_up_at: new Date().toISOString() });
    }
    if (pathname === "/v1/approval-policies" && method === "GET") {
      if (mode === "approver") return fulfill(route, { code: "WC_FORBIDDEN", message: "Solo el propietario" }, 403);
      return fulfill(route, { items: state.policies });
    }
    const policyMatch = pathname.match(/^\/v1\/approval-policies\/([^/]+)$/);
    if (policyMatch && method === "PUT") {
      const body = route.request().postDataJSON() as Policy;
      const kind = decodeURIComponent(policyMatch[1] ?? "");
      const current = state.policies.find((item) => item.kind === kind);
      if (!current) return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
      if (!body.allowed_roles?.length) {
        return fulfill(route, { code: "WC_INVALID", message: "Elige al menos un aprobador", fields: { allowed_roles: "Elige al menos un aprobador" } }, 422);
      }
      Object.assign(current, {
        allowed_roles: body.allowed_roles,
        min_approvals: body.min_approvals,
        requires_step_up: body.requires_step_up,
        validity_hours: body.validity_hours,
        allow_self_approval: body.allow_self_approval,
      });
      return fulfill(route, current);
    }
    return fulfill(route, { code: "WC_NOT_FOUND", message: "No encontrado" }, 404);
  });
}

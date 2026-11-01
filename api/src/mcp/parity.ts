/**
 * Routes of the web app that have no MCP tool, and why. Every other `/v1` route must be
 * the `routes` of some tool: `test/mcp/route-parity.test.ts` fails otherwise.
 */
const SIGN_IN = "Acceso y credenciales de la persona (passkeys, TOTP, verificación reforzada): solo en la app, con su dispositivo.";
const MACHINE_KEYS = "Credenciales de máquina: un cliente MCP no crea, rota ni revoca tokens ni cambia alcances, tampoco los suyos.";
const ASSISTANT = "Es el chat de la propia app; por MCP se usan directamente las herramientas que él usa.";
const SECURITY = "Control de seguridad de las aprobaciones: un cliente MCP no puede rebajarlo. Se lee con approvals_settings_get y approvals_policies_list.";
const PEOPLE = "Alta y cambios de personas y roles: la API exige una passkey reciente del propietario (WC_STEP_UP_REQUIRED), que no existe por MCP.";

export const NOT_IN_MCP: Readonly<Record<string, string>> = {
  "GET /v1/auth/credentials": SIGN_IN,
  "PATCH /v1/auth/credentials/:id": SIGN_IN,
  "POST /v1/auth/credentials/:id/revoke": SIGN_IN,
  "POST /v1/auth/passkeys/registration/options": SIGN_IN,
  "POST /v1/auth/passkeys/registration/verify": SIGN_IN,
  "POST /v1/auth/step-up/options": SIGN_IN,
  "POST /v1/auth/step-up/verify": SIGN_IN,
  "POST /v1/auth/totp/confirm": SIGN_IN,
  "POST /v1/auth/totp/enroll": SIGN_IN,
  "GET /v1/mcp/clients": MACHINE_KEYS,
  "POST /v1/mcp/clients": MACHINE_KEYS,
  "POST /v1/mcp/clients/:id/rotate": MACHINE_KEYS,
  "POST /v1/mcp/clients/:id/revoke": MACHINE_KEYS,
  "GET /v1/assistant/status": ASSISTANT,
  "POST /v1/assistant/chat": ASSISTANT,
  "PUT /v1/approval-settings": SECURITY,
  "PUT /v1/approval-policies/:kind": SECURITY,
  "POST /v1/users": PEOPLE,
  "PATCH /v1/users/:id": PEOPLE,
};

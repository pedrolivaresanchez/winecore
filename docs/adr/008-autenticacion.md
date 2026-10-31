# ADR 008 · Autenticación, autorización y verificación reforzada

- **Estado**: propuesto · 31-10-2026
- **Fuentes** (31-10-2026): https://docs.timbal.ai/api-reference/projects/auth/update, …/auth/providers/update, README de `@timbal-ai/timbal-sdk` (`timbalAuth`, `timbalMcp`), https://docs.timbal.ai/api-reference/orgs/roles/list, …/orgs/iam/check, OpenAPI v2.0.0.

## Contexto
- Timbal ofrece login de usuarios finales para las apps desplegadas (`timbalAuth()` en `api/`: email con enlace mágico, Google, Microsoft, GitHub), IAM de la org y SSO. **Si `auth_enabled = false`, la app es pública.** No está documentado si cualquier cuenta del proveedor puede entrar o solo miembros/invitados de la org.
- Timbal no documenta verificación reforzada (*step-up*) ni MFA a nivel de app.
- Las reglas exigen: aprobación por **persona identificada** (0.3), mínimos privilegios, y que los agentes no aprueben.

## Decisión

### 1. Personas: login de Timbal + lista blanca de WineCore
1. El proyecto Timbal se configura con `auth_enabled = true` y **solo** el proveedor **Microsoft** (el correo de la empresa está en Microsoft 365) y, como respaldo, **email** (enlace mágico). Google y GitHub desactivados.
2. `api/` monta `timbalAuth()` (sin modificar su código, como pide la plantilla de Timbal). Tras la autenticación, el middleware `api/src/auth/resolveUser.ts` toma el email verificado y busca `core.app_user` con `status = 'active'`. Si no existe → `403 WC_FORBIDDEN` y evento de auditoría `auth.denied`. Es decir, **aunque Timbal dejase entrar a cualquier cuenta**, WineCore solo admite la lista blanca.
3. Roles por entidad (`core.user_role`) y matriz de permisos en código (`07-arquitectura.md` §6). Comprobación en cada ruta con `requirePermission('billing.issue', entityId)`.

### 2. Verificación reforzada para aprobar (passkey o TOTP)
1. Cada aprobador registra al menos **una passkey** (WebAuthn; `@simplewebauthn/server` en `api/`, `@simplewebauthn/browser` en `ui/`) y, opcionalmente, un **TOTP** de respaldo (secreto cifrado con `WINECORE_DATA_KEY`, AES-256-GCM).
2. Para decidir una aprobación, la UI pide la verificación; si es correcta, la API crea una fila en `core.session` con `step_up_at = now()` y devuelve una cookie `wc_stepup` (httpOnly, Secure, SameSite=Strict, 5 minutos). La ruta de decisión exige `step_up_at` de menos de 5 minutos (`401 WC_STEP_UP_REQUIRED`) y guarda método y hora en `ops.approval_decision`.
3. Registro de passkeys: solo desde una sesión con login reciente (≤ 10 min) y verificación por enlace mágico al email del usuario.

### 3. Máquinas: tokens de WineCore con alcances
1. Cada cliente de máquina tiene un `core.api_client` (rol `agent` o `mcp_client`, alcances explícitos) y tokens `core.api_token` (solo el hash; caducidad máxima 90 días; rotación por tarea programada y aviso 14 días antes).
   - Miembros de la workforce de Timbal: un cliente por miembro (`regulatorio-silicie`, `ocr-gastos`…), con alcances mínimos.
   - CVBOT (MCP): `cvbot` con `read:*` y escrituras concretas **con confirmación** (13-mcp.md), `on_behalf_of_user_id` = Pedro.
   - Ejecutor local (ADR 009): `runner-local` con alcances `runner:claim`, `runner:report`, `attachments:write`.
2. Las rutas de máquina viven bajo `/api/m2m/*` (incluido `/api/m2m/mcp`) y se autentican con `Authorization: Bearer wc_…`.
3. **Pendiente con Timbal**: si `timbalAuth` en modo plataforma exige login de Timbal en **todas** las rutas de un proyecto autenticado, las rutas `/api/m2m/*` no serían alcanzables con un token propio. Alternativa preparada: cuentas de Timbal dedicadas de la org 122 para CVBOT y el ejecutor; su identidad de Timbal se mapea a un `core.api_client` (tabla de correspondencia en ajustes). La tarea `TASK-AUTH-005` implementa la variante que Timbal confirme.
4. Webhooks entrantes (Stripe, M3): `/api/m2m/hooks/stripe` con verificación de firma de Stripe; mismo pendiente.

### 4. Sesiones y cabeceras
- Cookies de sesión gestionadas por Timbal; WineCore no guarda contraseñas.
- Cabeceras de seguridad en `api/` y `ui/`: `Content-Security-Policy` estricta (sin `unsafe-inline` en scripts), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy` mínima.
- CSRF: las mutaciones desde la UI exigen cabecera `X-WineCore-CSRF` con el token de la cookie `wc_csrf` (doble envío) además de SameSite.

### 5. Altas y bajas
- Alta: `owner` crea el `app_user` (estado `invited`), asigna roles, y la persona entra con Microsoft o enlace mágico; el primer login la pasa a `active`.
- Baja: `owner` pone `revoked` → efecto inmediato (cada petición comprueba el estado); se revocan sus passkeys, TOTP y sesiones de verificación; se registra en auditoría. Procedimiento específico para la salida de la administradora: rotar todas las credenciales de portales que conocía (fuera de WineCore) y revocar su acceso al certificado (R11).

## Consecuencias
- No hay contraseñas propias que custodiar; dependemos del login de Timbal (y de Microsoft).
- La verificación reforzada es nuestra y se puede probar de extremo a extremo con autenticadores virtuales de Playwright.
- Pendiente con Timbal: rutas de máquina fuera de `timbalAuth` y quién puede iniciar sesión (Q-004, preguntas a Timbal en `07-arquitectura.md` §13).

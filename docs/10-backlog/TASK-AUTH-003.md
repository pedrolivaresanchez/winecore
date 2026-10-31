# TASK-AUTH-003 · Passkeys y TOTP (verificación reforzada)
- Hito M1 · 1,5 días · Escalado: sí (seguridad)
- Historias / RNF: US-CORE-03
- Depende de: TASK-AUTH-002

## Objetivo
Registro y uso de passkeys (WebAuthn) con TOTP de respaldo; verificación reforzada reciente (≤ 5 min) exigible por las rutas sensibles; pantalla de seguridad (UI-37).

## Contexto
ADR 008 · `core.user_credential` · UI-37.

## Ficheros
`api/src/core/auth/webauthn.ts`, `api/src/core/auth/totp.ts`, `api/src/routes/me-credentials.ts`, `ui/src/ui/PasskeyPrompt.tsx`, `ui/src/pages/settings/security/*`.

## Interfaz exacta
```ts
requireStepUp({ maxAgeSeconds: 300 })   // guarda de ruta
POST /api/v1/me/passkeys/register/options · /verify · POST /api/v1/me/step-up/options · /verify
POST /api/v1/me/totp (alta, secreto cifrado con WINECORE_DATA_KEY)
```

## Criterios de aceptación
- Sin verificación reciente, `POST /approvals/{id}/decision` responde 401 `WC_STEP_UP_REQUIRED`.
- Los secretos TOTP se guardan cifrados; nunca aparecen en logs.

## Tests requeridos
Integración con autenticador WebAuthn virtual (Playwright) y TOTP con reloj controlado.

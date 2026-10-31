# TASK-APR-002 · Bandeja de aprobaciones (UI-03)
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-APR-01, US-APR-02
- Depende de: TASK-APR-001, TASK-UI-002

## Objetivo
Pantalla UI-03 (lista y detalle) pensada para el móvil de Pedro, con `PayloadSummary`, `DiffView` y `PasskeyPrompt`.

## Contexto
`08-ui/UI-03-aprobaciones.md` · `08-ui/00-sistema-diseno.md`.

## Ficheros
`ui/src/pages/approvals/*`, `ui/src/ui/ApprovalCard.tsx`, `ui/src/ui/PayloadSummary.tsx`, `ui/src/ui/DiffView.tsx`.

## Interfaz exacta
Rutas `/aprobaciones` y `/aprobaciones/:id`; consume los endpoints de TASK-APR-001; muestra el hash abreviado y los adjuntos aprobados.

## Criterios de aceptación
- Rechazar exige motivo ≥ 10 caracteres.
- En móvil, los botones quedan fijos abajo y la passkey usa la biometría del teléfono.

## Tests requeridos
E2E (Playwright) aprobar y rechazar con autenticador virtual; captura visual en escritorio y móvil.

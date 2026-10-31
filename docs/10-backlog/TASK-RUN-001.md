# TASK-RUN-001 · Ejecutor local: instalación, latido y cola
- Hito M2 · 2 días · Escalado: sí (certificado y seguridad)
- Historias / RNF: US-SIL-03
- Depende de: TASK-AUTH-005, TASK-REG-001

## Objetivo
Programa `runner/` instalable en el equipo dedicado: registro con token de alcance `runner:*`, latido, reclamar trabajos con *lease*, informar progreso y subir evidencias; certificado solo en el llavero del sistema.

## Contexto
ADR 009 §2 (protocolo `/api/m2m/runner/*`) · ADR 003 (zona local) · Q-026.

## Ficheros
`runner/src/main.ts`, `runner/src/api.ts`, `runner/src/keychain.ts`, `runner/README.md` (instalación paso a paso), `api/src/m2m/runner.ts`.

## Interfaz exacta
`POST /api/m2m/runner/heartbeat` · `POST /api/m2m/runner/claim` → `{ job, leaseUntil } | null` · `POST /api/m2m/runner/jobs/{id}/progress|artifact|evidence|result`; el *lease* caduca a los 10 min sin latido y el trabajo pasa a `needs_human` (nunca se reintenta solo tras pulsar "Enviar").

## Criterios de aceptación
- El certificado y las contraseñas nunca salen del equipo ni aparecen en logs, trazas o evidencias (capturas con zonas sensibles tapadas).
- Solo conexiones salientes HTTPS.

## Tests requeridos
Integración del protocolo con un servidor de pruebas; test de caducidad del *lease*.

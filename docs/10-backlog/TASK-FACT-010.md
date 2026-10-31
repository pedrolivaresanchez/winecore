# TASK-FACT-010 · Envío al cliente (descarga y correo)
- Hito M1 (descarga) / M2 (correo) · 1 día · Escalado: no
- Historias / RNF: US-FACT-10
- Depende de: TASK-FACT-004

## Objetivo
Registrar la descarga del PDF como "enviada (descarga)" y, si Pedro lo aprueba (Q-014), enviar por correo desde el buzón dedicado solo tras el clic de una persona.

## Contexto
Reglas duras 0.4 y 0.5 · UI-13.

## Ficheros
`api/src/routes/invoice-send.ts`, `api/src/core/billing/email.ts` (detrás de bandera hasta Q-014).

## Interfaz exacta
`POST /api/v1/invoices/{id}/sent { channel: 'download' }` · `POST /api/v1/invoices/{id}/email { to[], cc[] }` (solo personas con `billing.issue`; ningún agente ni cliente de máquina).

## Criterios de aceptación
- Un agente o token de máquina recibe 403 al intentar enviar.

## Tests requeridos
Integración de permisos y del registro de envío.

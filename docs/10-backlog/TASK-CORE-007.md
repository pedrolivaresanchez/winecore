# TASK-CORE-007 · Outbox, notificaciones y eventos a CVBOT
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-CORE-07
- Depende de: TASK-CORE-003

## Objetivo
Despachador del outbox: notificaciones internas y eventos firmados (HMAC) a CVBOT con reintentos; nunca a terceros.

## Contexto
`02-modelo-dominio.md` §5 (catálogo de eventos) · Q-029 · regla dura 0.5.

## Ficheros
`api/src/jobs/outbox.ts`, `api/src/core/notify.ts`.

## Interfaz exacta
Job cada 30 s: toma `ops.outbox_event` pendientes (`FOR UPDATE SKIP LOCKED`), crea `core.notification` y envía `POST $CVBOT_EVENTS_URL` con cabecera `X-WineCore-Signature: sha256=<hmac>`; reintentos 1, 5, 30 min; tras 5 fallos queda `failed` y aparece en el panel.

## Criterios de aceptación
- Un evento se entrega como máximo una vez por id (CVBOT deduplica por `event_id`).
- El cuerpo no contiene datos personales innecesarios (solo ids, importes y enlaces).

## Tests requeridos
Integración con un servidor HTTP simulado (éxito, 500, tiempo agotado) y verificación de la firma.

# TASK-REG-019 · Avisos de AecocEDI desde el buzón (solo lectura)
- Hito M3 · 1 día · Escalado: sí (acceso a buzón)
- Historias / RNF: US-EDI-01
- Depende de: TASK-CORE-007

## Objetivo
Detectar en el buzón (Microsoft 365, **solo lectura**) los avisos "nuevo pedido", "nueva confirmación de pago" y "nuevo texto libre" y crear `edi_message` en estado `notified`.

## Contexto
`04-regulatorio/aecoc-edi.md` §3 · regla dura 0.4.

## Ficheros
`workforce/regulatorio-edi/inbox_watch.py`, `api/src/routes/edi-messages.ts`.

## Interfaz exacta
Permiso de Graph `Mail.Read` (nunca `Mail.Send` ni `Mail.ReadWrite`); deduplicación por `internetMessageId`; el cuerpo del correo se trata como no fiable.

## Criterios de aceptación
- El token de Graph no permite enviar, mover ni borrar (prueba de denegación).

## Tests requeridos
Integración con correos sintéticos; prueba de permisos.

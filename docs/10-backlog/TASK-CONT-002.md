# TASK-CONT-002 · Contactos: UI-04 y UI-05
- Hito M1 · 2 días · Escalado: no
- Historias / RNF: US-CONT-01, US-CONT-03
- Depende de: TASK-CONT-001, TASK-UI-002

## Objetivo
Índice y ficha de contacto con direcciones, personas, condiciones por entidad (P.O y CVPO), documentos, cobros, EDI (GLN, códigos de artículo del cliente) e historial.

## Contexto
`08-ui/UI-04-contactos.md`, `08-ui/UI-05-contacto.md`.

## Ficheros
`ui/src/pages/contacts/*`, `api/src/routes/contact-terms.ts`, `api/src/routes/contact-gln.ts`.

## Interfaz exacta
`PUT /api/v1/contacts/{id}/terms/{entityId}` (tarifa, forma y días de pago, recargo, retención) · `PUT /api/v1/contacts/{id}/gln` (GLN con dígito de control).

## Criterios de aceptación
- Si el cliente está en recargo de equivalencia, su código de IVA por defecto pasa a `IVA21_RE`.
- Edición concurrente detectada con `If-Match` (mensaje "Otra persona cambió este contacto").

## Tests requeridos
E2E de alta, edición y condiciones; unitario del dígito de control GLN.

# TASK-FACT-002 · Borradores de factura
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-FACT-01
- Depende de: TASK-FACT-001, TASK-CONT-001, TASK-CAT-001

## Objetivo
Crear y editar borradores (en blanco, desde albaranes, desde pedido) y validarlos sin emitir.

## Contexto
`03-maquinas-estado.md` §5 · UI-13.

## Ficheros
`api/src/core/billing/drafts.ts`, `api/src/core/billing/validate.ts`, `api/src/routes/invoices.ts` (parte borrador).

## Interfaz exacta
`POST /api/v1/invoices { legalEntityId?, customerId, fromDeliveryNotes?: UUID[], fromOrder?: UUID }` (la entidad la resuelve D3 si no viene) · `PATCH /api/v1/invoices/{id}` · `POST /api/v1/invoices/{id}/validate` → `{ errors: Issue[], warnings: Issue[] }`.

## Criterios de aceptación
- Desde dos albaranes trae sus líneas con lote; un albarán ya facturado no se puede volver a incluir.
- Validaciones de UI-13 (NIF en F1, lote en vino, NIF-IVA en intracomunitaria) con los mensajes exactos.

## Tests requeridos
Integración de cada validación y de la creación desde albaranes.

# TASK-VENT-005 · Incidencias de transporte
- Hito M2 · 0,5 días · Escalado: no
- Historias / RNF: US-VENT-06
- Depende de: TASK-VENT-003

## Objetivo
Registrar incidencias (rotura, retraso, pérdida, rechazo) vinculadas a un albarán, con fotos y referencia de reclamación al transportista.

## Contexto
`sales.shipping_incident` · UI-11.

## Ficheros
`api/src/routes/shipping-incidents.ts`, `ui/src/pages/sales/delivery-notes/IncidentDrawer.tsx`.

## Interfaz exacta
`POST /api/v1/delivery-notes/{id}/incidents { kind, description, photos[], carrierClaimRef? }`.

## Criterios de aceptación
- Una rotura con mercancía perdida propone la merma correspondiente (no la crea sin confirmación).

## Tests requeridos
Integración y E2E del cajón de incidencias.

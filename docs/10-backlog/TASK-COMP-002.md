# TASK-COMP-002 · Validación y aprobación de gastos (UI-17)
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-COMP-02
- Depende de: TASK-COMP-001, TASK-UI-002

## Objetivo
Revisión de los campos extraídos, detección de duplicados, validación por administración y aprobación por Pedro.

## Contexto
`08-ui/UI-17-gastos.md` · `purchasing.supplier_invoice`.

## Ficheros
`api/src/core/purchasing/*`, `ui/src/pages/purchasing/*`.

## Interfaz exacta
`PATCH /api/v1/supplier-invoices/{id}` · `POST .../validate|approve|reject`.

## Criterios de aceptación
- Suma de líneas = total (± 0,01 €); proveedor + número únicos.

## Tests requeridos
Integración del flujo y E2E de la pantalla.

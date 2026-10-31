# TASK-FACT-012 · Pantallas de facturas (UI-12, UI-13)
- Hito M1 · 2 días · Escalado: no
- Historias / RNF: US-FACT-01, US-FACT-02, US-FACT-03
- Depende de: TASK-FACT-003, TASK-UI-002

## Objetivo
Índice de facturas con estado de cobro y Verifactu, selección para lote, y formulario/ficha de factura con totales, validaciones y confirmación de emisión.

## Contexto
`08-ui/UI-12-facturas.md`, `08-ui/UI-13-factura.md`.

## Ficheros
`ui/src/pages/billing/invoices/*`.

## Interfaz exacta
Consume `invoices`, `validate`, `issue`, `pdf`, `batch-issue-request`; el diálogo de emisión muestra entidad, número previsto y total.

## Criterios de aceptación
- "Emitir" deshabilitado con errores; mensajes exactos de US-FACT-02.
- Filtro rápido "Verifactu: requieren acción".

## Tests requeridos
E2E de borrador → emisión → descarga; captura visual de la ficha.

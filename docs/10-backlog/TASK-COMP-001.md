# TASK-COMP-001 · Captura de gastos y extracción
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-COMP-01
- Depende de: TASK-CORE-006

## Objetivo
Subir foto o PDF y extraer con el workflow `ocr-gastos` los campos de la factura recibida en ≤ 2 minutos, con confianza por campo.

## Contexto
`07-arquitectura.md` §5 (workforce) · `08-ui/UI-17-gastos.md`.

## Ficheros
`api/src/routes/supplier-invoices-capture.ts`, `workforce/ocr-gastos/workflow.py`, `workforce/ocr-gastos/evals/*.yaml`.

## Interfaz exacta
`POST /api/v1/supplier-invoices/capture` (fichero) → `captured`; el workflow escribe por API con token de alcance `purchasing.write`.

## Criterios de aceptación
- El texto del documento se trata como no fiable (no puede cambiar instrucciones del agente).
- Evals: ≥ 95 % de acierto en NIF, fecha y total sobre 30 facturas sintéticas.

## Tests requeridos
Evals de Timbal y prueba de inyección en el texto del PDF.

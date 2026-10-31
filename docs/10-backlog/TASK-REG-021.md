# TASK-REG-021 · Factura a El Corte Inglés en AecocEDI
- Hito M3 · 2 días · Escalado: sí (envío a terceros)
- Historias / RNF: US-EDI-03
- Depende de: TASK-REG-020, TASK-FACT-003

## Objetivo
Ficha INVOIC desde la factura emitida a ECI y procedimiento que la crea en AecocEDI ("crear factura" desde el pedido) tras la aprobación, con evidencias.

## Contexto
`04-regulatorio/aecoc-edi.md` §4.2, §5–§9 · ADR 006.

## Ficheros
`api/src/core/regulatory/edi/invoic.ts`, `runner/src/procedures/aecocedi.submit_invoice.ts`.

## Interfaz exacta
`invoicSheet(invoiceId)` → campos canónicos (GLN, departamento, códigos de artículo, bases, IVA); el procedimiento compara lo tecleado con la ficha antes de "Enviar".

## Criterios de aceptación
- Cualquier diferencia entre pantalla y ficha detiene el envío.

## Tests requeridos
Golden de la ficha y portal simulado.

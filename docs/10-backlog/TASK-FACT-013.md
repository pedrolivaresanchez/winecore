# TASK-FACT-013 · EORI y documentos de exportación por país
- Hito M2 · 1,5 días · Escalado: sí (aduanas)
- Historias / RNF: US-FACT-12, US-FACT-07
- Depende de: TASK-FACT-004, TASK-FACT-007

## Objetivo
Facturas a clientes de fuera de la UE con EORI de la entidad y del cliente, Incoterm, NC por línea, origen, pesos y bultos, y la lista de documentos por país.

## Contexto
`02-modelo-dominio.md` §12 (exportación) · `04-regulatorio/emcs.md` (paquete del transitario) · ajuste `billing.export_documents_by_country`.

## Interfaz exacta
Validación del EORI por formato de país; ajuste con los documentos por país (factura comercial, lista de bultos, certificado de origen…); generación de la factura comercial y la lista de bultos en PDF ES/EN; lista de pendientes en la ficha de la factura.

## Criterios de aceptación
- Una factura de exportación sin EORI de la entidad no se emite (mensaje claro).
- La ficha muestra los documentos que pide el país de destino y cuáles están generados.

## Tests requeridos
Golden de PDF por texto; unitarios de validación de EORI y de reglas por país.

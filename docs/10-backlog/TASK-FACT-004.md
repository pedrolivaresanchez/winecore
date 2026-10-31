# TASK-FACT-004 · PDF de factura ES/EN con QR
- Hito M1 · 1,5 días · Escalado: sí (representación Verifactu)
- Historias / RNF: US-FACT-03
- Depende de: TASK-FACT-003, TASK-CORE-006

## Objetivo
Generar el PDF inmutable de cada factura emitida con todos los datos obligatorios (RD 1619/2012 art. 6), el QR tributario y las leyendas según `verifactu.md` §12, en español o inglés.

## Contexto
`04-regulatorio/verifactu.md` §12 · menciones legales de `billing.tax_code`.

## Ficheros
`api/src/core/billing/pdf/invoice.tsx`, `api/src/core/billing/pdf/qr.ts`, `api/src/jobs/invoice-pdf.ts`.

## Interfaz exacta
`renderInvoicePdf(invoice: IssuedInvoice, lang: 'es'|'en'): Promise<Uint8Array>`; QR ISO/IEC 18004 nivel M, 30–40 mm, margen ≥ 2 mm, arriba en la primera página, con "QR tributario:" encima y "Factura verificable en la sede electrónica de la AEAT" debajo; "Importe total de la factura" y, si hay retención, "Total a pagar".

## Criterios de aceptación
- La URL del QR decodificada coincide con `verifactu_record.qr_url`.
- El PDF se guarda una vez (`pdf_attachment_id`) y no cambia.

## Tests requeridos
Golden por texto extraído (ES y EN); decodificación del QR en el test; medición del tamaño del QR en el PDF.

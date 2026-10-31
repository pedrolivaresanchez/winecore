# TASK-CAT-003 · Tarifa intercompañía
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-CAT-03
- Depende de: TASK-CAT-002

## Objetivo
Tarifa intercompañía (D4): precio base × (1 − descuento), vigencia y referencia a la validación del asesor; activación con aprobación.

## Contexto
`02-modelo-dominio.md` §7 y §12.6 · `catalog.intercompany_tariff`.

## Ficheros
`api/src/core/catalog/intercompany.ts`, `api/src/routes/intercompany-tariffs.ts`.

## Interfaz exacta
`intercompanyPrice(tx, { productId, date }): Promise<Decimal>` = `round(base × (1 − d/100), 6)`; sin tarifa vigente → `WC_IC_TARIFF_MISSING`.

## Criterios de aceptación
- Sin referencia de validación del asesor no se puede activar.

## Tests requeridos
Unitarios de redondeo a 6 decimales; integración de vigencias.

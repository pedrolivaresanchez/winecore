# TASK-BOD-009 · Recepción de uva, prensado y fin de fermentación
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-BOD-08, US-BOD-09
- Depende de: TASK-BOD-002

## Objetivo
Recepción de uva (kg, parcela o proveedor, documento de acompañamiento/DAT, comprobación ecológica), prensado/encubado (uva → mosto) y fin de fermentación (mosto → vino, lías).

## Contexto
`02-modelo-dominio.md` §9.2 · `sisv.md` §5 · `silicie.md` §5 (A02, A14, A15, A32) · `ecologico.md` (R10–R14).

## Ficheros
`api/src/core/cellar/ops/reception.ts`, `.../crushing.ts`, `.../fermentationEnd.ts`.

## Interfaz exacta
Manejadores de `reception`, `crushing_pressing` y `fermentation_end`; la recepción ecológica comprueba el certificado vigente del proveedor (`WC_ECO_CERT_MISSING`).

## Criterios de aceptación
- La uva propia enlaza con la vendimia de la parcela (TASK-VIN-003).

## Tests requeridos
Integración de una vendimia sintética completa (parcela → vino).

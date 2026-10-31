# TASK-VFT-005 · Subsanaciones, rechazos y duplicados
- Hito M1 · 1 día · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-04
- Depende de: TASK-VFT-004

## Objetivo
Implementar la tabla de correcciones de `verifactu.md` §9: subsanación, alta por rechazo, alta por rechazo de subsanación, anulación por rechazo y tratamiento de duplicados.

## Contexto
`04-regulatorio/verifactu.md` §9 (pestañas A y B del diseño de registros).

## Ficheros
`api/src/core/regulatory/verifactu/corrections.ts`, ruta `POST /api/v1/verifactu/records/{id}/correct`.

## Interfaz exacta
`correctRecord(tx, { recordId, kind: 'subsanacion'|'rechazo'|'rechazo_subsanacion'|'anulacion_rechazo', changes, actor })` → nuevo registro encadenado con los indicadores correctos; nunca modifica el original.

## Criterios de aceptación
- La interfaz solo ofrece subsanación si el error es del registro y no de la factura.
- Duplicado con datos idénticos → el registro se marca aceptado sin nuevo envío.

## Tests requeridos
Golden VF-12, VF-13, VF-14; integración de cada transición.

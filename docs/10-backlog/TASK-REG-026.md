# TASK-REG-026 · Límites de SO₂ y sustancias autorizadas
- Hito M3 · 0,5 días · Escalado: sí (normativa ecológica)
- Historias / RNF: US-ECO-02
- Depende de: TASK-BOD-011, TASK-REG-024

## Objetivo
Validar el SO₂ total de lotes ecológicos frente a los límites (tabla versionada `organic.so2_limits`) y que los productos enológicos usados estén en la lista UE.

## Contexto
`04-regulatorio/ecologico.md` §1 y §3.

## Ficheros
`api/src/core/regulatory/organic/limits.ts`.

## Interfaz exacta
`so2LimitFor({ color, residualSugarGL }): number` (100/150 con < 2 g/L; si no, límite general − 30) · `checkLotForBottling(tx, lotId): Issue[]`.

## Criterios de aceptación
- Tinto ecológico con 110 mg/L y < 2 g/L de azúcar → bloqueo para envasar como ecológico.

## Tests requeridos
Tabla de casos con los límites de `ecologico.md` §1.

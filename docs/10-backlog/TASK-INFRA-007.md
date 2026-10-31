# TASK-INFRA-007 · Comparación de remotos y trabajos nocturnos
- Hito M0 · 1 día · Escalado: no
- Historias / RNF: RNF-04, RNF-07
- Depende de: TASK-INFRA-006

## Objetivo
`remotes-drift.yml` (diario) y `nightly.yml` (propiedades con 20.000 casos, restauración de la copia de `dev`, e2e completo) según ADR 007 §2.

## Contexto
ADR 007 · riesgo R10.

## Ficheros
`.github/workflows/remotes-drift.yml`, `.github/workflows/nightly.yml`, `scripts/compare-remotes.ts`.

## Interfaz exacta
`compare-remotes.ts --branches dev,staging,main` → código de salida 1 y resumen en `$GITHUB_STEP_SUMMARY` si difieren.

## Criterios de aceptación
- Una diferencia provocada en `dev` hace fallar el job con el detalle.
- `nightly` restaura la copia en una BD temporal y ejecuta `audit.verify_chain()` sin rupturas.

## Tests requeridos
Unitarios de `compare-remotes.ts` con respuestas simuladas.

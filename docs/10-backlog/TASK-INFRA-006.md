# TASK-INFRA-006 · Despliegue (`deploy.yml`)
- Hito M0 · 1,5 días · Escalado: sí (arquitectura)
- Historias / RNF: RNF-04
- Depende de: TASK-INFRA-002, TASK-INFRA-004, TASK-CORE-002

## Objetivo
Implementar tal cual el esqueleto de ADR 007 §3: `db-migrate → push-timbal → deploy-timbal → smoke-remote` (Plan B) o `db-migrate` en el PR + despliegue de Timbal + `smoke-remote` (Plan A). Todo en el proyecto Timbal 3942; nada fuera de Timbal.

## Contexto
ADR 007 §2–§3 · ADR 001 · ADR 002 §7 (migraciones aditivas).

## Ficheros
`.github/workflows/deploy.yml`, `scripts/wait-deploy.ts`, `scripts/smoke-remote.ts`.

## Interfaz exacta
*Environments* `timbal-dev`, `timbal-staging`, `timbal-main` (este con aprobación de Pedro). `smoke-remote` comprueba `/api/health` (SHA desplegada = SHA del commit; versión del esquema = última migración) y un flujo de lectura autenticado con un usuario sintético.

## Criterios de aceptación
- Nunca ambos mecanismos a la vez (Plan A o B).
- Un fallo de migración detiene el despliegue.
- El entorno `verifactu` (M4) se despliega con el mismo workflow y falla si la versión `billing-x.y.z` no tiene declaración responsable (lo comprueba TASK-REG-010).

## Tests requeridos
Ejecución en el entorno de pruebas con una migración vacía; ejecución con migración fallida (debe parar).

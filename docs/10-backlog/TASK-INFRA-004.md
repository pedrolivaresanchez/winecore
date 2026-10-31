# TASK-INFRA-004 · Timbal: entornos y conexión con GitHub
- Hito M0 · 1 día · Escalado: sí (arquitectura)
- Historias / RNF: RNF-04
- Depende de: Q-004 (Pedro conecta GitHub en Timbal)

## Objetivo
Dejar el proyecto Timbal 3942 con los entornos `dev`, `staging` y `main` (4165) ligados a sus ramas y verificar la conexión con GitHub (Plan A, comprobaciones V1–V7) o preparar el Plan B.

## Contexto
ADR 001 (procedimientos y V1–V7) · ADR 007 §3 · `07-arquitectura.md` §14.

## Ficheros
`docs/runbooks/timbal-entornos.md` (resultado de V1–V7 con fecha), `timbal.yaml` de cada componente si hace falta.

## Interfaz exacta
Comprobaciones V1–V7 de ADR 001 con evidencia (captura o salida) por cada una. Nunca se toca el proyecto SDR ni la org 1.

## Criterios de aceptación
- Un commit en `dev` despliega solo en el entorno `dev` (o, en Plan B, lo empuja la CI).
- El commit `f89f339` del Composer queda sustituido según ADR 001 (solo con aprobación de Pedro).
- La protección de ramas impide empujes directos a `staging` y `main`.

## Tests requeridos
Prueba de humo: despliegue de un endpoint `/health` en `dev` y comprobación de la SHA desplegada.

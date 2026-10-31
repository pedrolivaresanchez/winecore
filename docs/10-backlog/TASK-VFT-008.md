# TASK-VFT-008 · Instalación y declaración responsable
- Hito M1 · 0,5 días · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-05
- Depende de: TASK-VFT-002, Q-007

## Objetivo
Instalaciones por entidad y entorno, versión `billing-x.y.z` del sistema y declaración responsable visible en Ajustes → Verifactu.

## Contexto
`04-regulatorio/verifactu.md` §8 · Orden HAC/1177/2024 art. 15 · ADR 004.

## Ficheros
`api/src/core/regulatory/verifactu/installation.ts`, `docs/legal/declaraciones/README.md` (plantilla con los apartados a)–l) del art. 15).

## Interfaz exacta
`activateInstallation(tx, { entityId, environment, version, installationNumber, producer })` con aprobación del `owner`; `GET /api/v1/verifactu/declaration` → PDF firmado de la versión activa.

## Criterios de aceptación
- No se puede activar producción sin declaración firmada de esa versión.

## Tests requeridos
Integración de activación con y sin declaración.

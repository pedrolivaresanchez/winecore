# TASK-REG-010 · Vigilancia normativa y declaración en CI
- Hito M1 · 1 día · Escalado: sí (regulatorio)
- Historias / RNF: US-VFT-05, US-ASIS-03
- Depende de: TASK-INFRA-002

## Objetivo
Tres guardas automáticas: (1) comparar semanalmente los documentos técnicos y esquemas publicados por la AEAT (Verifactu, SILICIE, EMCS) con las copias versionadas; (2) vigilante `boe-watch` que busca en el sumario del BOE cambios del RD 1007/2023 (aplazamiento anunciado el 05-10-2026) y de la normativa citada; (3) comprobación en CI de que la versión `billing-x.y.z` tiene declaración responsable firmada antes de desplegar en producción.

## Contexto
`04-regulatorio/verifactu.md` §2, §8 y §17 · ADR 004 · ADR 007 (`deploy-sender.yml`).

## Ficheros
`.github/workflows/regulatory-watch.yml`, `scripts/regwatch/aeat-docs.ts`, `scripts/regwatch/boe.ts`, `scripts/ci/check-declaration.ts`.

## Interfaz exacta
`aeat-docs.ts` → lista de URL + hash guardado; diferencia → issue interno y aviso a CVBOT (sin enviar nada a terceros). `boe.ts --since` → coincidencias por palabras clave en el sumario diario. `check-declaration.ts` → falla si falta `docs/legal/declaraciones/billing-x.y.z.pdf` con su hash en el índice.

## Criterios de aceptación
- Un cambio simulado en un XSD abre el aviso.
- Despliegue a `main` sin declaración → bloqueado.

## Tests requeridos
Unitarios con respuestas grabadas del BOE y de la sede.

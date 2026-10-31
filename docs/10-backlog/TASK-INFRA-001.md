# TASK-INFRA-001 · Monorepo y herramientas
- Hito M0 · 1 día · Escalado: no
- Historias / RNF: US-CORE-01, RNF-10
- Depende de: —

## Objetivo
Crear la estructura del repositorio de `07-arquitectura.md` §3 con Bun workspaces, TypeScript estricto, Biome y scripts comunes, sin lógica de negocio.

## Contexto
`07-arquitectura.md` §2–§3 · ADR 011 (núcleo dentro de `api/`) · `.gitignore` y guardas existentes.

## Ficheros
`package.json` (workspaces `ui`, `api`, `runner`, `sender`), `bunfig.toml`, `tsconfig.base.json`, `biome.json`, `ui/package.json`, `api/package.json`, `runner/package.json`, `sender/package.json`, `workforce/pyproject.toml`, `infra/aws/README.md`, `.env.example`, `README.md`.

## Interfaz exacta
Scripts raíz: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:db`, `bun run dev:api`, `bun run dev:ui`. `tsconfig` con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Criterios de aceptación
- `bun install && bun run lint && bun run typecheck` pasan en limpio.
- `.env.example` lista todas las variables de `07-arquitectura.md` §10 **sin valores**.
- `guardrails.yml` sigue en verde (sin datos ni secretos).

## Tests requeridos
Un test vacío por paquete que se ejecuta con `bun test`; CI de guardas en verde.

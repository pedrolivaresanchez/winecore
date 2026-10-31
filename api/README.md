# WineCore API

API del núcleo (Elysia + DuckDB en local, Knowledge Base de Timbal en despliegue).

## Arranque local

```bash
cd api
bun install
export NODE_ENV=development
export AUTH_MODE=dev
bun run migrate
bun run seed
bun run dev
```

`AUTH_MODE=dev` entra como `owner@winecore.test`. La cabecera `X-Dev-User` cambia de usuario (`admin@winecore.test`, `asesor@winecore.test`, `bodega@winecore.test`). En producción ese modo se rechaza.

La base local queda en `.data/winecore.duckdb`. `bun run migrate -- --dry-run` lista las migraciones pendientes sin aplicarlas.

`GET /health` y `GET /v1/me` responden en `http://localhost:3000`. Si el despliegue publica la API bajo un prefijo, defínelo en `API_BASE_PATH` (por ejemplo `/api`).

Los identificadores fiscales de la semilla salen de `WINECORE_SEED_PO_TAX_ID` y `WINECORE_SEED_CVPO_TAX_ID`. Fuera de producción, si no están, se usan valores sintéticos.

# TASK-CORE-008 · Ajustes y búsqueda global
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-CORE-04, US-MCP-01
- Depende de: TASK-CORE-003

## Objetivo
Lectura y escritura tipada de `core.setting` (con aprobación para los sensibles) y búsqueda global de contactos, productos, lotes, facturas, pedidos y albaranes.

## Contexto
`07-arquitectura.md` §9 (catálogo de ajustes) · UI-34 · herramienta MCP `system_search`.

## Ficheros
`api/src/core/settings.ts`, `api/src/routes/settings.ts`, `api/src/routes/search.ts`.

## Interfaz exacta
```ts
getSetting<K extends SettingKey>(tx, key: K): Promise<SettingValue<K>>
GET/PATCH /api/v1/settings/{key}   // claves sensibles (p. ej. inventory.fiscal_exit_rule) → solicitud de aprobación
GET /api/v1/search?q=&types=       // máx. 20 resultados por tipo, filtrados por permiso
```

## Criterios de aceptación
- Un ajuste inválido (esquema TypeBox) se rechaza.
- La búsqueda no devuelve tipos para los que el usuario no tiene permiso.

## Tests requeridos
Unitarios de esquemas; integración de búsqueda con dos roles.

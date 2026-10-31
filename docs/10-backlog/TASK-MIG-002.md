# TASK-MIG-002 · Contactos desde Holded y Shopify
- Hito M1 · 1,5 días · Escalado: sí (migración)
- Historias / RNF: US-MIG-01
- Depende de: TASK-MIG-001, TASK-CONT-003

## Objetivo
Importar contactos de CVPO y P.O (y la selección de clientes de Shopify aprobada en Q-023) con el mapeo columna a columna, normalización de NIF y deduplicación entre entidades.

## Contexto
`06-migracion.md` §6 (contactos y Shopify) · `05-mapeo-holded-bacosoft.md`.

## Ficheros
`api/db/migration/datasets/contacts.ts`, `api/db/migration/datasets/shopify_customers.ts`.

## Interfaz exacta
Informe: filas leídas, creadas, fusionadas (con motivo), NIF inválidos, sin NIF, duplicados entre entidades.

## Criterios de aceptación
- El ensayo de CVPO produce el informe que pide US-MIG-01 sin cargar nada.

## Tests requeridos
Ficheros sintéticos con duplicados conocidos (mismo NIF, nombre parecido) y resultado esperado.

# DDL de WineCore (referencia lógica en PostgreSQL 16)

Esquema completo de la especificación, validado en PostgreSQL 16. **En producción no hay PostgreSQL**: los datos viven en la Knowledge Base de Timbal (DuckDB) por decisión de Pedro (ADR 002 v2, 31-10-2026). Estos ficheros son la **referencia validada** del modelo y de sus invariantes: en M0 se traducen al esquema físico de DuckDB (`api/db/migrations/`, tareas `TASK-INFRA-003` y `TASK-CORE-002`) y sus disparadores, funciones y roles pasan al núcleo según la tabla de equivalencias de ADR 002. Los cambios del modelo se hacen aquí primero y luego en una migración nueva.

## Orden de aplicación

1. `0000_roles.sql` — como administrador del servidor, una vez (crea `winecore_migrator`, `winecore_app`, `winecore_readonly` y `winecore_vf_sender`, este último solo para el emisor de Verifactu, ADR 003).
2. `0001_core.sql` … `0017_elaboracion.sql` — en orden numérico, cada fichero en su propia transacción, con el rol `winecore_migrator`.
3. `0099_grants.sql` — tras cada despliegue de migraciones (idempotente).

## Validación local (hecha el 31-10-2026 con PostgreSQL 16.15)

```bash
createdb winecore_spec
psql -v ON_ERROR_STOP=1 -d winecore_spec -f 0000_roles.sql
for f in $(ls 00[0-1][0-9]_*.sql | grep -v 0000_ | sort); do psql -v ON_ERROR_STOP=1 -q -d winecore_spec -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d winecore_spec -f 0099_grants.sql
psql -v ON_ERROR_STOP=1 -q -d winecore_spec -f tests/invariants_test.sql   # → "OK: todas las pruebas de invariantes han pasado"
```

Resultado (revalidado el 31-10-2026): las 17 migraciones se aplican sin errores (159 tablas y vistas) y `tests/invariants_test.sql` pasa sus 19 bloques (numeración sin huecos, actor obligatorio, auditoría inmutable y encadenada, saldos no negativos, capacidad, un lote por recipiente, conservación de volumen, operaciones inmutables, DAG sin ciclos, libros solo de inserción y periodos cerrados, factura inmutable, cobros, aprobación ligada al hash, cadena Verifactu, un solo envío en curso, reglas de entidad facturadora, histórico de solo lectura, hora de generación Verifactu que no retrocede, permisos mínimos del emisor de Verifactu, cambio de mayor fiscal depósito ↔ barrica que cuadra y contenido de adjuntos inmutable). Con el rol `winecore_app`, `DELETE FROM billing.invoice`, `UPDATE audit.audit_log` y `TRUNCATE inventory.stock_move` fallan por permisos; con `winecore_vf_sender`, crear registros, cambiar su huella o tocar facturas falla por permisos.

## Datos

Solo sintéticos. Los NIF del test (`00000000T`, `B00000000`, `B11111111`) y el CAE (`ES00000V0000T`) son ficticios.

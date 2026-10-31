# ADR 002 · Base de datos y almacenamiento de ficheros

- **Estado**: propuesto · 31-10-2026 · Decisor: Pedro (coste y cuenta del proveedor)
- **Fuentes** (consultadas el 31-10-2026): https://docs.timbal.ai/api-reference/knowledge-bases/query, …/knowledge-bases/get, …/backups/create, …/restores/create, https://docs.timbal.ai/api-reference/introduction, https://docs.timbal.ai/api-reference/files/upload, plugin oficial de Timbal para Cursor (`skills/timbal-knowledge-base`), https://timbal.ai/legal/terms (§17.1), https://timbal.ai/legal/subprocessors.

## Requisitos (del plan y del dominio)

| # | Requisito | Por qué |
|---|---|---|
| R-1 | **Transacciones ACID** multi-sentencia con bloqueo de fila | Numeración sin huecos, emisión de factura + registro Verifactu + stock en una sola transacción |
| R-2 | Restricciones, triggers y constraint triggers diferidos | Invariantes del modelo (02-modelo-dominio §19) |
| R-3 | Migraciones versionadas | Esquema evolutivo y reproducible |
| R-4 | Auditoría inmutable (roles sin UPDATE/DELETE) | Rectificar, nunca borrar |
| R-5 | Copias con restauración a un instante (PITR) y exportación completa | Conservación de libros 4–6 años; cero dependencia de un proveedor |
| R-6 | Datos en la UE | RGPD |
| R-7 | Coste bajo para 1–3 usuarios y < 10.000 documentos/año | R8 |

## Opciones evaluadas

| Opción | R-1 | R-2 | R-3 | R-4 | R-5 | R-6 | R-7 | Valoración |
|---|---|---|---|---|---|---|---|---|
| **Knowledge Base de Timbal** | **No documentado**: SQL solo por HTTP; "multiple statements allowed; only the last result is returned"; sin BEGIN/COMMIT documentados; motor **DuckDB** según el plugin oficial (un escritor por fichero) | Parcial (DuckDB no tiene triggers) | Manual | Políticas "stored opaquely in this release" | Backups diarios *keep-last-N* (N sin documentar); restore sin PITR documentado; sin descarga de backups | Sí (eu-north-1) | Incluido en créditos | **No apta** como base transaccional. Útil para búsqueda semántica sobre documentación (opcional). |
| **PostgreSQL gestionado en AWS RDS (eu-north-1, Estocolmo)** | Sí | Sí | Sí | Sí (roles y GRANT) | Copias automáticas con PITR hasta 35 días + volcados propios | Sí; misma región que Timbal (latencia mínima) | ~20–35 €/mes (instancia pequeña de un solo AZ + 20 GB) — **a verificar al contratar** | **Recomendada** |
| PostgreSQL serverless (Neon, región UE) | Sí | Sí | Sí | Sí | PITR según plan; ramas por entorno | Sí (Fráncfort) | Desde ~0–25 €/mes según uso — a verificar | Alternativa válida si Pedro prefiere no gestionar AWS |
| PostgreSQL de Supabase (UE) | Sí | Sí | Sí | Sí | Copias diarias; PITR es un extra caro | Sí | ~25 €/mes + extras | Alternativa; añade servicios que no se usan |

## Decisión

1. **Base de datos transaccional del núcleo: PostgreSQL 16 gestionado en la UE**, preferentemente **AWS RDS en eu-north-1** (la misma región donde Timbal declara alojar los datos, según su lista de subencargados). Configuración mínima: instancia pequeña de un solo AZ, almacenamiento gp3 de 20 GB con autoescalado, cifrado en reposo (KMS), **TLS obligatorio** (`rds.force_ssl = 1`), copias automáticas **35 días** (PITR), protección contra borrado, parámetros `timezone = UTC`, extensiones `pgcrypto`, `citext`, `btree_gist`.
2. Tres bases (una por entorno): `winecore_prod`, `winecore_staging`, `winecore_dev`. **Staging y dev nunca contienen datos reales** (solo sintéticos, `11-tests.md` §7).
3. **Roles de base de datos** (los crea `docs/02-ddl/0000_roles.sql` en Fase 2, ejecutado por un administrador):
   - `winecore_migrator`: propietario de los esquemas; solo lo usa el job de migraciones de CI (ADR 007).
   - `winecore_app`: `USAGE` en los esquemas; `SELECT, INSERT, UPDATE` en tablas de negocio; **sin** `DELETE` ni `TRUNCATE`; en `audit.audit_log` solo `INSERT` y `SELECT`; `EXECUTE` en funciones. Lo usa la API en tiempo de ejecución.
   - `winecore_readonly`: `SELECT` para informes y exportaciones de la asesoría.
   - `winecore_vf_sender`: solo para el emisor de Verifactu (ADR 003). Lee registros e instalaciones, actualiza **solo** las columnas de estado de envío y crea `submission`/`connector_run`. Escribe en la auditoría sin poder leerla (la última huella la da `audit.last_hash()`, `SECURITY DEFINER`).
4. **Ficheros** (PDF de facturas, fotos de gastos, capturas y acuses de envíos regulatorios, informes de laboratorio): **S3 en eu-north-1** con versionado, cifrado SSE-KMS y **Object Lock en modo *compliance*** con retención de 6 años para los prefijos `evidence/` y `invoices/` (no se pueden borrar ni sobrescribir). Prefijos: `invoices/{entidad}/{año}/`, `evidence/{flujo}/{año}/`, `expenses/{entidad}/{año}/`, `labs/`, `exports/`. OneDrive se usa solo como **copia de consulta** opcional de los PDF para Pedro (Q-014), nunca como archivo maestro.
5. **Copias y exportación**: además del PITR, un job semanal hace `pg_dump` cifrado a `s3://…/exports/db/` (retención 6 años con Object Lock) y un job mensual exporta a CSV las tablas de negocio (portabilidad, cero dependencia). Prueba de restauración trimestral en una base temporal (checklist en `11-tests.md` §10).
6. **Knowledge Base de Timbal**: no se usa para datos de negocio. Se puede usar más adelante para búsqueda semántica sobre documentación pública (normas, manuales), nunca con datos personales.
7. **Acceso desde Timbal**: la API (`api/`) se conecta con `DATABASE_URL` (rol `winecore_app`, `sslmode=verify-full` con el certificado raíz de RDS empaquetado en `api/certs/`). Como Timbal no documenta IP de salida fija, el grupo de seguridad no puede limitar por IP: se compensa con TLS obligatorio, contraseña larga rotada cada 90 días y usuario sin privilegios de DDL. **Pendiente** preguntar a Timbal por IP de salida fija o conectividad privada (si existe, se restringe).

## Consecuencias

- Pieza externa a Timbal **justificada**: Timbal no ofrece una base transaccional documentada (R19). Requiere una **cuenta de AWS** a nombre de CVPO o P.O (Q-027) y aprobar el coste.
- Las migraciones las aplica CI con el rol `winecore_migrator` antes de desplegar (ADR 007); la API nunca tiene permisos de DDL.
- Latencia API ↔ BD mínima si ambos están en eu-north-1 (a confirmar: la web de Timbal también muestra Fráncfort, discrepancia pendiente).
- Si Pedro prefiere Neon, solo cambia la cadena de conexión y la sección de copias (Neon gestiona el PITR); el resto del diseño no cambia.

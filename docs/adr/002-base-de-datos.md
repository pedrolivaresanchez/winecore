# ADR 002 · Datos y documentos en la Knowledge Base de Timbal

- **Estado**: aceptado por decisión de Pedro (31-10-2026: **todo en Timbal, sin AWS**). Sustituye a la versión anterior (PostgreSQL en AWS).
- **Relacionado**: ADR 003 (certificado), ADR 007 (despliegue), ADR 011 (núcleo en `api/`), `02-modelo-dominio.md`, `02-ddl/`, riesgo R26, Q-028.

## Contexto (hechos de la documentación de Timbal, consultada el 31-10-2026)

- El único almacén de datos de la plataforma es la **Knowledge Base** (KB), un recurso de la organización que se vincula al proyecto. El motor es **DuckDB** y se usa por HTTP: `POST /orgs/{org}/k2/{kb}/query` (SQL con parámetros; admite varias sentencias separadas por `;` y devuelve el último resultado). No hay PostgreSQL ni cadena de conexión.
- En los despliegues, Timbal inyecta `TIMBAL_ORG_ID` y `TIMBAL_KB_ID`.
- Copias: diarias y gestionadas por Timbal ("keep-last-N", N sin documentar); restauración por API; no hay descarga directa de copias.
- Ficheros: hasta 100 MB por fichero en la KB.
- **No está documentado** si una petición con varias sentencias es atómica ni cómo se comportan escrituras concurrentes (PENDIENTE, Q-028). DuckDB admite transacciones y es de un solo escritor por base de datos.

## Decisión

1. **Un único almacén**: la KB vinculada al proyecto 3942 para producción. Desarrollo, CI y pruebas usan **otra KB** de la org 122 (o DuckDB local en CI), nunca la de producción. Si Timbal permite una KB por entorno, se usa una por entorno (pregunta en `07-arquitectura.md` §14).
2. **Esquema físico en DuckDB**: traducción del modelo lógico de `02-ddl/` (esquemas, tablas, claves primarias y únicas, CHECK, claves foráneas, secuencias). DuckDB no tiene disparadores, funciones PL/pgSQL ni roles: el DDL de PostgreSQL se conserva como **referencia validada** del modelo y de sus invariantes.
3. **Integridad en el núcleo** (`api/src/core/db/`):
   - **Escritor único**: solo el componente `api` escribe en la KB (`desired_count: 1`), con una cola en proceso que serializa las escrituras; la workforce y los agentes nunca escriben directamente (usan la API de WineCore).
   - **Una operación de negocio = una petición atómica** (`BEGIN; …; COMMIT;` en una sola llamada), si la prueba de M0 confirma la atomicidad.
   - Cada guarda de base de datos de la especificación (`WC001`…`WC140`: inmutabilidad, libros de solo inserción, numeración sin huecos, saldos, conservación de volumen, cadenas de huellas, un solo envío en curso) se implementa en TypeScript **con el mismo código de error** y con los mismos casos de prueba de `02-ddl/tests/invariants_test.sql`.
   - La cadena de auditoría (hash encadenado) se calcula en el núcleo; un job diario la verifica junto con la cadena Verifactu.
4. **Documentos** (PDF, evidencias, fotos): tabla de documentos en la misma KB (contenido binario ≤ 100 MB, SHA-256, sin borrado ni sustitución; deduplicación por hash).
5. **Copias**: las diarias de Timbal + una **exportación semanal propia** de todas las tablas de negocio (Parquet o CSV) guardada en la KB y descargada por Pedro cada mes; prueba de restauración trimestral en una KB de pruebas.
6. **Prueba técnica en M0** (TASK-INFRA-003): atomicidad de una petición con varias sentencias y un fallo provocado a mitad, latencia p95, concurrencia y límites. Si la atomicidad no se cumple, **no se improvisa**: se para y se lleva a Pedro con opciones.

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| PostgreSQL gestionado en AWS (versión anterior de este ADR) | Pedro decide no usar AWS |
| PostgreSQL propio vía el conector de Timbal (caja local) | No está "en Timbal" y el conector es de solo lectura por defecto |
| SQLite o DuckDB dentro de un componente | El almacenamiento de los componentes es efímero: se perderían los datos |

## Consecuencias

- Se pierden las garantías que daba PostgreSQL por sí mismo (disparadores, roles, bloqueos): pasan al núcleo y a sus tests, y un único proceso escribe.
- El volumen de WineCore (RNF-02: ~400 facturas y ~3.000 movimientos al año) encaja de sobra con DuckDB y un escritor único.
- La exportación semanal es la vía de salida de los datos si algún día se deja Timbal.
- Riesgo R26 (`00-triaje.md`) hasta que la prueba de M0 y Timbal confirmen la atomicidad.

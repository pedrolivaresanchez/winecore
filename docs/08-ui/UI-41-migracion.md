# UI-41 · Migración

| | |
|---|---|
| Ruta | `/migracion` |
| Objetivo | Ejecutar los ensayos y cargas de la migración desde Holded, Shopify y Bacosoft, revisar los informes (fusiones, anomalías, cuadres) y aprobar cada carga |
| Historias | US-MIG-01…07 |
| Módulo y permiso | núcleo · `owner` |
| Patrón | Asistente por lotes de datos |

## Componentes
Lista de conjuntos (contactos CVPO/P.O, catálogo, partidas abiertas, albaranes pendientes, histórico de facturas, PDF, contabilidad D7, clientes de Shopify) con estado (sin empezar, ensayo, revisado, cargado); por conjunto: subir ficheros (se guardan cifrados fuera del repositorio), ejecutar ensayo (`--dry-run`), informe (filas, fusiones, avisos de NIF, anomalías, cuadres por entidad/tipo/año), aprobar carga.

## Datos (API)
- `POST /api/v1/migration/batches` (fichero + conjunto + entidad; hash del fichero).
- `POST /api/v1/migration/batches/{id}/dry-run` → informe.
- `POST /api/v1/migration/batches/{id}/load-request` → aprobación con el hash del informe; la carga la hace `api/db/migration/run.ts --load --approved-report` (06-migracion.md).
- `GET /api/v1/migration/batches/{id}/report`.

## Reglas
- Los datos reales nunca salen del entorno de producción ni se versionan (regla dura 0.6); la pantalla solo muestra recuentos y ejemplos enmascarados.
- Cada carga es idempotente (claves de idempotencia de `06-migracion.md`); repetirla no duplica.
- El histórico cargado es de solo lectura (`WC140`).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Subir ficheros | `owner` | Lote de importación | — |
| Ensayo | `owner` | Informe sin cargar | — |
| Pedir carga | `owner` | Solicitud con el hash del informe | Aprobación con passkey |

## Móvil
No disponible.

## Wireframe
```
Migración
┌ Contactos CVPO · ensayo revisado · 1.204 filas · 37 fusiones · 5 NIF dudosos ┐ [Pedir carga]
┌ Partidas abiertas CVPO · sin empezar                                        ┐ [Subir]
┌ Histórico de facturas · ensayo con diferencias (2024: 0,02 €)               ┐ [Ver informe]
```

# TASK-CORE-006 · Documentos en la Knowledge Base con hash
- Hito M0 · 1 día · Escalado: no
- Historias / RNF: RNF-08
- Depende de: TASK-CORE-003, TASK-INFRA-003

## Objetivo
Subida y descarga de adjuntos (PDF de facturas, evidencias, fotos) guardados en la misma Knowledge Base, con SHA-256, enlace por rol y sin borrado ni sustitución.

## Contexto
`02-modelo-dominio.md` §3 (`core.attachment`, `core.attachment_content`, `core.attachment_link`) · ADR 002 §4.

## Ficheros
`api/src/core/attachments.ts`, `api/src/routes/attachments.ts`.

## Interfaz exacta
```ts
export async function putAttachment(tx: Tx, file: { bytes: Uint8Array; mime: string; name: string }, link: { table: string; rowId: UUID; role: AttachmentRole }): Promise<{ id: UUID; sha256: string }>;
GET /api/v1/attachments/{id} → contenido con su Content-Type, solo si el usuario puede leer el registro enlazado
```

## Criterios de aceptación
- Subir dos veces el mismo fichero reutiliza el contenido (mismo hash, una sola fila en `core.attachment_content`).
- No se puede desvincular un adjunto con rol de evidencia ni sustituir un contenido (guardas con su código).
- Límite de 20 MB por fichero en la API (la KB admite hasta 100 MB) y tipo MIME comprobado por el contenido, no por la extensión.

## Tests requeridos
Integración con DuckDB local: hash, deduplicación, permisos de lectura y guardas.

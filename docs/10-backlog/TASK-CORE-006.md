# TASK-CORE-006 · Adjuntos en S3 con hash
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: RNF-08
- Depende de: TASK-CORE-003, TASK-INFRA-003

## Objetivo
Subida y descarga de adjuntos (PDF de facturas, evidencias, fotos) con SHA-256, enlace por rol y bloqueo de escritura en el bucket de evidencias.

## Contexto
`02-modelo-dominio.md` §3 (`core.attachment`, `attachment_link`) · ADR 002 §5.

## Ficheros
`api/src/core/attachments.ts`, `api/src/routes/attachments.ts`.

## Interfaz exacta
```ts
export async function putAttachment(tx: Tx, file: { bytes: Uint8Array; mime: string; name: string }, link: { table: string; rowId: UUID; role: AttachmentRole }): Promise<{ id: UUID; sha256: string }>;
GET /api/v1/attachments/{id} → URL firmada de 5 minutos
```

## Criterios de aceptación
- Subir dos veces el mismo fichero reutiliza el objeto (mismo hash).
- No se puede desvincular un adjunto con rol de evidencia (guarda de BD).

## Tests requeridos
Integración con un S3 local (MinIO) y el guard de la BD.

# TASK-CORE-005 · Auditoría: consulta y verificación de la cadena
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-CORE-05
- Depende de: TASK-CORE-003

## Objetivo
Endpoints para consultar el historial de un registro y verificar la cadena de auditoría; componente `AuditTrail`.

## Contexto
`02-modelo-dominio.md` §4 · UI-40 · `audit.verify_chain`.

## Ficheros
`api/src/routes/audit.ts`, `ui/src/ui/AuditTrail.tsx`.

## Interfaz exacta
`GET /api/v1/audit?table=&row_id=&actor=&from=&to=&cursor=` · `POST /api/v1/audit/verify?from_id=` → `{ intact: boolean, firstBrokenId?: number }`.

## Criterios de aceptación
- Un registro muestra antes/después por campo y el actor "en nombre de".
- La verificación de la BD sintética devuelve `intact: true`.

## Tests requeridos
Integración con datos sintéticos; test que rompe la cadena en una BD temporal (como superusuario) y comprueba `firstBrokenId`.

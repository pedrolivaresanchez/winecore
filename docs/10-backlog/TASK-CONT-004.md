# TASK-CONT-004 · Derechos RGPD
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-CONT-04, RNF-06
- Depende de: TASK-CONT-001, TASK-APR-001

## Objetivo
Exportar todos los datos de un contacto y tramitar su supresión con aprobación, anonimizando lo que no tenga obligación legal de conservación.

## Contexto
`07-arquitectura.md` §11 (RGPD) · UI-05.

## Ficheros
`api/src/core/party/gdpr.ts`, rutas `POST /api/v1/contacts/{id}/gdpr-export` y `.../gdpr-erase-request`.

## Interfaz exacta
Exportación → ZIP con JSON y PDF de documentos; supresión → solicitud de aprobación; al aprobarse, sustituye nombre, correo y teléfono por marcas anónimas salvo en documentos con conservación obligatoria (facturas: 6 años).

## Criterios de aceptación
- Ningún documento fiscal pierde sus datos obligatorios.

## Tests requeridos
Integración con un contacto sintético con facturas y sin ellas.

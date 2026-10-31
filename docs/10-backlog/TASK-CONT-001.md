# TASK-CONT-001 · Contactos: NIF y alta/edición
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-CONT-01
- Depende de: TASK-CORE-003

## Objetivo
Servicio y API de contactos con `normalizeTaxId` (NIF, NIE, CIF españoles con control; formatos de NIF-IVA de la UE), comprobación VIES asíncrona y condiciones por entidad.

## Contexto
`02-modelo-dominio.md` §6 (party) · UI-04, UI-05 · `06-migracion.md` (reglas de NIF de la migración).

## Ficheros
`api/src/core/party/taxId.ts`, `api/src/core/party/contacts.ts`, `api/src/routes/contacts.ts`, `api/src/jobs/vies-check.ts`.

## Interfaz exacta
```ts
export function normalizeTaxId(raw: string, country: string): { normalized: string; kind: 'NIF'|'NIE'|'CIF'|'VAT'|'OTHER'; valid: boolean; reason?: string }
GET/POST /api/v1/contacts · GET/PATCH /api/v1/contacts/{id} (If-Match)
```

## Criterios de aceptación
- NIF duplicado → 409 con enlace al existente.
- VIES caído no bloquea el alta (queda "pendiente de comprobar").

## Tests requeridos
Unitarios de `normalizeTaxId` con casos sintéticos válidos e inválidos por tipo (sin datos reales); propiedad: normalizar dos veces = normalizar una.

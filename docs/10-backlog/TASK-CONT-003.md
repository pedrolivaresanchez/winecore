# TASK-CONT-003 · Duplicados y fusión (UI-06)
- Hito M1 · 1,5 días · Escalado: sí (deduplicación)
- Historias / RNF: US-CONT-02
- Depende de: TASK-CONT-001

## Objetivo
Detección de duplicados con puntuación y fusión que mueve documentos sin tocar los datos congelados de documentos emitidos.

## Contexto
`02-modelo-dominio.md` §6 (dedupe, `party.contact_merge`) · `06-migracion.md` §5 · UI-06.

## Ficheros
`api/src/core/party/dedupe.ts`, `api/src/routes/contact-duplicates.ts`, `ui/src/pages/contacts/duplicates/*`.

## Interfaz exacta
```ts
export function scorePair(a: ContactLite, b: ContactLite): { score: number; reasons: ('same_tax_id'|'similar_name'|'same_email'|'same_phone')[] }
POST /api/v1/contacts/{keepId}/merge { mergeId, fieldChoices }
```

## Criterios de aceptación
- La fusión es transaccional y auditada; el contacto fusionado queda de solo lectura con "fusionado en".
- Facturas emitidas conservan `customer_snapshot` intacto.

## Tests requeridos
Unitarios de `scorePair` (nombres con y sin "S.L.", tildes, mayúsculas); integración de la fusión con pedidos, albaranes y facturas sintéticos.

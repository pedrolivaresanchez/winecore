# TASK-VENT-001 · Reglas de entidad facturadora (UI-35)
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-VENT-02
- Depende de: TASK-CONT-001, TASK-APR-001

## Objetivo
Versiones de reglas (cliente > canal > por defecto), prueba, impacto de los últimos 90 días y activación con aprobación, usando `billing.resolve_issuing_entity`.

## Contexto
`02-modelo-dominio.md` §12.2 (D3) · `08-ui/UI-35-reglas-facturacion.md` · Q-025.

## Ficheros
`api/src/core/billing/rules.ts`, `api/src/routes/billing-rules.ts`, `ui/src/pages/settings/billing-rules/*`.

## Interfaz exacta
```ts
resolveIssuingEntity(tx, { customerId, channel, setId? }): Promise<{ entityId: UUID; matchedScope: 'customer'|'channel'|'default'; ruleId: UUID; trace: Json }>
GET /api/v1/billing-rules/resolve · GET /api/v1/billing-rules/sets/{id}/impact?days=90
```

## Criterios de aceptación
- Dos reglas para el mismo ámbito → `WC070`.
- La activación nunca es retroactiva: pedidos existentes conservan su regla.

## Tests requeridos
Integración de los tres ámbitos y del impacto; E2E de la prueba en pantalla.

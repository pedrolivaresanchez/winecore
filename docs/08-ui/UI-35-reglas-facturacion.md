# UI-35 · Reglas de entidad facturadora

| | |
|---|---|
| Ruta | `/ajustes/reglas-facturacion` |
| Objetivo | Decidir qué entidad (P.O o CVPO) factura cada venta, con reglas versionadas por **cliente > canal > por defecto** (D3), probarlas antes de activarlas y ver qué cambiaría |
| Historias | US-VENT-02, US-VENT-01, Q-025 |
| Módulo y permiso | billing · editar `settings.manage`; activar: aprobación `billing_rules_activation` |
| Patrón | Formulario con versiones |

## Componentes
`Timeline` de versiones (activa, borrador, retiradas), `DataTable` editable de reglas (ámbito, cliente o canal, entidad, notas), panel **Probar** (cliente + canal → entidad y traza), `DiffView` entre la versión activa y el borrador, impacto ("de los pedidos de los últimos 90 días, 14 cambiarían de entidad").

## Datos (API)
- `GET /api/v1/billing-rules/sets` (versiones); `POST /api/v1/billing-rules/sets` (borrador desde la activa).
- `PUT /api/v1/billing-rules/sets/{id}/rules`.
- `GET /api/v1/billing-rules/resolve?set_id=&customer_id=&channel=` (usa `billing.resolve_issuing_entity`).
- `GET /api/v1/billing-rules/sets/{id}/impact?days=90`.
- `POST /api/v1/billing-rules/sets/{id}/request-activation` → aprobación con hash de las reglas.

## Validaciones
- Una sola regla por defecto por versión; no puede haber dos reglas para el mismo cliente o canal (`WC070`).
- Vigencia desde una fecha futura o hoy; nunca retroactiva (los pedidos existentes conservan la regla con la que se resolvieron).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nueva versión | `settings.manage` | Borrador | — |
| Probar | `settings.manage` | Resultado y traza sin guardar | — |
| Pedir activación | `settings.manage` | Solicitud de aprobación | Aprobación con passkey (UI-03) |

## Estados
Sin versión activa: banner "Sin reglas activas: los pedidos usan la entidad por defecto del Ajuste" (no debería ocurrir tras M1).

## Móvil
Lectura de la versión activa.

## Wireframe
```
Reglas de facturación     v2 activa desde 01-01-2027   [Nueva versión]
┌───────────┬─────────────────────────────┬─────────┐
│ Ámbito    │ Cliente / canal             │ Factura │
│ Cliente   │ Cliente Ejemplo (ECI)       │ P.O     │
│ Canal     │ Exportación                 │ CVPO    │
│ Defecto   │ —                           │ CVPO    │
└───────────┴─────────────────────────────┴─────────┘
Probar: [Cliente ▾] [Canal ▾] → CVPO (regla: canal Exportación · v2)
```

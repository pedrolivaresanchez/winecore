# UI-02 · Panel

| | |
|---|---|
| Ruta | `/` |
| Objetivo | Ver en 10 segundos qué requiere atención hoy: aprobaciones, plazos, cobros vencidos, envíos fallidos, alertas de bodega |
| Historias | US-APR-01, US-VFT-02/03, US-FIN-02, US-ASIS-02/03, US-BOD-10 |
| Módulo y permiso | núcleo · autenticado (cada bloque se filtra por permiso y módulo) |
| Patrón | Panel |

## Componentes
`PageHeader` ("Panel"), `EntitySwitcher`, `StatTile` ×4, `Card` con listas cortas, `Banner` fijo de Verifactu.

## Datos (API)
- `GET /api/v1/dashboard?entity=` → bloques: `approvals_pending`, `deadlines_next_30d` (`regulatory.obligation`), `receivables_overdue`, `verifactu_pending` (registros sin enviar y desde cuándo), `submissions_failed`, `cellar_alerts` (fermentaciones), `stock_alerts` (descuadres físico/fiscal).
- Refresco cada 60 s y al volver a la pestaña.

## Bloques
| Bloque | Contenido | Enlace |
|---|---|---|
| Aprobaciones | Nº pendientes y las 3 más antiguas | UI-03 |
| Plazos | Próximos 30 días (SILICIE, SISV, INFOVI, cierres) con días restantes | UI-27 |
| Cobros vencidos | Importe y nº por antigüedad (0–30, 31–60, > 60) | UI-18 |
| Verifactu | Banner obligatorio si hay registros sin enviar: "N registros Verifactu sin enviar desde hh:mm" (Orden HAC/1177/2024, art. 16.4) | UI-15 |
| Envíos con error | Envíos regulatorios fallidos o `needs_human` | UI-28 |
| Bodega | Fermentaciones con alerta, depósitos sin lectura en 24 h | UI-23 |
| Stock | Descuadres abiertos | UI-21 |

## Acciones
Solo navegación. Ninguna acción con efectos desde el panel.

## Estados
- Vacío: "Todo al día" en cada bloque sin elementos.
- Cargando: `Skeleton` por bloque (no bloquea los demás).
- Error de un bloque: `ErrorState` local con "Reintentar".
- Módulo desactivado: el bloque no aparece.

## Textos
Título "Panel". Cifras con formato es-ES.

## Móvil
Bloques en una columna, en este orden: Verifactu (si aplica), aprobaciones, plazos, cobros, bodega.

## Wireframe
```
Panel                                   [P.O | CVPO | Ambas]
┌ ⚠ 3 registros Verifactu sin enviar desde 10:42 ─────────┐
[Aprobaciones 4] [Plazos 2] [Vencido 12.430 €] [Alertas 1]
┌ Aprobaciones ────────┐ ┌ Plazos (30 días) ────────────┐
│ Lote de 8 facturas   │ │ SISV octubre · 10-11 · 3 d   │
│ SILICIE dic–jul      │ │ INFOVI · 20-12 · 49 d        │
└──────────────────────┘ └──────────────────────────────┘
```

# UI-21 · Conciliación físico ↔ fiscal

| | |
|---|---|
| Ruta | `/stock/conciliacion` |
| Objetivo | Explicar en cualquier momento la diferencia entre el stock físico del perímetro fiscal y el saldo fiscal (D2: la salida fiscal va con la factura) |
| Historias | US-INV-03, US-SIL-05 |
| Módulo y permiso | inventory · `inventory.read` |
| Patrón | Panel |

## Componentes
Selector de fecha y establecimiento; tabla por mayor: físico en el perímetro, fiscal, diferencia, diferencia explicada, diferencia sin explicar; desglose de explicaciones (albaranes salidos sin facturar, facturas sin salida física, mermas pendientes de anotar, regularizaciones pendientes).

## Datos (API)
- `GET /api/v1/stock/reconciliation?at=&tax_warehouse_id=` (usa `inventory_reconcile_physical_fiscal`).
- `POST /api/v1/regulatory/reconciliations` (`physical_vs_fiscal`) para guardar el resultado.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar conciliación | `regulatory.prepare` | `regulatory.reconciliation_run` con el detalle | — |
| Ir al documento | `inventory.read` | Navega al albarán o factura | — |

## Estados
Sin diferencias sin explicar: `StatusPill` verde "Cuadra". Con diferencias sin explicar: aviso en el panel (UI-02) y vigilante.

## Móvil
Resumen por mayor.

## Wireframe
```
Conciliación a [31-01-2027]        Fábrica P.O
┌──────────────┬─────────┬─────────┬────────┬───────────┬──────────┐
│ Mayor        │ Físico  │ Fiscal  │ Dif.   │ Explicada │ Sin expl.│
│ B075-TINTO-X │ 13.500 L│ 13.815 L│ -315 L │ -315 L    │ 0        │
└──────────────┴─────────┴─────────┴────────┴───────────┴──────────┘
-315 L = albarán CA-2027-0103 salido el 30-01, factura pendiente
```

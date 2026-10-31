# UI-29 · Cuadres SISV ↔ SILICIE

| | |
|---|---|
| Ruta | `/regulatorio/cuadres` |
| Objetivo | Comprobar mes a mes que SISV y SILICIE cuentan la misma historia (entradas, elaboración, envasado, salidas, mermas) y explicar cada diferencia |
| Historias | US-SIL-05, US-INV-03 |
| Módulo y permiso | silicie + sisv · `regulatory.read`; ejecutar `regulatory.prepare` |
| Patrón | Panel |

## Componentes
Selector de mes; tabla por concepto y mayor: SISV (L), SILICIE (L), diferencia, explicación; `StatusPill` del cuadre; historial de ejecuciones.

## Datos (API)
- `POST /api/v1/regulatory/reconciliations` con `{kind: 'sisv_vs_silicie', period}` (usa `regulatory_reconcile_sisv_silicie`).
- `GET /api/v1/regulatory/reconciliations?kind=&period=` (+ `diffs`).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Ejecutar cuadre | `regulatory.prepare` | `reconciliation_run` + diferencias | — |
| Explicar diferencia | `regulatory.prepare` | Nota y enlace al hecho que la causa | — |

## Estados
Cuadrado: verde. Diferencias sin explicar: bloquean la aprobación del envío mensual de SISV y del semestral de SILICIE.

## Móvil
Resumen del mes.

## Wireframe
```
Cuadre SISV ↔ SILICIE · enero 2027                [Ejecutar cuadre]
┌──────────────┬──────────┬──────────┬──────┬──────────────────────┐
│ Concepto     │ SISV (L) │ SILIC.(L)│ Dif. │ Explicación          │
│ Envasado     │ 2.250    │ 2.250    │ 0    │ —                    │
│ Salidas      │ 1.980    │ 1.665    │ 315  │ Factura pendiente D2 │
└──────────────┴──────────┴──────────┴──────┴──────────────────────┘
```

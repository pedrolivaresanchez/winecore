# UI-16 · Intercompañía

| | |
|---|---|
| Ruta | `/facturas/intercompania` |
| Objetivo | Seguir la liquidación del mes (ventas de CVPO con stock de P.O), revisar la factura recapitulativa P.O → CVPO y pedir su aprobación antes del día 16 |
| Historias | US-FACT-09, US-CAT-03 |
| Módulo y permiso | billing · ver `billing.read`; preparar `billing.write`; aprobar: aprobación `intercompany_invoice_issue` |
| Patrón | Panel + ficha |

## Componentes
Selector de periodo, `StatTile` (unidades, litros, importe a tarifa intercompañía, coste estándar, margen informativo), `DataTable` de líneas de liquidación (fecha, albarán de CVPO, producto, lote, unidades, precio intercompañía), estado de la factura del periodo, aviso de plazo.

## Datos (API)
- `GET /api/v1/intercompany/settlements?period=` → liquidación con líneas.
- `POST /api/v1/intercompany/settlements/{id}/close` (job del día 1; manual si falló).
- `POST /api/v1/intercompany/settlements/{id}/invoice-request` → borrador de factura de P.O (`PI`) con `operation_date` = último día del mes y solicitud de aprobación.

## Validaciones
- Tarifa intercompañía vigente para cada línea (si falta: bloqueo "Falta tarifa intercompañía para <producto>").
- La factura se expide con la fecha real de emisión, **antes del día 16** del mes siguiente (RD 1619/2012, arts. 11 y 13); aviso desde el día 12.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Cerrar periodo | `billing.write` | Congela las líneas del mes | — |
| Pedir aprobación de la factura | `billing.write` | Solicitud con hash del contenido | — |
| (Al aprobarse) | — | Se emite la factura de P.O, se crea la recibida espejo en CVPO y las salidas fiscales | Aprobación con passkey (UI-03) |

## Estados
Periodo sin ventas intercompañía: "Sin movimientos en <mes>; no hace falta factura".

## Móvil
Lectura del estado del mes.

## Wireframe
```
Intercompañía · octubre 2027          Plazo de emisión: 15-11 (13 días)
[Unidades 1.320] [Litros 990] [Importe 6.930 €] [Coste 3.960 €]
Factura PI-2027-0010 · borrador     [Pedir aprobación]
┌────────┬────────────┬──────────────────────┬──────┬────────┐
│ Fecha  │ Albarán    │ Producto / lote      │ Ud.  │ Precio │
└────────┴────────────┴──────────────────────┴──────┴────────┘
```

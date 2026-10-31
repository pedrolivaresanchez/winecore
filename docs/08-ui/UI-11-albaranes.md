# UI-11 · Albaranes

| | |
|---|---|
| Rutas | `/ventas/albaranes` · `/ventas/albaranes/:id` |
| Objetivo | Emitir albaranes (venta, consigna, traspaso, devolución) con **lote obligatorio** en el vino, controlar la salida física y el documento de circulación (e-DA) |
| Historias | US-VENT-03/04/05/06, US-EMCS-01, US-SISV-03, US-MIG-04 |
| Módulo y permiso | sales · ver `sales.read`; emitir `sales.write`; anular `sales.manage` |
| Patrón | Índice + ficha |

## Componentes
`DataTable` (número, tipo, cliente, origen → destino, estado logístico, estado de facturación, ARC), ficha con líneas por lote, `Banner` "Necesita e-DA", `Timeline` (emitido, expedido, entregado, facturado), bultos y SSCC.

## Datos (API)
- `GET /api/v1/delivery-notes?kind=&status=&invoiced=&cursor=`.
- `POST /api/v1/delivery-notes` (desde pedido o en blanco); `POST /api/v1/delivery-notes/{id}/issue`.
- `POST /api/v1/delivery-notes/{id}/dispatch` → falla con `WC_REG_EAD_REQUIRED` si necesita ARC y no lo tiene.
- `POST /api/v1/delivery-notes/{id}/void` (si no ha salido), `.../return` (devolución).
- `POST /api/v1/emcs/documents` desde el albarán (UI-31).
- `GET /api/v1/stock/balances?product_id=&location_id=` para sugerir lotes (FEFO: primero el lote más antiguo).

## Campos y validaciones
| Campo | Validación |
|---|---|
| Tipo | venta · consigna (a operador logístico) · traspaso · devolución |
| Origen / destino | Ubicaciones; en consigna, destino = almacén del operador (Q-021) |
| Líneas | Producto, lote (**obligatorio** en vino: "Indica el lote de la línea N"), unidades; saldo suficiente en origen a la fecha (`WC024`) |
| Transportista, bultos | Opcionales; SSCC si el cliente lo pide (EDI) |
| Documento de circulación | Calculado: e-DA (exportación, UE) o ninguno (nacional); ver `04-regulatorio/emcs.md` §2 |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Emitir | `sales.write` | Número de serie; movimientos físicos (`delivery_out`, cambio de propietario si vende CVPO stock de P.O) | — |
| Marcar expedido | `sales.write` | Estado logístico; exige ARC si hace falta | — |
| Preparar e-DA | `regulatory.prepare` | Borrador de e-DA (UI-31) | — |
| Facturar | `billing.write` | Borrador de factura con estas líneas (UI-13) | — |
| Anular | `sales.manage` | Solo si no ha salido; movimientos `reversal` | Motivo |
| Registrar incidencia de transporte | `sales.write` | `sales.shipping_incident` | — |

## Estados
Albarán emitido: no editable (`WC060`). Albarán de Holded migrado: etiqueta "Holded" y estado de revisión (vivo, cerrado, descartado).

## Móvil
Preparación en almacén: lista de líneas con escáner de GTIN y lote; marcar expedido con foto del palé.

## Wireframe
```
Albarán CA-2027-0103 · emitido · pendiente de facturar     [Facturar]
Venta · BOD → Cliente Ejemplo (Reino Unido)   ⚠ Necesita e-DA [Preparar]
┌──────────────────────────────┬──────────────┬─────┐
│ Producto                     │ Lote         │ Ud. │
│ Tinto Ejemplo 2025 0,75 L    │ L25-T01-B1   │ 120 │
└──────────────────────────────┴──────────────┴─────┘
```

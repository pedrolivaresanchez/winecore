# UI-30 · EDI (El Corte Inglés)

| | |
|---|---|
| Ruta | `/regulatorio/edi` |
| Objetivo | Ver los mensajes de AecocEDI (pedidos, facturas, confirmaciones de pago, textos libres), su estado y su vínculo con pedidos y facturas de WineCore |
| Historias | US-EDI-01/02/03/04 |
| Módulo y permiso | edi · `regulatory.read`; preparar factura EDI `regulatory.prepare` |
| Patrón | Bandeja |

## Componentes
`Tabs`: Entrantes · Salientes; `DataTable` (tipo ORDERS/INVOIC/REMADV/GENRAL, fecha, nº de documento, estado: avisado, leído, interpretado, enlazado, error; enviado, confirmado); ficha con campos normalizados y el documento original (captura o fichero).

## Datos (API)
- `GET /api/v1/edi/messages?direction=&type=&status=` (`regulatory_edi_inbox_list`).
- `GET /api/v1/edi/messages/{id}`; `POST /api/v1/edi/messages/{id}/link` (enlazar a pedido o factura).
- `POST /api/v1/edi/invoices/{invoice_id}/prepare` → ficha INVOIC y envío regulatorio (UI-28).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Crear pedido desde ORDERS | `sales.write` | Pedido de ECI por GTIN; líneas no identificadas marcadas | — |
| Preparar factura EDI | `regulatory.prepare` | Envío con la factura emitida a ECI | Aprobación (UI-03) |
| Proponer cobro desde REMADV | `finance.write` | Cobro con imputaciones propuestas (UI-18) | — |

## Estados
Aviso por correo sin documento leído aún: "Pendiente de lectura por el ejecutor". GTIN desconocido: error con enlace a UI-08.

## Móvil
Lectura de la bandeja.

## Wireframe
```
EDI · El Corte Inglés            [Entrantes] [Salientes]
┌────────┬────────┬──────────────┬─────────────┬─────────────┐
│ Fecha  │ Tipo   │ Documento    │ Estado      │ Enlace      │
│ 03-03  │ ORDERS │ 45000123     │ Enlazado    │ PO-2027-0061│
│ 05-03  │ REMADV │ PAG-2027-07  │ Interpretado│ Cobro prop. │
└────────┴────────┴──────────────┴─────────────┴─────────────┘
```

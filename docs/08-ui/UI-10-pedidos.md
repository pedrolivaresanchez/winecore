# UI-10 · Pedidos

| | |
|---|---|
| Rutas | `/ventas/pedidos` · `/ventas/pedidos/:id` · `/ventas/pedidos/nuevo` |
| Objetivo | Crear y seguir pedidos con la **entidad facturadora resuelta** por las reglas de Ajustes (D3), y pasar a albarán |
| Historias | US-VENT-01/02/07, US-EDI-02, US-MCP-02 |
| Módulo y permiso | sales · ver `sales.read`; crear y editar `sales.write` |
| Patrón | Índice + formulario |

## Componentes
`DataTable` (estado, cliente, canal, entidad, fecha, total, origen: manual/MCP/EDI/web), formulario con `Combobox` de cliente y de producto, `KeyValue` "Factura: CVPO (regla: canal Distribuidor)", `Stepper` de estado.

## Datos (API)
- `GET /api/v1/sales-orders?status=&entity=&channel=&cursor=`.
- `POST /api/v1/sales-orders` (`Idempotency-Key`); `PATCH /api/v1/sales-orders/{id}` (solo borrador).
- `GET /api/v1/billing-rules/resolve?customer_id=&channel=` → entidad, regla aplicada y traza.
- `POST /api/v1/sales-orders/{id}/confirm`, `.../cancel`, `.../delivery-notes` (crea albarán, UI-11).
- Precio: `GET /api/v1/price-quote?customer_id=&product_id=&qty=&date=`.

## Campos y validaciones
| Campo | Validación |
|---|---|
| Cliente | Obligatorio; si no tiene NIF y la factura será completa: aviso |
| Canal | Por defecto el del cliente |
| Entidad facturadora | **Resuelta**, no editable aquí; muestra la regla. Cambiarla exige cambiar la regla (UI-35) o una excepción con motivo (`sales.manage`) |
| Líneas | Producto activo, cantidad > 0 (unidades), precio de la tarifa (editable con motivo si baja del mínimo), IVA por defecto del producto |
| Departamento / centro de coste (ECI) | Obligatorios si el cliente es El Corte Inglés |
| Fecha de entrega, dirección de envío, Incoterm | Incoterm obligatorio si el destino está fuera de España |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar borrador | `sales.write` | — | — |
| Confirmar | `sales.write` | Reserva informativa de stock | — |
| Crear albarán | `sales.write` | UI-11 con las líneas pendientes | — |
| Cancelar | `sales.write` | Estado `cancelled` con motivo | Motivo |
| Excepción de entidad | `sales.manage` | Fija otra entidad para este pedido con motivo auditado | Motivo |

## Estados
Pedido de El Corte Inglés con GTIN desconocido: líneas marcadas "Producto no identificado" y bloqueo de confirmación.

## Móvil
Lista y ficha; alta rápida de pedido con búsqueda de producto y cantidades.

## Wireframe
```
Pedido PO-2027-0042 · borrador                 [Confirmar] [Albarán]
Cliente [Restaurante Ejemplo ▾]   Canal Restauración
Factura: CVPO  (regla: canal Restauración · v2)
┌──────────────────────────────┬─────┬────────┬───────┐
│ Producto                     │ Ud. │ Precio │ Total │
│ Tinto Ejemplo 2025 0,75 L    │ 12  │ 9,50   │ 114,00│
└──────────────────────────────┴─────┴────────┴───────┘
```

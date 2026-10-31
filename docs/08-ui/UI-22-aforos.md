# UI-22 · Aforos

| | |
|---|---|
| Rutas | `/stock/aforos` · `/stock/aforos/:id` |
| Objetivo | Hacer recuentos físicos (arranque, periódicos, de inspección), compararlos con el libro y contabilizar las diferencias con aprobación |
| Historias | US-INV-01/04/05, US-MIG-04 |
| Módulo y permiso | inventory · contar `inventory.count`; contabilizar: aprobación `inventory_adjustment` |
| Patrón | Índice + formulario de recuento (móvil primero) |

## Componentes
Lista de aforos; recuento por ubicación y recipiente con `VolumeInput` (L) o unidades, `QrScanner` para recipientes, foto opcional; comparación con el libro y diferencias; firma de quien cuenta.

## Datos (API)
- `POST /api/v1/inventory-counts` (`kind`: opening, periodic, inspection, spot; ubicaciones).
- `PUT /api/v1/inventory-counts/{id}/lines` (líneas contadas).
- `POST /api/v1/inventory-counts/{id}/close` → diferencias.
- `POST /api/v1/inventory-counts/{id}/post-request` → aprobación; al aprobar: `count_adjust_in/out` (físico) y `regularization_in/out` (fiscal, A30/A31).

## Validaciones
- Cada línea con recipiente, lote y volumen (o producto y unidades).
- Volumen ≤ capacidad del recipiente.
- El aforo de arranque (31-12-2026, Q-013) crea saldos de apertura (`opening`) y alimenta el A01 de SILICIE.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nuevo aforo | `inventory.count` | Borrador | — |
| Cerrar recuento | `inventory.count` | Calcula diferencias | — |
| Pedir contabilización | `inventory.count` | Solicitud de aprobación con las diferencias | Aprobación (UI-03) |

## Estados
Recuento sin conexión en la bodega: las líneas se guardan en el dispositivo y se sincronizan al volver la conexión (con aviso "Pendiente de sincronizar").

## Móvil
Pantalla principal de uso: lista de recipientes de la ubicación, escanear QR → introducir litros → siguiente.

## Wireframe
```
Aforo AF-2027-01 · periódico · BOD         [Cerrar recuento]
┌──────────┬──────────┬──────────┬──────────┬────────┐
│ Recip.   │ Lote     │ Libro (L)│ Contado  │ Dif.   │
│ INOX-03  │ L25-T01  │ 4.800,0  │ 4.790,0  │ -10,0  │
└──────────┴──────────┴──────────┴──────────┴────────┘
```

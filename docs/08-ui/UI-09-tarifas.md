# UI-09 · Tarifas

| | |
|---|---|
| Rutas | `/catalogo/tarifas` · `/catalogo/tarifas/:id` |
| Objetivo | Mantener tarifas versionadas (por canal o cliente) y la tarifa intercompañía, sin solapes de vigencia |
| Historias | US-CAT-02/03 |
| Módulo y permiso | catalog · ver `catalog.read`; editar `catalog.write`; activar: aprobación `tariff_activation` |
| Patrón | Índice + ficha con versiones |

## Componentes
`DataTable` de tarifas, `Timeline` de versiones, `DataTable` editable de precios (producto, precio, mínimo), `DiffView` entre versiones.

## Datos (API)
- `GET /api/v1/price-lists`, `GET /api/v1/price-lists/{id}/versions`.
- `POST /api/v1/price-lists/{id}/versions` (borrador), `PUT .../versions/{v}/items`.
- `POST /api/v1/price-lists/{id}/versions/{v}/request-activation` → aprobación con el hash de la tabla de precios.
- Intercompañía: `GET/POST /api/v1/intercompany/tariffs` (tarifa base + descuento + vigencia + referencia a la validación del asesor).

## Campos y validaciones
| Campo | Validación |
|---|---|
| Vigencia desde / hasta | Sin solape con otra versión activa (`EXCLUDE`, `WC050`) |
| Precio | ≥ 0, 4 decimales máximo |
| Moneda | EUR (otras: fuera del MVP) |
| Intercompañía: descuento | 0–100 %; referencia de validación del asesor obligatoria |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nueva versión | `catalog.write` | Copia la vigente como borrador | — |
| Pedir activación | `catalog.write` | Solicitud de aprobación | Aprobación (`tariff_activation`) |
| Importar CSV | `catalog.write` | Carga precios en el borrador con informe de errores | — |

## Estados
Versión aprobada: solo lectura. Productos sin precio en la versión: aviso.

## Móvil
Consulta de precios por producto (lectura).

## Wireframe
```
Tarifa Distribuidor                       [Nueva versión]
v3 · 01-01-2027 → … · aprobada       v2 · 2026 · cerrada
┌─────────────────────────────┬────────┬────────┐
│ Producto                    │ Precio │ Mínimo │
│ Tinto Ejemplo 2025 0,75 L   │ 7,9000 │ 6      │
└─────────────────────────────┴────────┴────────┘
```

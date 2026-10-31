# UI-07 · Catálogo

| | |
|---|---|
| Ruta | `/catalogo` |
| Objetivo | Ver y gestionar vinos (marcas), formatos y productos vendibles (vino × añada × formato, servicios, merchandising) |
| Historias | US-CAT-01, US-MIG-02 |
| Módulo y permiso | catalog · ver `catalog.read`; crear `catalog.write` |
| Patrón | Índice con pestañas |

## Componentes
`Tabs`: Productos · Vinos · Formatos. `DataTable` con filtros (tipo, vino, añada, formato, activo, ecológico, sin GTIN, sin NC).

## Datos (API)
- `GET /api/v1/products?kind=&wine_id=&vintage=&active=&missing=gtin|nc_code|silicie`.
- `GET /api/v1/wines`, `GET /api/v1/formats`.
- `POST /api/v1/products`, `POST /api/v1/wines`, `POST /api/v1/formats`.

## Columnas (Productos)
SKU · nombre · vino · añada · formato · GTIN · NC · IVA por defecto · grado · existencias (enlace a UI-19) · activo.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nuevo producto / vino / formato | `catalog.write` | Alta (ver UI-08) | — |
| Desactivar | `catalog.write` | Deja de ofrecerse en pedidos; no se borra | `Dialog` si tiene stock |
| Exportar CSV | `catalog.read` | Vista filtrada | — |

## Estados
Avisos por fila: "Sin GTIN" (necesario para El Corte Inglés), "Sin código NC" (necesario para SILICIE y e-DA), "Sin mayor SILICIE".

## Móvil
Lista de productos con búsqueda y escáner de código de barras (`QrScanner`) para encontrar un producto por GTIN.

## Wireframe
```
Catálogo                 [Productos] [Vinos] [Formatos]   [Nuevo]
(Vino) (Añada 2025) (Activos) (Sin GTIN)
┌──────────────┬──────────────────────────┬──────┬───────┬──────────┐
│ SKU          │ Nombre                    │ Añada│ Form. │ Avisos   │
│ TB-2025-075  │ Tinto Ejemplo 2025 0,75 L │ 2025 │ B075  │ Sin GTIN │
└──────────────┴──────────────────────────┴──────┴───────┴──────────┘
```

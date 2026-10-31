# UI-08 · Ficha de producto

| | |
|---|---|
| Ruta | `/catalogo/:id` |
| Objetivo | Definir un producto con todo lo que necesitan ventas, facturación, stock, SILICIE, EDI y etiqueta |
| Historias | US-CAT-01/04, US-EDI-02, US-ETQ-01 |
| Módulo y permiso | catalog · ver `catalog.read`; editar `catalog.write` |
| Patrón | Ficha con pestañas |

## Componentes
`Tabs`: General · Precios · Fiscal y aduanas · EDI · Etiqueta · Existencias · Historial.

## Datos (API)
`GET/PATCH /api/v1/products/{id}`; `GET /api/v1/products/{id}/prices`; `GET /api/v1/stock/balances?product_id=`; `GET/POST /api/v1/products/{id}/label-specs`.

## Campos y validaciones
| Pestaña | Campos | Validación |
|---|---|---|
| General | SKU, nombre ES/EN, tipo, vino, añada, formato, unidad, requiere lote, ecológico | SKU `^[A-Z0-9][A-Z0-9._-]{1,39}$`; vino y formato obligatorios si tipo = vino; único por vino + añada + formato |
| Precios | Precio en cada tarifa vigente (solo lectura; se editan en UI-09), coste estándar | — |
| Fiscal y aduanas | IVA por defecto, código NC (8 dígitos), mayor SILICIE (`silicie_ledger`), grado declarado, cuenta de ventas | NC `^[0-9]{8}$`; grado 0–25 |
| EDI | GTIN unidad, GTIN-14 caja, "GTIN vigente" (si varias añadas comparten GTIN), códigos de artículo por cliente | Dígito de control GS1 |
| Etiqueta | Fichas de etiqueta por idioma y versión (`catalog.label_spec`) con estado y aprobación | Ver `04-regulatorio/etiquetado.md` §5 |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar | `catalog.write` | Actualiza y audita | — |
| Marcar GTIN vigente | `catalog.write` | `catalog.gtin_current` apunta a este producto (EDI) | `Dialog` "Los pedidos de El Corte Inglés con este GTIN irán a esta añada" |
| Aprobar ficha de etiqueta | `catalog.write` | Estado `approved` | Comprobaciones de etiquetado sin errores |

## Estados
Producto con movimientos: vino, añada y formato bloqueados (se crea otro producto).

## Móvil
Solo lectura con existencias y GTIN.

## Wireframe
```
Tinto Ejemplo 2025 0,75 L                                   [Guardar]
General | Precios | Fiscal y aduanas | EDI | Etiqueta | Existencias | Historial
SKU TB-2025-075   Vino Tinto Ejemplo   Añada 2025   Formato B075
NC 22042xxx   Mayor SILICIE B075-TINTO-EJEMPLO   IVA IVA21
```

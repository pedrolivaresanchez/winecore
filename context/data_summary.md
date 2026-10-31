# Resumen de datos exportados (estructuras y volúmenes, sin datos personales)

Origen: exportaciones de Holded (31-10-2026) en `holded-export/{cvpo,po}` y de Shopify en `shopify-export/`. Las filas son las de cada fichero, con la cabecera detectada automáticamente. Hay que verificar si hay filas de totales.

## Holded — CVPO (COMPAÑIA DE VINOS PEDRO OLIVARES S.L.)
| Fichero | Filas | Columnas clave |
|---|---|---|
| Contactos.xlsx | 256 | Creado, Nombre, ID (NIF), Email, Teléfono, Móvil, Dirección, Población, CP, Provincia, País, Código país, Idioma, Moneda, Dto. %, Cuenta, Referencia, Régimen, F.Pago, IBAN, Swift, Ref. mandato (SEPA), Tags, Cuenta ventas/compras, Tipo, Tipo de contacto, Acumula en modelo 347 |
| ventas/Ingresos (facturas de venta, cabecera) | 1.028 | Fecha, Num, Fecha operación, Vencimiento, Cliente, Descripción, Tags, Cuenta, F.Pago, Proyecto, Subtotal, IVA, Retención, Rec. de eq., Total, Cobrado, Pendiente, Estado, Fecha de cobro, FACe |
| ventas/Ventas Exportar items (líneas) | 3.032 | Num factura, Fecha, Vencimiento, Descripción, Borrador, Contacto, ID Contacto, CP, Población, País, SKU, Item, Tags, Proyecto, Cuenta, Unidades, Subtotal, Impuestos, Importe Impuestos, Total |
| ventas/Albaranes (cabecera) | 1.547 | Num, Fecha, Destino, Envío, Tags, Descripción, Canal, Almacén, F.Pago, Unidades, IVA, Subtotal, Total, Facturado, Etapa |
| ventas/Albaranes Exportar items (líneas) | 5.134 | mismas columnas que las líneas de venta |
| ventas/Presupuestos (cabecera / líneas) | 10 / 29 | … Total facturado, Pagos a cuenta, Estado, Facturado |
| compras/Compras (cabecera) | 634 | Fecha emisión, Num, Num interno, Fecha contable, Vencimiento, Proveedor, Descripción, Tags, Cuenta, F.Pago, Proyecto, Subtotal, IVA, Retención, Rec. eq., Total, Pagado, Pendiente, Estado, Fecha de pago |
| compras/Compras Exportar items (líneas) | 647 | Num factura, Num interno, …, SKU, Item, Cuenta, Unidades, Subtotal, Impuestos, Total |
| inventario/Productos | 46 | Nombre, Descripción, SKU, Código, Variante, Tags, Tipo, Almacén, Canal, Cuenta, Stock, Stock virtual, Stock disponible, Coste, Precio compra, Valor coste/venta, IVA, Rec. eq., Total |
| contabilidad/Cuadro de cuentas 2026 | 125 | Cuenta, Nombre, Grupo, Subgrupo 1-3, Debe, Haber, Saldo (solo 2026) |
| contabilidad/Cuenta de PyG | — | formato informe (no tabular), solo 2026 |
| PDF | ~1.500 + 76 | holded_1023/1039a/1039b.zip (500 cada uno: ventas y compras); bulk*.zip (50+26) |

## Holded — P.O (Pedro Olivares Sánchez, autónomo, "Vinos Bio Pedro Olivares")
| Fichero | Filas | Notas |
|---|---|---|
| Contactos | 220 | mismas columnas que CVPO |
| ventas/Ingresos (cabecera) | 479 | incluye columna extra IVA.1 (dos tipos de IVA) |
| ventas/Ventas items (líneas) | 1.849 | |
| ventas/Presupuestos (cab./líneas) | 12 / 36 | |
| Albaranes | — | **no exportados para P.O**: hay que confirmar si existen |
| compras/Compras (cabecera / líneas) | 922 / 975 | |
| inventario/Productos | 39 | sin "Stock virtual/disponible" |
| contabilidad/Cuadro de cuentas 2026 | 51 | solo 2026 |
| PDF | 500 + 477 + 419 | holded_1048/1050/1051.zip |

**Lagunas conocidas:** Libro diario, mayor, balance y sumas y saldos no se pueden exportar con el plan actual. La contabilidad solo cubre 2026. Faltan unos 132 PDF de compras de CVPO y un lote de PDF de P.O. No hay lotes/trazabilidad en Holded: el lote solo aparece, como mucho, en la descripción o el SKU de las líneas.

## Shopify (tienda online)
| Fichero | Filas | Columnas clave |
|---|---|---|
| products_export_1.csv | 95 (filas de variante/imagen; 53 productos) | Handle, Title, Body HTML, Type, Tags, Variant SKU/Price/Grams/Inventory Qty, Image Src, SEO Title/Description, metafields custom: alcohol, añada, ecológico, ficha_cata, producción, sulfitos, tipo, variedad, zona_origen; Cost per item, Status |
| orders_export_1.csv | 322 (filas de línea) | Name, Email, Financial/Fulfillment Status, Subtotal, Shipping, Taxes, Total, Discount, Shipping Method, Lineitem qty/name/price/sku, Billing/Shipping address, Payment Method, Refunded, Tax 1..5, Source |
| customers_export.zip → customers_export.csv | 2.305 | Customer ID, Nombre, Email, Accepts Email/SMS/WhatsApp Marketing, dirección por defecto, Phone, Total Spent, Total Orders, Tags, Tax Exempt |
| transactions_export.csv | 55 | Order, Kind, Gateway, Status, Amount, Card Type |
| discounts_export_1.csv | 3 | Name, Value, Type, condiciones, Status, Start/End |
| gift_cards_export_1.csv | 2 | saldo inicial/actual, caducidad |
| theme_export_…zip | — | tema "VBPO" (para la web; no es el ámbito de WineCore) |

Último pedido Shopify: 18-09-2026. Los clientes de Shopify (B2C) y los contactos de Holded (B2B/proveedores) deben deduplicarse por email/NIF.

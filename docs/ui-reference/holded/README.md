# Referencia visual: Holded

Capturas del ERP que WineCore sustituye, como **inspiración de diseño** (petición de Pedro, 31-10-2026). Los datos están pixelados porque el repositorio es público: solo se leen las etiquetas de la interfaz. Los originales no se suben nunca (viven en `data/`, fuera de git).

| Captura | Qué tomamos | Cómo lo mejoramos en WineCore |
|---|---|---|
| 01 Panel de inicio | Saludo, tarjetas de cifras clave, "Acciones pendientes" | Solo lo accionable hoy (aprobaciones, plazos, cobros vencidos, alertas de bodega); sin bloques de "Recomendado" ni ofertas |
| 02 Facturas de venta, 04 Contactos, 07 Productos, 10 Compras, 12 Cuadro de cuentas | Tabla densa con filtros en píldoras, búsqueda, selector de columnas, paginación y botón principal "Nuevo X" con desplegable (importar, etc.) | El mismo patrón en todas las listas; en móvil, tarjetas con la información clave y búsqueda fija arriba |
| 03 Detalle de factura | Vista previa del PDF a la izquierda, panel con pestañas a la derecha, anterior/siguiente, acciones arriba | En móvil, pestañas apiladas y PDF a pantalla completa bajo demanda; sin publicidad de cobros |
| 05 Contacto en panel lateral | Ficha rápida que se desliza desde la derecha sobre la lista, acciones rápidas y cifras del contacto | Mismo panel para cualquier registro (contacto, lote, depósito); en móvil, a pantalla completa |
| 06 Panel de inventario, 08 Producto, 09 Almacenes | Cifras de stock, operaciones frecuentes como tarjetas, stock por almacén con gráfico | Stock por almacén, recipiente y lote; operaciones de bodega a un toque en móvil |
| Barra lateral (todas) | Menú plegable con submenús por módulo | Solo los módulos activos; sin bloque "Mejora tu plan" |
| 13 Ajustes | Panel lateral con categorías en cuadrícula y buscador | Igual, con los ajustes de WineCore (entidades, series, módulos, usuarios) |

Reglas para todas las pantallas: todo en español; un mismo patrón para lo mismo en todo el producto; nada que no tenga sentido para el usuario; sin mensajes comerciales; QA a 390 y 1440 px.

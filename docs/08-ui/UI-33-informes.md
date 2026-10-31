# UI-33 · Informes

| | |
|---|---|
| Ruta | `/informes` |
| Objetivo | Consultar y exportar informes de ventas, cobros, stock, bodega, ecológico y fiscales (para la asesoría) |
| Historias | US-FACT-11, US-COMP-03, US-MOD-01, US-ECO-01, US-ASIS-02 |
| Módulo y permiso | núcleo · cada informe exige el `*.read` de su módulo; exportaciones fiscales `exports.fiscal` |
| Patrón | Índice de informes + visor |

## Informes
| Informe | Contenido | Permiso |
|---|---|---|
| Ventas | Por periodo, entidad, canal, cliente, producto, añada (unidades, litros, importe) | `sales.read` |
| Cobros | Antigüedad de deuda, cobrado por periodo | `finance.read` |
| Existencias valoradas | Existencias a fecha × coste estándar | `inventory.read` |
| Bodega | Producción por añada, rendimientos (kg → L), mermas por tipo | `cellar.read` |
| Ecológico | Informe para el organismo de control (`ecologico.md` §4) | `cellar.read` + aprobación para entregar |
| Libros de IVA | Emitidas y recibidas del periodo con cuadres (`modelos-aeat.md` §2) | `exports.fiscal` |
| Paquete para la asesoría | ZIP del periodo con hash por fichero | `exports.fiscal` |

## Datos (API)
`GET /api/v1/reports/{report}?params` (JSON) y `GET /api/v1/reports/{report}.{csv|xlsx|pdf}`; `POST /api/v1/reports/advisor-pack` (genera el ZIP).

## Acciones
Ejecutar, exportar, programar envío **interno** a CVBOT (nunca a terceros sin aprobación).

## Estados
Informe pesado: se genera en segundo plano y avisa al terminar.

## Móvil
Ventas y cobros (lectura).

## Wireframe
```
Informes
[Ventas] [Cobros] [Existencias valoradas] [Bodega] [Ecológico] [Libros de IVA] [Paquete asesoría]
Ventas · 2027 T1 · CVPO        (Canal) (Producto)        [CSV] [XLSX] [PDF]
```

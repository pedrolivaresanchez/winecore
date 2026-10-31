# UI-17 · Gastos (facturas recibidas)

| | |
|---|---|
| Rutas | `/compras` · `/compras/:id` · `/compras/capturar` |
| Objetivo | Capturar facturas de proveedores (foto, PDF, correo reenviado), revisarlas, aprobarlas y llevar el libro de recibidas |
| Historias | US-COMP-01/02/03, US-ECO-01 (facturas de productos enológicos y fitosanitarios) |
| Módulo y permiso | purchasing · ver `purchasing.read`; capturar y validar `purchasing.write`; aprobar `purchasing.approve` |
| Patrón | Índice + bandeja de validación + ficha |

## Componentes
`FileDrop` y `CameraCapture`; `DataTable` (estado: capturado, validado, aprobado, rechazado, duplicado); ficha en dos columnas: documento (visor PDF/imagen) y campos extraídos con su confianza; aviso de duplicado.

## Datos (API)
- `POST /api/v1/supplier-invoices/capture` (fichero) → crea `captured`; la extracción la hace el workflow `ocr-gastos` y escribe por API (≤ 2 min).
- `GET /api/v1/supplier-invoices?status=&entity=&cursor=`; `PATCH /api/v1/supplier-invoices/{id}`.
- `POST /api/v1/supplier-invoices/{id}/validate` · `.../approve` · `.../reject`.
- `GET /api/v1/supplier-invoices/export?period=` (libro de recibidas, US-COMP-03).

## Campos y validaciones
| Campo | Validación |
|---|---|
| Entidad | P.O o CVPO (sugerida por el NIF del destinatario de la factura) |
| Proveedor | Contacto existente o alta; NIF válido |
| Número, fecha de expedición, fecha contable | Número + proveedor únicos (aviso de duplicado) |
| Líneas | Categoría de gasto (`purchasing.expense_category`), base, tipo de IVA, cuota, retención | Suma de líneas = total del documento (tolerancia 0,01 €) |
| Relevante para ecológico | Si la categoría lo es: enlace a la adición o tratamiento correspondiente |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Capturar | `purchasing.write` | Sube y extrae | — |
| Validar | `purchasing.write` | Estado `validated` | — |
| Aprobar | `purchasing.approve` | Estado `approved`; entra en pagos pendientes | — |
| Rechazar / marcar duplicado | `purchasing.write` | Con motivo | Motivo |

## Estados
Extracción en curso: `Skeleton` en los campos con "Leyendo la factura…". Campos con baja confianza: resaltados para revisar.

## Móvil
Captura con la cámara trasera desde el móvil y lista de lo capturado.

## Wireframe
```
Gasto · capturado                                   [Validar] [Rechazar]
┌ Documento ─────────────┐  Proveedor [Proveedor Ejemplo ▾]  NIF ✓
│  (vista del PDF)       │  Nº F-2027-118   Fecha 03-02-2027
│                        │  Categoría Productos enológicos  Base 48,00
└────────────────────────┘  IVA 21 % 10,08   Total 58,08   ⚠ Revisa la fecha
```

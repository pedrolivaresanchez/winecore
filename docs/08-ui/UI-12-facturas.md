# UI-12 · Facturas

| | |
|---|---|
| Ruta | `/facturas` |
| Objetivo | Encontrar facturas de las dos entidades, ver su estado de cobro y de Verifactu, y emitir en lote |
| Historias | US-FACT-01/08/10/11, US-VFT-03, US-MIG-03 |
| Módulo y permiso | billing · ver `billing.read`; lote `billing.write` (la emisión en lote requiere aprobación) |
| Patrón | Índice |

## Componentes
`DataTable` con selección múltiple; filtros en pills (entidad, estado, serie, cliente, canal, periodo, cobro, Verifactu); `StatusPill` doble (documento y Verifactu); barra de acciones de selección.

## Datos (API)
- `GET /api/v1/invoices?entity=&status=&series=&customer_id=&from=&to=&payment_status=&verifactu_status=&cursor=`.
- `POST /api/v1/invoices/batch-issue-request` con los ids de borradores → solicitud de aprobación (`invoice_batch_issue`) con resumen (nº, clientes, total) y hash.
- `GET /api/v1/invoices/export?period=` (libro de emitidas, ZIP de PDF; US-FACT-11).

## Columnas
Número · fecha · entidad · cliente · base · total · cobrado · vencimiento · estado · Verifactu (aceptada / con errores / rechazada / pendiente) · origen (WineCore / Holded).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nueva factura | `billing.write` | UI-13 | — |
| Emitir seleccionadas | `billing.write` | Solicitud de aprobación del lote; al aprobarse se emiten en orden de fecha con números consecutivos | Aprobación con passkey (UI-03) |
| Exportar libro | `exports.fiscal` | Libro de emitidas del periodo + PDF | — |

## Estados
Facturas de Holded (partidas abiertas): se ven y se cobran, no se editan. Facturas con Verifactu rechazado: fila marcada en rojo y filtro rápido "Requieren acción".

## Móvil
Lista con búsqueda; ficha de solo lectura y descarga del PDF.

## Wireframe
```
Facturas                                [Nueva factura]
(CVPO) (Emitidas) (Octubre) (Verifactu: requieren acción 1)
┌───────────┬────────┬──────────────┬────────┬─────────┬───────────┐
│ Número    │ Fecha  │ Cliente      │ Total  │ Cobro   │ Verifactu │
│ CF27-0012 │ 14-01  │ Cliente Ej.  │ 145,20 │ Pendien.│ Aceptada  │
└───────────┴────────┴──────────────┴────────┴─────────┴───────────┘
[3 seleccionadas]  [Emitir seleccionadas]
```

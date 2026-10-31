# UI-13 · Factura

| | |
|---|---|
| Rutas | `/facturas/nueva` · `/facturas/:id` |
| Objetivo | Preparar un borrador (en blanco, desde albaranes o desde un pedido), emitirlo en una sola operación con su registro Verifactu y ver la factura emitida con su PDF, cobros y estado |
| Historias | US-FACT-01/02/03/05/06/07/10, US-VFT-01/03, US-FIN-01 |
| Módulo y permiso | billing · ver `billing.read`; borrador `billing.write`; emitir `billing.issue`; anular `billing.void` |
| Patrón | Formulario (borrador) / ficha (emitida) |

## Componentes
Cabecera con entidad (resuelta por D3), serie, cliente; `DataTable` editable de líneas; panel lateral de totales (base por tipo, IVA, recargo, retención, **importe total de la factura** y **total a pagar**); `Banner` de validaciones; ficha emitida con `Tabs`: Factura · PDF · Cobros · Verifactu · Historial.

## Datos (API)
- `POST /api/v1/invoices` (borrador; `from_delivery_notes[]` o `from_order`); `PATCH /api/v1/invoices/{id}` (solo borrador).
- `POST /api/v1/invoices/{id}/validate` → lista de errores y avisos sin emitir.
- `POST /api/v1/invoices/{id}/issue` (`Idempotency-Key`) → número, fecha, totales, `verifactu_record` (QR) en la misma transacción.
- `GET /api/v1/invoices/{id}/pdf`; `POST /api/v1/invoices/{id}/sent` (descarga registrada); `POST /api/v1/invoices/{id}/void`.
- `GET /api/v1/verifactu/records?invoice_id=`.

## Campos y validaciones
| Campo | Validación |
|---|---|
| Entidad y serie | Entidad resuelta; serie por defecto del tipo (`CF27-`/`PF27-`…); no editable tras emitir |
| Cliente | Factura completa (`F1`): cliente con NIF o NIF-IVA ("El cliente necesita NIF para una factura completa") |
| Fecha de operación | Si difiere de la de expedición; nunca posterior a la emisión |
| Líneas | Producto, lote (vino: "Indica el lote de la línea N"), unidades, precio, descuento, código de IVA |
| Tratamiento fiscal | `IVA21` / `IVA21_RE` / `IVA21_ALQ` / `EXP_E2` / `INTRA_E5`; intracomunitaria exige NIF-IVA validado ("Valida el NIF-IVA en VIES") |
| Descripción de la operación | 1–500 caracteres (por defecto "Venta de vino") |
| Idioma | ES/EN según cliente |
| Total ≥ 1.000.000 € | Bloqueo para revisión (verifactu.md §5) |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Guardar borrador | `billing.write` | Sin número ni efectos | — |
| Emitir | `billing.issue` | Número, congelado, desglose, vencimientos, registro Verifactu, efectos de stock fiscal (P.O), PDF | `Dialog` "Vas a emitir la factura N de <entidad> por X €. No se podrá modificar." (la aprobación de la emisión es la del envío a la AEAT, Q-003) |
| Descargar PDF | `billing.read` | Marca "enviada (descarga)" con quién y cuándo | — |
| Enviar por correo (M2, Q-014) | `billing.issue` | Envío desde el buzón dedicado tras el clic | `Dialog` con destinatarios |
| Crear rectificativa | `billing.write` | UI-14 | — |
| Anular (emitida por error) | `billing.void` | Registro de anulación Verifactu; número no reutilizable | Motivo de la lista + passkey |
| Registrar cobro | `finance.write` | UI-18 con la factura preseleccionada | — |

## Estados
Emitida: solo lectura (`WC080`), con "Crear rectificativa". Verifactu rechazada: `Banner` rojo con el error y "Corregir" (subsanación). Borrador con errores: botón "Emitir" deshabilitado y lista de errores.

## Móvil
Ficha de lectura y descarga del PDF; la emisión se permite (con passkey en anulaciones).

## Wireframe
```
Factura · borrador · CVPO · serie CF27-                 [Validar] [Emitir]
Cliente [Cliente Ejemplo S.L. ▾]  NIF B00000000  Idioma ES
┌───────────────────────────┬─────────────┬────┬───────┬──────┬────────┐
│ Producto                  │ Lote        │ Ud.│ Precio│ IVA  │ Base   │
│ Tinto Ejemplo 2025 0,75 L │ L25-T01-B1  │ 12 │ 10,00 │ IVA21│ 120,00 │
└───────────────────────────┴─────────────┴────┴───────┴──────┴────────┘
                         Base 120,00 · IVA 25,20 · Importe total 145,20
                                                    Total a pagar 145,20
```

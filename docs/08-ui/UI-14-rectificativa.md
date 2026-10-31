# UI-14 · Rectificar factura

| | |
|---|---|
| Ruta | `/facturas/:id/rectificar` |
| Objetivo | Crear una rectificativa (por diferencias o por sustitución) de una factura de WineCore o de Holded, con el tipo y la causa correctos |
| Historias | US-FACT-04, US-VENT-05, US-VFT-04 |
| Módulo y permiso | billing · `billing.write` (emitir: `billing.issue`) |
| Patrón | Asistente (Stepper de 3 pasos) |

## Pasos
1. **Causa** (`RadioGroup`): devolución o descuento posterior (`R4`), error fundado en derecho o art. 80.1, 80.2 y 80.6 LIVA (`R1`), concurso (`R2`), crédito incobrable (`R3`). Ayuda contextual con ejemplos.
2. **Modo**: por diferencias (`I`, solo lo que cambia, importes negativos) o por sustitución (`S`, factura completa nueva con importes rectificados).
3. **Líneas**: precargadas desde la original; se editan cantidades y precios; si hay devolución de mercancía, se pide el albarán de devolución (o se marca "sin devolución física").

## Datos (API)
- `GET /api/v1/invoices/{id}` (o factura de Holded: `GET /api/v1/legacy/invoices/{id}`).
- `POST /api/v1/invoices` con `{rectifies: [{invoice_id | legacy_ref}], invoice_type, rectification_kind, lines}` → borrador en la serie de rectificativas (`CR27-`/`PR27-`).
- Emisión como UI-13.

## Validaciones
- Una rectificativa por diferencias no puede dejar la factura original con importe negativo acumulado.
- Por sustitución: `ImporteRectificacion` (base, cuota y recargo de la original) se rellena automáticamente.
- Rectificar una factura de Holded: número y fecha de Holded obligatorios (verifactu.md §14.5).
- Si el error es solo del **registro** Verifactu y no de la factura, la pantalla propone "Subsanación" en lugar de rectificativa (UI-15).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Crear borrador | `billing.write` | Rectificativa en borrador | — |
| Emitir | `billing.issue` | Como UI-13; registro Verifactu con `TipoFactura` R1–R4 y facturas rectificadas | `Dialog` de emisión |

## Móvil
No disponible (aviso "Usa un ordenador").

## Wireframe
```
Rectificar CF27-0012                         Paso 1 de 3 · Causa
( ) Devolución o descuento posterior (R4)
( ) Error en la factura (R1)
( ) Concurso del cliente (R2)   ( ) Crédito incobrable (R3)
                                                   [Siguiente]
```

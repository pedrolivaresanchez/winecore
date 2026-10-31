# 04 · AecocEDI y El Corte Inglés (EDI)

> Versión 1 · 31-10-2026 · Fuentes consultadas el 31-10-2026 (ver §12). Marcas: **HECHO** (fuente) · **SUPUESTO** · **PENDIENTE**.
> Decisión: ADR 006 (computer use asistido hoy; ficha para teclear de respaldo; reevaluar antes de 2028). Hito: **M3**. Pedro pasará el detalle de AECOC más adelante (§12.3 del plan): lo marcado PENDIENTE no bloquea el resto.

## 1. Qué es y cómo se trabaja hoy

| Hecho | Estado | Fuente |
|---|---|---|
| AecocEDI es la herramienta web de AECOC para que las pymes intercambien pedidos, albaranes y facturas por EDI y gestionen catálogo y códigos de barras | HECHO | https://servicios.aecocedi.es/que-es/ |
| Gratis para socios hasta 600 mensajes/año; no socios 192 €/año + IVA hasta 600 | HECHO | https://servicios.aecocedi.es/tarifas/ |
| Acceso solo web: usuario = GLN (13 dígitos, empieza por 84) + contraseña + CAPTCHA según el caso; sin API publicada | HECHO | https://www.aecocedi.es/Account/Login · https://servicios.aecocedi.es/wp-content/uploads/2017/03/Guía-Rápida-AECOC-EDI.pdf |
| "Crear factura" desde un pedido copia los datos del pedido a la factura | HECHO | Guía rápida |
| Las condiciones de uso no prohíben ni permiten expresamente la automatización; prohíben el "consumo masivo" de recursos | HECHO (texto) / PENDIENTE (confirmación de AECOC) | https://servicios.aecocedi.es/condiciones-de-uso/ |
| Volumen estimado de P.O: 60–110 mensajes/año (2–4 pedidos/mes + facturas + avisos de pago) | SUPUESTO | Cálculo interno |
| Avisos por correo: "nuevo pedido", "nueva confirmación de pago", "nuevo texto libre" (sin contenido) | HECHO (interno) | Plan §5.3 |
| Hoy: pedido en AecocEDI → factura en Holded → se **teclea** la factura en AecocEDI para cobrar → salida en SISV → recogida | HECHO (interno) | Traspaso de la administradora |
| ECI no publica guía EDI de proveedores; pistas: ORDERS D96A, DESADV D96A, INVOIC D93A | NO ENCONTRADO / SUPUESTO | https://portalb2beci.elcorteingles.es/es-ES/homologacion/ |
| GS1 España usa D93A para INVOIC, D01B para PRICAT y D96A para el resto | HECHO | https://www.gs1es.org/compartir-estandares-gs1/gs1-eancom/ |
| Plazo legal de pago de ECI (alimentación): 60 días, ampliable a 90 con pacto | HECHO | Cuentas anuales 2025 de ECI (nota 20) |

## 2. Base legal y fechas relevantes

| Norma | Qué implica | Fecha | Fuente |
|---|---|---|---|
| RD 1619/2012 (facturación), art. 10.1.b | El EDI es un medio válido de garantizar autenticidad e integridad de la factura | Vigente | https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696 |
| RD 1007/2023 (Verifactu) | La factura nace en WineCore (SIF) con su registro; lo que se teclea en AecocEDI debe coincidir campo a campo | CVPO 01-01-2027; P.O 01-07-2027 | https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840 |
| Ley 56/2007 art. 2 bis (mod. Ley 18/2022) + **RD 238/2026** + **Orden HAC/1028/2026** (factura electrónica B2B) | Emitir y recibir factura electrónica estructurada (UBL/CII/EDIFACT/Facturae) por plataforma privada conforme o por la **solución pública** de la AEAT (gratuita, UBL); informar estados | ECI: **06-10-2027**; P.O y CVPO (≤ 8 M€): **06-10-2028**; estados P.O (persona física): **06-10-2029** | https://www.boe.es/eli/es/rd/2026/03/25/238 · https://www.boe.es/eli/es/o/2026/10/02/hac1028/con · https://sede.agenciatributaria.gob.es/Sede/iva/factura-electronica/calendario-implantacion.html |
| Ley 56/2007 art. 2 bis.3 bis | El receptor (ECI) no puede imponer plataforma al emisor | Vigente | https://www.boe.es/buscar/act.php?id=BOE-A-2007-22440 |

**Consecuencia**: hasta el 05-10-2028 P.O puede seguir enviando sus facturas a ECI por AecocEDI. Desde el 06-10-2028 la factura legal deberá ser electrónica B2B; si AecocEDI no se acredita como plataforma privada conforme (art. 13 RD 238/2026; **no consta**), WineCore emitirá en UBL por la solución pública (hito M8, `09-roadmap.md`). Además, desde el **06-10-2027** ECI emitirá sus **facturas de cargo/abono** a P.O como factura electrónica: WineCore deberá poder recibirlas (lectura desde la solución pública) — PENDIENTE de confirmar con el asesor (Q-032).

## 3. Flujos

```mermaid
sequenceDiagram
  participant M as Buzón (solo lectura)
  participant W as WineCore
  participant R as Ejecutor local
  participant A as AecocEDI
  participant P as Persona aprobadora
  M-->>W: aviso "nuevo pedido" (vigilante del buzón)
  W->>R: connector_run read_inbox (sin aprobación: solo lectura)
  R->>A: login (GLN + contraseña del llavero; CAPTCHA → persona)
  R->>A: Mis documentos → abrir pedido → captura
  R-->>W: pedido leído (campos §4.1) + evidencia
  W->>W: pedido de venta (canal eci_edi), validaciones
  Note over W: preparación, albarán, factura emitida (Verifactu), salida SISV
  W->>R: connector_run prepare_invoice (abre "Crear factura" y rellena, sin enviar)
  R-->>W: formulario rellenado + comparación con la factura de WineCore
  W->>P: aprobación edi_submission (ve la comparación)
  P-->>W: aprueba con passkey
  W->>R: connector_run submit
  R->>A: "Enviar" + captura de confirmación
  R-->>W: resultado + evidencias
```

## 4. Campo a campo

### 4.1 Pedido recibido (ORDERS) → `regulatory.edi_message.parsed` y `sales.sales_order`

| Campo EANCOM | Tipo | Oblig. | Destino en WineCore | Regla | Ejemplo (sintético) |
|---|---|---|---|---|---|
| `BGM` 1004 nº de pedido | texto ≤ 35 | Sí | `sales_order.customer_order_ref`, `edi_message.document_number`, `external_ref` | Único por cliente; si ya existe → `duplicate` y aviso | `4500012345` |
| `BGM` 1225 función | código | Sí | `parsed.message_function` | 9 original; 5 sustitución → actualizar el pedido en borrador o avisar si confirmado | `9` |
| `DTM+137` fecha del pedido | fecha | Sí | `sales_order.order_date` | AAAAMMDD | `20270115` |
| `DTM+2` entrega solicitada | fecha | No | `sales_order.requested_date` | — | `20270122` |
| `NAD+BY` GLN comprador | 13 díg. | Sí | `party.contact_gln(role='buyer')` | Debe existir; si no → tarea "dar de alta GLN" | `8400000000017` |
| `NAD+SU` GLN proveedor | 13 díg. | Sí | comprobación | = `core.legal_entity.gln` de la entidad que factura a ECI (Q-009) | `8400000000024` |
| `NAD+DP` punto de entrega | 13 díg. | Sí | `sales_order.ship_to.gln` + `party.contact_gln(role='delivery')` | Dirección desde la ficha del GLN | `8400000000031` |
| `NAD+IV` facturar a | 13 díg. | No | `party.contact_gln(role='invoicee')` | — | `8400000000048` |
| Departamento / centro (`RFF`/`NAD`, PENDIENTE) | texto | No | `sales_order.customer_department` | — | `209` |
| `CUX` moneda | código | No | `sales_order.currency` | Debe ser EUR | `EUR` |
| `LIN` GTIN | 13/14 díg. | Sí | `sales_order_line.product_id` vía `catalog.gtin_current` | Si no existe → línea "sin casar" y el pedido queda en borrador | `8400000000505` |
| `PIA:IN` código del comprador | texto | No | `catalog.customer_item_code` | Si llega y no está, se guarda | `209 027-00069` |
| `IMD` descripción | texto | No | `sales_order_line.description` | Si no viene, la del producto | — |
| `QTY+21` cantidad | decimal | Sí | `sales_order_line.quantity` | En unidades de consumo; si viene en cajas (`QTY+59`), multiplicar | `12` |
| `PRI+AAA` / `AAB` precio neto / bruto | decimal | No | `sales_order_line.unit_price` | Si no viene, tarifa; si viene y difiere > 0,5 % de la tarifa → aviso | `7.50` |
| `CNT+2` nº de líneas | entero | No | control | = nº de líneas leídas; si no, error de lectura | `3` |

### 4.2 Factura a ECI (INVOIC D93A) ← `billing.invoice` emitida

Lo que el ejecutor completa en "Crear factura" (o la ficha para teclear) **debe coincidir** con la factura de WineCore. Campos (subconjunto AECOC, guía pública de otro distribuidor como referencia; PENDIENTE confirmar el de ECI):

| Campo EANCOM | Tipo | Oblig. | Origen en WineCore | Regla | Ejemplo |
|---|---|---|---|---|---|
| `BGM+380` nº de factura (381 abono) | texto | Sí | `invoice.number` | Rectificativa → 381 | `PF27-0012` |
| `DTM+137` fecha | fecha | Sí | `invoice.issue_date` | — | `20270118` |
| `PAI` forma de pago | código | Sí | `invoice.payment_method` | transferencia → 42 | `42` |
| `RFF+ON` pedido de ECI | texto | Sí | `sales_order.customer_order_ref` | Obligatorio en facturas a ECI (`WC_EDI_ORDER_REF_REQUIRED`) | `4500012345` |
| `RFF+DQ` albarán | texto | Sí | `delivery_note.number` | — | `PA27-0007` |
| `NAD+II` emisor (GLN, razón social, domicilio, datos registrales) + `RFF+VA` NIF | — | Sí | `core.legal_entity` | NIF con prefijo ES | — |
| `NAD+IV` receptor + `RFF+VA` | — | Sí | `party.contact` ECI + GLN `invoicee` | — | — |
| `RFF+API` centro de coste | texto | Según ECI | `sales_order.customer_cost_center` | PENDIENTE | — |
| `NAD+DP` / `BY` | 13 díg. | Sí | GLN del pedido | — | — |
| `PAT` + `DTM+13` vencimiento | fecha | Sí | `invoice_due.due_date` | — | `20270319` |
| `LIN` GTIN · `PIA:IN` código ECI · `PIA:NB` lote · `IMD` descripción | — | Sí (GTIN) | línea + producto + lote | Lote del vino en `PIA:NB` | — |
| `QTY+47` facturada | decimal | Sí | `invoice_line.quantity` | — | `12` |
| `PRI+AAA` neto · `PRI+AAB` bruto | decimal | Sí | `unit_price`, `unit_price × (1 − dto)` | — | `7.50` |
| `MOA+66` / `MOA+203` importe de línea | decimal | Sí | `line_base` | — | `90.00` |
| `TAX+7+VAT` 21 + `MOA+124` cuota de línea | — | Sí | `tax_code` IVA21 | El impuesto especial del vino es 0: no se informa `ACT` (PENDIENTE confirmar con ECI) | `18.90` |
| `MOA+79` neto · `98` bruto · `125` base · `176` impuestos · `139` total | decimal | Sí | totales de la factura | Deben cuadrar con `invoice.subtotal`, `tax_total`, `total` al céntimo | `90.00/90.00/90.00/18.90/108.90` |

### 4.3 Confirmación de pago (REMADV, SUPUESTO muy probable) → finanzas
| Campo | Destino | Regla |
|---|---|---|
| `BGM+481` nº de aviso | `edi_message.document_number` | Único |
| `DTM+138` fecha de pago | fecha prevista de cobro | Propuesta de cobro con esa fecha |
| `RFF+AEK` nº de orden de pago | `payment.reference` | — |
| `DOC+380` nº de factura · `MOA+9` debido · `MOA+12` remitido | imputación propuesta | Si remitido < debido → diferencia con ajustes |
| `AJT` + `MOA+5` ajustes (rotura, entrega corta, rappel…) | incidencia | Crea tarea "revisar deducción de ECI" con el motivo |
| `MOA+12` total remitido | `finance.payment.amount` (propuesta) | Se confirma con el extracto (M6) o a mano |

### 4.4 Texto libre (GENRAL)
`FTX+ADK` → `edi_message.parsed.text` como `untrusted_text`; se enlaza a pedido o factura si cita su número; crea una tarea humana. Nunca se responde automáticamente.

## 5. Conector (ADR 006 y ADR 009)
- **Modo inicial**: `computer_use` en el ejecutor local. Procedimientos deterministas:
  - `aecocedi-read-documents`: inicia sesión, abre "Mis documentos", lee los documentos nuevos (pedido, aviso de pago, texto), captura y extrae los campos de §4.1/§4.3/§4.4. **Solo lectura**: no requiere aprobación; frecuencia: al llegar un aviso y como mucho un barrido diario (cláusula de "consumo masivo").
  - `aecocedi-prepare-invoice`: abre el pedido → "Crear factura" → rellena número, fecha, cantidades, albarán y lote → **no envía**; devuelve la comparación campo a campo con la factura de WineCore (`diff`), con captura.
  - `aecocedi-submit-invoice`: solo con la aprobación consumida; pulsa "Enviar" y captura la confirmación.
- **CAPTCHA**: si aparece, el ejecutor se detiene (`needs_human`) y avisa; una persona lo resuelve en el equipo del ejecutor. Nunca se intenta saltar.
- **Respaldo manual**: "Ficha para teclear" (PDF/HTML) con todos los campos de §4.2 en el orden del formulario del portal, generada por `api/src/core/regulatory/edi/invoicSheet.ts`.
- **Prohibido**: usar "Editar" sobre una factura ya enviada en AecocEDI. Una corrección se hace con rectificativa en WineCore y se teclea como abono/factura nueva.

## 6. Aprobación humana
`ops.approval_policy.kind = 'edi_submission'`: el aprobador ve la factura de WineCore, la captura del formulario rellenado y la comparación (debe ser "sin diferencias"; si hay diferencias, el botón de aprobar está desactivado con el motivo).

## 7. Evidencias (≥ 6 años, S3 `evidence/edi/`)
Captura del pedido leído y su texto extraído; captura del formulario rellenado + comparación; captura de la confirmación de envío; avisos de pago leídos.

## 8. Reintentos y errores
- Lectura: reintento a los 15 min y a la hora; si falla 3 veces → `needs_human`.
- Envío: **sin reintento automático**. Ante un error o una pantalla inesperada: parar, `check_status` en "Mis documentos" para saber si se envió, y decidir una persona.

## 9. Casos límite
| Caso | Comportamiento |
|---|---|
| Pedido duplicado (mismo nº) | Se marca `duplicate`; no se crea otro pedido |
| Pedido de sustitución (función 5) | Si el pedido está en borrador, se actualiza; si está confirmado, se crea una tarea |
| GTIN desconocido o de otra añada | Línea sin casar; el pedido queda en borrador; `catalog.gtin_current` decide la añada vigente |
| Precio distinto de tarifa | Aviso al confirmar; prevalece lo pactado con ECI (decisión humana) |
| Entrega parcial | Factura por lo servido (`QTY+47` ≤ pedido); el pedido queda parcialmente servido |
| Devolución o rotura deducida en el pago | Se registra el ajuste (`AJT`) y se propone rectificativa si procede (Q-030) |
| ECI cambia de entidad (P.O → CVPO) | Nueva regla D3 por cliente + nuevo GLN/alta en AecocEDI (Q-009) |
| Portal cambia de diseño | Los `assert_text` fallan → `needs_human` → se adapta el procedimiento (R4) |

## 10. Golden files (datos sintéticos)
- `api/test/golden/edi/orders_sintetico.json` (pedido leído) → `sales_order` esperado.
- `api/test/golden/edi/invoic_ficha_PF27-0012.json` y `.html` (ficha para teclear) generados desde una factura sintética; deben coincidir byte a byte.
- `api/test/golden/edi/remadv_sintetico.json` → propuesta de cobro esperada.

## 11. Datos maestros necesarios
GLN de la entidad que factura a ECI (y de CVPO si llega a hacerlo), prefijo GS1; GLN de ECI por función (`party.contact_gln`); código de proveedor ECI (`contact_entity_terms.edi_supplier_code`); GTIN por formato y caja (`catalog.product.gtin`, `gtin_case`, `catalog.gtin_current`); códigos de artículo de ECI (`catalog.customer_item_code`); unidades por caja y cajas por palet (`catalog.format`); condiciones de pago con ECI; credenciales de AecocEDI y del portal B2B **solo** en el llavero del ejecutor.

## 12. Pendientes (no bloquean; Pedro los pasará, §12.3)
Q-009 (entidad que factura a ECI), Q-024 (GTIN, GLN, DESADV/SSCC, credenciales, términos de AecocEDI), Q-032 (factura electrónica B2B: recepción de cargos de ECI desde 06-10-2027 y emisión desde 06-10-2028). Preguntas para AECOC y ECI: automatización permitida, formato de carga de ficheros, mensajes activos y versiones, si "confirmación de pago" es REMADV, si AecocEDI será plataforma conforme al RD 238/2026.

Fuentes (todas consultadas el 31-10-2026): https://servicios.aecocedi.es/que-es/ · https://servicios.aecocedi.es/tarifas/ · https://servicios.aecocedi.es/condiciones-de-uso/ · https://servicios.aecocedi.es/tutoriales/ · https://www.aecocedi.es/Account/Login · https://portalb2beci.elcorteingles.es/es-ES/nuevo-proveedor/ · https://portalb2beci.elcorteingles.es/es-ES/homologacion/ · https://www.gs1es.org/compartir-estandares-gs1/gs1-eancom/ · manuales EANCOM 2002 S4 de GS1 (orders, invoic, remadv, genral) · https://www.boe.es/eli/es/rd/2026/03/25/238 · https://www.boe.es/eli/es/o/2026/10/02/hac1028/con · https://sede.agenciatributaria.gob.es/Sede/iva/factura-electronica/calendario-implantacion.html

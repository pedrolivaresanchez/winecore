# 04 · Modelos de la AEAT y libros registro

> Versión 1 · 31-10-2026 · Marcas: **HECHO** (fuente y fecha) · **SUPUESTO** · **PENDIENTE**.
> Alcance: **WineCore no presenta declaraciones fiscales**. Las presenta el asesor; WineCore le entrega datos cuadrados y trazables (US-MOD-01, US-FACT-11, US-COMP-03). Si algún día se automatiza una presentación, será con aprobación previa (regla dura 0.3) y por el conector regulatorio (ADR 009). Hito: **M6** (exportaciones completas); el libro de emitidas y recibidas sale en **M2**.

## 1. Qué aplica a cada entidad

| Modelo | Qué es | CVPO (sociedad) | P.O (persona física) | Periodo y plazo | WineCore entrega |
|---|---|---|---|---|---|
| **303** | IVA, autoliquidación | Sí | Sí | **Trimestral**: 20 primeros días naturales del mes siguiente; 4.º trimestre, 30 primeros días de enero. Mensual solo si el volumen de operaciones superó 6.010.121,04 € el año anterior. **HECHO** (RD 1624/1992, art. 71.3–71.4, consultado el 31-10-2026) | Desglose de emitidas y recibidas por tipo, recargo, exentas (E2, E5), no sujetas y rectificativas; cuadre con los libros |
| **390** | Resumen anual de IVA | Sí | Sí | Anual, enero (RD 1624/1992, art. 71.7; plazo por orden ministerial: confirmar con el asesor) | Totales anuales del 303 |
| **349** | Operaciones intracomunitarias | Si vende a empresas de la UE | Ídem | Mensual o trimestral según importe (confirmar con el asesor) | Ventas `INTRA_E5` por NIF-IVA y periodo; rectificaciones |
| **347** | Operaciones con terceros > 3.005,06 € | Sí | Sí | Anual, febrero (confirmar) | Totales anuales por contacto (sin las ya declaradas en el 349 ni las que llevan retención) y cobros en efectivo |
| **111** | Retenciones de trabajo y profesionales | Si paga a profesionales con retención (y nóminas, fuera de WineCore) | Ídem | Trimestral | Facturas recibidas con retención de profesionales |
| **115** | Retenciones de arrendamientos | Solo si **paga** alquileres con retención | Ídem | Trimestral | Facturas recibidas de arrendamiento con retención. Las facturas de alquiler que **emiten** CVPO y P.O (H6) las retiene y declara el inquilino |
| **180 / 190** | Resúmenes anuales de 115 / 111 | Según lo anterior | Ídem | Enero | Totales por perceptor |
| **200 / 202** | Impuesto sobre Sociedades y pagos fraccionados | Sí | — | Anual y pagos fraccionados | Exportación contable (M7, Q-022) |
| **130 / 100** | IRPF: pagos fraccionados y renta | — | Sí (estimación directa, SUPUESTO) | Trimestral / anual | Ingresos y gastos de la actividad por trimestre |
| **369** | IVA OSS (ventas a distancia a consumidores de la UE) | Solo si la tienda web vende a consumidores de la UE por encima del umbral | Ídem | Trimestral | Ventas web por país (Q-018) |
| **553** | II.EE.: declaración de operaciones en fábricas de vino | **No** | **No** | — | **HECHO**: no es exigible a quien lleva la contabilidad por SILICIE (FAQ AEAT "establecimiento autorizado como elaborador de vino", consultada el 31-10-2026) |

Los plazos que dicen "confirmar" son la referencia habitual del calendario del contribuyente; el asesor los confirma al configurar los avisos de WineCore (vigilante `regulatory-deadlines`). **PENDIENTE**: Pedro + asesor, 15-12-2026.

## 2. Libros registro de IVA (emitidas y recibidas)

Ninguna de las dos entidades está en el SII (SUPUESTO: volumen < 6 M€ y sin opción voluntaria; confirmar con el asesor). Los libros se llevan con el formato de libros registro que publica la AEAT en su sede (hoja de cálculo o CSV). WineCore exporta:

| Columna | Emitidas: origen | Recibidas: origen |
|---|---|---|
| Ejercicio y periodo | `billing.invoice.issue_date` | `purchasing.supplier_invoice.accounting_date` |
| Fecha de expedición y de operación | `issue_date`, `operation_date` | `issue_date` |
| Serie y número | `number` | `supplier_invoice_number` |
| Tipo de factura | `invoice_type` (F1, R1–R4…) | Tipo del gasto |
| Rectificada (serie, número, fecha) | `billing.invoice_rectification` | Ídem del proveedor |
| NIF / IDOtro y nombre | `customer_snapshot` | `party.contact` del proveedor |
| Clave de operación / régimen | `billing.tax_code.regime_key` | Régimen del gasto |
| Base, tipo, cuota, recargo | `billing.invoice_tax` | `purchasing.supplier_invoice_line` |
| Exenta (causa) / no sujeta | `tax_code.exemption` / `qualification` | — |
| Total factura | Igual que `ImporteTotal` de Verifactu (verifactu.md §5) | Total del proveedor |
| Retención | `withholding_total` | Retención soportada |
| Cobro / pago (criterio de caja: no aplica) | — | — |
| Registro Verifactu (CSV de la AEAT) | `verifactu_record.aeat_csv` | — |

**Cuadres obligatorios antes de exportar**: (1) libro de emitidas = suma de facturas emitidas del periodo; (2) desglose del 303 = suma del libro; (3) facturas de Verifactu aceptadas = facturas del libro (ni más ni menos). Cualquier diferencia bloquea la exportación y se explica en pantalla.

## 3. Exportación para la asesoría

- Un ZIP por entidad y periodo: libros (CSV y XLSX), desglose del 303, listados de 347/349 cuando toque, PDF de facturas emitidas y recibidas, y un resumen firmado con el hash de cada fichero.
- Formato de asiento contable para el histórico y la contabilidad (D7): ver `06-migracion.md` §8.
- Envío: descarga o carpeta compartida del asesor; **nunca** por correo automático sin aprobación (reglas duras 0.4 y 0.5).

## 4. Pendientes

| Tema | Dueño | Fecha |
|---|---|---|
| Plazos exactos y modelos que presenta hoy cada entidad (y quién los presenta) | Pedro + asesor | 15-12-2026 |
| Régimen de IRPF de P.O (estimación directa normal o simplificada) | Pedro + asesor | 15-12-2026 |
| Formato de libros que prefiere la asesoría (AEAT o el de su programa) | Asesor | 15-01-2027 |
| Si la tienda web vende a consumidores de la UE (OSS, modelo 369) | Pedro (Q-018) | 15-02-2027 |

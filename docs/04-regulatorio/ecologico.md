# 04 · Producción ecológica (bodega y viñedo)

> Versión 1 · 31-10-2026 · Fuentes oficiales consultadas el 31-10-2026 (§9; identificadores F01–F64 de las notas de investigación). Marcas: **HECHO** · **SUPUESTO** · **PENDIENTE**.
> Conector: `manual` (informe para el organismo de control; ADR 009). Hito: **M4**. Historias: US-ECO-01/02, US-VIN-01/02, US-BOD-05/11/13.
> Tablas: `vineyard.treatment`, `vineyard.parcel`, `cellar.addition`, `cellar.cleaning_record`, `cellar.analysis_result`, `regulatory.organic_certificate`, `catalog.label_spec`.

## 1. Reglas que afectan a WineCore

| Regla | Estado | Fuente |
|---|---|---|
| El vino ecológico solo usa materia prima ecológica y una **lista cerrada** de prácticas y sustancias; **SO₂ y ácido tartárico están autorizados** | HECHO | Reg. (UE) 2018/848, anexo II, parte VI (reescrita en parte por 2025/405) · Reg. de Ejecución (UE) 2021/1165, anexo V, parte D (modificado por 2025/973) |
| Límites de **SO₂ total** en el momento de la oferta al consumo: **tinto 100 mg/L** y **blanco/rosado 150 mg/L** con azúcar residual < 2 g/L; en el resto, el límite general menos **30 mg/L** (p. ej. tinto 2–5 g/L → 120; blanco/rosado 2–5 g/L → 170) | HECHO (regla) · cifras derivadas SUPUESTO aritmético | 2021/1165, anexo V D, entrada 13 · Reg. Delegado (UE) 2019/934, anexo I B |
| Registro de **todo producto** usado en vinificación y en limpieza o desinfección: fecha, nombre, sustancias activas y lugar | HECHO | 2018/848, anexo II VI 2.3 |
| Limpieza en bodega: medidas, **control de su eficacia** y registro | HECHO | 2018/848, anexo II IV 1.4 b) |
| Lista UE de productos de limpieza para bodegas: **vacía y aplazada al 01-01-2028**; hasta entonces, régimen transitorio (productos autorizados antes que cumplan 648/2004 y 528/2012) | HECHO | 2021/1165, art. 5.4 · Reg. de Ejecución (UE) 2025/2501 |
| **Ácido peracético** en bodega: no se ha encontrado autorización expresa | NO ENCONTRADO → PENDIENTE (organismo de control) | Búsqueda en 2021/1165, 2025/2501, página de insumos y compendio de la Junta |
| Viñedo: registro de fertilizantes y fitosanitarios (con justificación de la **necesidad**), limpieza, parcelas, cosecha e insumos | HECHO | 2018/848, anexo II I 1.9.3–1.12 |
| **Cuaderno de explotación**: desde el **01-01-2027**, registro electrónico en el **CUE** en el plazo de **1 mes** desde cada tratamiento; facturas y documentos, 3 años | HECHO | RD 1311/2012, art. 16 y anexo III (redacción del RD 1039/2025) |
| Comprobar el **certificado ecológico de cada proveedor** | HECHO | 2018/848, art. 35.6 |
| Control **anual** con inspección física (o 24 meses con bajo riesgo), con **control de trazabilidad y de balance de materias**; ≥ 10 % sin aviso | HECHO | 2018/848, art. 38 · Reg. Delegado (UE) 2021/771, art. 1 · Reg. de Ejecución (UE) 2021/279, art. 7 |
| Sospecha de incumplimiento: separar, no vender como ecológico, comprobar e **informar de inmediato** al organismo de control | HECHO | 2018/848, arts. 27–28 |
| Organismos de control en Andalucía: códigos `ES-ECO-0XX-AN` (8 con alcance "vino", lista del MAPA de julio de 2026) | HECHO | Listado MAPA (julio 2026) · página de la Junta (18-09-2026) |
| Plazo de conservación de los registros ecológicos | NO ENCONTRADO en la norma UE → se conservan **6 años** (como el resto de evidencias) y se pregunta al organismo de control | — |

## 2. Registro ecológico → hecho de WineCore

| # | Registro exigido | Hecho que lo alimenta | Campos (origen) |
|---|---|---|---|
| R1 | Fertilizantes y enmiendas | `vineyard.treatment` con tipo fertilizante (o `field_task`) | Fecha, producto, cantidad, cultivo, parcelas |
| R2 | Fitosanitarios | `vineyard.treatment` | Fecha (`applied_on`), parcela (SIGPAC en `vineyard.parcel`), plaga (`target`), aplicador (`operator_name`) y asesor (`advisor_name`), cultivo y variedad, superficie (`treated_area_ha`), producto y nº de registro (`product_name`, `product_registration`), equipo ROMA (`equipment_roma`), dosis y cantidad (`dose`, `dose_unit`), eficacia (`efficacy`), factura (`supplier_invoice_id`), apto en ecológico (`is_organic_approved`) |
| R3 | Limpieza en la explotación | `cellar.cleaning_record` con `location_id` de almacén de campo | Fecha, producto, sustancia activa, lugar |
| R4 | Parcelas, cosecha e insumos | `vineyard.parcel`, `vineyard.harvest`, recepciones | Cantidades cosechadas por parcela; insumos por parcela |
| R5–R6 | Precaución y limpieza en bodega con eficacia | `cellar.operation` `cleaning` + `cellar.cleaning_record` | Fecha, depósito, producto, sustancia activa, cantidad, **comprobación de eficacia**, factura |
| R7 | Separación ecológico / no ecológico | `inventory.lot.is_organic` (todo es ecológico hoy) | Si algún día entra producto no ecológico: bloqueo de mezcla (validación `WC_ECO_MIX`) |
| R9 | Productos enológicos (SO₂, ácido tartárico) | `cellar.addition` | Fecha (de la operación), producto, sustancia activa (del catálogo), lote y depósito, cantidad y dosis, finalidad, factura |
| R10–R12 | Recogida y recepción de uva o vino comprado | Recepción (`reception`, `bulk_reception`) | Fecha y hora, proveedor, documento, comprobación del etiquetado ecológico (casilla obligatoria en la recepción) |
| R13 | Almacenamiento | Recipientes y lotes (`cellar.vessel`, `inventory.lot`) | Identificación y separación de lotes |
| R14 | Certificado de cada proveedor | `regulatory.organic_certificate` (`holder_kind = 'supplier'`) | Organismo, categorías, vigencia y PDF. **Regla**: una recepción ecológica sin certificado vigente en esa fecha no puede crear un lote ecológico (`WC_ECO_CERT_MISSING`) |
| R15 | Trazabilidad | DAG de lotes + albaranes y facturas | Proveedor, destinatario, certificado, lote (US-INV-06) |
| R16 | Balance de materias | Libro físico (`inventory.stock_move`) | kg de uva → L de vino (rendimiento), existencias por depósito, embotellado por formato, salidas y mermas |
| R18 | Declaración del operador | Adjunto en Ajustes → Ecológico | Documento firmado y fecha |
| R19–R20 | Sospechas y medidas de precaución | `core.notification` + incidencia (texto, separación del lote, aviso al organismo) | Registro y fecha del aviso |

## 3. Validaciones (US-ECO-02)

- **SO₂ total**: al confirmar una analítica de un lote ecológico o antes de envasarlo, WineCore compara el SO₂ total con el límite según color y azúcares residuales (tabla versionada en `settings` `organic.so2_limits`). Si lo supera: bloqueo para envasar como ecológico; el lote puede envasarse como no ecológico tras una aprobación `inventory_adjustment`, con la incidencia registrada.
- **Sustancia no autorizada**: un producto enológico solo puede añadirse a un lote ecológico si su ficha (`catalog.product` `kind = 'oenological_product'`) está marcada como apta en ecológico con la entrada de la lista UE (2021/1165, anexo V D).
- **Proveedor sin certificado vigente**: bloqueo del lote ecológico (R14).
- **Cuaderno digital**: aviso a los 20 días de un tratamiento sin `cue_recorded_at` (desde el 01-01-2027).

## 4. Informe para el organismo de control (US-ECO-01)

PDF y hoja de cálculo por campaña o año con: certificado propio y de proveedores; cuaderno de tratamientos; productos enológicos usados por lote; limpiezas con eficacia; balance de materias (uva → vino → botellas → salidas, con mermas y rendimientos); trazabilidad de una muestra de lotes; analíticas de SO₂ de cada lote envasado; etiquetas aprobadas (con código del organismo y origen). Aprobación previa a entregarlo (`organic_report`); WineCore **no** lo envía: lo entrega una persona en la inspección.

## 5. Etiqueta ecológica (resumen; detalle en `etiquetado.md`)

Si aparece "ecológico/eco/bio": código del organismo de control (`ES-ECO-0XX-AN`), **logotipo UE** (mínimo 9 × 13,5 mm) y origen "**Agricultura España**" (o "Agricultura UE") en el mismo campo visual (2018/848, arts. 30–33 y anexo V). Datos en `catalog.label_spec.organic_control_code` y `organic_origin`, que salen del certificado propio vigente.

## 6. Casos límite

1. Uva de un proveedor cuyo certificado caduca durante la vendimia: vale la vigencia en la **fecha de recepción**.
2. Cambio de organismo de control: nuevo certificado propio; las etiquetas con el código anterior se retiran al agotar existencias (PENDIENTE: confirmar con el nuevo organismo).
3. Lote ecológico que supera el SO₂ ecológico pero no el general: puede venderse como vino convencional, nunca como ecológico.
4. Embotellado subcontratado (embotelladora móvil): exige notificación o declaración de responsabilidad (2018/848, art. 34.3) → **PENDIENTE** si se usa.

## 7. Pendientes

| Tema | Dueño | Fecha |
|---|---|---|
| Organismo de control de P.O (y de CVPO si está certificada) y certificado vigente | Pedro | 15-02-2027 |
| Ácido peracético en bodega: confirmación del organismo de control | Pedro | 15-02-2027 |
| Plazo de conservación de registros que exige el organismo | Pedro | 15-02-2027 |
| Si se usa embotellado subcontratado | Pedro | 15-02-2027 |

## 8. Relación con otros registros

SISV registra la acidificación (práctica C6 01) pero no el SO₂ (sisv.md §4.3); el cuaderno de explotación (CUE) recibe los tratamientos; SILICIE no ve nada de esto.

## 9. Fuentes (consultadas el 31-10-2026)

Reg. (UE) 2018/848 consolidado 25-03-2025 (CELEX 02018R0848-20250325) · Reg. de Ejecución (UE) 2021/1165 consolidado 01-01-2026 · Reg. Delegado (UE) 2025/405 · Reg. de Ejecución (UE) 2025/973 y 2025/2501 · Reg. Delegado (UE) 2021/1691, 2020/464 y 2021/771 · Reg. de Ejecución (UE) 2021/279 · Reg. Delegado (UE) 2019/934 consolidado 29-12-2024 · RD 1311/2012 consolidado y RD 1039/2025 (BOE-A-2025-23421) · RD 833/2014 (REGOE) · MAPA: autoridades y organismos de control ECO (julio 2026), PNCOCA 2026-2030 · Junta de Andalucía: organismos de control autorizados (18-09-2026), insumos utilizables, modelo de cuaderno de explotación v9 (10-03-2026), compendio de documentación oficial (23-07-2025).

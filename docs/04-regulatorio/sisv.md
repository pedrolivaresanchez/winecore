# 04 · SISV (libros de registro vitivinícolas de la Junta de Andalucía)

> Versión 1 · 31-10-2026 · Fuentes consultadas el 31-10-2026 (§11). Marcas: **HECHO** · **SUPUESTO** · **PENDIENTE**.
> Decisión de conector: ADR 005 (*computer use* sobre "Importar libro" de la aplicación web con el fichero que genera WineCore). Hito: **M3**. Historias: US-SISV-01…03, US-SIL-05.
> Tablas: `regulatory.sisv_entry`, `regulatory.submission`, `regulatory.reconciliation_run` (`02-ddl/0012`).

## 1. Qué es y qué nos aplica

| Hecho | Estado | Fuente |
|---|---|---|
| Las bodegas llevan **libros de registro** de entradas y salidas, procesos de elaboración, prácticas enológicas y envasado (registros del Reg. Delegado (UE) 2018/273, arts. 28–30) | HECHO | Reg. Delegado (UE) 2018/273 · Orden de 14-11-2012 de la Consejería de Agricultura (Andalucía) |
| En Andalucía se pueden llevar en el sistema informático **SISV**; la presentación telemática de los registros se hace **dentro de los diez primeros días naturales de cada mes**, por las operaciones del mes anterior | HECHO | Orden de 14-11-2012, art. 26.4, en la redacción de la Orden de 28-08-2015 |
| Justificantes admitidos: documentos de acompañamiento para entradas y salidas; para las manipulaciones, **certificación firmada por el enólogo** o técnico responsable | HECHO | Orden de 14-11-2012, art. 26.4 |
| SISV es una aplicación web (`www.juntadeandalucia.es/agriculturaypesca/sisv`); la bodega solicita acceso para una persona física y se entra con **certificado digital** | HECHO | Presentación de SISV al sector (Junta, 09-07-2013) · manual de usuario de SISV |
| SISV permite **importar libros desde ficheros de texto** con la especificación oficial ("Importar libro": se carga el fichero, queda "Pendiente" y se pulsa "Importar fichero") | HECHO | Manual de usuario de SISV, apartado "Importar libro" |
| El fichero es de **ancho fijo**, versión de modelo **02**, un tipo de registro por libro (§4) | HECHO | Especificación del fichero de comunicación (hojas LIBRO, VINO, IGP, DOP, VARIETAL, ELABORACION, PRACTICA, MOVIMIENTOS, ENVASADO, ENT SAL ENVASADO) |
| Indicar **variedad o añada** en la etiqueta exige autorización previa de la Junta para cada vino | HECHO | Orden de 14-11-2012, art. 33 (redacción de 2015) |
| Hoy los ficheros los genera Bacosoft y la administradora los importa en SISV antes del día 10 | HECHO interno | Traspaso de la administradora (Q-012) |
| La Junta ofrece una API REST para el **DAT** (documento de acompañamiento al transporte de productos agrarios, p. ej. uva), con acceso "premium" y "gold" por API Manager | HECHO | Manual del integrador DAT v2500 (22-12-2021) · relevante para la recepción de uva (US-BOD-08), no para SISV |

## 2. Calendario

| Qué | Vence | Notas |
|---|---|---|
| Libros del mes M | Día **10** del mes M+1 (naturales: si cae en festivo no se traslada, SUPUESTO; se trabaja con día 7 como objetivo interno) | Aviso a 5, 2 y 0 días |
| Primer mes en WineCore | Enero de 2027 → **10-02-2027** | Diciembre de 2026 lo presenta el proceso actual |

## 3. Flujo

1. Cada hecho de bodega o de salida genera sus anotaciones `regulatory.sisv_entry` al confirmarse (libro, fecha, dirección, campos).
2. El día 1 de cada mes, el job `sisv-prepare` agrupa el mes anterior por libro, valida y genera **un fichero por libro** (más el registro `LIBRO` de cabecera) y la certificación del enólogo para las manipulaciones.
3. Cuadre SISV ↔ SILICIE del mes (silicie.md §10). Si hay diferencias sin explicar, la aprobación se bloquea.
4. Aprobación en la bandeja (hash del contenido).
5. El ejecutor local entra en SISV con el certificado, carga cada fichero, pulsa "Importar fichero", descarga el resultado y lo sube como evidencia.
6. Las anotaciones pasan a `recorded` (o `rejected` con el error de la línea).

## 4. Campo a campo (modelo de intercambio v02, ancho fijo)

Reglas comunes: campos alfanuméricos rellenos con espacios a la derecha; numéricos opcionales rellenos con ceros; fechas `AAAAMMDD` (8); cantidades con formato `dddddddddddddddddddd.dddd`; grados `ddd.dd`. Todos los registros empiezan por: tipo de registro (9) · versión `02` · CIF de la bodega (10) · matrícula RIA de la instalación (8, `PP/NNNNN`).

| Origen común | Campo | Origen en WineCore |
|---|---|---|
| CIF de la bodega | 3 | `core.legal_entity.tax_id` de P.O |
| Matrícula RIA | 4 | `inventory.tax_warehouse` → ajuste `sisv.installation_ria` (Q-012) → `sisv_entry.installation_ria` |
| Entrada/Salida | 5 | `sisv_entry.direction` |
| Borrada | 6 | `N`; `S` solo en la línea que anula una anterior (`annuls_entry_id`) |
| Fecha Registro | 7 | `sisv_entry.entry_date` |
| Tipo Documento (C1) | 8 | 01 albarán · 02 factura · **03 e-DA** · 06 otros (documento de acompañamiento vitivinícola) |
| Número Documento | 10 | Nº de albarán, factura o ARC |

### 4.1 Libros de entradas y salidas de vino a granel: `VINO` (sin IG), `IGP`, `DOP`, `VARIETAL`

El libro depende de la categoría del vino (`catalog.wine.category`: `wine` → VINO o VARIETAL si lleva variedad autorizada, `pgi_wine` → IGP, `pdo_wine` → DOP).

| Campo | Origen |
|---|---|
| Denominación (IGP/DOP) | `catalog.wine.pdo_pgi_name` |
| Procedencia / Destino (200) | Nombre y dirección del proveedor o cliente (`party.contact`), o "Proceso <nº>" en movimientos internos |
| Zona | `CIII.b` (zona vitícola de Jaén; emcs.md §1) |
| Identificación envases | Códigos SISV de los depósitos (`cellar.vessel.sisv_code`, Q-020) |
| Año cosecha · Variedad (C4) · Otra variedad | `inventory.lot.vintage` · variedad principal del lote (DAG de parcelas) → tabla C4 (p. ej. 14 Jaén Tinto, 24 Tempranillo, 23 Syrah; `99` + texto si no está) |
| Designación (C3) | 01 uva fresca · 02 mosto · 03 vino · 05 vino nuevo en fermentación · 20 orujo · 21 lías |
| Cantidad blanco / tinto-rosado | Litros (o kg para uva) según `catalog.wine.color` del lote |
| Graduación adquirida / total | Última analítica del lote (grado) |
| Índice refractométrico / masa volúmica + unidad | Solo uva y mosto: lectura de la recepción (`cellar.fermentation_reading` o analítica de entrada) |
| Observaciones (1000) | Motivo de mermas, nº de operación de WineCore, notas |

### 4.2 `ELABORA` — procesos de elaboración (C5)

Solo los procesos de la lista C5 (aumento de grado, edulcoración, **mezcla** (03), destilación, espumosos…). En esta bodega el único previsto es la **mezcla** (ensamblaje, `blend`): partida (envases, designación, color, volumen, grados), incorporado (ídem + documento comercial, cantidad, unidad 5 litros), variación de volumen, fecha de salida, envases y volumen del producto final y grados. Origen: `cellar.operation` `blend` con sus líneas de entrada (partida e incorporados) y salida (producto final).

### 4.3 `PRACTICA` — prácticas enológicas (C6) y `PROCPRACT` — movimientos de productos

| Hecho | Libro | Datos |
|---|---|---|
| Adición de ácido tartárico para acidificar (`cellar.addition`) | `PRACTICA`, designación C6 **01 acidificación**, producto **61 ácido L-tartárico** | Partida (envases, volumen, acidez inicial), cantidad total y dosis, documento comercial (factura de compra del ácido), producto final (volumen, acidez total en tartárico). Acidez de la analítica antes y después |
| Compra y consumo de ácido tartárico | `PROCPRACT` (E compra con factura y proveedor; S consumo con nº de práctica de destino) | Cantidad en el campo 21 (ácido tartárico), lote del producto, existencias reales tras el movimiento |
| Adición de SO₂ | **No** va a SISV (no es una práctica de la lista C6); sí al cuaderno ecológico | — |
| Trozos de madera de roble (si algún día se usan) | `PRACTICA` C6 06 | — |

### 4.4 `ENVASADO` y `ENTSALENV`

| Hecho | Libro | Datos |
|---|---|---|
| Envasado (`bottling`) | Granel: salida (S) del libro VINO/IGP/DOP con destino "Envasado <nº>". Envasado: **entrada (E)** en `ENVASADO` | Identificación del envase, denominación de venta (`catalog.product.name`), nº de lote (`inventory.lot.code`), variedad, añada, otras menciones, nº de botellas u otros envases, capacidad unitaria, cantidad total |
| Venta de vino envasado propio | `ENVASADO` **salida (S)** con el documento (albarán/factura/e-DA) | Mismos datos del producto y lote; destino |
| Compra de vino envasado a otro embotellador | `ENTSALENV` (E) | Proveedor (razón social, dirección, país, provincia, municipio), nº de embotellador |

### 4.5 Mermas y destrucciones

No hay un libro propio en el fichero: se anotan como **salida (S)** del libro donde está el producto con documento 06 "otros", destino "Merma" o "Destrucción" y la explicación en observaciones (SUPUESTO: validar con la administradora y con un fichero real de Bacosoft antes de M3).

## 5. Reglas de generación (resumen)

| `op_type` / documento | Anotaciones SISV |
|---|---|
| `reception` (uva) | VINO/IGP/DOP · E · designación 01 · kg · procedencia = viticultor o "propia" · documento DAT o albarán |
| `crushing_pressing` | Libro de la categoría: S uva (01) y E mosto (02) |
| `fermentation_end` | S mosto (02 o 05) y E vino (03) |
| `racking` | Ninguna si no hay merma; con merma, S de la merma (§4.5) |
| `blend` | `ELABORA` código 03 mezcla (+ cambio de libro si cambia la categoría) |
| `addition` (ácido tartárico) | `PRACTICA` 01 + `PROCPRACT` S |
| `bottling` | S granel + E `ENVASADO` |
| Albarán o factura de venta (salida física) | S en `ENVASADO` (envasado) o en el libro de granel; documento = albarán o ARC |
| e-DA aceptado | El número de documento de la salida es el **ARC** (tipo 03) (US-SISV-03) |
| Compra de producto enológico | `PROCPRACT` E |
| Rectificación de una operación | Línea con "Borrada = S" de la anotación anterior + la nueva |

## 6. Aprobación, evidencias y reintentos

- Aprobación mensual (`approval_policy` `regulatory_submission`), con el cuadre adjunto.
- Evidencias (6 años + el corriente): ficheros enviados, resultado de la importación, capturas, certificación del enólogo firmada.
- Si una importación queda "Pendiente" sin finalizar, el ejecutor la elimina antes de reintentar (la aplicación lo permite) para no duplicar.

## 7. Casos límite

1. Ensamblaje entre categorías (p. ej. vino sin IG con vino IGP): el resultado pierde la categoría superior; el cambio de libro se anota como salida de un libro y entrada en otro.
2. Botellas sin etiquetar: ya están en `ENVASADO` desde el envasado; el etiquetado no genera anotación.
3. Devoluciones de clientes: entrada en `ENVASADO` (E) solo si vuelve a la bodega (Q-030).
4. Corrección de un mes ya importado: anotación con "Borrada = S" + nueva, en el mes en curso, con observaciones.

## 8. Golden files

`api/test/golden/sisv/`: un fichero por libro con los hechos sintéticos de un mes completo (recepción, prensado, fin de fermentación, ensamblaje, acidificación, envasado, ventas con e-DA). **Validación adicional** antes de M3: comparar, para el mismo mes real, los ficheros de WineCore con los que generó Bacosoft (solo en `data/`, nunca en el repo).

## 9. Pendientes

| Tema | Dueño | Fecha |
|---|---|---|
| Matrícula RIA, códigos SISV de los depósitos y acceso actual a SISV (persona y certificado) | Pedro + administradora (Q-012, Q-020) | 15-02-2027 |
| Un fichero real de Bacosoft por libro (en `data/`) para validar la generación | Pedro | 15-02-2027 |
| Cómo se anotan hoy mermas y destrucciones (§4.5) | Administradora | 15-02-2027 |
| Autorizaciones de variedad y añada de cada vino (art. 33) | Pedro | 15-02-2027 |

## 10. Relación con otros registros

- SILICIE: mismas operaciones con otra granularidad (silicie.md §5); cuadre mensual.
- INFOVI: declaraciones de existencias de agosto y diciembre y la de cosecha (`infovi.md`).
- Cuaderno de explotación y ecológico: tratamientos de viñedo y adiciones (`ecologico.md`).

## 11. Fuentes (consultadas el 31-10-2026)

Reg. Delegado (UE) 2018/273 y Reg. de Ejecución (UE) 2018/274 · Orden de 14-11-2012 de la Consejería de Agricultura, Pesca y Medio Ambiente y su modificación por la Orden de 28-08-2015 (BOJA) · Especificación del fichero de comunicación de SISV (modelo v02, hojas por libro y tablas C0–C8) · Manual de usuario y presentación de SISV (Junta de Andalucía) · Manual del integrador DAT v2500 (Junta, 22-12-2021) · Reg. (UE) 1308/2013, anexo VII, apéndice 1.

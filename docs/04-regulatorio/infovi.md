# 04 · INFOVI y declaración de cosecha

> Versión 1 · 31-10-2026 · Fuente: Real Decreto 739/2015, de 31 de julio, sobre declaraciones obligatorias en el sector vitivinícola (BOE-A-2015-8647, texto consolidado consultado el 31-10-2026: https://www.boe.es/eli/es/rd/2015/07/31/739/con). Marcas: **HECHO** · **SUPUESTO** · **PENDIENTE**.
> Conector: `manual` asistido (WineCore prepara los datos y una ficha para teclear) hasta valorar *computer use*; ADR 009. Hito: **M3**. Historia: US-INFOVI-01.

## 1. Qué nos aplica

| Obligación | Plazo | Norma | Quién |
|---|---|---|---|
| **Declaración de cosecha** (cosecheros), en la aplicación de la comunidad autónoma | Hasta el **10 de diciembre** de cada año | RD 739/2015, art. 3.2 | P.O (viticultor), salvo exención del art. 3.1 |
| **Declaraciones INFOVI** de productores con producción media **inferior a 1.000 hl**: una por instalación en **diciembre y agosto** (modelo del anexo III b), aunque todos los datos sean cero | Hasta el **día 20** de diciembre y de agosto | RD 739/2015, art. 5.3 y 5.6 | P.O (instalación de la bodega) |
| Datos de proveedores y justificantes de compraventa (anexos IV a y IV b), referidos al **30 de noviembre** | Entre el **1 y el 10 de diciembre**, ante la comunidad autónoma | RD 739/2015, art. 6.2 | P.O |
| Producción media | Media de las **cuatro campañas anteriores** declaradas | RD 739/2015, art. 5.4 | — |
| Inscripción en el REOVI | Previa | RD 739/2015, art. 4 | Hecho; número PENDIENTE (Q-031) |

Producción de la bodega < 1.000 hl (HECHO interno, `00-triaje.md`) → régimen semestral del art. 5.3. Si algún año la media de cuatro campañas llegara a 1.000 hl, pasaría a declaración **mensual** (art. 5.2): WineCore calcula la media cada campaña y avisa.

## 2. De dónde salen los datos

| Dato de la declaración | Origen en WineCore |
|---|---|
| Existencias de vino y mosto por instalación, color y categoría (con/sin DOP/IGP, varietal) a la fecha de corte | `inventory.stock_at()` por lote y `catalog.wine` (color, categoría), solo propietario P.O |
| Producción de la campaña (vino y mosto) | Operaciones `fermentation_end` y `crushing_pressing` de la campaña (1 de agosto – 31 de julio) |
| Entradas y salidas del periodo | Libros SISV del periodo (sisv.md) |
| Cosecha por parcela (declaración de cosecha): superficie, variedad, kg, destino | `vineyard.parcel`, `vineyard.parcel_variety`, vendimias (`vineyard.harvest`) y recepciones (`cellar.operation` `reception`) |
| Proveedores de uva y justificantes (anexos IV) | Recepciones de uva comprada con su documento (DAT) y factura de compra |

## 3. Proceso

1. Vigilante `regulatory-deadlines`: avisos a 30, 7 y 1 días de cada plazo (10-12, 20-12, 20-08; 1–10-12 para anexos IV).
2. El job `infovi-prepare` genera la ficha (PDF y tabla) con los datos del §2 y su cuadre con SISV y con el aforo más cercano.
3. Aprobación en la bandeja (`regulatory_submission`).
4. Presentación: hoy la teclea una persona en la aplicación del Ministerio (INFOVI) y en la de la Junta (cosecha); WineCore guarda el justificante como evidencia. *Computer use* se valorará tras la primera campaña (§12.1).

## 4. Pendientes

| Tema | Dueño | Fecha |
|---|---|---|
| Números REOVI/NIDPB, acceso a INFOVI y quién presenta hoy | Pedro + administradora (Q-031) | 15-02-2027 |
| Modelo actual del anexo III b (columnas exactas de la aplicación) | Equipo, con una declaración real anonimizada | Antes del 20-08-2027 |

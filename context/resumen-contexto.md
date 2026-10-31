# Resumen de contexto (anonimizado)

> Conocimiento de dominio extraído de la reunión de requisitos (31-10-2026, ~66 min), del traspaso de la administradora saliente (correos jul-2025 → oct-2026), del informe consolidado y de la especificación previa de CVBOT. Personas por su rol. Las marcas `[hh:mm:ss]` remiten a la transcripción original (privada, en `data/context-raw/`).
> Roles: **Pedro** = dueño de producto (Hablante 1). **Titular de P.O** = bodeguero y enólogo, autónomo (Hablante 2). **Administradora** = persona que deja la empresa.

## 1. Entidades y canales

- **P.O** (persona física, autónomo): bodega productora; fábrica de vino a efectos de Impuestos Especiales; lleva los libros en SISV (Junta de Andalucía) y presenta SILICIE (AEAT). Factura vino a CVPO y a algunos clientes directos; es quien está dado de alta como proveedor de El Corte Inglés [01:05:39] (contradicción con otras fuentes: ver `docs/00-triaje.md` C-04).
- **CVPO** (S.L., comercializadora): compra a P.O con tarifa de distribuidor con descuento (60 % en 2026; 80 % antes), vende a distribuidores, restaurantes, exportación, instituciones y web [01:01:00]–[01:03:39]. Tendrá almacén y stock propios [01:03:39].
- **Tarifas**: cliente final, distribuidor y tienda [01:01:00].
- **Canales**: distribuidores nacionales y extranjeros (Reino Unido vía una plataforma de pedidos del importador; Dinamarca; Austria; Alemania), restaurantes y sumilleres, El Corte Inglés por EDI, tienda web (nueva, con Stripe, proyecto aparte), ferias y mercados, tienda de la bodega.
- **Logística**: paquetería (Nacex, con dos cuentas: P.O y CVPO; DHL en alta para P.O), operadores con stock (TFRP en consigna, Ecovitis para BIB, transitario en Valencia para exportación), stock en Valencia.

## 2. Proceso de bodega (de la parcela a la botella)

1. **Viñedo** [00:06:28]–[00:15:04]: parcelas identificadas por SIGPAC (polígono, parcela) e inscritas en el Registro Vitícola, con superficie y variedad. ~2 ha propias (por debajo del umbral que obliga a más documentación de campo). Certificación ecológica con inspección anual: el certificador pide los **tratamientos** (fecha, operario, producto certificado, método) y la **factura** del producto. Las labores (poda, desbroce, laboreo) se apuntan hoy en una libreta para comparar añadas.
2. **Control de maduración** [00:15:14]–[00:18:22]: cata en campo (pulpa, pepitas, hollejo), fotos, observaciones por voz, previsión meteorológica y disponibilidad de personal para decidir la fecha de vendimia; análisis de laboratorio opcionales.
3. **Recepción de uva** [00:07:18]–[00:08:30]: en cajas de ~20 kg o en contenedores; se pesa o se estima; la uva comprada viene con un **documento de acompañamiento** que emite el productor. La uva no lleva e-DA (no es producto sujeto a II.EE.). Se anotan los kg en el libro de la Junta. A cada partida de uva se le asigna un **lote** [00:48:33].
4. **Elaboración** [00:08:30]–[00:12:34]: blanco (despalillado, prensado, mosto a depósito), tinto (despalillado, encubado con hollejos, maceración, a veces maceración en frío) y blanco vinificado en tinto. Se anota en el libro: prensado (fecha, litros de mosto, depósito de destino), adiciones de productos (SO2, ácido tartárico: 1–2 g/L de tartárico), entradas y salidas uva → mosto → vino con **mermas** en cada paso; mermas reglamentarias por proceso más mermas manuales justificadas [00:10:50]–[00:11:16].
5. **Depósitos** [00:11:16]: "Inox 1" a "Inox 32" solo almacenamiento; "Inox B1" a "B7" vinificadores con camisa de frío; capacidades de 4.000, 5.000 y 10.000 L, entre otras. Además barricas, damajuanas de cristal (a la intemperie) y jaulones de botellas sin etiquetar. Hace falta un plano de la bodega.
6. **Controles de fermentación** [00:19:40]–[00:21:23]: densidad y temperatura dos veces al día (mañana y tarde) para ver la cinética; gráficas de la relación densidad/tiempo.
7. **Fermentación maloláctica** [00:26:23]–[00:30:24]: espontánea; todos los vinos la hacen. Tras la FML, **análisis completo en laboratorio externo** ("pack FML" + grado, glucosa+fructosa y acidez total), además de análisis sensorial.
8. **Filtración de desbaste** (placas de celulosa 00), corrección de SO2 según pH, grado, azúcares y acidez volátil [00:30:24]–[00:32:54].
9. **Estabilización natural en invierno** y **primer trasiego** en primavera [00:32:54]–[00:34:00]; limpieza de depósitos con ácido peracético [00:34:00].
10. **Destino del vino** [00:35:12]–[00:37:31]: se decide la referencia (p. ej. "Entredicho") o una colección nueva; crianza en depósito, barrica o damajuana; trazabilidad de decisiones para poder repetir un vino.
11. **Ensamblaje** [00:38:24]–[00:40:59]: cata a ciegas durante 2–3 días, fórmula en mililitros por muestra → porcentajes → litros por depósito; trasiego de cada componente al depósito de mezcla; nuevo análisis de la mezcla. El ensamblaje crea un **lote nuevo** que hereda de los lotes de origen (genealogía) [00:48:33]. Los vinos de **parcela única** (p. ej. "Muscat Blanda Argila") mantienen un solo origen [00:49:37].
12. **Envasado** [00:40:59]–[00:45:15]: filtración intermedia (V07) y, si procede, filtración amicróbica (V13); corrección final de SO2; embotelladora manual de 4 caños; tapón de aglomerado o corcho natural según gama; botellas de 0,25 / 0,5 / 0,75 / 1,5 L (Magnum); jaulones de ~600 botellas; cápsula o cera; etiquetado; **cajas de 6**; **palet americano de 16 cajas por fila y 112 cajas (672 botellas)**; el palet europeo lleva menos. El envasado genera mermas que se anotan [00:45:55].
13. **Después del envasado** [00:47:19]: mermas por roturas, destrucción de un vino defectuoso; cada movimiento lleva **número de albarán o de movimiento**; hay que saber en todo momento dónde está cada vino y en qué estado (depósito, barrica, damajuana, jaulón sin etiquetar, botella etiquetada, caja, palet, almacén externo).
14. **Inspecciones** [00:51:51]–[00:53:20]: II.EE., agricultura ecológica y sanidad. La inspección de II.EE. puede **aforar toda la bodega sin aviso**; una diferencia fuera de tolerancia acaba en sanción. Hace falta: existencias exactas por ubicación y estado al momento, y la **trazabilidad de un lote** (de la botella a la parcela) explicable rápido, idealmente preguntando a un asistente.
15. **Post-venta / conocimiento de añadas** [00:54:21]: notas de cata años después (restaurante, copa, evolución), vinculadas a lote y añada; módulo aparte [00:55:15].

## 3. Comercial y facturación

- Presupuesto (no siempre) → **albarán (siempre)** → factura [00:49:37]. Las líneas llevan tipo, número, nombre del vino, **lote** y cantidad [00:50:42].
- **"El albarán no descuenta stock; lo descuenta la factura"** [00:50:42] → decisión D2 del plan (stock físico por albarán, fiscal por factura).
- Exportación: documentación por país (EORI, etc.) también en la factura [00:50:42].
- Gastos: escanear o fotografiar facturas de proveedor y registrarlas [00:55:42].
- Cobros: saber qué está cobrado, pendiente o pagado a cuenta; remesas a plazo para algunos clientes; alertas de impago; aplicar transferencias a facturas automáticamente; envío automático de facturas con registro de "enviada" [00:57:13] (ver reglas de envío en `docs/00-triaje.md` C-17).
- Regímenes: algunas ventas en **régimen suspensivo** de II.EE. y sin IVA español; la mayoría, ventas nacionales con IVA [00:58:23].
- **Intercompañía** [01:01:00]–[01:03:39]: CVPO vende y P.O le factura lo vendido (hoy mensual) con tarifa de distribuidor y descuento, sin vender bajo coste. Idea: albarán P.O → CVPO por cada venta de CVPO y factura mensual.

## 4. Reglas operativas de la administración (traspaso, correos jul-2025 → oct-2026)

| Regla | Fuente (mes del correo) |
|---|---|
| SISV y SILICIE "tienen que ser lo mismo" en salidas y envasados | ago-2026 |
| Los **trasiegos internos no van a SILICIE**, pero sí a SISV y a la bodega | ago-2026; oct-2026 |
| Los **envasados sí van a SILICIE**, con sus mermas (ej.: ~150 L sobre ~5.000 L) | oct-2026 |
| **"La barrera es la fecha del último día que facturamos"**: lo enviado con albarán a un operador logístico se declara cuando se factura, con esa fecha | ago-2026; oct-2026 |
| Las salidas con e-DA llevan el **número de e-DA/ARC** en SISV | oct-2026 |
| Destrucciones en SILICIE como "mermas de almacenamiento" | dic-2025 |
| SILICIE: trabajar en Excel y exportar a CSV al final; alcohol con 3 decimales; fechas sin saltos; revisar saldos: **nunca saldo negativo** | dic-2025; ago-2026 |
| SISV: tres libros (Varietal, Vinos envasados, Envasado); depósitos que quedan a 0 tras embotellar; cierre y apertura de libros | jul-2025; ago-2025; oct-2026 |
| Facturas: un **borrador no es válido** (ni se envía ni va a la gestoría); al aprobar hay que fijar el número correcto de la serie | sep-2026; oct-2026 |
| Factura P.O → CVPO: recoge las ventas del periodo, con la tarifa vigente y el descuento; se registra también como gasto en CVPO | sep-2026 |
| Abonos por muestras comerciales; asociar en SISV las salidas a la factura correspondiente | sep-2026 |
| El Corte Inglés: pedido en AecocEDI → factura → **teclear la factura en AecocEDI para cobrar** → dar de baja (salida) en SISV → avisar al transportista | ago–sep-2026 |
| EMCS: requiere el certificado en el navegador; datos de destinatario, productos y lotes; se enlaza el ARC en SISV; el transitario pide factura comercial + ARC + Incoterm | oct-2026 |
| Paquetería: recogida por correo con datos del destinatario y albarán; factura aprobada en el bulto; partes de rotura al seguro (rechazos por embalaje insuficiente) | ago–sep-2026 |
| Pagos a proveedores: Pedro da el visto bueno; la transferencia se hace con claves que él facilita en el momento | sep-2026 |
| Gestoría: facturas aprobadas cada trimestre; revisión del modelo 347 | feb-2026 |
| **Seguridad**: hubo credenciales de un portal reenviadas en claro por correo; hay que rotar todas las contraseñas que conocía la administradora y revocar su acceso al certificado | sep-2026 |

## 5. Lo que la administradora dejó abierto (genérico)

Confirmaciones de pedido de exportación, un e-DA pendiente con su anotación en SISV/SILICIE, cierre de SILICIE 2026 (un embotellado sin fecha, salidas pendientes de envasado, trasiegos de cuadre), una venta a la UE en espera de autorización, la factura intercompañía del stock en un operador logístico, una factura a un cliente institucional y documentación para el transitario. **Riesgo**: el Excel maestro de movimientos y aforos parece estar en su equipo; hay que recuperarlo antes de su salida.

## 6. Herramientas actuales

Holded (dos empresas, más una tercera fuera de alcance), Shopify (impagado desde octubre de 2026; datos exportados), Microsoft 365 (correo) y OneDrive (carpetas de depósitos y aforo), portales AEAT (SILICIE, EMCS) con certificado, SISV (Junta), AecocEDI y catálogo de AECOC, webs de paquetería, banca online, Excel de stock compartido.

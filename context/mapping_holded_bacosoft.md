# Mapeo de funcionalidades Holded / Bacosoft → WineCore

Fuentes públicas: holded.com (módulos de Facturación, Inventario, Compras, Contabilidad, Tesorería, CRM, Proyectos, Equipo/RR. HH. e Impuestos) y developers.holded.com (API REST: invoicing, accounting, CRM, projects, team). Bacosoft: bacosoft.com/bacosoft-lex y docs.bacosoft.com (recepción de uva, datos básicos de vendimia, libros, SILICIE, declaraciones). El agente debe **verificar cada fila contra la documentación vigente** antes de cerrarla en el PRD.

Prioridad: **MVP** = necesario para apagar Holded y la operativa manual antes del 1-1-2027. **v2** = primer semestre de 2027. **Luego** = deseable.

| # | Origen | Funcionalidad | Módulo WineCore | Prioridad | Cómo adaptarlo |
|---|---|---|---|---|---|
| 1 | Holded | Facturas de venta (series, rectificativas, borradores, PDF, envío por email) | Facturación | MVP | Una serie por entidad (P.O y CVPO) y una serie de rectificativas. Las líneas llevan **lote** obligatorio en vino. El envío automático va por Microsoft 365 (Graph) y deja un registro de "enviada". |
| 2 | Holded | Verifactu (registro de facturación, hash encadenado, QR, envío a AEAT) | Regulatorio / Facturación | MVP (CVPO 1-1-2027, P.O 1-7-2027) | Hay que decidir entre implementación propia (RD 1007/2023 y Orden HAC/1177/2024) o un proveedor certificado vía API. Escribir un ADR. El envío a AEAT requiere aprobación humana. |
| 3 | Holded | Presupuestos → albarán → factura | Comercial / Facturación | MVP | El albarán **no** descuenta stock y la factura emitida **sí**, según el padre. Ojo: esto choca con la trazabilidad física (ver preguntas). Se necesita factura mensual agrupando albaranes. |
| 4 | Holded | Tarifas y descuentos por contacto | Comercial | MVP | Tres tarifas: cliente final, distribuidor y tienda. La tarifa intercompañía P.O→CVPO es la de distribuidor con un 60–80 % de descuento, con suelo de coste. |
| 5 | Holded | Multi-empresa | Núcleo | MVP | Dos entidades con datos fiscales, series, almacenes y contabilidad separadas. La facturación intercompañía es automática: cada venta de CVPO genera un albarán de P.O a CVPO, y se factura mensualmente. |
| 6 | Holded | Contactos / CRM básico (tipo, régimen, forma de pago, IBAN, mandato SEPA, modelo 347) | Comercial (CRM) | MVP | Se importan 256+220 contactos y 2.305 clientes de Shopify, deduplicados. Campos de exportación: EORI, idioma, número de impuestos especiales (CAE) y régimen suspensivo. |
| 7 | Holded | Pipelines CRM, actividades | Comercial | Luego | Interfaz simple. El bot puede registrar visitas y notas. |
| 8 | Holded | Inventario multi-almacén, stock virtual/disponible, variantes | Bodega + Stock | MVP | Almacenes: bodega P.O, almacén CVPO y operadores logísticos (Nacex, Ecovitis, Grupamar). El stock se lleva **por lote y formato** (0,25, 0,5, 0,75 y 1,5 L). |
| 9 | Holded | Compras / gastos con OCR de facturas | Gastos | MVP | Se reciben por foto, escaneo o reenvío de email, con extracción por IA (agente en Timbal) y validación humana. Se adjunta el PDF y se asigna cuenta contable. |
| 10 | Holded | Tesorería: bancos, conciliación, cobros/pagos parciales | Finanzas | MVP | Importar extractos (Norma 43/CAMT o el agregador que se elija en un ADR) y conciliar automáticamente contra facturas. También pagos a cuenta. |
| 11 | Holded | Remesas SEPA (adeudos) | Finanzas | MVP | Generar el fichero pain.008 con mandatos. Hay alertas de impago por vencimiento. |
| 12 | Holded | Contabilidad (PGC, asientos automáticos, diario, mayor, balance, PyG, sumas y saldos) | Contabilidad | MVP (asientos automáticos e informes), cierre en v2 | Partida doble, generada desde los documentos. Plan de cuentas importado (125/51 cuentas). Falta el histórico de años anteriores (ver lagunas). |
| 13 | Holded | Impuestos: 303, 390, 347, 349, 111, 115, 130 (P.O) y 200/202 (CVPO) | Regulatorio fiscal | v2 (borradores) | Generar borradores y ficheros. La presentación es siempre humana o del gestor. Confirmar quién presenta hoy. |
| 14 | Holded | Proyectos / tiempos | — | Fuera | No se ha pedido. |
| 15 | Holded | Equipo / RR. HH. (nóminas, fichaje) | — | Luego | Confirmar si hay empleados (temporeros de vendimia). |
| 16 | Holded | API REST | Integraciones | MVP | Un MCP server propio sustituye a la API. Cada caso de uso es una herramienta para Grok Bot y para los agentes de Timbal. |
| 17 | Holded | FACe (factura electrónica pública) | Facturación | Luego | Hay columna FACe: confirmar si se usa. |
| 18 | Bacosoft | Datos básicos: parcelas (SIGPAC: polígono/parcela, superficie, variedad), viticultores, calificaciones, zona CI/CII/CIIIb, sistema de producción (ecológico) | Viñedo | MVP | Unas 2 ha propias más proveedores de uva (moscatel). Registro vitícola. |
| 19 | Bacosoft | Recepción de uva (kg, GAP, viticultor, parcela, variedad, documento de acompañamiento) e importación Excel | Bodega – Vendimia | MVP | Se asigna **lote** de partida en la entrada. Registro desde móvil o por voz al bot. |
| 20 | Bacosoft | Encubado/prensado, descubado, vinificación con depósitos | Bodega – Elaboración | MVP | Hay dos flujos: blanco (prensado) y tinto, más "blanco vinificado en tinto". Se pasa de uva a mosto y de mosto a vino, con mermas legales y manuales justificadas. |
| 21 | Bacosoft | Depósitos con QR, contenido en tiempo real | Bodega – Aforo | MVP | Inox 1–32 de almacenamiento e Inox B1–B7 vinificadores con camisa de frío. Además barricas, damajuanas y jaulones. Hay que hacer un plano o dibujo de la bodega. |
| 22 | Bacosoft | Trasiegos, coupages/mezclas, partidas | Bodega – Elaboración | MVP | El ensamblaje (Arcal, Entredicho) se diseña con una fórmula en ml que se convierte a % y a litros por depósito. Genera un **lote nuevo** con genealogía (DAG). Los single plot (Muscat Blanda Argila) mantienen un solo origen. |
| 23 | Bacosoft | Tratamientos/aditivos (SO2, tartárico), productos enológicos | Bodega + Etiquetado | MVP | Dosis en g/L, factura del producto adjunta y cumplimiento ecológico. Alimenta la lista de ingredientes y alérgenos de la etiqueta (sulfitos). |
| 24 | Bacosoft | Analíticas (laboratorio y propias) | Bodega – Calidad | MVP | Controles: densidad y temperatura dos veces al día, con gráfica de cinética. Pack FML de Centrolab (Noblejas) más grado, glucosa+fructosa y AT. Notas de cata sensoriales. |
| 25 | Bacosoft | Embotellado (paso de granel a envasado), mermas | Bodega – Envasado | MVP | Formatos, tapón (aglomerado/corcho), cápsula o cera, cajas de 6 y palet americano de 112 cajas (672 botellas). El palet europeo tiene otra configuración. |
| 26 | Bacosoft | Existencias a fecha, almacenes virtuales | Stock / Inspección | MVP | Fotografía a fecha t de granel y envasado por ubicación, para una inspección sin aviso. Exportable a PDF. |
| 27 | Bacosoft | Trazabilidad lote ⇄ origen (historial) | Trazabilidad | MVP | Diagrama de trazabilidad desde la botella hasta la parcela, consultable por chat. |
| 28 | Bacosoft | SILICIE: asientos automáticos y suministro XML | Regulatorio II.EE. | MVP | Se generan asientos desde cada movimiento. P.O tiene una autorización de <100.000 L, con **dos declaraciones al año (agosto y diciembre)**: verificar la modalidad exacta. Se envía como servicio web con certificado y aprobación humana. |
| 29 | Bacosoft | Libros de II.EE., modelos 553/563/548/521/380 | Regulatorio II.EE. | v2 | El 553 es el del vino. Confirmar cuáles aplican. |
| 30 | Bacosoft | Libros de bodega autonómicos (Andalucía: SIF/SISV de la Junta), comunicaciones mensuales | Regulatorio agrícola | MVP (libro), v2 (envío) | La transcripción dice "SIF" y el contexto dice "SISV": aclarar. Probablemente no tiene API y se hará con computer use desde Timbal, con aprobación humana. |
| 31 | Bacosoft | INFOVI (declaraciones de existencias y producción) | Regulatorio agrícola | v2 | Confirmar si aplica. |
| 32 | Bacosoft | EMCS (e-DA/ARC), MVV para granel | Regulatorio II.EE. / Logística | MVP | Expediciones en régimen suspensivo (distribuidores UE) con e-DA y ARC. La factura de estas ventas va sin IVA español cuando corresponda. |
| 33 | Bacosoft | Informes para certificadora ecológica | Viñedo / Regulatorio | v2 | Cuaderno de tratamientos: fecha, operario, producto, método y factura. Las labores de campo se registran para histórico de añadas. |
| 34 | Bacosoft | Costes de producción por partida | Contabilidad analítica | v2 | Imprescindible para justificar el precio intercompañía (no vender bajo coste). |
| 35 | — (nuevo) | AECOC EDI El Corte Inglés (ORDERS, DESADV, INVOIC) | Integraciones | MVP | Lo hace P.O. Decidir en un ADR entre un proveedor EDI con API (el actual "iBook EDI"?) y computer use. Sincronización 1:1. |
| 36 | — (nuevo) | Tienda online Stripe (web en reconstrucción) | Comercial | MVP | Webhooks de Stripe crean un pedido, después un albarán y una factura en CVPO (¿o P.O?). |
| 37 | — (nuevo) | Logística Nacex / DHL / Ecovitis / Grupamar | Logística | v2 | Etiquetas y tracking. El stock queda en el almacén del operador. |
| 38 | — (nuevo) | Bot (MCP) para Grok Bot y bot interno; voz y fotos en el campo | Integraciones IA | MVP (MCP de lectura y altas simples) | Ningún bot escribe en registros regulatorios sin confirmación. |
| 39 | — (nuevo) | Post-venta / evolución de añadas (catas años después) | Conocimiento | Luego | Es un módulo aparte de notas de cata vinculadas a lote y añada. |
| 40 | — (nuevo) | Planificación de vendimia (clima, personal, madurez) | Viñedo | Luego | Agente en Timbal con API meteorológica. |

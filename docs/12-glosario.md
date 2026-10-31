# 12 · Glosario

> Términos enológicos, fiscales, regulatorios y técnicos usados en la especificación. Entre paréntesis, el nombre en el código cuando existe.

## Bodega y viñedo

| Término | Definición |
|---|---|
| **Aforo** | Medición del contenido de un recipiente o de toda la bodega en un momento dado. "Aforo de arranque": inventario físico firmado en la fecha de corte del que salen los saldos iniciales (`inventory_count`, `kind = 'opening'`). |
| **Añada** | Año de la vendimia (`vintage`). |
| **Barrica** | Recipiente de madera (normalmente roble) para crianza (`vessel.kind = 'barrel'`). |
| **BIB (bag-in-box)** | Envase de bolsa dentro de caja (3, 5, 10 L…); formato libre si supera 1,5 L. |
| **Camisa de frío** | Doble pared de un depósito por la que circula refrigerante para controlar la temperatura de fermentación. Los vinificadores (Inox B1–B7) la tienen. |
| **Cata** | Evaluación sensorial de un vino (`cellar.tasting`; años después, `knowledge.tasting_note`). |
| **Cinética fermentativa** | Evolución de la densidad (y temperatura) durante la fermentación; se mide dos veces al día (`fermentation_reading`). |
| **Coupage / ensamblaje** | Mezcla de varios vinos (lotes) en proporciones definidas por cata; crea un lote nuevo (`op_type = 'blend'`). |
| **Damajuana** | Garrafa de vidrio para crianza (`vessel.kind = 'demijohn'`). |
| **Délestage / sangrado** | Técnicas de extracción en tinto: vaciar y reincorporar el mosto sobre los hollejos / extraer mosto sin prensar. |
| **Depósito (Inox)** | Recipiente de acero inoxidable de almacenamiento (Inox 1–32) o vinificador (Inox B1–B7) (`cellar.vessel`). |
| **Descube / descubado** | Separación del vino de los hollejos tras la maceración. |
| **Despalillado** | Separar el raspón de las uvas. |
| **Documento de acompañamiento** | Documento que acompaña el transporte de uva o productos vitivinícolas (p. ej. uva comprada a un viticultor). |
| **Encubado** | Introducir la uva despalillada con sus hollejos en el depósito (vinificación en tinto). |
| **Envasado / embotellado** | Paso de granel a envase (botella, BIB); genera el lote envasado y mermas (`op_type = 'bottling'`). |
| **FA / FML** | Fermentación alcohólica (azúcares → etanol, levaduras) / fermentación maloláctica (málico → láctico, bacterias). "Pack FML": análisis de laboratorio tras la FML. |
| **Filtración (placas V00, V07, V13)** | Filtrado por placas de celulosa de distinta porosidad: desbaste (V00), intermedia (V07), amicróbica (V13). |
| **Granel** | Vino o mosto no envasado, en recipientes. |
| **Jaulón** | Contenedor de botellas sin etiquetar (~600 botellas) (`product_state = 'packaged_unlabeled'`). |
| **Lías** | Sedimento que queda tras la fermentación o el reposo; se pierde en los trasiegos (merma). |
| **Lote / partida** | Identidad de un contenido (uva, mosto, vino, envasado) que acompaña todo el proceso; el ensamblaje y el envasado crean lotes nuevos. El lote envasado es el que se imprime en la etiqueta (`inventory.lot`). |
| **Genealogía (DAG)** | Grafo dirigido sin ciclos que une cada lote con los lotes de los que procede (`inventory.lot_edge`). |
| **Merma** | Pérdida de volumen o unidades: autorizada (inherente al proceso) o por incidencia (derrame, rotura) (`loss_kind`). |
| **Mosto** | Zumo de uva antes o durante la fermentación. |
| **Palet americano / europeo** | Palet de 112 cajas de 6 (672 botellas) en la bodega; el europeo lleva menos. |
| **Parcela única (single plot)** | Vino de una sola parcela, sin ensamblaje. |
| **Prensado** | Extraer el mosto de la uva (blancos) o del orujo. |
| **Rendimiento** | Litros de mosto o vino obtenidos por kg de uva. |
| **SIGPAC** | Sistema de Información Geográfica de Parcelas Agrícolas: identifica cada parcela (provincia, municipio, agregado, zona, polígono, parcela, recinto). |
| **Registro Vitícola** | Registro oficial de las parcelas de viñedo. |
| **Trasiego** | Pasar vino de un recipiente a otro (mismo lote), separando las lías (`op_type = 'racking'`). |
| **Vinificación en blanco / en tinto / blanco en tinto** | Elaboración por prensado (blanco), con hollejos (tinto) o de uva blanca con hollejos (blanco en tinto). |

## Fiscal y regulatorio

| Término | Definición |
|---|---|
| **AEAT** | Agencia Estatal de Administración Tributaria. |
| **AecocEDI** | Herramienta web de AECOC para intercambiar pedidos, albaranes y facturas por EDI. |
| **ARC** | Código de Referencia Administrativo: identificador que asigna EMCS a un e-DA validado. |
| **CAE** | Código de Actividad y Establecimiento: identifica un establecimiento autorizado de II.EE. (la fábrica de vino de P.O); actividad V1 = elaboradores de vino. |
| **Colaborador social** | Entidad autorizada por la AEAT para presentar declaraciones por cuenta de terceros. |
| **CSV (AEAT)** | Código Seguro de Verificación de un envío o justificante de la AEAT. |
| **Cuaderno de explotación (CUE)** | Registro de tratamientos fitosanitarios y labores; desde el 01-01-2027 en formato electrónico (RD 1039/2025). |
| **Depositario autorizado** | Titular autorizado a producir, transformar y tener productos objeto de II.EE. en régimen suspensivo en un depósito fiscal o fábrica. |
| **Devengo** | Momento en que nace la obligación tributaria; en II.EE. de fabricación, en general la salida de fábrica o depósito fiscal. |
| **DOP / IGP** | Denominación de Origen Protegida / Indicación Geográfica Protegida. |
| **e-DA / e-DAS** | Documento Administrativo electrónico (circulación en régimen suspensivo) / simplificado (con impuesto pagado), emitidos en EMCS. |
| **EMCS** | Excise Movement and Control System: sistema de control de la circulación de productos objeto de II.EE. |
| **EANCOM / EDIFACT** | Estándares de mensajes EDI (ORDERS pedido, DESADV albarán, INVOIC factura, REMADV aviso de pago, GENRAL texto libre). |
| **EORI** | Número de registro de operadores económicos para aduanas en la UE. |
| **Exportación / entrega intracomunitaria** | Venta fuera de la UE (exenta de IVA, art. 21 LIVA) / a otro Estado miembro (exenta, art. 25 LIVA, con NIF-IVA validado en VIES). Canarias se trata como exportación a efectos de IVA. |
| **Fábrica de vino** | Establecimiento donde se elabora vino a efectos de II.EE. |
| **Factura completa / simplificada / rectificativa** | Tipos del Reglamento de facturación (Verifactu: F1, F2, R1–R5). Rectificativa por sustitución (S) o por diferencias (I). |
| **Factura electrónica B2B** | Factura estructurada obligatoria entre empresas (RD 238/2026): UBL, CII, EDIFACT o Facturae, por plataforma conforme o por la solución pública de la AEAT. |
| **GLN / GTIN / SSCC** | Códigos GS1: punto operacional (13 dígitos), artículo (EAN-13/GTIN-14) y unidad logística (18 dígitos). |
| **Huella (Verifactu)** | Hash SHA-256 de un registro de facturación encadenado con el anterior. |
| **II.EE.** | Impuestos Especiales (de fabricación); el vino tranquilo tributa a tipo 0 € pero está sujeto a control. |
| **INFOVI** | Sistema de declaraciones obligatorias del sector vitivinícola (existencias y producción; RD 739/2015). |
| **IRPF / IS** | Impuesto sobre la Renta (P.O, persona física) / Impuesto sobre Sociedades (CVPO). |
| **Libros de bodega (SISV)** | Registros de entradas, salidas, elaboración, prácticas enológicas, envasado y existencias que se llevan en SISV. |
| **NIF / NIE / NIF-IVA** | Identificación fiscal española de personas y entidades / de extranjeros / con prefijo de país para operaciones en la UE. |
| **Operaciones vinculadas** | Operaciones entre partes relacionadas (P.O y CVPO) que deben valorarse a mercado; el precio lo valida el asesor (D4). |
| **Recargo de equivalencia** | Régimen de IVA de minoristas: el proveedor añade un recargo (5,2 % sobre el 21 %). |
| **Régimen suspensivo** | Situación en la que el impuesto especial no se ha devengado (dentro del depósito fiscal o circulando con e-DA). |
| **SILICIE** | Suministro Inmediato de Libros Contables de Impuestos Especiales: contabilidad de existencias de II.EE. en la AEAT. |
| **SISV** | Aplicación de la Junta de Andalucía para llevar, firmar y remitir los libros del sector vitivinícola. |
| **Solución pública de facturación electrónica** | Servicio gratuito de la AEAT para emitir, recibir y conservar facturas electrónicas B2B en UBL. |
| **Verifactu (VERI*FACTU)** | Requisitos de los sistemas de facturación (RD 1007/2023): registros encadenados, QR y, en modalidad VERI*FACTU, remisión automática a la AEAT. |
| **VIES** | Sistema de la UE para validar NIF-IVA. |

## Técnico (WineCore)

| Término | Definición |
|---|---|
| **Agente padre / hijo** | Orquestador de Fase 2 / agentes que implementan una tarea del backlog. |
| **Aprobación ligada al hash** | La decisión humana guarda el SHA-256 del contenido aprobado; si cambia, la aprobación no vale (`WC040`). |
| **Conector** | Pieza intercambiable que lleva un envío regulatorio a su destino: API, *computer use*, carga de fichero o manual (`regulatory.connector`). |
| **CVBOT** | Asistente de Pedro; cliente MCP de WineCore y lector de `PROGRESS.md`. |
| **Ejecutor local (runner)** | Programa en un equipo dedicado que ejecuta en portales los envíos ya aprobados, con el certificado en local (ADR 009). |
| **Golden file** | Fichero de salida esperado (XML, CSV, PDF de referencia) con el que se compara byte a byte la salida del código en los tests. |
| **Libro físico / fiscal** | Movimientos de stock por dónde está la mercancía / por su situación ante II.EE. (D2) (`stock_move` / `fiscal_move`). |
| **MCP** | Model Context Protocol: protocolo para exponer herramientas a modelos y asistentes. |
| **Outbox** | Tabla de eventos escrita en la misma transacción que el cambio, publicada después (`ops.outbox_event`). |
| **Passkey / verificación reforzada** | Credencial WebAuthn (o TOTP) que se exige para aprobar. |
| **PITR** | Recuperación de la base de datos a un instante (copias continuas). |
| **Timbal** | Plataforma donde se despliega WineCore (org 122, proyecto 3942). |
| **Vigilante** | Job que detecta problemas (descuadres, cobros, plazos, colas) y avisa. |

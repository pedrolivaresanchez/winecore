# Cobertura de la reunión de arranque

> Auditoría de 149 puntos de la reunión de arranque (operativa de bodega) contra la especificación v2, y actualización del 31-10-2026. Sin citas ni nombres: solo el tema de cada punto y dónde queda cubierto.

## Resumen

| Estado | Antes | Ahora |
|---|---|---|
| Cubiertos | 73 | 149 |
| Parciales | 45 | 0 |
| Faltan | 31 | 0 |

De los 149, **12** dependen de un valor o de una norma por confirmar (Q-035 a Q-040): el modelo y la regla existen, y el valor se guarda como supuesto o queda vacío hasta que Pedro o el asesor lo confirmen.

**Implementación**: la elaboración y el viñedo ya no esperan a M5. Se construyen en paralelo desde el 31-10-2026 (M2 bodega, M3 viñedo y ecológico) en las tareas TASK-BOD-013 a 019, TASK-VIN-004 y TASK-ASIS-004.

## Por sección

| Sección | Puntos | Antes (cubiertos / parciales / faltan) | Ahora cubiertos |
|---|---|---|---|
| Arranque | 3 | 2 / 1 / 0 | 3 |
| Viñedo | 7 | 5 / 2 / 0 | 7 |
| Maduración | 9 | 2 / 4 / 3 | 9 |
| Recepción | 8 | 5 / 2 / 1 | 8 |
| Elaboración | 13 | 4 / 3 / 6 | 13 |
| Depósitos | 9 | 4 / 4 / 1 | 9 |
| Fermentación | 10 | 5 / 3 / 2 | 10 |
| Analítica | 16 | 7 / 8 / 1 | 16 |
| Adiciones | 7 | 5 / 0 / 2 | 7 |
| Mermas | 6 | 5 / 1 / 0 | 6 |
| Clarificación | 4 | 0 / 3 / 1 | 4 |
| Estabilización | 6 | 0 / 2 / 4 | 6 |
| Trasiego | 4 | 4 / 0 / 0 | 4 |
| Higiene | 4 | 1 / 1 / 2 | 4 |
| Crianza | 6 | 2 / 4 / 0 | 6 |
| Ensamblaje | 6 | 3 / 1 / 2 | 6 |
| Envasado | 10 | 4 / 1 / 5 | 10 |
| Stock | 7 | 4 / 2 / 1 | 7 |
| Inspección | 6 | 4 / 2 / 0 | 6 |
| Postventa | 1 | 0 / 1 / 0 | 1 |
| Diseño | 3 | 3 / 0 / 0 | 3 |
| Regulatorio | 4 | 4 / 0 / 0 | 4 |

## Puntos que estaban parciales o faltaban

| # | Tema | Antes | Dónde queda cubierto |
|---|---|---|---|
| 2 | Plano de la bodega con la posición de cada depósito | Parcial | US-BOD-01 · §8.1 zonas y plano |
| 6 | Exención del cuaderno con poca superficie (≈2 ha) | Parcial | US-VIN-02 · §15 · Q-038 (valor pendiente) |
| 10 | Comparar añadas para reproducir una buena | Parcial | US-VIN-07 · §9.5 comparador de añadas |
| 11 | Controles visuales y de cata en el campo | Parcial | US-VIN-04 · §15 cata de uva estructurada |
| 12 | Muestras de uva al laboratorio antes de vendimia | Parcial | US-VIN-04 · §9.3 analítica de parcela |
| 13 | Laboratorio externo habitual | Parcial | US-BOD-11 · §9.3 laboratorio como contacto proveedor |
| 14 | Cata de uva: pepita, hollejo, pulpa y madurez fenólica | Faltaba | US-VIN-04 · §15 |
| 17 | Meteorología como factor de la fecha de vendimia | Parcial | US-VIN-06 · §15 planificador |
| 18 | Personal disponible como factor de la fecha | Faltaba | US-VIN-06 · §15 disponibilidad por día |
| 19 | Fecha óptima de vendimia combinando factores | Faltaba | US-VIN-06 · §15 |
| 20 | Cajas de ~20 kg o contenedor grande | Parcial | US-BOD-08 · §9.2 recepción |
| 21 | Kilos pesados o estimados | Parcial | US-BOD-08 · §9.2 |
| 27 | Sanidad de la uva a la entrada (infección, tormenta, sobremaduración, pasificación) | Faltaba | US-BOD-08 · §9.2 `grape_intake` |
| 28 | Tipo de vinificación y despalillado | Parcial | US-BOD-09 · §9.2 y §9.5 |
| 30 | Encubado con hollejos y descube | Parcial | US-BOD-09 · §9.3 fases · operación `pressing_off` (Q-040) |
| 31 | Blancas vinificadas en tinto | Faltaba | US-BOD-09 · §9.5 tipo de vinificación |
| 32 | Prácticas que la casa no aplica (desfangado, centrifugado) | Faltaba | US-BOD-20 · §9.5 prácticas por lote |
| 33 | Délestage y sangrado | Faltaba | US-BOD-09 · §9.2 operaciones `delestage` y `bleeding` (Q-040) |
| 34 | Maceración en tintos | Faltaba | US-BOD-09 · §9.3 fases |
| 35 | Maceración acuosa: fermentación paralizada con frío | Faltaba | US-BOD-09 · §9.3 fases |
| 36 | Índice de polimerización (IP) | Faltaba | US-BOD-11 · §9.3 parámetro nuevo |
| 37 | Polifenoles (IPT) | Parcial | US-BOD-11 · §9.3 (parámetro ya en el DDL) |
| 44 | Depósitos en lugares distintos (zonas) | Parcial | US-BOD-01 · §8.1 zonas |
| 46 | Atributos de barrica (roble, tostado, tonelero, año, usos) | Parcial | US-BOD-01 · §9.1 barricas |
| 47 | Damajuanas a la intemperie | Parcial | US-BOD-01 · §8.1 zona exterior · §9.3 crianza |
| 48 | Jaulones de ≈600 botellas | Parcial | US-BOD-01 · §8.1 contenedores de botellas · Q-037 |
| 49 | Nichos | Faltaba | US-BOD-01 · §8.1 · Q-037 |
| 53 | Corrección de temperatura de fermentación | Parcial | US-BOD-10 · §9.2 `temperature_control` |
| 55 | Fermentación espontánea con levaduras autóctonas | Faltaba | US-BOD-10 · §9.3 inoculación |
| 56 | Fase de fermentación maloláctica con inicio y fin | Parcial | US-BOD-10 · §9.3 fases |
| 57 | Observación del fin de la FML | Faltaba | US-BOD-10 · §9.3 observaciones |
| 58 | Solape FA/FML y acidez volátil | Parcial | US-BOD-10 y US-BOD-16 · §9.3 reglas |
| 60 | Alcohol probable a partir de la densidad | Parcial | US-BOD-15 · §9.3 calculadoras (factor pendiente, Q-036) |
| 62 | Análisis en bodega o en laboratorio, fechas de muestra y resultado | Parcial | US-BOD-11 · §9.3 |
| 63 | Muestra homogeneizada ligada a la analítica | Parcial | US-BOD-11 · §9.3 |
| 66 | Dosis de SO2 según el pH | Faltaba | US-BOD-15 · §9.3 calculadora (objetivos pendientes, Q-036) |
| 67 | Azúcares agotados (vino seco) | Parcial | US-BOD-11 · §9.3 umbral (Q-036) |
| 68 | Volátil alta y corrección | Parcial | US-BOD-11 y US-BOD-16 · umbral (Q-036) |
| 69 | Extracto seco | Parcial | US-BOD-11 · §9.3 (parámetro ya en el DDL) |
| 72 | Analítica previa obligatoria al envasado | Parcial | US-BOD-16 · §9.3 reglas (antigüedad, Q-036) |
| 73 | Evolución de analíticas y catas | Parcial | US-BOD-11 y US-BOD-18 · §9.3 |
| 81 | Tras la FML solo se corrige el SO2 | Faltaba | US-BOD-16 · §9.3 reglas |
| 82 | Prácticas prohibidas (carbón activo) | Faltaba | US-BOD-16 · `WC140` |
| 83 | Mermas autorizadas por proceso (%) | Parcial | US-BOD-16 · §9.3 mermas legales · Q-035 (valores pendientes) |
| 89 | Filtración de desbaste (V00) | Parcial | US-BOD-17 · §9.2 filtración |
| 90 | Filtración intermedia (V07) | Parcial | US-BOD-17 |
| 91 | Filtración amicróbica (V13) si la volátil es alta | Parcial | US-BOD-17 y US-BOD-16 |
| 92 | Proveedor de placas y consumibles | Faltaba | US-BOD-17 · §9.6 consumibles |
| 93 | Estabilización tartárica natural por frío de invierno | Parcial | US-BOD-17 · §9.3 fases |
| 94 | Fórmula de temperatura −(grado/2 + 1) | Faltaba | US-BOD-15 · §9.3 calculadoras |
| 95 | Precipitación de bitartratos | Faltaba | US-BOD-17 · §9.2 |
| 96 | Reposo hasta primavera y primer trasiego | Parcial | US-BOD-16 · recordatorio de temporada |
| 97 | Estabilización proteica en blancos | Faltaba | US-BOD-17 · §9.3 fases |
| 98 | Envasar después de la primavera | Faltaba | US-BOD-16 · recordatorio de temporada |
| 104 | Procedimiento de limpieza y desinfección | Parcial | US-BOD-21 · §9.6 |
| 105 | Efluente a pozo de biodegradación | Faltaba | US-BOD-21 · §9.6 · Q-039 (requisito pendiente) |
| 106 | Desinfección de botellas antes de envasar | Faltaba | US-BOD-21 · §9.6 control de envasado |
| 108 | Destino del vino (referencia o colección nueva) | Parcial | US-BOD-20 · §9.5 |
| 109 | Receta reproducible de elaboración | Parcial | US-BOD-20 · §9.5 recetas |
| 111 | Catas periódicas en crianza | Parcial | US-BOD-18 · §9.4 |
| 112 | Cata diaria de mostos | Parcial | US-BOD-18 · §9.4 |
| 113 | Cata a ciegas de candidatos durante 2–3 días | Faltaba | US-BOD-19 · §9.4 |
| 114 | Selección sí/no por referencia | Faltaba | US-BOD-19 · §9.4 |
| 118 | Parcela única y número de etiqueta | Parcial | US-BOD-20 · §9.5 · `WC141` |
| 119 | Embotelladora manual de 4 caños | Faltaba | US-BOD-21 · §9.6 equipos |
| 120 | Control visual del envasado | Faltaba | US-BOD-21 · §9.6 |
| 121 | Tapón aglomerado o corcho natural | Faltaba | US-BOD-14 (material) y US-BOD-21 (tipo de cierre) |
| 123 | Cápsula o lacre | Faltaba | US-BOD-14 y US-BOD-21 |
| 124 | Cajas de 6 | Parcial | US-BOD-14 · §7 materiales de envasado |
| 125 | Palé de 112 cajas (672 botellas) | Faltaba | US-BOD-14 · §7 |
| 133 | Operadores logísticos y paquetería | Parcial | Contactos (transportista, operador logístico) y albarán con transportista y nº de seguimiento; integración de paquetería posterior |
| 134 | El albarán y la factura en el stock | Parcial | D2 confirmado por Pedro: físico con el albarán, fiscal con la factura (§10) |
| 135 | Ventas por lote y referencia con gráficas | Faltaba | US-REP-01 |
| 137 | Diagrama de trazabilidad por chat | Parcial | US-ASIS-04 |
| 140 | Controles de Sanidad | Parcial | US-BOD-21 · registro APPCC |
| 142 | Notas de cata años después | Parcial | US-BOD-18 · plantilla de posventa |


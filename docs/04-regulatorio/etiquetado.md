# 04 · Etiquetado del vino (UE, España y mercados de exportación)

> Versión 1 · 31-10-2026 · Fuentes oficiales consultadas el 31-10-2026 (§8). Marcas: **HECHO** · **SUPUESTO** · **PENDIENTE**.
> Alcance en WineCore: **ficha de etiqueta** por producto y versión (`catalog.label_spec`), etiqueta electrónica (e-etiqueta) por QR y comprobaciones contra lotes y analíticas. WineCore **no** diseña la etiqueta gráfica. Hito: posterior al MVP (US-ETQ-01), con los datos ya guardados desde M2. Relacionado: `ecologico.md` §5.

## 1. Menciones obligatorias del vino y de dónde salen

| Mención | Regla | Estado | Fuente | Origen en WineCore |
|---|---|---|---|---|
| Categoría ("Vino") | Obligatoria | HECHO | Reg. (UE) 1308/2013, art. 119 | `catalog.label_spec.legal_name` |
| Procedencia | Sin DOP/IGP: "**Vino de España**"; no se pueden citar unidades geográficas menores (comarca, provincia, región) salvo en la dirección del embotellador | HECHO | Reg. Delegado (UE) 2019/33, art. 55.1 | `label_spec.origin_statement` (por defecto "Vino de España") |
| DOP/IGP | Jaén no tiene DOP de vino; IGP **Bailén**, **Sierra Sur de Jaén** y **Torreperogil**. La Puerta de Segura no está en ninguna. "**Sierra de Segura**" es una DOP de **aceite**: no usarla en vino (riesgo de evocación) | HECHO | Listados de DOP/IGP del MAPA (julio 2026) · Junta (IGP de vinos; DOP de aceite) · Reg. (UE) 2024/1143, art. 26 | `catalog.wine.pdo_pgi_name` (vacío hoy) |
| Grado alcohólico adquirido (% vol) | Obligatorio | HECHO | 1308/2013, art. 119 | `label_spec.alcohol_pct_label`; se compara con la analítica del lote (tolerancia: PENDIENTE de transcribir del Reg. 2019/33, equipo, antes de M4) |
| Volumen nominal | 250, 500, 750 y 1500 mL permitidos; el BIB de más de 1,5 L tiene volumen libre; altura mínima de la cifra: 4 mm (> 20 cl hasta 100 cl) y 6 mm (> 100 cl); "℮" opcional | HECHO | Directiva 2007/45/CE · RD 1801/2008, art. 9 | `label_spec.nominal_volume_ml` = `catalog.format.nominal_volume_ml` |
| Embotellador | Nombre y dirección, o el **número del Registro de Envasadores** (obligatorio en la etiqueta) con "ES" | HECHO | RD 1363/2011, arts. 4, 6 y 9 (art. 7 reescrito por RD 189/2026) | `label_spec.bottler_statement`, `bottler_re_number` |
| Lote | Obligatorio, con "L"; puede ir fuera del campo visual | HECHO | Directiva 2011/91/UE · RD 1808/1991 | `inventory.lot.code` con `label_spec.lot_format` |
| Alérgenos | "**Contiene sulfitos**" si el SO₂ total > 10 mg/L, también en vinos "sin sulfitos añadidos" si se supera por el SO₂ de fermentación; debe ir en la **etiqueta física** | HECHO | Reg. (UE) 1169/2011, anexo II · Comunicación C/2023/1190 | `label_spec.allergens`; comprobación con la analítica de SO₂ total del lote |
| Ingredientes y declaración nutricional | Obligatorios desde el **08-12-2023**. En el envase basta el **valor energético con el símbolo "E"** si el resto va en la e-etiqueta | HECHO | 1308/2013, art. 119 (modificado por Reg. (UE) 2021/2117) · C/2023/1190 | `label_spec.ingredients` (uva, conservante: sulfitos, corrector de acidez: ácido tartárico) y `nutrition_per_100ml` |
| E-etiqueta (QR) | Sin información comercial, sin rastrear al usuario, y **no** en la web comercial de la bodega | HECHO | C/2023/1190, preguntas 30 y 35–37 · acuerdo RICAL del MAPA (25-09-2025) | `label_spec.e_label_url` (dominio propio de e-etiquetas, sin analítica web) |
| "Sin sulfitos añadidos" | No hay norma específica UE ni española; reglas generales de información voluntaria | NO ENCONTRADO | — | `catalog.wine.no_added_sulfites` (solo informativo; nunca sustituye a "contiene sulfitos") |
| Variedad y añada sin DOP/IGP | Requieren certificación por entidad inscrita y autorización de la Junta | HECHO | Reg. de Ejecución (UE) 2018/274, art. 12 · Orden de 14-11-2012, arts. 31–33 | `catalog.wine` + `label_spec` (bloqueo si falta la autorización, sisv.md §9) |

## 2. Cambios del Reglamento (UE) 2026/471

| Cambio | Desde | Estado | Efecto |
|---|---|---|---|
| Vino destinado **exclusivamente a exportación** exento de ingredientes y nutrición (nuevo art. 119.6) | 18-03-2026 | HECHO | `label_spec.export_only = true` permite omitirlos; solo para productos que no se venden en la UE |
| Menciones obligatorias "una única vez" por envase y reglas de vinos desalcoholizados | 19-09-2027 | HECHO | Revisión de las etiquetas antes de esa fecha (vigilante) |
| Pictogramas y diseño de la e-etiqueta por acto delegado (art. 122) | Pendiente de acto delegado | HECHO (habilitación) | Seguimiento |

## 3. Etiqueta ecológica

Código del organismo de control (`ES-ECO-0XX-AN`), **logotipo UE** (mínimo 9 × 13,5 mm; Pantone 376) y "**Agricultura España**" (o "Agricultura UE") en el mismo campo visual (Reg. (UE) 2018/848, arts. 30–33 y anexo V; Reg. de Ejecución (UE) 2021/279, art. 3). Con vino sin DOP/IGP se recomienda "Agricultura España" y no "España/Andalucía", para no chocar con 2019/33 art. 55.1 (SUPUESTO; PENDIENTE con el organismo de control). Origen: certificado propio vigente (`regulatory.organic_certificate`) → `label_spec.organic_control_code` y `organic_origin`.

## 4. Mercados de exportación

| Mercado | Reglas | Estado | Fuente |
|---|---|---|---|
| Reino Unido (GB) | No exige ingredientes ni nutrición (> 1,2 % vol); nombre y dirección de un operador del Reino Unido (o "importer"); "contains sulphites" y lote obligatorios; ecológico: el importador debe estar certificado en el Reino Unido | HECHO | GOV.UK "Importing, selling and labelling wine" (19-09-2025) · "Importing organic food to the UK" (04-09-2026) |
| Reino Unido: logotipo ecológico UE | ¿Se acepta? | PENDIENTE (importador) | — |
| Dinamarca | Alérgenos en danés ("sulfitter" / "svovldioxid"); el resto en cualquier lengua de la UE | HECHO | BEK nr 1355 af 27/11/2015, § 3 · Fødevarestyrelsen (29-11-2023) |
| Austria | Alemán probable | PENDIENTE (importador) | WKO (no normativo) |
| Canarias | Etiquetado UE completo | SUPUESTO | — |

Para cada mercado con idioma propio, WineCore guarda una ficha por idioma (`label_spec.language`; única por producto, idioma y versión).

## 5. Comprobaciones automáticas (antes de aprobar una ficha y al envasar)

1. Grado de la etiqueta frente a la analítica del lote (tolerancia del §1).
2. SO₂ total > 10 mg/L → "contiene sulfitos" obligatorio; si el lote es ecológico, límite ecológico (ecologico.md §3).
3. Volumen nominal = formato del producto.
4. Vino sin DOP/IGP: el texto no contiene topónimos menores que "España" fuera de la dirección del embotellador (lista de topónimos a vigilar: Sierra de Segura, Jaén, Andalucía, La Puerta de Segura).
5. Ecológico: código con el formato `ES-ECO-NNN-XX` y certificado propio vigente.
6. E-etiqueta: la URL pertenece al dominio de e-etiquetas configurado (no a la tienda).
7. Ingredientes coherentes con las adiciones del lote (si hay ácido tartárico en la ascendencia del lote, aparece como corrector de acidez).

## 6. Datos de la ficha y su origen

| Dato | Origen |
|---|---|
| Denominación, procedencia, DOP/IGP | `catalog.wine` + `label_spec` |
| Grado | Analítica del lote (`cellar.analysis_result`, parámetro grado) redondeado a 0,5 % vol (SUPUESTO de práctica habitual; confirmar con el §1) |
| Volumen | `catalog.format.nominal_volume_ml` |
| Lote | `inventory.lot.code` |
| Alérgenos | SO₂ total del lote |
| Ingredientes | Adiciones del lote y de su ascendencia (`cellar.addition`) |
| Nutrición (energía y resto) | Cálculo a partir de grado y azúcares de la analítica (factores de conversión del Reg. (UE) 1169/2011, anexo XIV) |
| Embotellador y RE | Ajustes de la entidad que embotella (P.O) |
| Bloque ecológico | `regulatory.organic_certificate` propio vigente |

## 7. Pendientes

| Tema | Dueño | Fecha |
|---|---|---|
| Tolerancia del grado alcohólico (artículo del Reg. 2019/33) | Equipo | Antes de M4 |
| Número RE de P.O y textos actuales de cada etiqueta | Pedro | 15-02-2027 |
| Autorizaciones de variedad y añada | Pedro (Q-012) | 15-02-2027 |
| Logotipo UE en Reino Unido e idioma en Austria | Pedro con los importadores | 15-02-2027 |

## 8. Fuentes (consultadas el 31-10-2026)

Reg. (UE) 1308/2013 consolidado 18-08-2026 · Reg. (UE) 2021/2117 · Reg. (UE) 2026/471 y su corrección (22-05-2026) · Reg. Delegado (UE) 2019/33 consolidado 18-01-2025 y 2023/1606 · Reg. de Ejecución (UE) 2018/274 · Reg. (UE) 1169/2011 · Comunicación C/2023/1190 · Directivas 2011/91/UE y 2007/45/CE · Reg. (UE) 2024/1143 · Reg. (UE) 2018/848 y Reg. de Ejecución (UE) 2021/279 · RD 1363/2011 consolidado (13-03-2026) y RD 189/2026 (BOE-A-2026-5875) · RD 1808/1991 · RD 1801/2008 · MAPA: listados de DOP/IGP de vinos (02-07-2026) e IG por provincias (03-07-2026), acuerdos RICAL (25-09-2025 y 17-12-2025) · Junta de Andalucía: IGP de vinos, DOP de aceite (pliego Sierra de Segura, BOJA 146 de 01-08-2023), Orden de 14-11-2012 · GOV.UK (guías de vino, etiquetado y ecológico) · retsinformation.dk (BEK 1355/2015) · Fødevarestyrelsen (29-11-2023).

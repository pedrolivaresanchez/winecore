# Progreso WineCore — actualizado 31-10-2026 14:39 CET (Europe/Madrid)
Fase: 1 · Hito: especificación (antes de M0) · Estado: en revisión de Pedro

## Hecho desde la última actualización
- **Indicaciones de Pedro del 31-10 (14:36) aplicadas**: el certificado (Q-006) queda para el final y solo bloquea el paso a producción (el desarrollo y las pruebas usan un certificado de pruebas); Q-002, Q-003 y Q-005 siguen sin respuesta y se aplican sus recomendaciones como **supuesto** marcado en los documentos; límite de 1 subagente Opus a la vez.
- **Especificación completa** en la rama `spec/fase-1`, lista para que Pedro la apruebe en un PR: producto, modelo de datos, estados, normativa, mapeo con Holded y Bacosoft, migración, arquitectura y decisiones técnicas, pantallas, hoja de ruta, tareas, tests y glosario.
- **Normativa escrita con fuentes oficiales** (consultadas hoy): Verifactu, SILICIE, SISV, EMCS (e-DA), AecocEDI, INFOVI, modelos de la AEAT, producción ecológica y etiquetado. Cada dato que se envía a un organismo dice de qué campo de WineCore sale.
- **Verifactu**: comprobadas con la AEAT las tres huellas de ejemplo oficiales; preparada una batería de 22 pruebas para el entorno de pruebas de la AEAT (control del 01-12-2026). Las fechas siguen siendo las del BOE (CVPO 01-01-2027, P.O 01-07-2027): el aplazamiento a 2028 que anunció Hacienda el 05-10-2026 **no está publicado en el BOE** (revisado hasta hoy).
- **Certificado**: propuesta nueva y más segura. El certificado de Verifactu vive solo en AWS y lo usa únicamente una pieza pequeña que envía los registros; nunca está en Timbal ni al alcance de los agentes. El certificado personal de P.O no sale del equipo de la bodega.
- **Modelo de datos**: ampliado y comprobado de nuevo en una base de datos de pruebas (134 tablas; pasan las 18 pruebas de reglas básicas).
- **Pantallas**: 41 fichas (qué muestra cada pantalla, quién puede usarla, qué pide confirmar y cómo se ve en el móvil).
- **Tareas para la Fase 2**: 132 tareas pequeñas (180 días de agente en total), cada una con lo que hay que hacer, cómo comprobarlo y qué tests exige. Todas las historias del MVP tienen al menos una tarea.
- **Hallazgos que cambian cosas** (detalle en `docs/00-triaje.md`):
  - Desde 2025, en SILICIE el vino en barrica y el de depósito son cuentas distintas: **los trasiegos depósito ↔ barrica sí se anotan** (los de depósito a depósito, no).
  - Holded dice que Verifactu se mantiene "hasta el 31 de diciembre del año siguiente"; la norma dice **del mismo año**.
  - La factura mensual P.O → CVPO no puede llevar fecha de expedición del día 31: lleva **fecha de operación** fin de mes y se expide antes del día 16.

## Siguiente
- Esperar la revisión de Pedro del PR y responder a sus comentarios.
- Con las respuestas urgentes (Q-002, Q-003, Q-004, Q-005, Q-027) y la especificación aprobada, empezar M0: repositorio, integración continua, AWS y Timbal.

## Bloqueos
- Para empezar M0 hacen falta: aprobación de esta especificación, GitHub conectado en Timbal con los entornos `dev` y `staging` (Q-004) y la cuenta de AWS (Q-027).

## Necesita decisión de Pedro   (pregunta · opciones · recomendación · fecha límite)
- **Comprobar hoy con la administradora el cierre de SILICIE de 2025** · el plazo de comunicarlo vence ahora (el 31-10-2026 es sábado: pasa al primer día hábil) · si no se comunica, Hacienda lo cierra de oficio · **preguntarle si ya está hecho y si en 2025–2026 se anotaron los trasiegos depósito ↔ barrica** · 02-11-2026.
- **Q-004 Conectar GitHub en Timbal** · conexión de GitHub (Plan A) / que la integración continua empuje (Plan B) · **Plan A, protegiendo antes las ramas de GitHub** · 04-11-2026.
- **Q-002 Verifactu** · envío por servicio web / sin envío con firma / software externo en enero · **servicio web** · 05-11-2026 · *sin respuesta: se aplica como supuesto*.
- **Q-003 Aprobación en Verifactu** · aprobar la factura ya aprueba su envío / doble aprobación · **aprobar la factura ya aprueba su envío** · 05-11-2026 · *sin respuesta: se aplica como supuesto*.
- **Q-005 Quién aprueba** · solo en la web con verificación / también por chat · **solo en la web; CVBOT avisa y manda el enlace** · 05-11-2026 · *sin respuesta: se aplica como supuesto*.
- **Q-027 Cuenta de AWS** · AWS (UE) / Neon / Supabase · **AWS en Estocolmo a nombre de CVPO (≈ 30–70 €/mes en total fuera de Timbal)** · 06-11-2026.
- **Q-028 Preguntas a Timbal** · — · **reenviarles la lista de `07-arquitectura.md` §14** · 06-11-2026.
- **Q-007 Quién firma la declaración responsable de Verifactu** · Pedro / una sociedad / Timbal · **decidir con el asesor** · 15-12-2026.
- Resto (no urgentes o con valor por defecto): `docs/QUESTIONS.md` (32 preguntas).
- **Al final (decisión de Pedro)**: **Q-006 Certificado de Verifactu** · solo en AWS con un envío aislado / en Timbal / en el equipo de Pedro / proveedor externo · **solo en AWS; mejor un sello electrónico de CVPO y que P.O dé poder a CVPO para este trámite (confirmar con el asesor)** · como tarde 15-12-2026 (solo bloquea el paso a producción).

## Riesgos (R1… con estado)
- R1 Verifactu de CVPO no listo para el 01-01-2027 · **abierto, el más grave**; control el 01-12-2026 con plan B (Holded, ya adaptado).
- R24 Posibles asientos SILICIE de 2025–2026 incompletos (trasiegos a barrica) y cierre de 2025 que vence ahora · **nuevo**; lo comprueba Pedro con la administradora.
- R25 Aplazamiento de Verifactu anunciado pero no publicado · **nuevo**; vigilamos el BOE cada semana.
- R7 Custodia del certificado · abierto; mitigado con la propuesta nueva (ADR 003).
- R14 Repo público · **aceptado por Pedro y vigilado** (todo anonimizado; la integración continua bloquea datos reales y personales).
- R10 Despliegue doble o remotos desincronizados · abierto; Timbal hace commits por su cuenta: prohibido usar su editor en las ramas de entorno.
- R20 Plazo de M1 muy corto · abierto; depende de aprobar la especificación en 2–3 días.
- Lista completa (R1–R25) en `docs/00-triaje.md`.

## Coste y créditos (Opus/Grok usados; escalados con su motivo)
- **Agente principal**: 1 especificador con **Claude Opus 5.5** (razonamiento máximo).
- **Subagentes lanzados en total: 8**, todos con **Claude Opus 5.5** y todos de investigación documental (Timbal, Verifactu, SILICIE/EMCS, SISV, ecológico y etiquetado, AecocEDI, Holded/Bacosoft, modelos de la AEAT), lanzados a las 12:05 CET, **antes** de la instrucción de limitar el gasto.
  - Terminaron bien 2: Timbal (12:35) y Holded/Bacosoft (13:07).
  - Los otros 6 se cortaron con error a las 13:12 y **no se han relanzado**: aproveché lo que ya habían descargado (normas del BOE, documentación técnica de la AEAT y de la Junta) y escribí yo los documentos.
  - **Desde el primer límite (12:25 CET) no se ha lanzado ningún subagente.** Límite vigente desde las 14:36 CET: **máximo 1 subagente Opus a la vez y solo si es imprescindible**; no se relanzan investigaciones terminadas.
- Grok: no usado (Fase 2). Escalados: ninguno (aún no hay Fase 2).

## Enlaces (PRs, despliegue de staging)
- Rama: `spec/fase-1` · PR de la especificación: https://github.com/pedrolivaresanchez/winecore/pull/1 (contra `main`, pendiente de la aprobación de Pedro).
- Proyecto Timbal: org 122, proyecto 3942, entorno Main 4165 (sin despliegue de WineCore todavía).
- Staging: no existe todavía.

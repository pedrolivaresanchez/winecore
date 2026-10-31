# Progreso WineCore — actualizado 31-10-2026 16:40 CET (Europe/Madrid)
Fase: 2 · Hito: M0 (fundaciones en Timbal) y primeros módulos de M1 · Estado: en curso

## Hecho desde la última actualización
- **Correcciones de Pedro aplicadas** (PR #2): todo en Timbal, sin AWS (datos en la Knowledge Base con un único proceso que escribe); Verifactu pasa a M4 y CVPO sigue en Holded con Verifactu hasta entonces; primero stock, bodega y lotes, después ventas, facturación y SILICIE.
- **M0 en revisión (PR #9)**: API (Bun + Elysia con la estructura de la plantilla de Timbal; esquema completo en DuckDB; auditoría encadenada; acceso con Timbal y lista de usuarios; permisos por rol) y UI móvil primero con los patrones de Holded (menú plegable con submenús, listas densas con filtros y columnas, vista previa lateral, ajustes en panel lateral). Primera pantalla útil: **Contactos**. Integración continua con tests de API y UI.
- **Más PRs pequeños**: #3 validadores de NIF/NIE/CIF, IBAN y GLN · #4 despliegue a Timbal (preparado, desactivado hasta tener la credencial) · #5 MCP para CVBOT (escrituras con confirmación; ninguna herramienta aprueba) · #6 existencias a fecha, aforos y aforo de arranque del 31-12-2026 · #7 motor de operaciones de bodega con los mayores de SILICIE por clase y color · #8 cálculo de factura (IVA, recargo, retención).
- **Capturas de Holded** guardadas anonimizadas en `docs/ui-reference/holded/` (los originales no se suben: el repositorio es público).
- **Equipo de agentes**: Opus solo coordina y revisa; los hijos son Grok 4.7 Extra High (hasta 10 a la vez); ninguno escalado a Opus.

## Siguiente
- En curso: API de Contactos con datos de demostración, API de Catálogo, API de Bodega, API de Existencias, pantallas de Catálogo, Bodega y Existencias, SILICIE (asientos y fichero CSV) y aprobaciones.
- Después: bandeja de aprobaciones con passkey, MCP conectado a CVBOT y M2 (ventas, facturación de P.O y presentación de SILICIE).

## Bloqueos
- **Credencial de Timbal**: sin una API key de una cuenta que solo pertenezca a la org 122 (secreto `TIMBAL_API_KEY` en Cursor → Cloud Agents → Secrets y en GitHub) y el id de la Knowledge Base, no se puede desplegar en el proyecto 3942 ni probar la atomicidad de la Knowledge Base real. Todo lo demás avanza en local y en la integración continua.

## Necesita decisión de Pedro   (pregunta · opciones · recomendación · fecha límite)
- **Cierre de SILICIE 2025 con la administradora** · vence ahora (R24) · comprobar si está hecho · 02-11-2026.
- **Q-004 Credencial de Timbal** · cuenta dedicada solo de la org 122 · crearla y añadir el secreto · 04-11-2026.
- **Q-033 Facturas de 2027 hasta M4** · CVPO en Holded con Verifactu (supuesto aplicado) · comprobar si Holded de P.O ya envía registros a la AEAT: si lo hace, P.O también se queda en Holded hasta M4 · 15-12-2026.
- **Q-028 Preguntas a Timbal** · atomicidad de la Knowledge Base, variables por entorno, dirección pública · reenviarles `07-arquitectura.md` §14 · 06-11-2026.
- **Q-034 Copia del SDR** · opcional (se usan las plantillas públicas de Timbal) · 04-11-2026.
- Q-002, Q-003 y Q-005 siguen aplicadas como supuesto; Q-006 (certificado) al final, en M4. Resto en `docs/QUESTIONS.md`.

## Riesgos (R… con estado)
- R26 Knowledge Base sin transacciones documentadas · mitigado en el código (un solo escritor, comprobación de que nadie más escribe) y probado en DuckDB local; falta la prueba en la Knowledge Base real (necesita la credencial).
- R1 Verifactu · fuera de la ruta crítica (M4, control 01-06-2027); CVPO en Holded hasta entonces.
- R24 SILICIE 2025 · pendiente de comprobar con la administradora.

## Coste
- Subagentes de hoy en Fase 2: unos 20 lanzamientos o reanudaciones, todos Grok 4.7 Extra High; Opus solo como coordinador.

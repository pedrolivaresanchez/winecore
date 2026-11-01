## Tarea

`TASK-XXX-NNN` · enlace a `docs/10-backlog/TASK-XXX-NNN.md`
Historias / RNF: 

## Qué cambia

<!-- Resumen en 3–5 frases: qué hace el PR y qué no hace. -->

## Evidencia de los tests

<!-- Salida resumida de los tests añadidos o cambiados (unitarios, integración, golden, propiedades, e2e). -->

## Lista de comprobación

- [ ] Solo toco los ficheros de la tarea; no cambio esquema, interfaces públicas ni ADR sin una tarea que lo diga.
- [ ] Primero los tests; todos los criterios de aceptación de la tarea están cubiertos y marcados abajo.
- [ ] Sin datos reales (solo `api/db/synthetic.ts` y `api/test/fixtures/synthetic/`); sin secretos, certificados ni `.env`.
- [ ] Nada de datos personales en logs, trazas, prompts ni mensajes de error.
- [ ] Importes con `Decimal` y redondeo HALF_UP; fechas de negocio en Europe/Madrid.
- [ ] Cobertura ≥ 90 % en `billing`, `regulatory`, `inventory` y `cellar` (≥ 80 % en el resto del núcleo).
- [ ] Si cambia un *golden file*: etiqueta `golden-update` y revisión de Opus.
- [ ] Ningún envío a terceros sin aprobación (AEAT, Junta, EDI, certificadora, correo); toda ruta nueva tiene herramienta MCP (escrituras en dos pasos) o exclusión con motivo en `api/src/mcp/parity.ts`.
- [ ] Si la tarea tiene escalado "sí": revisión de Opus solicitada.
- [ ] Si algo de la especificación es ambiguo: lo indico como `BLOQUEADO: <pregunta>` y no improviso.

## Criterios de aceptación de la tarea

- [ ] 

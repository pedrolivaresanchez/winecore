# TASK-RUN-002 · Procedimientos de *computer use*
- Hito M2 · 2 días · Escalado: sí (envíos regulatorios)
- Historias / RNF: US-SIL-03
- Depende de: TASK-RUN-001

## Objetivo
Marco de procedimientos Playwright: pasos declarativos, comprobación de la pantalla esperada antes de cada paso, capturas antes y después de enviar, detección de cambios del portal y salida `needs_human`.

## Contexto
ADR 009 §2–§4 · `03-maquinas-estado.md` §11.

## Ficheros
`runner/src/procedures/_framework.ts`, `runner/src/procedures/README.md`.

## Interfaz exacta
```ts
defineProcedure({ id: 'silicie.import_file', version, steps: Step[], expect: Assertion[], onUnknownScreen: 'needs_human' })
type Step = { goto?; click?; fill?; upload?; waitFor; capture?: 'before'|'after'; submit?: true } // solo un paso 'submit' por procedimiento
```

## Criterios de aceptación
- Si una pantalla no coincide con lo esperado, se detiene antes de enviar.
- El paso `submit` solo se ejecuta si el payload subido tiene el hash aprobado.

## Tests requeridos
Pruebas contra un portal simulado local (HTML estático) con cambios de diseño.

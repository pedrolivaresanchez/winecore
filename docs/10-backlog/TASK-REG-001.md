# TASK-REG-001 · Conector regulatorio y ciclo de vida de envíos
- Hito M2 · 2 días · Escalado: sí (idempotencia de envíos)
- Historias / RNF: US-SIL-02, US-SIL-03
- Depende de: TASK-APR-001, TASK-CORE-006

## Objetivo
Interfaz común de conectores y máquina de estados de `regulatory.submission` (borrador → validado → en aprobación → aprobado → enviando → enviado → aceptado/rechazado) con un solo intento en curso y evidencias.

## Contexto
ADR 009 §1 · `03-maquinas-estado.md` §11 · `02-ddl/0012_regulatory.sql` (WC120, WC121, `connector_run_single_submit_uq`).

## Ficheros
`api/src/core/regulatory/connector.ts`, `api/src/core/regulatory/submissions.ts`, `api/src/routes/regulatory-submissions.ts`.

## Interfaz exacta
```ts
interface RegulatoryConnector<P> { flow: Flow; mode: 'manual'|'computer_use'|'api'; validate(p: P): Issue[]; render(p: P): Promise<Rendered>; submit(run: ConnectorRun): Promise<void> }
createSubmission(tx, { flow, entityId, kind, period, payload }) · requestApproval(tx, id) · enqueueRun(tx, id)
```

## Criterios de aceptación
- El contenido no cambia tras pedir la aprobación (`WC120`).
- Nunca dos intentos de envío en curso (índice único).

## Tests requeridos
Integración de la máquina de estados completa con un conector simulado.

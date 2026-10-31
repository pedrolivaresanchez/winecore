# ADR 009 · Conector regulatorio intercambiable y ejecutor local de *computer use*

- **Estado**: propuesto (requiere Q-026: equipo dedicado) · 31-10-2026
- **Fuentes** (31-10-2026): notas de investigación de Timbal (§8 "computer use: NO ENCONTRADO", §6 aprobaciones y `claim_approval`, §10 secretos por entorno), https://docs.timbal.ai/human-in-the-loop/approval-gates, https://docs.timbal.ai/human-in-the-loop/suspend, https://docs.timbal.ai/models/anthropic (computer use como capacidad del modelo, ejecutada por el cliente), notas de versión de Playwright 1.46 (certificados de cliente TLS en contextos de navegador; **a verificar en el spike de M3**).

## Contexto
- §12.1: las integraciones (SILICIE, SISV, EMCS, AecocEDI) empiezan por **computer use** con aprobación humana previa de cada envío, con una capa de conector intercambiable ("computer use hoy, API mañana").
- **Hechos de Timbal**: no ofrece *computer use* ni navegador gestionado; no documenta certificados de cliente; las variables secretas se limitan **por entorno** (todas las llegan a UI, API y workforce); el proveedor de trazas de la plataforma no implementa la protección contra doble reanudación de una aprobación.
- Los portales de la AEAT (SILICIE, EMCS) y probablemente SISV exigen **certificado electrónico** (o Cl@ve). El certificado de P.O es personal (persona física) y de alto riesgo (R7).

## Decisión

### 1. El "qué" en el núcleo, el "cómo" en el conector
- El núcleo genera para cada envío un **payload canónico** (JSON validado con el esquema del flujo en `04-regulatorio/*.md`), su hash y, si el conector lo necesita, un **artefacto renderizado** (CSV de SILICIE, ficha de AecocEDI, plan de formulario para SISV/EMCS).
- Interfaz en `api/src/core/regulatory/connector.ts`:

```ts
export type Flow = 'verifactu' | 'silicie' | 'sisv' | 'emcs' | 'edi' | 'organic' | 'aeat_model';
export type ConnectorMode = 'api' | 'computer_use' | 'file_upload' | 'manual';
export interface RenderedArtifact { kind: 'csv' | 'xml' | 'json' | 'form_plan' | 'pdf'; filename: string; mime: string; bytes: Uint8Array; sha256: string; }
export interface FormPlan { portal: string; procedure: string; steps: Array<{ id: string; action: 'open'|'fill'|'select'|'upload'|'click'|'assert_text'|'screenshot'|'submit'; target: string; value?: string; description_es: string; }>; }
export interface ConnectorOutcome { status: 'succeeded' | 'failed' | 'needs_human'; external_ref?: string; receipt?: Record<string, string>; errors?: Array<{ code: string; message: string }>; evidence_attachment_ids: string[]; }
export interface RegulatoryConnector {
  readonly flow: Flow;
  readonly mode: ConnectorMode;
  render(submission: SubmissionDTO): Promise<RenderedArtifact | null>;   // determinista y con golden files
  validate(submission: SubmissionDTO): ValidationError[];                  // reglas del flujo
}
```
- Cambiar de *computer use* a API es cambiar `regulatory.connector.mode` y añadir la implementación API; el payload, las validaciones, las aprobaciones y las evidencias no cambian.

### 2. Ejecutor local (`runner/`) para portales con certificado o credenciales
- Programa en TypeScript (Bun) con **Playwright + Chromium**, en un **equipo dedicado** (p. ej. el ordenador nuevo previsto en la reunión) en la bodega o en casa de Pedro, con usuario de sistema propio, disco cifrado y actualizaciones automáticas.
- **El certificado nunca sale de ese equipo**: fichero `.p12` cifrado en el llavero del sistema; Playwright lo usa como certificado de cliente TLS en el contexto del navegador (opción `clientCertificates`; alternativa: Chrome del sistema con la política `AutoSelectCertificateForUrls` para los dominios de la AEAT y de la Junta). Las contraseñas de AecocEDI y SISV (si las hay) también en el llavero.
- **Solo conexiones salientes** HTTPS hacia la API de WineCore (`/api/m2m/runner/*`), autenticado con un token `wc_runner_…` guardado en el llavero.
- Protocolo:

| Paso | Llamada | Detalle |
|---|---|---|
| Latido | `POST /api/m2m/runner/heartbeat` `{runner_code, version, capabilities}` | Cada 60 s; actualiza `regulatory.runner.last_seen_at` |
| Reclamar | `POST /api/m2m/runner/claim` `{capabilities}` | Devuelve un `connector_run` en cola cuyo envío está `approved` (o una lectura sin aprobación: `read_inbox`, `check_status`) o `204`. Dentro de la cola del escritor único (ADR 002): toma el primero, fija `lease_until = now() + 15 min`; **consume la aprobación** en la misma transacción |
| Artefacto | `GET /api/m2m/runner/jobs/{id}/artifact` | Fichero o plan de formulario + payload canónico |
| Progreso | `POST /api/m2m/runner/jobs/{id}/progress` `{step_id, note}` | Renueva el *lease* |
| Evidencias | `POST /api/m2m/runner/jobs/{id}/evidence` (multipart) | Capturas en cada paso clave, acuse/PDF del portal, HTML de la respuesta |
| Resultado | `POST /api/m2m/runner/jobs/{id}/result` `ConnectorOutcome` | Actualiza envío, anotaciones y emite eventos |

- **Procedimientos deterministas** por portal y trámite (`runner/procedures/<portal>-<trámite>.ts`): pasos con selectores estables, `assert_text` antes del envío, captura antes y después de enviar, y extracción del justificante. Si una pantalla no es la esperada → **detenerse** (`needs_human`), dejar el navegador visible y avisar (evento a CVBOT). Una persona puede terminar el trámite a mano en ese equipo y marcarlo; el ejecutor recoge la evidencia. Esto es el *computer use asistido* de §5.2.
- **LLM**: en v1 el modelo no decide clics de envío. Más adelante, un modo "explorador" con un modelo con *computer use* puede **proponer** cómo adaptar un procedimiento cuando cambie el portal, siempre revisado por una persona y nunca en el clic final.
- **Un único envío**: el índice único sobre `connector_run` y el consumo de la aprobación en la reclamación impiden ejecutar dos veces. Si el *lease* vence sin resultado, el intento queda `expired` y el siguiente paso obligatorio es `check_status` (comprobar en el portal si llegó) antes de reintentar.

### 3. Reparto por flujo (estado inicial)

| Flujo | Modo inicial | Dónde se ejecuta | Motivo |
|---|---|---|---|
| Verifactu | `api` (servicio web AEAT) | `api/` en Timbal | Remisión automática e inmediata exigida (ADR 004) |
| SILICIE | `computer_use` sobre la **carga de fichero** del portal (CSV que genera WineCore) | Ejecutor local (certificado de P.O) | Es lo que se hace hoy a mano; §12.1 |
| SISV | `computer_use` (formularios del libro) | Ejecutor local | Sin API conocida (ADR 005) |
| EMCS | `computer_use` (formulario del e-DA en la sede) | Ejecutor local (certificado de P.O) | §12.1; API más adelante si compensa |
| AecocEDI | `computer_use` (lectura de pedidos y tecleo de facturas) + ficha para teclear como respaldo | Ejecutor local | Sin API conocida; términos por confirmar (ADR 006) |
| Modelos AEAT | `manual` (borradores para la asesoría) | — | Los presenta la asesoría |
| Certificadora ecológica | `manual` (informe PDF) | — | Se entrega en la inspección |

### 4. Orquestación en Timbal
- Cada flujo tiene un *workflow* en `workforce/regulatorio-<flujo>/` que: prepara el envío (llama a la API del núcleo), pide la aprobación (`ops.approval_request` + evento a CVBOT), **espera** con `suspend()` hasta que la API le notifica la decisión, encola el intento (`connector_run`) y, al llegar el resultado, informa. La lógica de negocio está en el núcleo; el workflow solo orquesta.
- Las aprobaciones del *approval gate* de Timbal **no** sustituyen a las de WineCore: la fuente de verdad y el consumo único están en la base de datos.

## Alternativas descartadas
- **Navegador en un contenedor de Timbal con el certificado como variable secreta**: la variable llegaría a todos los componentes del entorno, sin IP fija y sin garantías de Chromium en el contenedor (pendiente con Timbal). Inaceptable para un certificado cualificado de persona física.
- **Servicios de navegador en la nube de terceros**: fuera de la UE y sin certificados de cliente.
- **Dar el certificado "al bot"** (reunión [00:02:52]): incompatible con R7 y D8.

## Consecuencias
- Requiere un equipo dedicado encendido en horario laboral (Q-026) y un procedimiento de instalación (`runner/README.md`, tarea `TASK-RUN-001`).
- Los procedimientos de *computer use* se rompen si cambian los portales (R3): se detectan por `assert_text`, se detienen y avisan; nunca envían a ciegas.
- Cuando un flujo pase a API, se hará con su propio ADR y la aprobación de Pedro (§12.1).

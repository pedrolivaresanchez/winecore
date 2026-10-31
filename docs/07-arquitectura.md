# 07 · Arquitectura

> Versión 1 · 31-10-2026. Decisiones en `adr/`: 001 repo y remotos · 002 base de datos · 003 certificado · 004 Verifactu · 005 SISV · 006 AecocEDI · 007 CI/CD · 008 autenticación · 009 conector regulatorio y ejecutor local · 010 MCP · 011 ubicación del núcleo.
> Hechos de Timbal: documentación y código consultados el 31-10-2026 (ver fuentes en cada ADR). Lo no documentado se marca **PENDIENTE (Timbal)** y está en §13.

## 1. Vista general

```mermaid
flowchart LR
  subgraph Personas
    P[Pedro / aprobadores<br/>navegador escritorio y móvil]
    B[Bodega y campo<br/>móvil]
  end
  subgraph Timbal org 122 · proyecto WineCore (id 3942) · entorno = rama (Main 4165 = main)
    UI[ui/<br/>React + Vite]
    API[api/<br/>Elysia + núcleo TS<br/>REST · MCP · jobs]
    WF[workforce/<br/>agentes y workflows Python]
  end
  DB[(PostgreSQL 16<br/>AWS RDS eu-north-1)]
  S3[(S3 eu-north-1<br/>Object Lock)]
  SND[verifactu-sender<br/>AWS Lambda eu-north-1<br/>certificado en Secrets Manager]
  RUN[Ejecutor local<br/>Playwright + certificado<br/>equipo dedicado]
  AEAT[AEAT<br/>servicio web Verifactu]
  PORT[Portales: SILICIE, EMCS,<br/>SISV, AecocEDI]
  CV[CVBOT<br/>cliente MCP]
  M365[Microsoft 365<br/>buzón solo lectura]
  P --> UI
  B --> UI
  UI -->|REST + cookie Timbal| API
  CV -->|MCP /api/m2m/mcp| API
  WF -->|REST/MCP con token| API
  API --> DB
  API --> S3
  SND -->|registros pending / estados| DB
  SND -->|mTLS| AEAT
  RUN -->|HTTPS saliente: reclamar trabajos, evidencias| API
  RUN --> PORT
  WF -->|lectura| M365
  API -->|eventos firmados| CV
```

## 2. Stack

| Capa | Tecnología | Versión mínima | Motivo |
|---|---|---|---|
| UI | React 19, Vite, TypeScript, Tailwind 4, Radix, React Router 7, TanStack Table, Recharts (plantilla `blueprint-ui-simple-chat` de Timbal) + sistema de diseño del SDR (`08-ui/00-sistema-diseno.md`) | Las de la plantilla, fijadas en `ui/package.json` | Plataforma Timbal |
| API + núcleo | Bun, Elysia, `@timbal-ai/timbal-sdk` (auth, cron, MCP), `postgres` (postgres.js), `decimal.js`, `date-fns` + `@date-fns/tz`, TypeBox (esquemas), `@modelcontextprotocol/sdk`, `@simplewebauthn/server`, `pdf-lib` + `qrcode` (PDF y QR), `fast-xml-parser` y `xmlbuilder2` (XML), `undici` (mTLS) | Bun ≥ 1.2; SDK de Timbal fijado a una versión exacta (discrepancia GitHub/npm) | Plataforma Timbal + necesidades fiscales |
| Workforce | Python 3.12, `timbal[all]` (versión fijada), `httpx` | `timbal` 2.8.x | Plataforma Timbal |
| Ejecutor local | Bun + TypeScript + Playwright (Chromium) | Playwright ≥ 1.46 | Certificados de cliente en el navegador (ADR 009) |
| BD | PostgreSQL 16 (RDS eu-north-1) | 16 | ADR 002 |
| Ficheros | S3 eu-north-1 (versionado + Object Lock) | — | ADR 002 |
| Tests | `bun test`, `fast-check` (propiedades), Playwright (e2e), `timbal.evals` (agentes), PostgreSQL de servicio en Actions | — | `11-tests.md` |
| Calidad | Biome (lint/format TS), `tsc --noEmit`, ruff, mypy, gitleaks | — | ADR 007 |

## 3. Estructura del repositorio

```
WineCore/
├── ui/                         # React (Timbal). Pantallas en ui/src/pages/<módulo>/, primitivas en ui/src/ui/
├── api/
│   ├── src/
│   │   ├── core/               # NÚCLEO: dominio, cálculos, máquinas de estado, renderizadores (sin Elysia)
│   │   │   ├── auth/ billing/ catalog/ cellar/ finance/ inventory/ party/ purchasing/
│   │   │   ├── regulatory/{connector.ts, verifactu/, silicie/, sisv/, emcs/, edi/}
│   │   │   ├── traceability/ ids.ts time.ts money.ts db.ts errors.ts events.ts
│   │   ├── routes/             # REST para la UI (/api/v1/...)
│   │   ├── mcp/                # herramientas MCP (13-mcp.md)
│   │   ├── m2m/                # ejecutor local, webhooks, MCP de máquina
│   │   ├── jobs/               # cron (timbalCron)
│   │   └── index.ts            # app Elysia: timbalAuth, módulos, rutas, errores
│   ├── db/{migrations/*.sql, migrate.ts, seed.ts, synthetic.ts}
│   ├── test/{unit, integration, property, golden, fixtures/synthetic}
│   └── certs/                  # certificados raíz públicos (RDS, AEAT); nunca claves privadas
├── workforce/
│   ├── asistente/  ocr-gastos/  regulatorio-silicie/  regulatorio-sisv/
│   ├── regulatorio-emcs/  regulatorio-edi/  vendimia-campo/  resumen-diario/
│   │   └── timbal.yaml, agent.py | workflow.py, pyproject.toml, evals/*.yaml
├── runner/                     # ejecutor local (ADR 009): procedures/, src/, README.md
├── sender/                     # verifactu-sender (ADR 003): función AWS Lambda, reutiliza api/src/core/regulatory/verifactu
├── scripts/                    # utilidades de CI (esperar despliegue, comparar remotos)
├── docs/  context/  .github/
└── .gitignore  .env.example  biome.json  README.md
```

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No hace |
|---|---|---|
| `ui/` | Pantallas (08-ui), formularios, bandeja de aprobaciones con passkey | Lógica de negocio, acceso a BD |
| `api/src/core` | Toda la lógica de negocio: cálculos, invariantes, máquinas de estado, payloads y renderizadores regulatorios, Verifactu (huella, XML, QR) | HTTP, UI |
| `api/src/routes` | REST `/api/v1/*` con validación TypeBox, permisos, idempotencia | Lógica de negocio |
| `api/src/mcp` | Catálogo MCP (ADR 010) | Lógica de negocio; aprobaciones |
| `api/src/jobs` | Cron: cierre intercompañía, vigilantes, outbox, verificaciones | Enviar a la AEAT (lo hace `sender/`) |
| `sender/` | `verifactu-sender` en AWS Lambda (ADR 003): envía los registros ya generados, respeta el control de flujo y guarda respuestas | Generar registros o huellas; emitir facturas |
| `api/src/m2m` | Protocolo del ejecutor local, webhooks (Stripe, M3), MCP de máquina | — |
| `workforce/*` | Orquestación (workflows regulatorios con `suspend()`), extracción (OCR), interfaz conversacional (asistente, vendimia), resumen diario | Escribir en BD directamente; decidir reglas de negocio |
| `runner/` | Ejecutar trabajos aprobados en portales con certificado; subir evidencias | Decidir qué enviar; aprobar |

## 5. Workforce validada (plan §3.4)

| Miembro | Tipo | Hito | Qué hace | Cambios respecto al plan |
|---|---|---|---|---|
| `asistente` | agent | M3 | Chat interno y de inspección: existencias a fecha, trazabilidad de un lote (diagrama), cobros pendientes. Usa las herramientas MCP de solo lectura | — |
| `ocr-gastos` | workflow (paso LLM) | M2 | Extrae campos de una factura recibida (PDF/foto) y la crea `captured` vía API | — |
| `regulatorio-silicie` / `-sisv` / `-emcs` / `-edi` | workflow | M2/M3 | Preparar → pedir aprobación → `suspend()` → encolar intento → informar del resultado | — |
| `vendimia-campo` | agent (voz y foto) | M4 | Controles de maduración, catas y lecturas de fermentación por voz o foto | — |
| `resumen-diario` | workflow (paso LLM barato) | M3 | Resumen diario para CVBOT a partir de eventos (vencimientos, cola, descuadres) | Nuevo (agente intermedio §12.6) |
| ~~`winecore-mcp`~~ | — | — | — | **Se elimina**: el MCP vive en `api/` (ADR 010) para compartir el núcleo |
| ~~`regulatorio-verifactu`~~ | — | — | — | **Se elimina**: el envío es un job determinista en `api/` en la misma BD (ADR 004); un workflow añadiría latencia y otro punto de fallo |
| ~~`conciliacion-cobros`~~ | — | — | — | **Pasa a job** en `api/` (emparejamiento determinista; M6) |

**Vigilantes** (§12.6), como jobs de `api/src/jobs/watchers/` (módulo `watchers`): descuadre físico/fiscal, cuadre SISV↔SILICIE semanal, cobros vencidos, obligaciones a 7 y 1 días, envíos en cola > 24 h, ejecutor local sin latido > 2 h en horario laboral, Verifactu con fallos, fermentaciones paradas. Emiten eventos que el notificador entrega a CVBOT.

## 6. Matriz de permisos

Permisos (claves usadas por `requirePermission`). ✔ = sí; E = solo en las entidades asignadas; — = no.

| Permiso | owner | approver | admin | cellar | field | advisor | agent* | mcp_client* |
|---|---|---|---|---|---|---|---|---|
| `*.read` (lectura de su módulo) | ✔ | ✔ | ✔ | bodega, stock, catálogo | viñedo, bodega (lectura) | ✔ (sin datos de contacto personales) | según alcance | ✔ (según alcance) |
| `contacts.write` | ✔ | — | ✔ | — | — | — | — | con confirmación |
| `catalog.write` | ✔ | — | ✔ | — | — | — | — | — |
| `sales.write` / `sales.manage` | ✔ / ✔ | — | ✔ / — | — | — | — | EDI: `sales.write` | con confirmación / — |
| `billing.write` | ✔ | ✔ | ✔ | — | — | — | — | con confirmación (borradores) |
| `billing.issue` (una factura) | ✔ | ✔ | ✔ | — | — | — | — | **no** |
| `billing.void` | ✔ | E | — | — | — | — | — | no |
| `purchasing.write` / `purchasing.approve` | ✔ / ✔ | — / ✔ | ✔ / — | — | — | — | `ocr-gastos`: `purchasing.write` | con confirmación / no |
| `finance.write` / `finance.manage` | ✔ / ✔ | — | ✔ / — | — | — | — | — | con confirmación / no |
| `inventory.count` | ✔ | — | ✔ | ✔ | — | — | — | — |
| `cellar.operate` / `cellar.manage` | ✔ / ✔ | — | — | ✔ / — | — | — | `vendimia-campo`: lecturas y catas | con confirmación (lecturas, catas) |
| `vineyard.write` | ✔ | — | — | ✔ | ✔ | — | `vendimia-campo` | con confirmación |
| `regulatory.prepare` | ✔ | ✔ | ✔ | — | — | — | workflows regulatorios | con confirmación (borradores y solicitud de aprobación) |
| `regulatory.approve` (decidir aprobaciones) | ✔ | E | — | — | — | — | **nunca** | **nunca** |
| `settings.manage`, `users.manage`, `modules.manage` | ✔ | — | — | — | — | — | — | — |
| `exports.fiscal` | ✔ | ✔ | ✔ | — | — | ✔ | — | — |
| `audit.read` | ✔ | ✔ | — | — | — | ✔ (fiscal) | — | — |
| `runner:*` | — | — | — | — | — | — | solo `runner-local` | — |

\* Los clientes de máquina tienen **alcances** explícitos (`core.api_client.scopes`), nunca roles amplios.

## 7. Flujo de una factura de CVPO en M1 (secuencia)

```mermaid
sequenceDiagram
  participant U as Administración (UI)
  participant A as api (núcleo)
  participant D as PostgreSQL
  participant J as verifactu-sender (AWS Lambda, ADR 003)
  participant T as AEAT (servicio web)
  U->>A: POST /api/v1/invoices/{id}/issue (Idempotency-Key)
  A->>D: BEGIN; set_actor; bloquear factura; validar
  A->>D: take_number; congelar cliente; desglose; vencimientos
  A->>D: verifactu_record (alta, encadenado, huella, XML, QR)
  A->>D: outbox billing.invoice.issued; COMMIT
  A-->>U: 200 factura emitida (número, QR)
  A->>A: generar PDF (QR) → S3 → pdf_attachment_id
  J->>D: registros pending y next_send_not_before ≤ now
  J->>T: RegFactuSistemaFacturacion (mTLS, ≤ máx. por envío)
  T-->>J: Correcto / AceptadoConErrores / Incorrecto + tiempo de espera
  J->>D: estado por registro; CSV; next_send_not_before
  J-->>U: (si error) evento a CVBOT + aviso en el panel
```

## 8. Integraciones

| Sistema | Sentido | Mecanismo | Hito | Doc |
|---|---|---|---|---|
| AEAT Verifactu | salida | Servicio web SOAP con mTLS desde `api/` | M1 | `04-regulatorio/verifactu.md`, ADR 004 |
| AEAT SILICIE | salida | *Computer use* (carga de fichero) desde el ejecutor local | M2 | `silicie.md`, ADR 009 |
| AEAT EMCS | salida/entrada | *Computer use* (formularios de la sede) | M3 | `emcs.md` |
| Junta SISV | salida | *Computer use* | M3 | `sisv.md`, ADR 005 |
| AecocEDI | entrada/salida | *Computer use* + ficha para teclear | M3 | `aecoc-edi.md`, ADR 006 |
| Microsoft 365 (correo) | entrada | Graph **solo lectura** (`Mail.Read` de un buzón concreto) para detectar avisos (AecocEDI, facturas de proveedor reenviadas) | M2 | Q-014 |
| Microsoft 365 (envío) | salida | Opcional, buzón dedicado, solo con clic de una persona | M2 (si Q-014) | Q-014 |
| OneDrive | salida | Copia de consulta de PDF (opcional) | M2 | ADR 002 |
| Stripe (web nueva) | entrada | Webhook firmado → pedido `source = 'web'` | M3 | Q-018 |
| Bancos | entrada | Importación de extractos (Norma 43/CAMT/CSV) | M6 | — |
| Paquetería (Nacex/DHL) | — | Fuera del MVP (datos de envío en el albarán) | Posterior | — |
| CVBOT | entrada (MCP) / salida (eventos) | MCP; eventos firmados con HMAC a `CVBOT_EVENTS_URL` | M1 | `13-mcp.md`, Q-029 |

## 9. Ajustes (catálogo inicial de `core.setting`)

| Clave | Tipo | Defecto | Efecto |
|---|---|---|---|
| `billing.require_lot_on_wine_lines` | boolean | `true` | Lote obligatorio en líneas de vino al emitir |
| `billing.default_payment_terms_days` | integer | 30 | Vencimiento si el cliente no tiene |
| `billing.invoice_description_default` | string | "Venta de vino" | `DescripcionOperacion` por defecto |
| `billing.allow_issue_date_in_past_days` | integer | 0 | Días hacia atrás permitidos en `issue_date` (0 = solo hoy) |
| `inventory.fiscal_exit_rule` | JSON | ver `02-modelo-dominio.md` §10.2 | Fecha fiscal de las salidas (D2/Q-010) |
| `inventory.block_negative_running_balance` | boolean | `true` | Comprobación de saldos en fechas intermedias |
| `intercompany.period` | enum `month` \| `quarter` | `month` | Periodo de liquidación (Q-016) |
| `intercompany.close_day` | integer | 1 | Día del mes en que se cierra el periodo anterior |
| `cellar.alerts.min_density_drop_48h` | decimal | 0.002 | Alerta de fermentación parada |
| `cellar.alerts.temperature_range_c` | [min,max] | [10,30] | Alerta de temperatura |
| `watchers.overdue_reminder_days` | integer[] | [7,30] | Avisos de cobro vencido |
| `regulatory.approval_reminder_hours` | integer | 4 | Recordatorio de aprobaciones pendientes |
| `notifications.cvbot_enabled` | boolean | `true` | Enviar eventos a CVBOT |
| `ui.locale_default` | string | `es-ES` | Idioma por defecto |

## 10. Secretos (dónde viven, quién los rota)

| Secreto | Dónde | Lo usa | Rotación |
|---|---|---|---|
| `DATABASE_URL` (rol app) | Variable secreta de Timbal por entorno | `api/` | 90 días (tarea programada + aviso) |
| `DATABASE_URL_MIGRATOR` | GitHub environment | CI `db-migrate` | 90 días |
| `WINECORE_DATA_KEY` (AES-256 para IBAN y TOTP) | Variable secreta de Timbal | `api/` | Anual (re-cifrado con job) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (usuario IAM limitado al bucket) | Variable secreta de Timbal | `api/` | 90 días |
| Certificado dedicado de Verifactu y su contraseña (ADR 003) | **AWS Secrets Manager** (eu-north-1, clave KMS propia); nunca en Timbal | Solo `verifactu-sender` (rol IAM propio) | Al caducar o ante incidente; aviso 30 días antes |
| Rol de BD `winecore_vf_sender` | AWS Secrets Manager | `verifactu-sender` | 90 días |
| `CVBOT_EVENTS_URL` / `CVBOT_EVENTS_HMAC_KEY` | Variable secreta de Timbal | notificador | Anual |
| Claves de modelos (si no se usa `timbal/auto`) | Variable secreta de Timbal | workforce | Según proveedor |
| `TIMBAL_API_KEY` (cuenta dedicada) | GitHub environment | CI | 90 días |
| Certificado de P.O, contraseñas de portales, token del ejecutor | **Llavero del equipo del ejecutor local** | `runner/` | Según caducidad; inmediata si hay incidente |

Limitación conocida: en Timbal las variables secretas llegan a **todos** los componentes del entorno (no hay restricción por componente), agentes incluidos. Por eso **ningún certificado va a Timbal**: el de P.O se queda en el equipo del ejecutor local y el de Verifactu es uno **dedicado** que solo lee `verifactu-sender` en AWS (ADR 003). Respaldo, solo si AWS no estuviera listo el 20-11-2026: variable secreta de Timbal en `main` y `staging` con certificado de sello.

## 11. Datos personales (RGPD)

| Categoría | Dónde | Base jurídica | Conservación | Acceso |
|---|---|---|---|---|
| Clientes y proveedores personas físicas (nombre, NIF, dirección, contacto) | `party.*`, `billing.invoice.customer_snapshot` | Contrato y obligación legal (facturación) | 6 años desde el último documento (Código de Comercio art. 30; LGT art. 66: 4 años) | owner, admin, approver; advisor sin datos de contacto |
| Consentimientos de marketing (web) | `party.contact.marketing_*` | Consentimiento | Hasta su retirada | owner, admin |
| Usuarios internos | `core.app_user`, auditoría | Interés legítimo / obligación legal (trazabilidad) | Mientras dure la relación + 6 años en auditoría | owner |
| Evidencias de portales (capturas) | S3 `evidence/` | Obligación legal | 6 años (Object Lock) | owner, approver |

- **Encargados**: Timbal (DPA del art. 28, aviso de brecha ≤ 48 h, alojamiento en la UE según su lista de subencargados), AWS (UE), proveedores de modelos de IA (solo los imprescindibles; ver abajo).
- **Minimización en IA**: los prompts a modelos no incluyen NIF, IBAN, emails ni teléfonos salvo que la tarea lo exija (OCR de una factura de proveedor sí los contiene: se usa un modelo con tratamiento en la UE si Timbal lo permite — PENDIENTE (Timbal) — y se registra el proveedor usado). Guardarraíl `RedactSecrets` activado en los agentes.
- **Derechos**: exportación y supresión de un contacto por `owner` (`/api/v1/contacts/{id}/gdpr-export` y `…/gdpr-erase`); la supresión **seudonimiza** cuando hay obligación legal de conservar facturas (se mantiene el NIF en las facturas, se borra el resto).
- **Brechas**: procedimiento en `docs/runbooks/brecha.md` (Fase 2): evaluación en 24 h, notificación a la AEPD en ≤ 72 h si procede.

## 12. Observabilidad, copias y continuidad

- **Logs**: JSON a stdout desde `api/` (los recoge Timbal en CloudWatch, filtrables por componente) con `request_id`, `actor`, `route`, `status`, duración; nunca secretos ni datos personales en claro.
- **Trazas**: cada petición propaga `request_id` a la auditoría, a los eventos y a las llamadas a la workforce; los runs de Timbal se enlazan por `trace_ref`. Exportación OTLP opcional (`OTEL_EXPORTER_OTLP_ENDPOINT`), desactivada por defecto (coste).
- **Alarmas** (Timbal `POST /orgs/122/alarms`, canal email): `deployment.health` de cada componente, `app.run.errors` de la workforce, `org.credits.usage_pct` > 80 %. **Alertas de negocio** (vigilantes → CVBOT y panel): Verifactu con fallos, cola regulatoria atascada, cadena de auditoría rota, copia semanal fallida, deriva de remotos.
- **Salud**: `GET /api/health` → `{status, sha, migrations, db, s3}`; `GET /api/health/deep` (solo `owner`) prueba BD, S3 y conectividad con el endpoint de Verifactu.
- **Copias**: ADR 002 §5 (PITR 35 días, volcado semanal y CSV mensual con Object Lock, prueba de restauración trimestral).
- **Continuidad**: si Timbal cae, los datos están en RDS/S3 (fuera de Timbal) y los PDF emitidos se pueden servir desde S3; el plan de contingencia de facturación es emitir en el plan B (Q-008) y registrar después. Si cae el ejecutor local, los envíos esperan en cola y se avisa.

## 13. Coste mensual estimado (a 31-10-2026; **a confirmar**)

| Concepto | Estimación | Notas |
|---|---|---|
| Timbal (plan, créditos y máquinas) | **PENDIENTE** | Precios no públicos (redirigen a contacto). Preguntar plan para la org 122 |
| AWS RDS PostgreSQL (eu-north-1, instancia pequeña, 20 GB, 35 días de copias) | 20–35 € | ADR 002 |
| AWS S3 + KMS | 1–3 € | Volumen bajo |
| Modelos de IA (OCR ~50 gastos/mes, asistente, resumen diario) | 5–25 € | Modelos baratos por defecto |
| GitHub (repo privado, Actions) | 0–4 € | Plan gratuito o Pro si faltan minutos |
| Equipo del ejecutor local | 0 € recurrente (compra única ~800 € ya prevista en la reunión) | Q-026 |
| Certificado dedicado para Verifactu | 0–150 €/año | Sello cualificado de empresa o representante (ADR 003) |
| `verifactu-sender` (Lambda, Secrets Manager, KMS) | 1–2 € | ADR 003 |
| **Total recurrente fuera de Timbal** | **≈ 30–70 €/mes** | + plan de Timbal |

## 14. Preguntas abiertas a Timbal (las canaliza Pedro; no bloquean la especificación)

1. "Settings → Git Settings → Connect GitHub" **existe** en la UI (Pedro, 31-10-2026). Falta su comportamiento: permisos que pide sobre GitHub, sentido de la sincronización, despliegue automático y si el Composer puede seguir haciendo commits (ADR 001, V1–V7).
2. ¿Cuentas de servicio o tokens con alcance por org/proyecto para CI? ¿Caducidad de las API keys?
3. ¿Acción IAM y rol mínimo para crear proyectos y escribir en el repo git del proyecto?
4. ¿Un push a la rama de un entorno redespliega solo? ¿Cada rama crea un entorno? ¿Coste y ciclo de vida?
5. ¿Se pueden desactivar los commits desde la plataforma (Composer) en un proyecto?
6. ¿`timbalAuth` permite rutas sin login de Timbal (para `/api/m2m/*` con token propio y webhooks)? ¿Quién puede iniciar sesión (solo miembros/invitados de la org)?
7. ¿IP de salida fija o conectividad privada hacia una BD externa?
8. ¿Modo `platform` del cron disponible en nuestro plan? ¿Zona horaria?
9. ¿Host canónico del gateway (`proj-env-<id>` o `e<id>`)? ¿Región real (Estocolmo o Fráncfort)?
10. ¿Se puede limitar el procesamiento de modelos a proveedores con tratamiento en la UE?
11. Plan, créditos, precio de máquinas, SLA y soporte para la org 122.
12. Límites: tamaño de variable secreta, duración máxima de un run, tamaño de despliegue.

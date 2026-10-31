# UI-03 · Bandeja de aprobaciones

| | |
|---|---|
| Rutas | `/aprobaciones` (bandeja) · `/aprobaciones/:id` (detalle) |
| Objetivo | Aprobar o rechazar, con verificación reforzada, exactamente lo que se va a ejecutar (envíos a terceros, lotes de facturas, intercompañía, mermas, regularizaciones, reglas y tarifas) |
| Historias | US-APR-01/02/03, US-CORE-03, US-FACT-08/09, US-SIL-02, US-EMCS-02, US-EDI-03, US-MCP-03 |
| Módulo y permiso | núcleo · ver: solicitante o aprobador de la política; decidir: aprobador según `ops.approval_policy` |
| Patrón | Bandeja + ficha |

## Componentes
`DataTable` (pendientes, decididas, caducadas), `ApprovalCard`, `PayloadSummary`, `DiffView`, `PasskeyPrompt`, `Timeline`, `Dialog` de rechazo con motivo.

## Datos (API)
- `GET /api/v1/approvals?status=pending|decided|expired&kind=` → lista con tipo, entidad, solicitante, resumen, `payload_sha256`, caducidad.
- `GET /api/v1/approvals/{id}` → contenido canónico completo, adjuntos (CSV, XML, PDF), diferencias con la versión anterior, historial.
- `POST /api/v1/approvals/{id}/decision` con `{decision: 'approve'|'reject', reason?, payload_sha256, webauthn_assertion}`; el servidor comprueba que el hash coincide (`WC040`–`WC043`) y que la verificación reforzada es reciente (≤ 5 min).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Aprobar | Aprobador de la política (no el solicitante si la política lo exige) | Decisión inmutable; el trabajo pasa a la cola (ejecutor, emisor o job) | **Passkey** (alternativa TOTP); texto "Vas a aprobar exactamente lo que ves" |
| Rechazar | Ídem | Estado `rejected`; aviso al solicitante y a CVBOT | Motivo obligatorio (≥ 10 caracteres) |
| Abrir origen | Lectura | Navega al documento (factura, envío, operación) | — |
| Descargar adjuntos | Lectura | Descarga el fichero aprobado (hash visible) | — |

No existe "aprobar en lote varias solicitudes": cada solicitud se aprueba por separado (aunque una solicitud pueda contener un lote de facturas).

## Estados
- Vacío: "No hay nada pendiente".
- Caducada: `StatusPill` gris "caducada"; se puede pedir de nuevo desde el origen.
- Contenido cambiado tras pedir la aprobación: imposible por diseño (`WC120`); si el origen se rectifica, la solicitud pasa a `superseded`.
- Sin permiso para decidir: botones ocultos y nota "Solo puede decidir: <rol>".

## Textos
Título "Aprobaciones". Botones "Aprobar" y "Rechazar". Mensaje tras aprobar: "Aprobado. Se ejecutará en unos minutos."

## Móvil
Pensado para el móvil de Pedro: tarjeta a pantalla completa, resumen arriba, "Ver detalle" despliega el contenido; botones fijos abajo; passkey con biometría del teléfono.

## Wireframe
```
Aprobaciones        [Pendientes 3] [Decididas] [Caducadas]
┌────────────────────────────────────────────────────────┐
│ SILICIE · P.O · dic 2026 – jul 2027        caduca 2 d  │
│ 412 asientos · 18.340 L salidas · cuadre SISV: OK      │
│ hash 9F3A…C21                                          │
│ [Ver detalle]              [Rechazar] [Aprobar 🔑]     │
└────────────────────────────────────────────────────────┘
```

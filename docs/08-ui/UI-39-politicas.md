# UI-39 · Políticas de aprobación

| | |
|---|---|
| Ruta | `/ajustes/aprobaciones` |
| Objetivo | Definir quién aprueba cada tipo de acción, cuántas aprobaciones hacen falta, si el solicitante puede aprobar y cuándo caduca la solicitud |
| Historias | US-APR-01/02/03, Q-005 |
| Módulo y permiso | núcleo · `settings.manage`; cambiar una política: aprobación del `owner` |
| Patrón | Formulario por tipo |

## Componentes
`DataTable` de políticas (tipo, entidad, aprobadores, mínimo, auto-aprobación permitida, caducidad, recordatorios), formulario lateral.

## Datos (API)
`GET /api/v1/approval-policies`; `PUT /api/v1/approval-policies/{id}` → solicitud de aprobación.

## Tipos (de `ops.approval_policy`)
Emisión de facturas en lote · factura intercompañía · envío regulatorio · e-DA · factura EDI · informe ecológico · mermas y destrucciones · regularización de aforo · activación de reglas de facturación · activación de tarifas · módulos · cualquier mensaje a terceros.

## Reglas
- Ningún tipo puede quedar sin aprobador; los clientes de máquina nunca son aprobadores.
- Envíos a la AEAT, Junta, EDI y certificadora: mínimo 1 aprobación con passkey; el solicitante no puede auto-aprobarse salvo que Pedro lo decida para su propio usuario (Q-005).

## Móvil
No disponible.

## Wireframe
```
Políticas de aprobación
┌──────────────────────────┬────────┬─────────────┬────┬──────────┬──────────┐
│ Tipo                     │ Entidad│ Aprobadores │ Mín│ Autoaprob│ Caducidad│
│ Envío regulatorio        │ P.O    │ Pedro, P.O  │ 1  │ No       │ 5 días   │
└──────────────────────────┴────────┴─────────────┴────┴──────────┴──────────┘
```

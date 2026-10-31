# UI-40 · Historial (auditoría)

| | |
|---|---|
| Ruta | `/auditoria` |
| Objetivo | Consultar quién hizo qué, cuándo, en nombre de quién y con qué antes/después; verificar que la cadena de auditoría está íntegra |
| Historias | US-CORE-05 |
| Módulo y permiso | núcleo · `audit.read` |
| Patrón | Índice |

## Componentes
`DataTable` (fecha, actor y tipo: persona, agente, sistema, migración; en nombre de; acción; tabla y registro; motivo), detalle con `AuditTrail` (antes/después), botón "Verificar cadena" con resultado.

## Datos (API)
- `GET /api/v1/audit?table=&row_id=&actor=&from=&to=&cursor=`.
- `POST /api/v1/audit/verify?from_id=` (usa `audit.verify_chain`) → primera ruptura o "íntegra".

## Acciones
Solo lectura, exportar CSV y verificar cadena. La auditoría no se puede modificar (`WC003`).

## Estados
Cadena rota: alerta crítica a Pedro y al panel; no debería ocurrir (indica manipulación directa de la base de datos).

## Móvil
No disponible.

## Wireframe
```
Historial         (Facturas) (Últimos 7 días) (Actor: todos)      [Verificar cadena ✓]
┌──────────────┬─────────────────────┬────────┬──────────────────┬───────────┐
│ Fecha        │ Actor               │ Acción │ Registro         │ Motivo    │
│ 14-01 10:41  │ Administración      │ UPDATE │ billing.invoice  │ emisión   │
│ 14-01 10:41  │ sistema · verifactu │ INSERT │ verifactu_record │ —         │
└──────────────┴─────────────────────┴────────┴──────────────────┴───────────┘
```

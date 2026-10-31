# UI-18 · Cobros y pagos

| | |
|---|---|
| Ruta | `/cobros` (pestañas Cobros · Pagos · Extractos · Remesas) |
| Objetivo | Registrar cobros (también de partidas abiertas de Holded), ver lo pendiente y vencido por cliente; desde M6, conciliar extractos y generar remesas |
| Historias | US-FIN-01/02 (M1), US-FIN-03/04 (M6), US-EDI-04, US-MIG-03 |
| Módulo y permiso | billing (M1) / finance (M6) · ver `finance.read`; registrar `finance.write`; remesas `finance.manage` |
| Patrón | Índice + formulario lateral |

## Componentes
`DataTable` de pendientes por cliente con antigüedad (0–30, 31–60, 61–90, > 90), `Drawer` "Registrar cobro" con imputación a varias facturas, `DataTable` de cobros; en M6, importación Norma 43 y sugerencias de conciliación.

## Datos (API)
- `GET /api/v1/receivables?entity=&contact_id=&aging=` (facturas de WineCore y `legacy.open_item`).
- `POST /api/v1/payments` con `{direction, method, amount, value_date, counterparty_id, allocations:[{target_table, target_id, amount}]}` (`Idempotency-Key`).
- `GET /api/v1/payments?entity=&from=&to=`.
- M6: `POST /api/v1/bank-statements` (Norma 43), `GET /api/v1/bank-statements/{id}/suggestions`, `POST /api/v1/remittances` (requiere aprobación).

## Validaciones
- La suma imputada ≤ importe del cobro; cada imputación ≤ pendiente de la factura (`WC100`/`WC101`).
- Cobro en efectivo > 1.000 € con profesionales: aviso (límite legal de pagos en efectivo; confirmar cifra con el asesor).
- Fecha valor no futura.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Registrar cobro | `finance.write` | Actualiza estados de cobro (parcial / cobrada) | — |
| Anular cobro | `finance.write` | Movimiento inverso con motivo | Motivo |
| Marcar incobrable | `finance.manage` | Estado `uncollectible`; propone rectificativa R3 si procede | Motivo |
| Generar remesa SEPA (M6) | `finance.manage` | Fichero para el banco; WineCore no guarda credenciales bancarias | Aprobación |

## Estados
Cliente sin deuda: "Al día". Confirmación de pago de ECI (EDI) pendiente de imputar: banner con enlace.

## Móvil
Consulta de pendientes por cliente.

## Wireframe
```
Cobros     [Cobros] [Pagos] [Extractos] [Remesas]       [Registrar cobro]
┌──────────────────────┬────────┬────────┬────────┬────────┬────────┐
│ Cliente              │ 0–30   │ 31–60  │ 61–90  │ > 90   │ Total  │
│ Cliente Ejemplo S.L. │ 145,20 │  0,00  │  0,00  │ 210,00 │ 355,20 │
└──────────────────────┴────────┴────────┴────────┴────────┴────────┘
```

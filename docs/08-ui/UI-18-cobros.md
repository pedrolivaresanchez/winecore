# UI-18 · Cobros y pagos

| | |
|---|---|
| Ruta | `/cobros` (pestañas Pendiente · Pagos · Conciliación · Remesas, en `?vista=`) |
| Objetivo | Registrar cobros (también de partidas abiertas de Holded), ver lo pendiente y vencido por cliente; desde M6, conciliar extractos y generar remesas |
| Historias | US-FIN-01/02 (M1), US-FIN-03/04 (M6), US-EDI-04, US-MIG-03 |
| Módulo y permiso | billing (M1) / finance (M6) · ver `finance.read`; registrar `finance.write`; remesas `finance.manage` |
| Patrón | Índice + formulario lateral |

## Componentes
Pendiente: franja de cifras de `summary` (pendiente, vencido, vence en 30 días, cobrado este mes, reparto por sociedad), barra de filtros (sociedad, vencido / por vencer, origen, antigüedad, búsqueda de cliente o factura) y un bloque por cliente con sus facturas abiertas; lo vencido en rojo con los días. Cada factura se abre en el visor de documentos (`?doc=holded-invoice:<id>` o `?doc=invoice:<id>`). Diálogo "Registrar cobro" con imputación a varias facturas. Pagos y remesas en tabla paginada; en M6, importación Norma 43 y sugerencias de conciliación.

## Datos (API)
- `GET /api/v1/receivables?entity=&contact_id=&aging=` (facturas de WineCore y `legacy.open_item`; grupos con `key`, partidas con `document_id`, y `summary`).
- `POST /api/v1/payments` con `{direction, method, amount, value_date, counterparty_id, allocations:[{target_table, target_id, amount}]}` (`Idempotency-Key`).
- `GET /api/v1/payments?entity=&direction=&from=&to=&limit=&cursor=`.
- `GET /api/v1/remittances?entity=&status=&kind=&limit=&cursor=`.
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
Cobros  [Pendiente] [Pagos] [Conciliación] [Remesas]               [Registrar cobro]
[Buscar cliente o factura] [Sociedad] [Vencido] [Por vencer] [Origen] [+ Filtro]
┌ Pendiente ──┐┌ Vencido ────┐┌ Vence en 30 d ┐┌ Cobrado mes ┐┌ Por sociedad ──┐
│ 355,20 €    ││ 210,00 €    ││ 145,20 €      ││ 0,00 €      ││ P.O   355,20 € │
└─────────────┘└─────────────┘└───────────────┘└─────────────┘└────────────────┘
┌ Cliente Ejemplo S.L.  2 facturas  P.O          210,00 € vencido  355,20 € [Cobrar] ┐
│ FS-PO-1042  Emitida el 01/09 · vence el 01/10   Vencida hace 31 días      210,00 € │
│ FS-PO-1108  Emitida el 20/10 · vence el 19/11   Vence en 18 días          145,20 € │
└────────────────────────────────────────────────────────────────────────────────────┘
```

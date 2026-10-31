# UI-20 · Movimientos

| | |
|---|---|
| Ruta | `/stock/movimientos` |
| Objetivo | Consultar el libro físico y el fiscal con su documento de origen, para explicar cualquier saldo |
| Historias | US-INV-03/05, US-SIL-01 |
| Módulo y permiso | inventory · `inventory.read` |
| Patrón | Índice (libro) |

## Componentes
`Tabs`: Físico · Fiscal; `DataTable` con filtros (periodo, tipo de movimiento, ubicación, recipiente, lote, producto, documento, asiento SILICIE); enlace al documento de origen; marca de periodo cerrado.

## Datos (API)
- `GET /api/v1/stock/moves?book=physical|fiscal&from=&to=&move_type=&lot_id=&source=&cursor=`.

## Columnas
Fecha (física y fiscal) · tipo · ubicación/recipiente o mayor · lote · producto · L · ud · documento (enlace) · justificante · asiento SILICIE · usuario.

## Acciones
Solo lectura. Los movimientos no se editan (`WC022`); se corrigen rectificando el documento de origen. Exportar CSV.

## Estados
Movimientos de periodos cerrados: icono de candado (`WC021`).

## Móvil
No prioritario (lectura básica).

## Wireframe
```
Movimientos          [Físico] [Fiscal]     (Enero 2027) (Lote L25-T01)
┌────────┬──────────────────┬───────────────┬─────────┬──────────────┐
│ Fecha  │ Tipo             │ Mayor         │ L       │ Documento    │
│ 02-01  │ Cambio de mayor ↑│ GRANEL-TINTO  │ -225,0  │ OB-2027-0003 │
│ 02-01  │ Cambio de mayor ↓│ CRIANZA-TINTO │ +225,0  │ OB-2027-0003 │
└────────┴──────────────────┴───────────────┴─────────┴──────────────┘
```

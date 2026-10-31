# UI-19 · Existencias

| | |
|---|---|
| Ruta | `/stock` |
| Objetivo | Saber qué hay, dónde, de quién y en qué estado, **ahora o en cualquier fecha** (inspección sin aviso), en los dos libros: físico y fiscal |
| Historias | US-INV-02/03/06, US-ASIS-01 |
| Módulo y permiso | inventory · `inventory.read` |
| Patrón | Índice con selector de fecha |

## Componentes
`DateTimePicker` "Existencias a" (por defecto ahora), `Tabs`: Físico · Fiscal; `DataTable` agrupable (ubicación → recipiente → lote → producto); `StatTile` de totales (L granel, botellas por formato); exportar PDF para inspección.

## Datos (API)
- `GET /api/v1/stock/balances?at=&location_id=&owner=&product_id=&lot_id=&state=` (usa `inventory.stock_at`).
- `GET /api/v1/stock/fiscal-balances?at=&tax_warehouse_id=` (usa `inventory.fiscal_at`; mayores `bulk`, `bulk_wood`, `packaged`).
- `GET /api/v1/stock/inspection-report?at=` → PDF firmado con hash (existencias por recipiente y por mayor, con lote y añada).

## Columnas (físico)
Ubicación · recipiente · lote · producto o vino · estado (granel, envasado sin etiquetar, etiquetado) · propietario (P.O/CVPO) · litros · unidades.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Ver trazabilidad del lote | `inventory.read` | UI-24 | — |
| Informe de inspección | `inventory.read` | PDF a la fecha elegida | — |
| Iniciar aforo | `inventory.count` | UI-22 | — |

## Estados
Fecha anterior al arranque (01-01-2027): "WineCore no tiene datos antes del aforo de arranque".

## Móvil
Consulta rápida por recipiente (escaneando su QR) y por producto.

## Wireframe
```
Existencias a [31-01-2027 18:00]           [Físico] [Fiscal]   [Informe]
[Granel 41.250 L] [Botellas 0,75 L 18.420] [BIB 5 L 310]
▸ Bodega (BOD)
   ▸ INOX-03 · L25-T01 · Tinto 2025 · granel · P.O · 4.800 L
   ▸ BAR-012 · L24-C02 · Tinto 2024 crianza · P.O · 225 L
▸ Nave 2 · Botellas sin etiquetar · L25-T01-B1 · 3.600 ud
```

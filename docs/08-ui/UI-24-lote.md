# UI-24 · Lotes y trazabilidad

| | |
|---|---|
| Rutas | `/bodega/lotes` · `/bodega/lotes/:code` |
| Objetivo | Ver un lote con su genealogía completa (parcela → uva → mosto → vino → ensamblajes → botellas → clientes), sus analíticas, adiciones y movimientos |
| Historias | US-INV-06, US-BOD-11, US-ECO-01/02, US-ASIS-01 |
| Módulo y permiso | cellar · `cellar.read` |
| Patrón | Índice + ficha |

## Componentes
`DataTable` de lotes (código, tipo, vino, añada, estado, volumen actual, ubicación); ficha con `Tabs`: Resumen · Genealogía (`MermaidView` ascendente y descendente) · Analíticas (con `Chart` de fermentación) · Adiciones · Movimientos · Ventas · Catas · Historial.

## Datos (API)
- `GET /api/v1/lots?kind=&vintage=&status=&cursor=`; `GET /api/v1/lots/{code}`.
- `GET /api/v1/lots/{code}/traceability?direction=up|down|both` → nodos, aristas y `mermaid` (usa `inventory.lot_ancestors/descendants`).
- `GET /api/v1/lots/{code}/analyses`, `.../additions`, `.../moves`, `.../sales` (albaranes y facturas con cliente).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Añadir analítica | `cellar.operate` | `cellar.analysis` + resultados (PDF del laboratorio adjunto) | — |
| Añadir cata | `cellar.operate` | `cellar.tasting` | — |
| Exportar trazabilidad | `cellar.read` | PDF con genealogía y documentos (para inspección o reclamación) | — |

## Estados
Lote ecológico con SO₂ total por encima del límite ecológico: `Banner` "Supera el límite ecológico de SO₂ (100 mg/L)" (US-ECO-02).

## Móvil
Resumen del lote y genealogía simplificada (lista en vez de diagrama).

## Wireframe
```
Lote L25-T01 · vino · Tinto 2025 · activo · 4.800 L en INOX-03
Resumen | Genealogía | Analíticas | Adiciones | Movimientos | Ventas | Catas
graph LR: P-07 ─▶ UVA-25-07 ─▶ MOSTO-25-03 ─▶ L25-T01 ─▶ L25-T01-B1 ─▶ CA-2027-0103
```

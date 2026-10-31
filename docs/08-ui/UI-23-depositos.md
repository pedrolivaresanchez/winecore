# UI-23 · Depósitos

| | |
|---|---|
| Rutas | `/bodega/depositos` · `/bodega/depositos/:code` |
| Objetivo | Ver el mapa de recipientes (depósitos, barricas, damajuanas) con su contenido, ocupación y alertas, y abrir la ficha de cada uno (también escaneando su QR) |
| Historias | US-BOD-01/10/13, US-INV-02 |
| Módulo y permiso | cellar · ver `cellar.read`; alta y edición `cellar.manage` |
| Patrón | Panel (mapa por zonas) + ficha |

## Componentes
Rejilla por zona/nave con tarjeta por recipiente (código, lote, vino, litros/capacidad con barra, estado: vacío, en fermentación, en crianza, limpio, sucio), filtros (tipo, ocupación, lote), ficha con `Tabs`: Contenido · Lecturas · Analíticas · Limpiezas · Historial; `QrScanner`.

## Datos (API)
- `GET /api/v1/vessels?zone=&kind=&status=`; `GET /api/v1/vessels/{code}` (contenido actual, último movimiento, última lectura, última limpieza).
- `POST /api/v1/vessels` / `PATCH /api/v1/vessels/{code}` (`cellar.manage`).
- `GET /api/v1/vessels/{code}/qr` (etiqueta imprimible con token).

## Campos (alta de recipiente)
Código (`^[A-Z0-9-]{2,20}$`), nombre, tipo, capacidad (L), camisa de frío (obligatoria en fermentadores), material (acero, roble…; determina el mayor SILICIE `bulk_wood` si es barrica de roble), ubicación, zona, código SISV (Q-020).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Nueva operación en este recipiente | `cellar.operate` | UI-25 precargada | — |
| Registrar lectura de fermentación | `cellar.operate` | `cellar.fermentation_reading` | — |
| Registrar limpieza | `cellar.operate` | Operación `cleaning` + `cellar.cleaning_record` (producto, sustancia activa, eficacia) | — |
| Imprimir QR | `cellar.read` | PDF de etiqueta | — |
| Fuera de servicio | `cellar.manage` | Estado; no admite entradas | Motivo |

## Estados
Recipiente con alerta (densidad estancada, temperatura fuera de rango): borde de color de estado y aviso en el panel.

## Móvil
Escanear el QR del depósito abre su ficha con "Lectura", "Operación" y "Limpieza" como acciones principales.

## Wireframe
```
Depósitos                         (Nave 1) (Ocupados) [Escanear QR]
┌ INOX-03 ─────────┐ ┌ INOX-04 ─────────┐ ┌ BAR-012 ─────────┐
│ L25-T01 Tinto 25 │ │ vacío · limpio   │ │ L24-C02 crianza  │
│ ████████░░ 4.800 │ │ ░░░░░░░░░░ 0     │ │ ██████████ 225   │
│ ⚠ densidad 48 h  │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

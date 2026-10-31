# UI-26 · Viñedo

| | |
|---|---|
| Rutas | `/vinedo` · `/vinedo/:code` |
| Objetivo | Gestionar parcelas (SIGPAC, variedades, ecológico), tratamientos (cuaderno de explotación y CUE), labores, controles de maduración y vendimia |
| Historias | US-VIN-01/02/03/04/05, US-ECO-01 |
| Módulo y permiso | vineyard · ver `vineyard.read`; registrar `vineyard.write` |
| Patrón | Índice + ficha con pestañas |

## Componentes
`DataTable` de parcelas (código, SIGPAC, superficie, variedades, ecológico desde, última labor, último tratamiento); ficha con `Tabs`: Datos · Tratamientos · Labores · Maduración · Vendimias; formulario de tratamiento con todos los campos del anexo III del RD 1311/2012.

## Datos (API)
- `GET/POST /api/v1/parcels`; `GET/PATCH /api/v1/parcels/{code}`.
- `POST /api/v1/treatments`, `POST /api/v1/field-tasks`, `POST /api/v1/maturity-checks`, `POST /api/v1/harvests`.
- `GET /api/v1/treatments/export?campaign=` (cuaderno en formato del modelo de la Junta v9 y datos para el CUE).

## Campos del tratamiento y validaciones
| Campo | Validación |
|---|---|
| Fecha, parcela, cultivo y variedad | Obligatorios |
| Plaga o problema (justificación de la necesidad) | Obligatorio en fitosanitarios (2018/848, anexo II I 1.10.2) |
| Aplicador y asesor | Aplicador obligatorio |
| Producto (nombre comercial y nº de registro) | Obligatorio; si la parcela es ecológica, debe estar marcado como apto |
| Equipo y nº ROMA | Obligatorio desde 2027 |
| Superficie tratada (ha), dosis y cantidad | > 0; superficie ≤ superficie de la parcela |
| Eficacia | Texto; se puede completar después |
| Factura | Enlace a la factura recibida (UI-17) |
| Anotado en el CUE | Fecha; aviso a los 20 días si falta |

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Registrar tratamiento / labor / control | `vineyard.write` | Alta | — |
| Cerrar vendimia de una parcela | `vineyard.write` | Enlaza la vendimia con la recepción de uva (US-VIN-05) | — |
| Exportar cuaderno | `vineyard.read` | PDF/CSV de la campaña | — |

## Móvil
Uso principal en campo: registrar labor o tratamiento con la ubicación y foto; control de maduración por CVBOT también disponible.

## Wireframe
```
Parcela P-07 · SIGPAC 23:xxx:x:x:xx · 0,84 ha · ecológica desde 2019
Datos | Tratamientos | Labores | Maduración | Vendimias       [Nuevo tratamiento]
┌────────┬─────────────────┬──────────┬────────┬─────────┬──────────┐
│ Fecha  │ Producto (nº)   │ Problema │ Dosis  │ Aplicad.│ CUE      │
│ 12-05  │ Azufre (ES-xxx) │ Oídio    │ 3 kg/ha│ Operario│ ✓ 20-05  │
└────────┴─────────────────┴──────────┴────────┴─────────┴──────────┘
```

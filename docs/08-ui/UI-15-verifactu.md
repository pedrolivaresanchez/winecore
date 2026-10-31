# UI-15 · Verifactu

| | |
|---|---|
| Ruta | `/facturas/verifactu` |
| Objetivo | Ver el estado de envío de los registros a la AEAT por entidad, resolver rechazos y errores, y consultar la instalación y la declaración responsable |
| Historias | US-VFT-02/03/04/05/06 |
| Módulo y permiso | verifactu · ver `billing.read`; subsanar `billing.issue`; instalación `settings.manage` |
| Patrón | Panel + índice |

## Componentes
`Banner` fijo de registros pendientes (art. 16.4); `StatTile` por entidad (aceptados, con errores, rechazados, pendientes, último envío, tiempo de espera actual); `DataTable` de registros (cadena, factura, tipo alta/anulación, huella abreviada, estado, CSV, error); `Tabs`: Registros · Envíos · Instalación · Declaración responsable · Batería de preproducción.

## Datos (API)
- `GET /api/v1/verifactu/summary?entity=`.
- `GET /api/v1/verifactu/records?entity=&status=&cursor=`; `GET /api/v1/verifactu/records/{id}` (XML, respuesta, huella anterior).
- `GET /api/v1/verifactu/submissions?entity=` (envíos con respuesta global, CSV, `TiempoEsperaEnvio`).
- `POST /api/v1/verifactu/records/{id}/correct` → subsanación o alta por rechazo (genera registro nuevo encadenado).
- `GET /api/v1/verifactu/installations`; `GET /api/v1/verifactu/declaration` (PDF de la versión vigente).
- `GET /api/v1/verifactu/preprod-runs` (resultado de la batería VF-01…VF-22).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Corregir (subsanar) | `billing.issue` | Nuevo registro con `Subsanacion`/`RechazoPrevio` según el caso (verifactu.md §9) | `Dialog` con la diferencia de datos |
| Reintentar ahora | `billing.issue` | Adelanta el envío si ya pasó el tiempo de espera | — |
| Ver XML / respuesta | `billing.read` | Descarga | — |
| Ejecutar batería de preproducción | `settings.manage` | Envía los casos a `prewww1` (solo entorno de pruebas) | `Dialog` |

No hay acción para modificar ni borrar registros (prohibido por `WC130`).

## Estados
- Alerta crítica de huella no coincidente: bloqueo de emisión de esa entidad y `Banner` rojo "Emisión detenida: revisión necesaria".
- Instalación inactiva: "Verifactu no está activo para <entidad>".

## Móvil
Panel de estado (lectura).

## Wireframe
```
Verifactu                                         [P.O | CVPO]
┌ ⚠ 3 registros sin enviar desde 10:42 · reintento cada hora ┐
[Aceptados 1.204] [Con errores 0] [Rechazados 1] [Pendientes 3]
Registros | Envíos | Instalación | Declaración | Preproducción
┌──────┬───────────┬──────┬───────────┬───────────┬──────────┐
│ Nº   │ Factura   │ Tipo │ Huella    │ Estado    │ Acción   │
│ 1207 │ CF27-0099 │ Alta │ 3C46…2F60 │ Rechazado │ Corregir │
└──────┴───────────┴──────┴───────────┴───────────┴──────────┘
```

# UI-28 · Envío regulatorio

| | |
|---|---|
| Ruta | `/regulatorio/envios/:id` |
| Objetivo | Revisar el contenido canónico de un envío (SILICIE, SISV, e-DA, EDI, INFOVI), validarlo, pedir aprobación y seguir su ejecución por el conector con evidencias |
| Historias | US-SIL-02/03/04, US-SISV-02, US-EMCS-02, US-EDI-03, US-INFOVI-01 |
| Módulo y permiso | según flujo · ver `regulatory.read`; preparar `regulatory.prepare`; decidir en UI-03 |
| Patrón | Ficha con `Stepper` (borrador → validado → en aprobación → aprobado → enviando → enviado → aceptado/rechazado) |

## Componentes
`Stepper`, `PayloadSummary` (totales por tipo y mayor), `DataTable` de partidas (asientos, anotaciones, partidas del e-DA) con resultado por partida, `Tabs`: Contenido · Fichero generado · Validación · Ejecución (intentos del conector, ejecutor, capturas) · Evidencias · Historial.

## Datos (API)
- `GET /api/v1/regulatory/submissions/{id}` (+ `items`, `runs`, `evidence`).
- `POST /api/v1/regulatory/submissions/{id}/validate` → errores (`validation_errors`).
- `POST /api/v1/regulatory/submissions/{id}/request-approval` → congela el contenido (`WC120`).
- `POST /api/v1/regulatory/submissions/{id}/cancel` (antes de enviar).
- `GET /api/v1/regulatory/submissions/{id}/file` (CSV, fichero SISV, ficha), `.../evidence/{n}`.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Validar | `regulatory.prepare` | Lista de errores y avisos | — |
| Pedir aprobación | `regulatory.prepare` | Solicitud con hash; contenido congelado | — |
| Cancelar | `regulatory.prepare` | Solo antes de enviar | Motivo |
| Reintentar | `regulatory.prepare` | Nuevo intento si el anterior falló **antes** de enviar | — |
| Resolver "requiere persona" | `regulatory.prepare` | Tras comprobar en el portal: marcar aceptado (con justificante) o reintentar | Adjunto obligatorio |
| Preparar corrección | `regulatory.prepare` | Envío de anulación/rectificación de partidas rechazadas | — |

## Estados
`needs_human`: `Banner` "El conector no pudo confirmar el envío. Comprueba en el portal antes de repetir" (nunca reenvío automático tras pulsar "Enviar").

## Móvil
Lectura del estado y evidencias.

## Wireframe
```
SILICIE · P.O · dic 2026 – jul 2027
borrador ─ validado ─ en aprobación ─ ●aprobado ─ enviando ─ enviado ─ aceptado
Contenido | Fichero | Validación | Ejecución | Evidencias | Historial
[Asientos 412] [Salidas 18.340 L] [Errores 0] [Cuadre SISV ✓]
Ejecución: intento 1 · ejecutor "Equipo bodega" · en curso desde 10:14
```

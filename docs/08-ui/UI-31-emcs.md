# UI-31 · e-DA (EMCS)

| | |
|---|---|
| Rutas | `/regulatorio/emcs` · `/regulatorio/emcs/:id` |
| Objetivo | Preparar, aprobar y seguir los e-DA de exportación y envíos en régimen suspensivo, con su ARC, recepción y paquete para el transitario |
| Historias | US-EMCS-01/02/03/04, US-SISV-03 |
| Módulo y permiso | emcs · ver `regulatory.read`; preparar `regulatory.prepare`; decidir en UI-03 |
| Patrón | Índice + ficha |

## Componentes
`DataTable` (LRN, ARC, albarán, destinatario, tipo de destino, estado); ficha por grupos del IE815 (expedidor, destinatario, lugar de entrega o aduana, transporte, partidas, datos vitivinícolas) con origen de cada dato; `Timeline` de mensajes (envío, recepción, exportación, anulación, cambio de destino).

## Datos (API)
- `GET /api/v1/emcs/documents?status=`; `GET /api/v1/emcs/documents/{id}`.
- `POST /api/v1/emcs/documents` (desde albarán); `PATCH` (borrador); `POST .../validate`; `POST .../request-approval`.
- `POST /api/v1/emcs/documents/{id}/cancel-request`, `.../change-destination-request` (cada uno con aprobación).
- `GET /api/v1/emcs/documents/{id}/forwarder-pack` (ZIP para el transitario).

## Validaciones
Campos obligatorios según tipo de destino (`emcs.md` §4); categoría y zona vitícola (C III b → 6); operaciones enológicas derivadas de las adiciones del lote; fecha de expedición no pasada.

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Pedir aprobación | `regulatory.prepare` | Congela el e-DA | — |
| Anular / cambiar destino | `regulatory.prepare` | Solicitud del mensaje correspondiente | Aprobación |
| Descargar paquete del transitario | `regulatory.read` | ZIP | — |

## Estados
Aceptado con ARC: el albarán se puede marcar expedido. Rechazado por el portal: errores en claro y vuelta a borrador.

## Móvil
Lectura de estado y ARC.

## Wireframe
```
e-DA EA-2027-0007 · aceptado · ARC 27ES00000000000000001
Albarán CA-2027-0103 → Cliente Ejemplo Ltd (Reino Unido) · Destino 3 Exportación
Partidas: W200 · 22042xxx · 90,000 L · 13,5 % vol · zona C III b · ops. enológicas 2
Mensajes: enviado 10-03 · exportación confirmada 14-03          [Paquete transitario]
```

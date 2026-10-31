# UI-27 · Calendario regulatorio

| | |
|---|---|
| Ruta | `/regulatorio` |
| Objetivo | Ver todas las obligaciones (SILICIE, SISV, INFOVI, cosecha, cierres de ejercicio, Verifactu, modelos de la asesoría) con su plazo, estado y envío asociado |
| Historias | US-SIL-02/06, US-SISV-02, US-INFOVI-01, US-ASIS-03 |
| Módulo y permiso | regulatorio (cualquiera activo) · `regulatory.read`; preparar `regulatory.prepare` |
| Patrón | Panel (lista por fecha + vista mes) |

## Componentes
Lista agrupada por semana con `StatusPill` (pendiente, preparado, en aprobación, presentado, vencido), vista de mes, filtros por flujo y entidad, base legal en cada obligación.

## Datos (API)
- `GET /api/v1/regulatory/obligations?from=&to=&flow=&entity=` (`regulatory.obligation` con `legal_basis`).
- `POST /api/v1/regulatory/submissions` (preparar el envío de una obligación; UI-28).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Preparar envío | `regulatory.prepare` | Crea el borrador del envío del periodo | — |
| Marcar presentado fuera de WineCore | `regulatory.prepare` | Estado `submitted` con justificante adjunto | Adjunto obligatorio |

## Estados
Obligación a ≤ 7 días sin preparar: fila destacada. Vencida: roja y aviso al panel.

## Móvil
Lista de los próximos 30 días.

## Wireframe
```
Calendario            (Todos los flujos) (P.O)               [Mes ▾]
Semana 45
 10-11  SISV · libros de octubre             preparado      [Ver envío]
Semana 51
 20-12  INFOVI · declaración de diciembre    pendiente      [Preparar]
 31-12  SILICIE · asientos ago–nov 2027      en aprobación  [Ver envío]
```

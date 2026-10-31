# TASK-REP-002 · Gráficos de ventas, gastos y stock por producto, lote y año
- Hito M1 (stock) / M2 · 1,5 días · Escalado: no
- Historias / RNF: US-REP-01
- Depende de: TASK-INV-005, TASK-FACT-011, TASK-COMP-003

## Objetivo
Gráficos de ventas, gastos y stock por producto, lote y año (y por entidad), con comparación con el año anterior y exportación de los datos.

## Contexto
`08-ui/UI-33` (informes) · `02-modelo-dominio.md` §10, §12 y §13.

## Interfaz exacta
Rutas de agregados `GET /v1/reports/{sales|expenses|stock}?group_by=product|lot|year&from=&to=&entity=`; gráficos con el sistema de diseño de la UI.

## Criterios de aceptación
- Los totales de cada gráfico coinciden con el libro de emitidas, el de recibidas y las existencias a fecha.
- Respuesta < 1 s con el volumen x10.

## Tests requeridos
Integración de los agregados contra los libros; prueba de rendimiento x10.

# TASK-FIN-003 · Extractos y conciliación de transferencias (Norma 43/CAMT)
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-FIN-03
- Depende de: TASK-FIN-001

## Objetivo
Importar extractos bancarios, deduplicar movimientos, sugerir la factura o el gasto que corresponde y crear el cobro o el pago al confirmar.

## Contexto
`02-ddl/0011_finance.sql` (`finance.bank_statement_import`, `bank_statement_line`) · UI-18.

## Interfaz exacta
Lectores de Norma 43 (AEB 43) y CAMT.053; deduplicación por cuenta, fecha, importe y referencia; sugerencias por importe, referencia y contacto; confirmar crea `finance.payment` imputado.

## Criterios de aceptación
- Importar dos veces el mismo extracto no duplica movimientos.
- Una transferencia con el número de factura en el concepto se sugiere con esa factura.

## Tests requeridos
Unitarios de los lectores con ficheros sintéticos; integración de importar → sugerir → confirmar.

# TASK-FIN-004 · Remesas SEPA (adeudos pain.008 y transferencias pain.001)
- Hito M2 · 1,5 días · Escalado: sí (bancos)
- Historias / RNF: US-FIN-04
- Depende de: TASK-FIN-001, TASK-APR-001

## Objetivo
Remesas de adeudos directos para cobrar a clientes con mandato y de transferencias para pagar a proveedores, con aprobación; WineCore genera el fichero y una persona lo sube al banco.

## Contexto
`02-ddl/0011_finance.sql` (`finance.remittance`, `remittance_item`) · `party.contact` (mandato SEPA) · regla dura: sin claves bancarias.

## Interfaz exacta
Generadores pain.008.001.02 y pain.001.001.03 validados contra sus esquemas XSD; remesa en borrador → aprobación → fichero; marcar como presentada y conciliar después con el extracto.

## Criterios de aceptación
- Sin mandato SEPA (referencia y fecha) un cliente no entra en una remesa de adeudos.
- El fichero solo se genera tras la aprobación y su hash queda en la auditoría.

## Tests requeridos
Golden de XML con datos sintéticos validados contra el XSD; integración de borrador → aprobación → fichero.

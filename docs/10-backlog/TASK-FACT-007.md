# TASK-FACT-007 · Exportación, intracomunitaria y Canarias
- Hito M2 · 1 día · Escalado: sí (IVA)
- Historias / RNF: US-FACT-07
- Depende de: TASK-FACT-003

## Objetivo
Facturas con `EXP_E2` (Reino Unido, fuera de la UE, Canarias) e `INTRA_E5` (NIF-IVA validado en VIES), con menciones legales ES/EN y destinatario con `IDOtro` cuando corresponda.

## Contexto
`04-regulatorio/verifactu.md` §5–§6 (validaciones 15.5.1 y 15.6.1) · Q-019.

## Ficheros
`api/src/core/billing/taxTreatments.ts`.

## Interfaz exacta
`suggestTaxCode(customer, deliveryCountry): TaxCode` y validación previa a la emisión (`WC_INV_VIES_REQUIRED`).

## Criterios de aceptación
- Intracomunitaria sin NIF-IVA validado → "Valida el NIF-IVA en VIES".
- Exportación no lleva tipo ni cuota.

## Tests requeridos
Golden de los registros VF-05, VF-06, VF-07.

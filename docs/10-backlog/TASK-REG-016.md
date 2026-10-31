# TASK-REG-016 · e-DA desde albarán
- Hito M3 · 2 días · Escalado: sí (II.EE.)
- Historias / RNF: US-EMCS-01, US-SISV-03
- Depende de: TASK-VENT-003, TASK-REG-001

## Objetivo
Decidir el documento necesario por venta (`emcs.md` §2), crear el e-DA con los campos canónicos del IE815 desde el albarán, validar por tipo de destino y numerar el LRN.

## Contexto
`04-regulatorio/emcs.md` §2 y §4 · tablas ADI1T032, ADI1T038, ADI1T040, ADI1T041.

## Ficheros
`api/src/core/regulatory/emcs/document.ts`, `.../validate.ts`, `.../wineData.ts`.

## Interfaz exacta
```ts
requiredDocument(dn: DeliveryNote): { kind: 'e_ad_internal'|'e_ad_eu'|'e_sad'|'none'; destinationType?: number }
draftFromDeliveryNote(tx, dnId): Promise<EmcsDocument>
wineOperationCodes(lotId): number[] // desde cellar.addition en la ascendencia
```

## Criterios de aceptación
- Exportación por aduana española → e-DA interno destino 3; zona vitícola 6; ácido tartárico acidificante → código 2.

## Tests requeridos
Golden de los casos de `emcs.md` §9.

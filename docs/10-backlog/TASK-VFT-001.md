# TASK-VFT-001 · Huella y serialización canónica
- Hito M1 · 1 día · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-01
- Depende de: TASK-CORE-001

## Objetivo
Calcular la huella SHA-256 de registros de alta y anulación exactamente como la especificación de la AEAT, desde los **mismos valores** que se escriben en el XML.

## Contexto
`04-regulatorio/verifactu.md` §7 (orden de campos, formato, vectores oficiales) · Orden HAC/1177/2024 art. 13.

## Ficheros
`api/src/core/regulatory/verifactu/hash.ts`, `api/src/core/regulatory/verifactu/canonical.ts`.

## Interfaz exacta
```ts
export type AltaHashInput = { IDEmisorFactura; NumSerieFactura; FechaExpedicionFactura; TipoFactura; CuotaTotal; ImporteTotal; Huella: string|''; FechaHoraHusoGenRegistro }
export type AnulacionHashInput = { IDEmisorFacturaAnulada; NumSerieFacturaAnulada; FechaExpedicionFacturaAnulada; Huella: string|''; FechaHoraHusoGenRegistro }
export function hashAlta(i: AltaHashInput): string      // 64 hex en mayúsculas
export function hashAnulacion(i: AnulacionHashInput): string
export function formatAmount(d: Decimal): string         // '123.45', '12.35'
```

## Criterios de aceptación
- Los tres vectores oficiales de `verifactu.md` §7 dan exactamente las huellas esperadas.
- Recorte de espacios al principio y al final; campos vacíos como `Campo=`.

## Tests requeridos
`api/test/unit/verifactu/hash.test.ts` con los 3 vectores; propiedad: XML generado → valores extraídos → misma huella.

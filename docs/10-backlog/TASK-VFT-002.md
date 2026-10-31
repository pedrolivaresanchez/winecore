# TASK-VFT-002 · Registros de alta y anulación encadenados
- Hito M1 · 2 días · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-01
- Depende de: TASK-VFT-001, TASK-CORE-002

## Objetivo
Generar `RegistroAlta` y `RegistroAnulacion` (XML v1.0 válido contra los XSD de la AEAT) campo a campo según `verifactu.md` §5, encadenarlos por instalación con bloqueo y guardar XML, huella y URL del QR.

## Contexto
`04-regulatorio/verifactu.md` §5–§8 · `02-ddl/0012_regulatory.sql` (WC130, WC131).

## Ficheros
`api/src/core/regulatory/verifactu/record.ts`, `.../xml.ts`, `.../qr.ts`, `api/src/core/regulatory/verifactu/schemas/*.xsd` (copia de los oficiales con su versión).

## Interfaz exacta
```ts
export async function createAltaRecord(tx, invoice: IssuedInvoiceSnapshot, opts?: { subsanacion?: boolean; rechazoPrevio?: 'N'|'S'|'X' }): Promise<VerifactuRecord>
export async function createAnulacionRecord(tx, invoice: InvoiceRef, opts?: { rechazoPrevio?: 'N'|'S'; sinRegistroPrevio?: boolean }): Promise<VerifactuRecord>
export function qrUrl(env: 'test'|'production', p: { nif; numserie; fecha; importe }): string
```

## Criterios de aceptación
- XML válido contra `SuministroLR.xsd`; `FechaHoraHusoGenRegistro` con el desfase de Madrid y monótona (`WC131`).
- Dos emisiones concurrentes de la misma entidad producen una cadena correcta (bloqueo por instalación).
- `ImporteTotal` = subtotal + IVA + recargo (sin retención).

## Tests requeridos
Golden XML de VF-01…VF-04, VF-11; validación XSD en CI; concurrencia de 20 registros.

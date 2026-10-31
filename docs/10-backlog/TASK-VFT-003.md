# TASK-VFT-003 · Cliente SOAP y respuestas
- Hito M1 · 1,5 días · Escalado: sí (Verifactu)
- Historias / RNF: US-VFT-02
- Depende de: TASK-VFT-002

## Objetivo
Construir el mensaje `RegFactuSistemaFacturacion` (cabecera + hasta 1.000 registros) e interpretar la respuesta (estado global, CSV, estado por registro, errores, duplicados, `TiempoEsperaEnvio`); consulta `ConsultaFactuSistemaFacturacion`.

## Contexto
`04-regulatorio/verifactu.md` §10–§11 · WSDL y XSD v1.0.

## Ficheros
`api/src/core/regulatory/verifactu/soap.ts`, `.../response.ts`, `.../query.ts`.

## Interfaz exacta
```ts
export function buildSubmission(header: { obligado: { nif; nombre }; incidencia: boolean }, records: VerifactuRecord[]): string // ≤ 1.000
export function parseResponse(xml: string): { global: 'Correcto'|'ParcialmenteCorrecto'|'Incorrecto'; csv?: string; waitSeconds: number; perRecord: { key; status: 'Correcto'|'AceptadoConErrores'|'Incorrecto'; code?; text?; duplicate?: 'Correcta'|'AceptadaConErrores'|'Anulada' }[] }
```
Sin certificado ni red: el transporte lo hace el emisor (TASK-VFT-004).

## Criterios de aceptación
- Respuestas de ejemplo de la AEAT y las grabadas en preproducción se interpretan sin errores.

## Tests requeridos
Golden de peticiones y respuestas (`api/test/golden/verifactu/`), incluidos duplicado y parcialmente correcto.

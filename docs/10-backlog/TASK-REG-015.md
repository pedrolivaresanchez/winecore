# TASK-REG-015 · Certificación del enólogo
- Hito M3 · 0,5 días · Escalado: no
- Historias / RNF: US-SISV-02
- Depende de: TASK-REG-013

## Objetivo
PDF mensual de certificación de las manipulaciones (procesos y prácticas) para que lo firme el enólogo o técnico responsable.

## Contexto
`04-regulatorio/sisv.md` §1 (Orden de 14-11-2012, art. 26.4).

## Ficheros
`api/src/core/regulatory/sisv/certificate.tsx`.

## Interfaz exacta
`renderOenologistCertificate({ entityId, month }): Uint8Array` con la lista de anotaciones ELABORA y PRACTICA del mes; se adjunta al envío.

## Criterios de aceptación
- WineCore no firma: deja el espacio de firma y guarda la versión firmada que suba la persona.

## Tests requeridos
Golden por texto extraído.

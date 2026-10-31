# TASK-INFRA-005 · Secretos y configuración por entorno
- Hito M0 · 0,5 días · Escalado: sí (seguridad)
- Historias / RNF: RNF-05
- Depende de: TASK-INFRA-003, TASK-INFRA-004

## Objetivo
Dar de alta las variables de cada entorno en Timbal y en los *environments* de GitHub según `07-arquitectura.md` §10, con rotación programada.

## Contexto
`07-arquitectura.md` §10 (tabla de secretos) · ADR 003 · regla dura 0.2.

## Ficheros
`docs/runbooks/secretos.md` (qué, dónde, quién rota, cada cuánto; **sin valores**), `api/src/core/config.ts` (lectura validada con TypeBox).

## Interfaz exacta
`export const config: Readonly<{ databaseUrl: string; s3Bucket: string; dataKey: Uint8Array; cvbotEventsUrl?: string; ... }>` — falla al arrancar si falta una variable obligatoria (mensaje con el **nombre**, nunca con el valor).

## Criterios de aceptación
- Ningún certificado en Timbal (ADR 003).
- `config.ts` nunca registra valores; test que lo comprueba.
- Recordatorios de rotación de 90 días creados como obligaciones internas.

## Tests requeridos
Unitarios de `config.ts` (falta una variable → error con el nombre; los logs no contienen valores).

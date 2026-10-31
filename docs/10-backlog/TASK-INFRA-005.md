# TASK-INFRA-005 · Secretos y configuración por entorno
- Hito M0 · 0,5 días · Escalado: sí (seguridad)
- Historias / RNF: RNF-05
- Depende de: TASK-INFRA-003, TASK-INFRA-004

## Objetivo
Dar de alta las variables de cada entorno como variables de proyecto de Timbal (`type: secret` y `env_ids`) y en los *environments* de GitHub según `07-arquitectura.md` §10, con rotación programada.

## Contexto
`07-arquitectura.md` §10 (tabla de secretos y limitación de Timbal) · ADR 003 · regla dura 0.2.

## Ficheros
`docs/runbooks/secretos.md` (qué, dónde, quién rota, cada cuánto; **sin valores**), `api/src/core/config.ts` (lectura validada con TypeBox).

## Interfaz exacta
`export const config: Readonly<{ role: 'app' | 'verifactu-sender'; timbalOrgId: string; timbalKbId: string; dataKey: Uint8Array; cvbotEventsUrl?: string; cvbotEventsHmacKey?: Uint8Array }>` — falla al arrancar si falta una variable obligatoria (mensaje con el **nombre**, nunca con el valor).

## Criterios de aceptación
- Ningún certificado en Timbal hasta M4, y entonces solo en el entorno `verifactu` (ADR 003).
- `TIMBAL_API_KEY` solo en los *environments* de GitHub y en los secretos del agente, de una cuenta dedicada solo de la org 122.
- `config.ts` nunca registra valores; test que lo comprueba.
- Recordatorios de rotación de 90 días creados como obligaciones internas.

## Tests requeridos
Unitarios de `config.ts` (falta una variable → error con el nombre; los logs no contienen valores).

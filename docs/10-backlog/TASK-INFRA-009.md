# TASK-INFRA-009 · Entorno `verifactu` en Timbal y alta del certificado
- Hito M4 · 1 día · Escalado: sí (custodia del certificado)
- Historias / RNF: US-VFT-02, RNF-05
- Depende de: TASK-INFRA-004, TASK-INFRA-006, Q-006 (se decide al final, antes de activar Verifactu; en preproducción se usa un certificado de pruebas)

## Objetivo
Crear los entornos `verifactu` y `verifactu-pruebas` del proyecto 3942 (solo el componente `api` con `WINECORE_ROLE=verifactu-sender`; UI y workforce con `deploy_mode: disabled`) y el procedimiento guiado para que **Pedro** suba el certificado dedicado como variable secreta limitada a ese entorno, lo renueve y lo revoque, sin que nadie más vea el fichero ni la contraseña.

## Contexto
ADR 003 · `07-arquitectura.md` §10 (limitación de las variables de Timbal) · `04-regulatorio/verifactu.md` §10 y §11.

## Ficheros
`docs/runbooks/certificado-verifactu.md`, `api/src/core/regulatory/verifactu/cert-expiry.ts`, `scripts/check-env-isolation.ts`.

## Interfaz exacta
`certExpiry()` (lo ejecuta el emisor una vez al día) → `{ notAfter: string, daysLeft: number }` **sin** exponer el certificado; aviso desde 30 días. `check-env-isolation.ts --var <nombre>` → consulta `/api/health/env` de cada entorno, que solo responde si la variable **existe** (nunca su valor).

## Criterios de aceptación
- La variable del certificado existe en `verifactu` y **no** existe en Main ni en el resto de entornos (comprobado antes de subir el certificado real, con una variable de prueba).
- En `verifactu` no corre nada más que el emisor; el emisor no accede a la Knowledge Base (ADR 003).
- El runbook cubre alta, renovación, revocación ante incidente y entorno de pruebas.

## Tests requeridos
Unitario de `certExpiry` con un certificado sintético autofirmado generado en el test; ejecución de `check-env-isolation.ts` adjunta al PR.
